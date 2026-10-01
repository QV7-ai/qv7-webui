import assert from "node:assert/strict";
import test from "node:test";
import { fallbackMemoryDrafts, isCasualChat, memoriesOverlap, memoryLineForPrompt, parseMemoryOperations, pickMemorySummary, selectMemoriesForPrompt, splitDeviceFacts } from "./memory-ops.ts";

test("parses Open WebUI-style memory operations from a noisy completion", () => {
  const ops = parseMemoryOperations(`Sure.
{"operations":[
  {"action":"add","category":"work","content":"The user's company is Northwind Studio"},
  {"action":"add","category":"work","content":"The user's job is System and network manager"}
]}`);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].content, "The user's company is Northwind Studio");
  assert.equal(ops[1].category, "work");
});

test("parses path and type like Open WebUI", () => {
  const ops = parseMemoryOperations(
    '{"operations":[{"action":"add","type":"user","path":"Communicatiestijl","content":"Use informal Dutch"}]}',
  );
  assert.equal(ops[0]?.path, "Communicatiestijl");
  assert.equal(ops[0]?.memoryType, "user");
});

test("maps delete aliases used by Open WebUI", () => {
  const ops = parseMemoryOperations('{"operations":[{"action":"delete","id":"abc"}]}');
  assert.equal(ops[0]?.action, "remove");
  assert.equal(ops[0]?.id, "abc");
});

test("summarizes first-person hardware instead of storing the prompt", () => {
  const drafts = fallbackMemoryDrafts("ik heb een gaming pc met ene 9070xt videokaart");
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].content, /9070xt/i);
  assert.match(drafts[0].content, /gebruiker heeft/i);
  assert.equal(drafts[0].path, "Hardware");
});

test("treats a follow-up about the same GPU as the same fact", () => {
  const first = fallbackMemoryDrafts("ik heb een 9070xt videokaart")[0];
  const second = fallbackMemoryDrafts("k heb een 9070xt videokaart en ik ben er erg blij mee")[0];
  assert.equal(memoriesOverlap(first.content, second.content), true);
  assert.equal(pickMemorySummary(first.content, second.content), first.content);
});

test("does not merge different machines into one hardware memory", () => {
  const blackview = "Blackview N97 mini-pc met 16 GB RAM";
  const prodesk = "HP ProDesk 600 G4 DM met een Intel i3-8100T en 16 GB RAM";
  const ryzen = "Ryzen 7 H255 mini-pc met 24 GB RAM";
  assert.equal(memoriesOverlap(blackview, prodesk), false);
  assert.equal(memoriesOverlap(ryzen, prodesk), false);
  const split = splitDeviceFacts(`${blackview}, een ${prodesk} en een ${ryzen}`);
  assert.equal(split.length, 3);
  const picked = selectMemoriesForPrompt(
    [
      { content: blackview, path: "Hardware" },
      { content: "De gebruiker heet Alex", path: "Identiteit" },
      { content: prodesk, path: "Hardware" },
    ],
    "Welke specs hebben mn mini pc's",
  );
  assert.equal(picked.some((item) => /Alex/.test(item.content)), false);
  assert.equal(picked.some((item) => /ProDesk/.test(item.content)), true);
});

test("does not treat a new location as the same as an unrelated memory", () => {
  const instruction =
    "Voeg in de toekomst bij het delen van nieuwe persoonlijke informatie dit automatisch toe aan de Memory.";
  const location = fallbackMemoryDrafts("De gebruiker woont in Utrecht")[0];
  assert.ok(location);
  assert.equal(memoriesOverlap(instruction, location.content), false);
  assert.equal(location.path, "Locatie");
});

test("updates the same location instead of adding another", () => {
  const first = fallbackMemoryDrafts("De gebruiker woont in Utrecht")[0];
  const second = fallbackMemoryDrafts("De gebruiker woont in Haarlem")[0];
  assert.equal(memoriesOverlap(first.content, second.content), true);
});


test("saves a communication-style preference", () => {
  const drafts = fallbackMemoryDrafts(
    "De gebruiker geeft de voorkeur aan een informele en directe aanspreekvorm en vraagt mij om nooit de formele aanhef uw of u te gebruiken.",
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].category, "preference");
  assert.equal(drafts[0].path, "Communicatiestijl");
  assert.equal(drafts[0].memoryType, "preference");
});

test("does not save conversational filler", () => {
  assert.deepEqual(fallbackMemoryDrafts("Ik ga je wat informatie voeden oke?"), []);
  assert.deepEqual(fallbackMemoryDrafts("Nee ik ga dat doen"), []);
});

test("does not save a greeting", () => {
  assert.deepEqual(fallbackMemoryDrafts("Hallo"), []);
});

test("treats a hello how-are-you as casual chat", () => {
  assert.equal(isCasualChat("hallo hoe gaat het"), true);
  assert.equal(isCasualChat("how old am i"), false);
});

test("rewrites first-person memories so the model is not the user", () => {
  assert.match(memoryLineForPrompt("Ik ben Alex en ik heb een homelab"), /De gebruiker is Alex/i);
  assert.doesNotMatch(memoryLineForPrompt("Ik ben Alex"), /^Ik ben/i);
});

test("does not save a who-am-i question", () => {
  assert.deepEqual(fallbackMemoryDrafts("Wie ben ik"), []);
  assert.deepEqual(fallbackMemoryDrafts("Who am I"), []);
});

test("saves labeled profile fields in one identity memory", () => {
  const drafts = fallbackMemoryDrafts("Geslacht: Man, Leeftijd: 30, Geboortedatum: 1 januari");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].content, "Geslacht: Man, Leeftijd: 30, Geboortedatum: 1 januari");
  assert.equal(drafts[0].path, "Identiteit");
});

test("does not prefix unrelated facts as a birthday", () => {
  const drafts = fallbackMemoryDrafts("De gebruiker heeft een 9070xt videokaart en 16 GB RAM");
  assert.equal(drafts.length, 1);
  assert.doesNotMatch(drafts[0].content, /Geboortedatum/i);
  assert.match(drafts[0].content, /9070xt/i);
});

test("strips a false birthday label from a saved fact", () => {
  const drafts = fallbackMemoryDrafts("Geboortedatum: De gebruiker woont in Utrecht");
  assert.equal(drafts.length, 1);
  assert.doesNotMatch(drafts[0].content, /Geboortedatum/i);
  assert.match(drafts[0].content, /Utrecht/i);
});

test("strips a birthday label from a numbered fact", () => {
  const drafts = fallbackMemoryDrafts("Geboortedatum: De gebruiker heeft 16 GB RAM");
  assert.equal(drafts.length, 1);
  assert.doesNotMatch(drafts[0].content, /Geboortedatum/i);
  assert.match(drafts[0].content, /16 GB RAM/i);
});

test("does not keep a birthday path for an unrelated add", () => {
  const ops = parseMemoryOperations(
    JSON.stringify({ action: "add", path: "Geboortedatum", content: "De gebruiker woont in Utrecht" }),
  );
  assert.equal(ops.length, 1);
  assert.doesNotMatch(ops[0].content || "", /Geboortedatum/i);
  assert.notEqual(ops[0].path, "Geboortedatum");
  assert.match(ops[0].content || "", /Utrecht/i);
});

test("merges a later birthday into the existing identity memory", () => {
  const first = fallbackMemoryDrafts("Geslacht: Man, Leeftijd: 22")[0];
  const second = fallbackMemoryDrafts("Geboortedatum: 1 januari")[0];
  assert.equal(memoriesOverlap(first.content, second.content), true);
  assert.equal(pickMemorySummary(first.content, second.content), "Geslacht: Man, Leeftijd: 30, Geboortedatum: 1 januari");
});
