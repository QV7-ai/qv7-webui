import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImages } from "./config.ts";

test("defaults to ImageRouter for create and edit", () => {
  const config = normalizeImages({});
  assert.equal(config.create.engine, "imagerouter");
  assert.equal(config.edit.engine, "imagerouter");
  assert.equal(config.create.apiBaseUrl, "https://api.imagerouter.io/v1/openai");
  assert.equal(config.create.model, "black-forest-labs/FLUX-2-klein-9b");
  assert.equal(config.generationEnabled, true);
});

test("edit engine cannot be automatic1111", () => {
  const config = normalizeImages({
    edit: { engine: "automatic1111", model: "x" },
  });
  assert.equal(config.edit.engine, "imagerouter");
});

test("keeps openai, comfyui, gemini, and automatic1111 for create", () => {
  for (const engine of ["openai", "comfyui", "gemini", "automatic1111"] as const) {
    const config = normalizeImages({ create: { engine } });
    assert.equal(config.create.engine, engine);
  }
});
