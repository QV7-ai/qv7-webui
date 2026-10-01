import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitMemories } from "./memory.ts";

test("auto-saves a birthday stated without remember", () => {
  const facts = extractExplicitMemories("im from 1 january 1990");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].content, "The user's birthday is 1 january 1990");
  assert.equal(facts[0].category, "identity");
});

test("save this in memory uses the previous user fact", () => {
  const facts = extractExplicitMemories("Save this in memory", "im from 1 january 1990");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].content, "The user's birthday is 1 january 1990");
});

test("does not save the phrase this in memory", () => {
  const facts = extractExplicitMemories("Save this in memory");
  assert.equal(facts.length, 0);
});

test("auto-saves name and age from Dutch", () => {
  const facts = extractExplicitMemories("ik heet Alex en ik ben 30 jaar oud");
  assert.deepEqual(
    facts.map((item) => item.content),
    ["The user's name is Alex", "The user's age is 30"],
  );
});

test("splits name, birthday and age from one sentence", () => {
  const facts = extractExplicitMemories(
    "ello my name is Alex, i was born on 1 january 1990 and im 30 years old",
  );
  assert.deepEqual(
    facts.map((item) => item.content),
    ["The user's name is Alex", "The user's birthday is 1 january 1990", "The user's age is 30"],
  );
});

test("auto-saves a job title", () => {
  const facts = extractExplicitMemories("I work as as product designer");
  assert.deepEqual(facts, [{ content: "The user's job is product designer", category: "work" }]);
});

test("auto-saves a company name", () => {
  const facts = extractExplicitMemories("I have a UX design company called Northwind Studio");
  assert.deepEqual(facts, [{ content: "The user's company is Northwind Studio", category: "work" }]);
});
