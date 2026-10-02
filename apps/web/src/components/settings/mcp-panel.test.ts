import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("mcp settings stay on the QV7 api", () => {
  const panel = fs.readFileSync(new URL("./McpPanel.tsx", import.meta.url), "utf8");
  const composer = fs.readFileSync(new URL("../composer/Composer.tsx", import.meta.url), "utf8");
  for (const source of [panel, composer]) {
    assert.equal(source.includes("localStorage"), false);
    assert.equal(source.includes("sessionStorage"), false);
    assert.equal(source.includes("EventSource"), false);
    assert.equal(source.includes("WebSocket"), false);
  }
  assert.equal(panel.includes("/api/admin/mcp/"), true);
  assert.equal(panel.includes("/api/mcp/proxy"), false);
  assert.equal(panel.includes("secretEnc"), false);
});
