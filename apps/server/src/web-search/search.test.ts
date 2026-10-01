import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WEB_SEARCH } from "@wlfv/shared";
import { buildSearxngUrl, domainAllowed } from "./search.ts";

test("buildSearxngUrl replaces query and forces JSON", () => {
  const url = buildSearxngUrl(DEFAULT_WEB_SEARCH, "docker networking");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("q"), "docker networking");
  assert.equal(parsed.searchParams.get("format"), "json");
});

test("domain filter includes and excludes", () => {
  assert.equal(domainAllowed("https://example.com/a", "example.com,site.org"), true);
  assert.equal(domainAllowed("https://other.com/a", "example.com"), false);
  assert.equal(domainAllowed("https://example.com/a", "!example.com"), false);
  assert.equal(domainAllowed("https://news.site.org/a", "site.org"), true);
});
