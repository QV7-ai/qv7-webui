import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactFilename,
  keepManualEdit,
  parseArtifactFences,
  parseCanvases,
  previewSandbox,
  stripArtifactFences,
  takeReplyArtifact,
} from "@wlfv/shared";
import {
  createArtifact,
  deleteArtifact,
  listArtifacts,
  listVersions,
  readArtifact,
  recordReplyArtifact,
  restoreArtifact,
  updateArtifact,
} from "./artifacts.ts";
import { openDb } from "./db/index.ts";
import { conversations, users } from "./db/schema.ts";
import type { Env } from "./env.ts";

test("artifact fences stay out of the chat and keep a file name", () => {
  const text = "I made a landing page.\n\n```artifact tsx\ntitle: Landing\ntype: react\nlanguage: tsx\n\nexport function Landing(){return <main/>}\n```";
  const [file] = parseArtifactFences(text);
  assert.equal(file?.title, "Landing");
  assert.equal(file?.type, "react");
  assert.equal(file?.language, "tsx");
  assert.match(file?.content || "", /Landing/);
  assert.equal(stripArtifactFences(text).includes("export function"), false);
  assert.match(stripArtifactFences(text), /landing page/);
  assert.equal(artifactFilename("Landing", "react", "tsx"), "Landing.tsx");
  assert.equal(artifactFilename("Query", "sql", "sql"), "Query.sql");
  assert.equal(artifactFilename("Notes", "markdown", "md"), "Notes.md");
  assert.equal(keepManualEdit("edited", "sent"), true);
  assert.equal(keepManualEdit("same", "same"), false);
  assert.equal(previewSandbox("html"), "allow-scripts");
  assert.equal(String(previewSandbox("html")).includes("allow-same-origin"), false);
  assert.equal(previewSandbox("svg"), "");
  assert.equal(previewSandbox("markdown"), null);
});

test("html canvas replies still open as an html artifact", () => {
  const text = "Here is the page.\n\n```html\n<!DOCTYPE html><html><head><title>Plants</title></head><body><h1>Plants</h1></body></html>\n```";
  assert.equal(parseCanvases(text)[0]?.title, "Plants");
  const file = takeReplyArtifact(text);
  assert.equal(file?.type, "html");
  assert.match(file?.content || "", /Plants/);
});

test("artifacts stay with their user and conversation and can be restored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "qv7-artifacts-"));
  const db = openDb({ databaseUrl: path.join(dir, "test.db") } as Env);
  const now = Date.now();
  db.insert(users).values({ id: "user-a", email: "a@example.com", username: "a", passwordHash: "x", role: "user", createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: "user-b", email: "b@example.com", username: "b", passwordHash: "x", role: "user", createdAt: now, updatedAt: now }).run();
  db.insert(conversations).values({ id: "chat-a", userId: "user-a", title: "Chat", createdAt: now, updatedAt: now }).run();
  db.insert(conversations).values({ id: "chat-b", userId: "user-b", title: "Other", createdAt: now, updatedAt: now }).run();

  const created = createArtifact(db, {
    userId: "user-a",
    conversationId: "chat-a",
    messageId: "m1",
    file: { title: "Query", type: "sql", language: "sql", content: "select 1" },
    source: "ai",
  });
  assert.ok(created);
  assert.equal(readArtifact(db, "user-b", created.id), null);
  assert.equal(listArtifacts(db, "user-b", "chat-a"), null);
  assert.equal(listArtifacts(db, "user-a", "chat-b"), null);
  assert.equal(deleteArtifact(db, "user-b", created.id), false);

  const edited = updateArtifact(db, { userId: "user-a", id: created.id, content: "select 1\n-- mine", source: "user" });
  assert.equal(edited?.content, "select 1\n-- mine");
  const revised = recordReplyArtifact(db, {
    userId: "user-a",
    conversationId: "chat-a",
    messageId: "m2",
    artifactId: created.id,
    content: "Updated.\n\n```artifact sql\ntitle: Query\ntype: sql\nlanguage: sql\n\nselect 2\n```",
  });
  assert.equal(revised?.content, "select 2");
  const versions = listVersions(db, "user-a", created.id) || [];
  assert.deepEqual(versions.map((row) => row.source), ["ai", "user", "ai"]);
  assert.equal(versions[1]?.content, "select 1\n-- mine");
  const restored = restoreArtifact(db, "user-a", created.id, 2);
  assert.equal(restored?.content, "select 1\n-- mine");
  assert.equal(listVersions(db, "user-a", created.id)?.at(-1)?.source, "user");

  const renamed = updateArtifact(db, { userId: "user-a", id: created.id, title: "Orders", source: "user" });
  assert.equal(renamed?.title, "Orders");
  assert.equal(deleteArtifact(db, "user-a", created.id), true);
  assert.equal(readArtifact(db, "user-a", created.id), null);
  assert.equal(createArtifact(db, { userId: "user-b", conversationId: "chat-a", file: { title: "X", type: "text", language: "txt", content: "no" }, source: "user" }), null);
});
