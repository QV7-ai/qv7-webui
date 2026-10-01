import assert from "node:assert/strict";
import test from "node:test";
import { completionTextFromJson, deltaFromOpenAIChunk, parseOpenAISseLine } from "./stream.ts";
import { openaiBaseUrl, requestModelId } from "./ids.ts";

test("parses OpenRouter chat deltas and reasoning details", () => {
  const delta = deltaFromOpenAIChunk({
    choices: [{ delta: { content: "Hi", reasoning_details: [{ type: "reasoning.text", text: "think" }] } }],
  });
  assert.equal(delta.content, "Hi");
  assert.equal(delta.thinking, "think");
});

test("parses Responses API string deltas", () => {
  const delta = deltaFromOpenAIChunk({ type: "response.output_text.delta", delta: "16" });
  assert.equal(delta.content, "16");
});

test("parses a non-stream completion body", () => {
  const parsed = completionTextFromJson({
    choices: [{ message: { content: "Hello from free router" } }],
  });
  assert.equal(parsed.content, "Hello from free router");
});

test("parses SSE data lines", () => {
  const json = parseOpenAISseLine('data: {"choices":[{"delta":{"content":"ok"}}]}');
  assert.equal(deltaFromOpenAIChunk(json!).content, "ok");
});

test("strips storage keys and normalizes OpenRouter URLs", () => {
  assert.equal(requestModelId("openai:abc:openrouter/free"), "openrouter/free");
  assert.equal(openaiBaseUrl("https://openrouter.ai"), "https://openrouter.ai/api/v1");
});
