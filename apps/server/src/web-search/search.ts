import { ProxyAgent, Agent, fetch as undiciFetch } from "undici";
import type { WebSearchConfig, WebSearchSource } from "@wlfv/shared";

type Hit = WebSearchSource & { content: string };

export function buildSearxngUrl(config: WebSearchConfig, query: string) {
  const encoded = encodeURIComponent(query);
  let url = config.searxngQueryUrl.replaceAll("<query>", encoded);
  if (!url.includes("<query>") && !/[?&]q=/.test(url)) {
    url += (url.includes("?") ? "&" : "?") + `q=${encoded}`;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has("format")) parsed.searchParams.set("format", "json");
  const lang = config.searxngLanguage.trim();
  if (lang && lang.toLowerCase() !== "all") parsed.searchParams.set("language", lang);
  parsed.searchParams.set("pageno", "1");
  return parsed.toString();
}

export function domainAllowed(url: string, filter: string) {
  if (!filter.trim()) return true;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  const parts = filter
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const includes = parts.filter((item) => !item.startsWith("!")).map((item) => item.replace(/^www\./, "").toLowerCase());
  const excludes = parts.filter((item) => item.startsWith("!")).map((item) => item.slice(1).replace(/^www\./, "").toLowerCase());
  if (excludes.some((item) => host === item || host.endsWith(`.${item}`))) return false;
  if (!includes.length) return true;
  return includes.some((item) => host === item || host.endsWith(`.${item}`));
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      out[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, () => worker()));
  return out;
}

function dispatcher(proxyUrl?: string, trustProxy = false) {
  if (proxyUrl) return new ProxyAgent(proxyUrl);
  if (trustProxy) return undefined;
  return new Agent();
}

async function requestText(url: string, init: RequestInit, proxyUrl: string | undefined, trustProxy: boolean, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: dispatcher(proxyUrl, trustProxy),
      headers: {
        "User-Agent": "QV7/1.0 (+web-search)",
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        ...(init.headers as Record<string, string> | undefined),
      },
    } as Parameters<typeof undiciFetch>[1]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function youtubeId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.replace(/^\//, "").split("/")[0] || null;
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
    const match = parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function youtubeTranscript(url: string, config: WebSearchConfig, timeoutMs: number) {
  const id = youtubeId(url);
  if (!id) return null;
  const html = await requestText(
    `https://www.youtube.com/watch?v=${id}`,
    {},
    config.youtubeProxyUrl || undefined,
    config.trustProxy,
    timeoutMs,
  );
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) return null;
  const tracks = JSON.parse(match[1]) as { languageCode?: string; baseUrl?: string }[];
  const langs = config.youtubeLanguage.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const track =
    langs.map((lang) => tracks.find((item) => (item.languageCode || "").toLowerCase().startsWith(lang))).find(Boolean) ||
    tracks[0];
  if (!track?.baseUrl) return null;
  const xml = await requestText(track.baseUrl, {}, config.youtubeProxyUrl || undefined, config.trustProxy, timeoutMs);
  return htmlToText(xml.replace(/<text[^>]*>/gi, " ").replace(/<\/text>/gi, " "));
}

async function loadWithPlaywright(url: string, config: WebSearchConfig) {
  const mod = (await import("playwright-core")) as {
    chromium: {
      connect: (ws: string, opts?: { timeout?: number }) => Promise<{
        newPage: () => Promise<{
          goto: (target: string, opts: { timeout: number; waitUntil: "domcontentloaded" }) => Promise<unknown>;
          innerText: (selector: string) => Promise<string>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await mod.chromium.connect(config.playwrightWsUrl, { timeout: config.playwrightTimeoutMs });
  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: config.playwrightTimeoutMs, waitUntil: "domcontentloaded" });
    const text = await page.innerText("body");
    await page.close();
    return text;
  } finally {
    await browser.close();
  }
}

async function loadPage(url: string, config: WebSearchConfig) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (isPrivateHost(host)) return "";
  if (youtubeId(url)) {
    try {
      return (await youtubeTranscript(url, config, config.playwrightTimeoutMs)) || "";
    } catch {
      return "";
    }
  }
  if (config.loaderEngine === "playwright") {
    try {
      return await loadWithPlaywright(url, config);
    } catch {
      // Fall through to HTTP fetch when Playwright is not reachable.
    }
  }
  try {
    const html = await requestText(url, {}, undefined, config.trustProxy, config.playwrightTimeoutMs);
    return htmlToText(html);
  } catch {
    return "";
  }
}

function retrieve(query: string, text: string, limit: number | null, bypassEmbedding: boolean) {
  const clipped = limit && limit > 0 && text.length > limit ? text.slice(0, limit) : text;
  if (bypassEmbedding || clipped.length < 900) return clipped;
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  const chunks = clipped.split(/(?<=\.)\s+/).reduce<string[]>((acc, sentence) => {
    const last = acc[acc.length - 1];
    if (!last || last.length > 700) acc.push(sentence);
    else acc[acc.length - 1] = `${last} ${sentence}`;
    return acc;
  }, []);
  const scored = chunks
    .map((chunk) => {
      const lower = chunk.toLowerCase();
      const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.chunk);
  const selected = scored.join("\n");
  return limit && limit > 0 && selected.length > limit ? selected.slice(0, limit) : selected;
}

export async function runWebSearch(query: string, config: WebSearchConfig, signal?: AbortSignal): Promise<{
  sources: WebSearchSource[];
  context: string;
}> {
  const url = buildSearxngUrl(config, query);
  const raw = await requestText(url, { signal }, undefined, config.trustProxy, 20000);
  let data: { results?: { title?: string; url?: string; content?: string }[] };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("SearXNG did not return JSON. Add format=json to the query URL.");
  }
  const hits = (data.results || [])
    .filter((item) => item.url && domainAllowed(item.url, config.domainFilter))
    .slice(0, config.resultCount)
    .map((item) => ({
      title: item.title || item.url || "Result",
      url: item.url as string,
      snippet: item.content || "",
      content: item.content || "",
    }));

  let filled: Hit[] = hits;
  if (!config.bypassWebLoader) {
    filled = await mapLimit(
      hits,
      config.loaderEngine === "playwright" ? config.loaderConcurrentRequests : config.concurrentRequests,
      async (hit) => {
      if (signal?.aborted) return hit;
      const page = await loadPage(hit.url, config);
      const content = retrieve(query, page || hit.snippet, config.fetchContentLengthLimit, config.bypassEmbedding);
      return { ...hit, content: content || hit.snippet };
    });
  } else if (config.fetchContentLengthLimit) {
    filled = hits.map((hit) => ({
      ...hit,
      content: hit.snippet.slice(0, config.fetchContentLengthLimit || hit.snippet.length),
    }));
  }

  const context = filled
    .map((hit, index) => {
      const body = hit.content || hit.snippet;
      return `[${index + 1}] ${hit.title}\nURL: ${hit.url}\n${body}`;
    })
    .join("\n\n");

  return {
    sources: filled.map(({ title, url: href, snippet }) => ({ title, url: href, snippet })),
    context,
  };
}
