import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryUsed } from "./MemoryUsed";
import { attachMemoryUsed } from "./memory-used";

const memories = [
  { id: "m-debian", content: "User prefers Debian for homelab systems" },
  { id: "m-qv7", content: "User is working on QV7" },
  { id: "m-ts", content: "User prefers TypeScript" },
];

test("frontend hides the indicator when no memories were used", () => {
  const html = renderToStaticMarkup(createElement(MemoryUsed, { memories: [], label: "Memory used" }));
  assert.equal(html, "");
});

test("frontend renders Memory used without the notes until it is opened", () => {
  const closed = renderToStaticMarkup(createElement(MemoryUsed, { memories, label: "Memory used" }));
  assert.match(closed, /Memory used/);
  assert.equal(closed.includes("User prefers Debian"), false);
  assert.equal(closed.includes("memoryIds"), false);
  const open = renderToStaticMarkup(createElement(MemoryUsed, { memories, label: "Memory used", defaultOpen: true }));
  assert.match(open, /Memory used/);
  assert.match(open, /User prefers Debian for homelab systems/);
  assert.match(open, /User is working on QV7/);
  assert.match(open, /User prefers TypeScript/);
  assert.equal(open.includes("m-debian"), false);
});

test("frontend streaming applies memory metadata without changing the reply", () => {
  const start: { id: string; role: "assistant"; content: string; streaming: boolean; memoriesUsed?: { id: string; content: string }[] }[] = [
    { id: "a1", role: "assistant", content: "Use a stable server image.", streaming: true },
  ];
  const marked = attachMemoryUsed(start, "a1", { memoryUsed: true, memoryIds: memories.map((item) => item.id), memories });
  assert.equal(marked[0]?.content, "Use a stable server image.");
  assert.equal(marked[0]?.content.includes("memoryUsed"), false);
  assert.equal(marked[0]?.content.includes("User prefers Debian"), false);
  assert.deepEqual(marked[0]?.memoriesUsed, memories);
  const cleared = attachMemoryUsed(marked, "a1", { memoryUsed: false, memories: [] });
  assert.deepEqual(cleared[0]?.memoriesUsed, memories);
  const other = attachMemoryUsed(marked, "a1", { memoryUsed: true, memories: [{ id: "m-bob", content: "Bob's private note" }] });
  assert.equal(other[0]?.content, "Use a stable server image.");
});
