import assert from "node:assert/strict";
import test from "node:test";
import { beginLiveTurn, emitChat, endLiveTurn, getLiveTurn } from "./chat-sync.ts";
import { memoryUsageForTurn, memoryUsedPayload } from "./memory-context.ts";
import type { SseRaw } from "./chat-sync.ts";

const debian = {
  id: "m-debian",
  userId: "alice",
  content: "User prefers Debian for homelab systems",
  path: "Preferences",
  memoryType: "context",
  updatedAt: 1,
};
const qv7 = {
  id: "m-qv7",
  userId: "alice",
  content: "User is working on QV7",
  path: "Projects",
  memoryType: "context",
  updatedAt: 2,
};
const typescript = {
  id: "m-ts",
  userId: "alice",
  content: "User prefers TypeScript",
  path: "Preferences",
  memoryType: "context",
  updatedAt: 3,
};
const bob = {
  id: "m-bob",
  userId: "bob",
  content: "User prefers Debian for homelab systems",
  path: "Preferences",
  memoryType: "context",
  updatedAt: 4,
};
const cooking = {
  id: "m-cook",
  userId: "alice",
  content: "The kitchen sink is stainless steel",
  path: "Kitchen",
  memoryType: "context",
  updatedAt: 5,
};

function contentText(raw: string) {
  let text = "";
  for (const block of raw.split("\n\n")) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event !== "content" || !data) continue;
    const json = JSON.parse(data) as { delta?: string; reset?: boolean };
    text = json.reset ? json.delta || "" : text + (json.delta || "");
  }
  return text;
}

function capture() {
  let raw = "";
  const stream = {
    writableEnded: false,
    destroyed: false,
    write(chunk: string) {
      raw += chunk;
      return true;
    },
  };
  return { stream: stream as SseRaw, text: () => raw };
}

test("response with memories reports the retrieved note", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [debian, cooking],
    query: "Which debian image should I use for a homelab?",
  });
  assert.equal(meta.memoryUsed, true);
  assert.deepEqual(meta.memoryIds, ["m-debian"]);
  assert.equal(meta.memories[0]?.content, "User prefers Debian for homelab systems");
  assert.equal(meta.memoryIds.includes("m-cook"), false);
  assert.match(meta.context, /<memory_context>/);
  const payload = memoryUsedPayload(meta);
  assert.equal(payload && "context" in payload, false);
  assert.equal(JSON.stringify(payload).includes("memory_context"), false);
  assert.equal(JSON.stringify(payload).includes("m-cook"), false);
});

test("response without memories stays unmarked", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [cooking],
    query: "hallo hoe gaat het",
  });
  assert.equal(meta.memoryUsed, false);
  assert.deepEqual(meta.memoryIds, []);
  assert.equal(meta.context, "");
  assert.equal(memoryUsedPayload(meta), null);
});

test("multiple memories are listed and unrelated notes are left out", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [debian, qv7, typescript, cooking],
    query: "debian typescript qv7 homelab",
  });
  assert.equal(meta.memoryUsed, true);
  assert.deepEqual(new Set(meta.memoryIds), new Set(["m-debian", "m-qv7", "m-ts"]));
  assert.equal(meta.memoryIds.includes("m-cook"), false);
  assert.deepEqual(
    new Set(meta.memories.map((item) => item.content)),
    new Set(["User prefers Debian for homelab systems", "User is working on QV7", "User prefers TypeScript"]),
  );
});

test("an earlier identity note is not marked on an unrelated message", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [
      {
        id: "id-quinten",
        userId: "alice",
        content: "Name: Quinten, Age: 22, Birthday: May 7, 2004",
        path: "Identity",
        memoryType: "user",
        updatedAt: 1,
      },
    ],
    query: "my name is quinten im 22 years old born on 7 may 2004\n\ni have a dog called diesel",
    current: "i have a dog called diesel",
  });
  assert.equal(meta.memoryUsed, false);
  assert.match(meta.context, /Quinten/);
  const asked = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [
      {
        id: "id-quinten",
        userId: "alice",
        content: "Name: Quinten, Age: 22, Birthday: May 7, 2004",
        path: "Identity",
        memoryType: "user",
        updatedAt: 1,
      },
    ],
    query: "whats my name",
    current: "whats my name",
  });
  assert.deepEqual(asked.memoryIds, ["id-quinten"]);
});

test("a stored memory that was not retrieved is not marked", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [
      {
        id: "u-ts",
        userId: "alice",
        content: "User prefers TypeScript",
        path: "Preferences",
        memoryType: "user",
        updatedAt: 1,
      },
    ],
    query: "hallo hoe gaat het",
  });
  assert.equal(meta.memoryUsed, false);
  assert.match(meta.context, /User prefers TypeScript/);
  assert.equal(memoryUsedPayload(meta), null);
});

test("a retrieved user memory is marked", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [
      {
        id: "u-ts",
        userId: "alice",
        content: "User prefers TypeScript",
        path: "Preferences",
        memoryType: "user",
        updatedAt: 1,
      },
      cooking,
    ],
    query: "Should I write this in typescript?",
  });
  assert.deepEqual(meta.memoryIds, ["u-ts"]);
  assert.equal(meta.memories[0]?.content, "User prefers TypeScript");
});

test("memory disabled does not retrieve or mark a reply", () => {
  const meta = memoryUsageForTurn({
    enabled: false,
    userId: "alice",
    memories: [debian, qv7, typescript],
    query: "debian typescript qv7 homelab",
  });
  assert.equal(meta.memoryUsed, false);
  assert.equal(meta.context, "");
  assert.equal(memoryUsedPayload(meta), null);
});

test("memory retrieval failure continues with no indicator", () => {
  const broken = {
    id: "bad",
    userId: "alice",
    path: "Notes",
    memoryType: "user" as const,
    get content(): string {
      throw new Error("retrieval failed");
    },
  };
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [broken, debian],
    query: "debian homelab notes",
  });
  assert.equal(meta.memoryUsed, false);
  assert.equal(meta.context, "");
  assert.deepEqual(meta.memories, []);
});

test("user isolation hides another user's memories", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [bob, typescript],
    query: "debian typescript homelab",
  });
  assert.equal(meta.memoryIds.includes("m-bob"), false);
  assert.equal(JSON.stringify(meta.memories).includes("m-bob"), false);
  assert.equal(JSON.stringify(memoryUsedPayload(meta)).includes("Debian"), false);
  assert.deepEqual(meta.memoryIds, ["m-ts"]);
});

test("streaming keeps memory metadata out of the assistant text", () => {
  const meta = memoryUsageForTurn({
    enabled: true,
    userId: "alice",
    memories: [debian],
    query: "debian homelab",
  });
  const payload = memoryUsedPayload(meta);
  assert.ok(payload);
  const { stream, text } = capture();
  beginLiveTurn({
    userId: "alice",
    conversationId: "c1",
    userMessage: { id: "u1", content: "debian homelab" },
    assistantId: "a1",
  });
  const answer = "Use a stable server image.";
  emitChat(stream, "c1", "memoryUsed", payload);
  emitChat(stream, "c1", "content", { delta: answer });
  emitChat(stream, "c1", "done", { messageId: "a1", ...payload });
  const visible = contentText(text());
  assert.equal(visible, answer);
  assert.equal(visible.includes("memoryUsed"), false);
  assert.equal(visible.includes("memoryIds"), false);
  assert.equal(visible.includes("User prefers Debian"), false);
  assert.equal(visible.includes("<memory_context>"), false);
  assert.match(text(), /event: memoryUsed/);
  assert.equal(getLiveTurn("c1")?.content, answer);
  assert.deepEqual(getLiveTurn("c1")?.memoriesUsed, payload.memories);
  endLiveTurn("c1");
});
