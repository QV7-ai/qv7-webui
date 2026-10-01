import assert from "node:assert/strict";
import test from "node:test";
import { parseNdjson } from "./ndjson.ts";

test("parses JSON objects split across chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"message":{"content":"Hel'));
      controller.enqueue(encoder.encode('lo"}}\n{"message":{"thinking":"hmm"}}\n'));
      controller.close();
    },
  });
  const items = [];
  for await (const row of parseNdjson(stream)) items.push(row);
  assert.equal(items.length, 2);
  assert.equal((items[0].message as { content: string }).content, "Hello");
  assert.equal((items[1].message as { thinking: string }).thinking, "hmm");
});
