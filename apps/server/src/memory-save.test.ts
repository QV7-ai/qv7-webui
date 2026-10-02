import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { openDb } from "./db/index.ts";
import { memories, users } from "./db/schema.ts";
import type { Env } from "./env.ts";
import { saveUserMemories } from "./memory.ts";
import { fallbackMemoryDrafts, isDurableMemory } from "./memory-ops.ts";

test("persists the name message and the hobbies message", () => {
  const file = path.join(os.tmpdir(), `qv7-memory-${Date.now()}.db`);
  const db = openDb({ databaseUrl: file } as Env);
  const now = Date.now();
  db.insert(users)
    .values({
      id: "user-1",
      email: "memory@example.com",
      username: "quinten",
      passwordHash: "x",
      role: "user",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const messages = [
    "Hello my name is quinten im 22 years old and born on 7 may 2004",
    "my hobbies are Designing programming and it stuff",
  ];
  for (const message of messages) {
    const drafts = fallbackMemoryDrafts(message);
    assert.ok(drafts.length > 0);
    assert.ok(drafts.every((item) => isDurableMemory(item.content)));
    saveUserMemories(db, "user-1", drafts, "chat-1");
  }
  const rows = db.select().from(memories).where(eq(memories.userId, "user-1")).all();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => /Quinten/.test(row.content) && /22/.test(row.content) && /May 7, 2004/.test(row.content)));
  const hobbies = rows.find((row) => /design/i.test(row.content));
  assert.ok(hobbies);
  assert.match(hobbies.content, /program/i);
  assert.match(hobbies.content, /\bit\b/i);
  assert.equal(hobbies.path, "Interests");
  assert.equal(hobbies.category, "preference");
  for (const extra of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.rmSync(extra, { force: true });
    } catch {
      /* the database handle stays open until the process exits */
    }
  }
});
