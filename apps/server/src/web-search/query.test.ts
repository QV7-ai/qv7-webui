import test from "node:test";
import assert from "node:assert/strict";
import { cleanSearchQuery, focusSearchText, queryIsNoise, resolveSearchQuery, sanitizeSearchQuery } from "./query.ts";

const pasted = `Recreate this page with much more information about the brown beer make it in dutch
<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bruine Beer Onderzoek</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <h1>Bruine Beer</h1>
    <p>Gedetailleerd onderzoek naar de leefwijze, gedrag en ecologie van Ursus arctos.</p>
</body>
</html>`;

test("pasted page searches the subject, not the markup", () => {
  const query = focusSearchText(pasted);
  assert.match(query, /Bruine/);
  assert.match(query, /Beer/);
  assert.match(query, /Ursus arctos/);
  assert.doesNotMatch(query, /doctype|viewport|stylesheet|charset|tailwind/i);
});

test("plain questions stay a short keyword query", () => {
  assert.equal(focusSearchText("what is the weather in Utrecht today"), "weather Utrecht today");
});

test("html noise from the model is replaced by the fallback", () => {
  assert.equal(
    cleanSearchQuery("DOCTYPE html head meta viewport stylesheet", "Bruine Beer Ursus arctos"),
    "Bruine Beer Ursus arctos",
  );
});

const flattened =
  "Recreate this page much information DOCTYPE html lang head meta charset UTF-8 name viewport content width device-width initial-scale title Bruine Beer Onderzoek link rel stylesheet";

test("a flattened markup query is rejected and the page subject is used", () => {
  assert.equal(queryIsNoise(flattened), true);
  const query = resolveSearchQuery(pasted, flattened);
  assert.match(query, /Bruine/);
  assert.match(query, /Ursus arctos/);
  assert.doesNotMatch(query, /doctype|viewport|device-width|stylesheet/i);
});

test("a short factual query from the model is kept", () => {
  assert.equal(resolveSearchQuery(pasted, "Ursus arctos habitat diet"), "Ursus arctos habitat diet");
  assert.equal(sanitizeSearchQuery("HTML document structure"), "HTML document structure");
  assert.equal(sanitizeSearchQuery("4x4 calculator"), "4x4 calculator");
});

test("a pasted stylesheet is not the search query", () => {
  const query = focusSearchText(`Add more about volcanoes in Iceland\n\`\`\`css\nbody { margin: 0; font-family: sans-serif; }\n.viewport { width: 100%; }\n\`\`\``);
  assert.match(query, /volcanoes/);
  assert.match(query, /Iceland/);
  assert.doesNotMatch(query, /margin|viewport|font-family|stylesheet/i);
});
