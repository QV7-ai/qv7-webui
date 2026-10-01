import { eq } from "drizzle-orm";
import { DEFAULT_WEB_SEARCH, type WebSearchConfig } from "@wlfv/shared";
import { appSettings } from "../db/schema.ts";
import type { DB } from "../db/index.ts";

const KEY = "web_search";

function asNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeWebSearch(raw: unknown): WebSearchConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limit = input.fetchContentLengthLimit;
  return {
    enabled: Boolean(input.enabled),
    confirmation: Boolean(input.confirmation),
    engine: "searxng",
    searxngQueryUrl: String(input.searxngQueryUrl || DEFAULT_WEB_SEARCH.searxngQueryUrl).trim() || DEFAULT_WEB_SEARCH.searxngQueryUrl,
    searxngLanguage: String(input.searxngLanguage || "all").trim() || "all",
    resultCount: Math.min(20, Math.max(1, Math.round(asNumber(input.resultCount, 8)))),
    concurrentRequests: Math.min(10, Math.max(1, Math.round(asNumber(input.concurrentRequests, 5)))),
    fetchContentLengthLimit:
      limit === null || limit === "" || limit === undefined ? null : Math.max(0, Math.round(asNumber(limit, 0))) || null,
    domainFilter: String(input.domainFilter || "").trim(),
    bypassEmbedding: Boolean(input.bypassEmbedding),
    bypassWebLoader: Boolean(input.bypassWebLoader),
    trustProxy: Boolean(input.trustProxy),
    loaderEngine: input.loaderEngine === "fetch" ? "fetch" : "playwright",
    playwrightWsUrl: String(input.playwrightWsUrl || DEFAULT_WEB_SEARCH.playwrightWsUrl).trim(),
    playwrightTimeoutMs: Math.min(120000, Math.max(1000, Math.round(asNumber(input.playwrightTimeoutMs, 30000)))),
    loaderConcurrentRequests: Math.min(10, Math.max(1, Math.round(asNumber(input.loaderConcurrentRequests, 3)))),
    youtubeLanguage: String(input.youtubeLanguage || "en,nl").trim() || "en,nl",
    youtubeProxyUrl: String(input.youtubeProxyUrl || "").trim(),
  };
}

export function loadWebSearch(db: DB): WebSearchConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return { ...DEFAULT_WEB_SEARCH };
  try {
    return normalizeWebSearch(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_WEB_SEARCH };
  }
}

export function saveWebSearch(db: DB, next: WebSearchConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}
