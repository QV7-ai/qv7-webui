import assert from "node:assert/strict";
import test from "node:test";
import { stripToolMarkup } from "@wlfv/shared";
import { parseToolCalls } from "./tools.ts";

test("parses OpenRouter-style memory_add tool markup", () => {
  const text = `<|tool_call_start|>[memory_add(content='User name: Alex, Age: 30', category='identity')]<|tool_call_end|>`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "memory_add");
  assert.equal(calls[0].arguments.content, "User name: Alex, Age: 30");
  assert.equal(calls[0].arguments.category, "identity");
  assert.equal(stripToolMarkup(text), "");
});

test("parses Gemma tool_code search_web and hides the thinking draft", () => {
  const text = `Thinking Process:\n\n1. Analyze the request.\n<think>Search first.</think>\n<tool_code>search_web {"query":"Spectacled bear information wikipedia"} </tool_code>`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "search_web");
  assert.equal(calls[0].arguments.query, "Spectacled bear information wikipedia");
  assert.equal(stripToolMarkup(text), "");
});

test("parses Mistral python-fence search_web and fetch_url", () => {
  const text = `To find the answer, let's use the search_web function.

\`\`\`python
search_web "4x4 calculator"
\`\`\`

\`\`\`
Here are the results:
1. URL: https://www.calculator.net/multiplication-calculator.html
\`\`\`

\`\`\`python
fetch_url https://www.calculator.net/multiplication-calculator.html
\`\`\`
`;
  const calls = parseToolCalls(text);
  assert.equal(calls.some((call) => call.name === "search_web" && call.arguments.query === "4x4 calculator"), true);
  assert.equal(calls.some((call) => call.name === "fetch_url" && call.arguments.url.includes("calculator.net")), true);
  assert.equal(stripToolMarkup(text), "");
});

test("treats Playwright page.goto scripts as fetch_url and hides them", () => {
  const text = `\`\`\`python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    page.goto('https://www.ufc.com/event/ufc-fight-night')
    browser.close()
\`\`\`
This script uses Playwright to open the official UFC event page.
`;
  const calls = parseToolCalls(text);
  assert.equal(calls.some((call) => call.name === "fetch_url" && call.arguments.url.includes("ufc.com")), true);
  assert.equal(stripToolMarkup(text), "");
});
