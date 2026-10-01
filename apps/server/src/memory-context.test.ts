import assert from "node:assert/strict";
import test from "node:test";
import { buildMemoryContext, MEMORY_CONTEXT_OPEN, rankMemories } from "./memory-context.ts";
import { parseToolCalls } from "./tools.ts";

test("caps user memories and retrieves matching hardware instead of dumping everything", () => {
  const memories = [
    { id: "1", content: "De gebruiker heet Alex", path: "Identiteit", memoryType: "user", updatedAt: 1 },
    {
      id: "2",
      content: "Blackview N97 mini-pc met 16 GB RAM",
      path: "Hardware",
      memoryType: "user",
      updatedAt: 2,
    },
    {
      id: "3",
      content: "HP ProDesk 600 G4 DM met een Intel i3-8100T en 16 GB RAM",
      path: "Hardware",
      memoryType: "user",
      updatedAt: 3,
    },
    {
      id: "4",
      content: "Ryzen 7 H255 mini-pc met 24 GB RAM",
      path: "Hardware",
      memoryType: "user",
      updatedAt: 4,
    },
    {
      id: "5",
      content: "A".repeat(2500),
      path: "Notes",
      memoryType: "user",
      updatedAt: 5,
    },
  ];
  const ctx = buildMemoryContext(memories, "Welke specs hebben mn mini pc's", { userLimit: 250, contextLimit: 2000, k: 8 });
  assert.match(ctx, new RegExp(MEMORY_CONTEXT_OPEN));
  assert.ok(ctx.length < 3500);
  const ranked = rankMemories(memories, "Welke specs hebben mn mini pc's", 8);
  assert.ok(ranked.some((item) => /ProDesk/.test(item.content)));
  assert.ok(ranked.some((item) => /Blackview/.test(item.content)));
});

test("does not treat a greeting as a reason to retrieve hardware", () => {
  const memories = [
    { id: "1", content: "Blackview N97 mini-pc met 16 GB RAM", path: "Hardware", memoryType: "context", updatedAt: 1 },
    { id: "2", content: "De gebruiker heet Alex", path: "Identiteit", memoryType: "user", updatedAt: 2 },
  ];
  const ranked = rankMemories(memories, "hallo hoe gaat het", 8);
  assert.equal(
    ranked.some((item) => /Blackview/.test(item.content)),
    false,
  );
});

test("understands Open WebUI memory tool names", () => {
  const calls = parseToolCalls('```tool\n{"name":"search_memories","arguments":{"query":"homelab"}}\n```');
  assert.equal(calls[0]?.name, "memory_search");
  assert.equal(calls[0]?.arguments.query, "homelab");
});
