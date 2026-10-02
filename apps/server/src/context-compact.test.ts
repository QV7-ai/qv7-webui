import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanContextSummary,
  compactionLimit,
  estimateTokens,
  fallbackContextSummary,
  isContextOverflow,
  resolveContextWindow,
  splitContextTurns,
} from "./context-compact.ts";

test("leaves room in the window when the threshold is empty", () => {
  const limit = compactionLimit(32768, "");
  assert.equal(limit, Math.floor(32768 * 0.75));
});

test("reads a percent, a fraction, or a token cap", () => {
  assert.equal(compactionLimit(10000, "80"), 8000);
  assert.equal(compactionLimit(10000, "0.5"), 5000);
  assert.equal(compactionLimit(32768, "100"), 32768 - Math.floor(32768 * 0.08));
  assert.equal(compactionLimit(32768, "20000"), 20000);
});

test("folds older turns once the latest ones fill the budget", () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({
    id: String(index),
    role: index % 2 ? "assistant" : "user",
    content: "word ".repeat(300),
  }));
  const each = estimateTokens(turns[0].content) + 8;
  const split = splitContextTurns(turns, each * 2 + 900, 900);
  assert.deepEqual(split.keep.map((item) => item.id), ["4", "5"]);
  assert.deepEqual(split.fold.map((item) => item.id), ["0", "1", "2", "3"]);
});

test("keeps the newest message even when it is larger than the budget", () => {
  const turns = [
    { id: "old", role: "user", content: "earlier" },
    { id: "now", role: "user", content: "x".repeat(5000) },
  ];
  const split = splitContextTurns(turns, 100, 0);
  assert.deepEqual(split.keep.map((item) => item.id), ["now"]);
  assert.deepEqual(split.fold.map((item) => item.id), ["old"]);
});

test("cleans a summary and falls back to recent lines", () => {
  assert.equal(cleanContextSummary("<think>hidden</think>\n\nKeep the plan."), "Keep the plan.");
  const summary = fallbackContextSummary("Old plan", [
    { id: "1", role: "user", content: "Use port 8080" },
  ]);
  assert.match(summary, /Old plan/);
  assert.match(summary, /Use port 8080/);
});

test("recognizes a full context window error", () => {
  assert.equal(isContextOverflow("the request exceeds the available context size"), true);
  assert.equal(isContextOverflow("connection refused"), false);
});

test("treats a full 32k reply as that loaded window, not the model maximum", () => {
  assert.equal(resolveContextWindow({ advertised: 262144, usedTokens: 32768 }), 32768);
  assert.equal(resolveContextWindow({ loaded: 32768, advertised: 262144, usedTokens: 32768 }), 32768);
  assert.equal(resolveContextWindow({ explicit: 8192, loaded: 32768, advertised: 262144 }), 8192);
  assert.equal(compactionLimit(32768, "") < 32768, true);
});
