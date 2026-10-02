import assert from "node:assert/strict";
import test from "node:test";
import { correctIdentityVoice, directIdentityReply } from "./identity.ts";

test("answers name and job as the user", () => {
  assert.equal(directIdentityReply("whats my name", "Quinten", "Designer"), "Your name is Quinten.");
  assert.equal(directIdentityReply("whats my job", "Quinten", "Designer"), "You work as a Designer.");
  assert.equal(correctIdentityVoice("I am Quinten. I am a Designer.", "Quinten", "Designer"), "You are Quinten. You are a Designer.");
  assert.equal(correctIdentityVoice("Ik ben Quinten.", "Quinten", "Designer"), "Jij bent Quinten.");
});
