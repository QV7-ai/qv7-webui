import { TOOL_NAMES, TOOL_NAME_RE, type ToolName, type WebSearchConfig, type WebSearchSource } from "@wlfv/shared";
import { eq } from "drizzle-orm";
import type { DB } from "./db/index.ts";
import { memories } from "./db/schema.ts";
import { fetchPublicPage } from "./attachments.ts";
import { deleteMemory, saveUserMemories, searchMemories, updateMemory } from "./memory.ts";
import { isDurableMemory, memoriesOverlap, normalizeMemoryType } from "./memory-ops.ts";
import { listMemoryPathGroups, MEMORY_SEARCH_K, readMemoryPath } from "./memory-context.ts";
import { runWebSearch } from "./web-search/search.ts";

export type ToolCall = { name: ToolName; arguments: Record<string, string> };

const NAME_SET = new Set<string>(TOOL_NAMES);
const TOOL_ALIASES: Record<string, ToolName> = {
  search_memories: "memory_search",
  add_memory: "memory_add",
  replace_memory_content: "memory_update",
  delete_memory: "memory_delete",
  update_memory: "memory_update",
  list_memories: "memory_list",
  list_memory_paths: "memory_list_paths",
  read_memory_path: "memory_read_path",
};

function asArgs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item == null) continue;
    out[key] = String(item);
  }
  return out;
}

function pushCall(calls: ToolCall[], name: string, args: Record<string, string>) {
  const raw = name.trim().toLowerCase();
  const tool = TOOL_ALIASES[raw] || raw;
  if (!NAME_SET.has(tool)) return;
  calls.push({ name: tool as ToolName, arguments: args });
}

function parseJsonCalls(raw: string, calls: ToolCall[]) {
  const text = raw.trim();
  if (!text) return;
  try {
    const data = JSON.parse(text) as unknown;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as { name?: string; function?: string; arguments?: unknown; parameters?: unknown; query?: string; url?: string };
      const name = String(row.name || row.function || "");
      const args = asArgs(row.arguments ?? row.parameters ?? row);
      if (!args.query && row.query) args.query = String(row.query);
      if (!args.url && row.url) args.url = String(row.url);
      pushCall(calls, name, args);
    }
  } catch {
    const name = text.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
    const query = text.match(/"query"\s*:\s*"([^"]*)"/)?.[1];
    const url = text.match(/"url"\s*:\s*"([^"]*)"/)?.[1];
    const content = text.match(/"content"\s*:\s*"([^"]*)"/)?.[1];
    const id = text.match(/"id"\s*:\s*"([^"]*)"/)?.[1];
    const category = text.match(/"category"\s*:\s*"([^"]*)"/)?.[1];
    if (name) {
      pushCall(calls, name, {
        ...(query ? { query } : {}),
        ...(url ? { url } : {}),
        ...(content ? { content } : {}),
        ...(id ? { id } : {}),
        ...(category ? { category } : {}),
      });
    }
  }
}

export function questionNeedsSearch(text: string) {
  const q = text.replace(/\s+/g, " ").trim();
  if (q.length < 3) return false;
  if (/\b(search(?:\s+for)?|zoek(?:\s+op)?|google|look\s+up)\b/i.test(q)) return true;
  if (/\b(today|tonight|yesterday|latest|current|recent|upcoming|breaking|news|weather|forecast|scores?|prices?|stocks?|schedule|right now|this week|this weekend|who won|when is|what time|vandaag|gisteren|laatste|actueel|nieuws|weer|prijs|wanneer|vanavond|deze week)\b/i.test(q)) return true;
  if (/\b20(2[4-9]|3\d)\b/.test(q)) return true;
  if (/\b(next|upcoming|latest|volgende)\b.{0,60}\b(match|game|fight|card|event|race|election|release|episode|concert|wedstrijd|gevecht)\b/i.test(q)) return true;
  if (/\b(match|game|fight|card|wedstrijd|gevecht)\b.{0,60}\b(next|upcoming|latest|volgende|tonight|today|vanavond|vandaag)\b/i.test(q)) return true;
  return false;
}

export function questionNeedsCode(text: string) {
  const q = text.replace(/\s+/g, " ").trim();
  if (q.length < 3) return false;
  return /\b(calculate|compute|evaluate this|run (?:this |the )?(?:code|python|javascript|script)|execute (?:this |the )?(?:code|python|script)|python-run|javascript-run|write (?:a |some )?(?:python|javascript) (?:program|script))\b/i.test(
    q,
  );
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of text.matchAll(/```(?:tool|json)\s*\n([\s\S]*?)```/gi)) {
    parseJsonCalls(block[1], calls);
  }
  for (const block of text.matchAll(/<tool_code>\s*([\s\S]*?)<\/tool_code>/gi)) {
    const body = block[1].trim();
    const named = body.match(/^([a-z_]+)\s*(\{[\s\S]*\})\s*$/i);
    if (named) {
      try {
        pushCall(calls, named[1], asArgs(JSON.parse(named[2])));
        continue;
      } catch {
        /* fall through */
      }
    }
    parseJsonCalls(body, calls);
  }
  for (const tag of TOOL_NAMES) {
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
    for (const match of text.matchAll(re)) {
      const inner = match[2].trim();
      const attrs = Object.fromEntries(
        [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((item) => [item[1], item[2]]),
      ) as Record<string, string>;
      if (inner.startsWith("{")) parseJsonCalls(inner, calls);
      else pushCall(calls, tag, { ...attrs, ...(inner && !attrs.query && !attrs.url && !attrs.content ? { query: inner, content: inner, url: inner } : {}) });
    }
  }
  for (const wrapped of text.matchAll(/<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/gi)) {
    parseJsonCalls(wrapped[1], calls);
  }
  for (const line of text.matchAll(
    /^call\s+(search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories|list_memory_paths|read_memory_path)\s+(.+)$/gim,
  )) {
    const args: Record<string, string> = {};
    for (const pair of line[2].matchAll(/(\w+)=(".*?"|\S+)/g)) {
      args[pair[1]] = pair[2].replace(/^"|"$/g, "");
    }
    if (!Object.keys(args).length) args.query = line[2].trim();
    pushCall(calls, line[1], args);
  }
  for (const fn of text.matchAll(
    /\b(search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories)\s*\(\s*(?:(\w+)\s*=\s*)?(["'`])([\s\S]*?)\3\s*(?:,\s*(?:(\w+)\s*=\s*)?(["'`])([\s\S]*?)\6)?\s*\)/g,
  )) {
    const args: Record<string, string> = {};
    const firstKey = fn[2] || (fn[1] === "fetch_url" ? "url" : fn[1].startsWith("memory_") && fn[1] !== "memory_search" ? "content" : "query");
    args[firstKey === "id" ? "id" : firstKey] = fn[4];
    if (fn[7]) {
      const secondKey = fn[5] || (fn[1] === "memory_add" ? "category" : "content");
      args[secondKey] = fn[7];
    }
    if (fn[1] === "memory_update" && args.content && !args.id && fn[4]) args.id = fn[4];
    if (fn[1] === "memory_delete") args.id = fn[4];
    pushCall(calls, fn[1], args);
  }
  for (const loose of text.matchAll(new RegExp(`\\b(${TOOL_NAME_RE})\\s+["']([^"']+)["']`, "gi"))) {
    const name = loose[1];
    const value = loose[2];
    pushCall(calls, name, name === "fetch_url" || name === "memory_read_path" ? { url: value, path: value } : { query: value, content: value });
  }
  for (const bare of text.matchAll(/^\s*(?:`{1,3}\s*)?(search_web|fetch_url)(?:\s*`{1,3})?\s*$/gim)) {
    pushCall(calls, bare[1], {});
  }
  for (const urlCall of text.matchAll(/\bfetch_url\s+(https?:\/\/\S+)/gi)) {
    pushCall(calls, "fetch_url", { url: urlCall[1].replace(/[.,;)]+$/, "") });
  }
  if (/playwright|sync_playwright|page\.goto\s*\(/i.test(text)) {
    for (const go of text.matchAll(/\b(?:page|context)\.goto\(\s*['"](https?:\/\/[^'"]+)['"]/gi)) {
      pushCall(calls, "fetch_url", { url: go[1] });
    }
  }
  const unique: ToolCall[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const key = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(call);
  }
  return unique.slice(0, 4);
}

export async function executeToolCall(
  call: ToolCall,
  ctx: {
    db: DB;
    userId: string;
    conversationId: string;
    memoryOn: boolean;
    searchEnabled: boolean;
    searchConfig: WebSearchConfig;
    signal?: AbortSignal;
    previousUser?: string;
    userMessage?: string;
  },
): Promise<{ text: string; sources?: WebSearchSource[] }> {
  const args = call.arguments;
  if (call.name === "search_web") {
    if (!ctx.searchEnabled) return { text: "search_web is disabled." };
    const query = (args.query || args.q || "").trim();
    if (!query) return { text: "search_web needs a query." };
    const found = await runWebSearch(query, { ...ctx.searchConfig, bypassWebLoader: true }, ctx.signal);
    return {
      text: found.context || "No results.",
      sources: found.sources,
    };
  }
  if (call.name === "fetch_url") {
    const url = (args.url || args.query || "").trim();
    if (!url) return { text: "fetch_url needs a url." };
    const page = await fetchPublicPage(url, 14000);
    return { text: `${page.url}\n\n${page.text}` };
  }
  if (!ctx.memoryOn) return { text: `${call.name} is disabled because memory is off.` };
  if (call.name === "memory_search") {
    const rows = searchMemories(ctx.db, ctx.userId, args.query || args.q || args.id || "", MEMORY_SEARCH_K);
    return { text: rows.length ? JSON.stringify(rows, null, 2) : "No matching memories." };
  }
  if (call.name === "memory_list") {
    const rows = ctx.db.select().from(memories).where(eq(memories.userId, ctx.userId)).all().slice(0, 80);
    return {
      text: rows.length
        ? JSON.stringify(
            rows.map((row) => ({
              id: row.id,
              type: row.memoryType,
              path: row.path,
              content: row.content,
            })),
            null,
            2,
          )
        : "No memories.",
    };
  }
  if (call.name === "memory_list_paths") {
    const rows = ctx.db.select().from(memories).where(eq(memories.userId, ctx.userId)).all();
    const groups = listMemoryPathGroups(rows);
    return { text: groups.count ? JSON.stringify(groups, null, 2) : "No memory paths." };
  }
  if (call.name === "memory_read_path") {
    const path = (args.path || args.query || "").trim();
    if (!path) return { text: "memory_read_path needs a path." };
    const rows = ctx.db.select().from(memories).where(eq(memories.userId, ctx.userId)).all();
    const found = readMemoryPath(rows, path);
    return {
      text: found.memories.length
        ? JSON.stringify(
            {
              path: found.path,
              parents: found.parents,
              children: found.children,
              memories: found.memories.map((row) => ({
                id: row.id,
                type: row.memoryType,
                path: row.path,
                content: row.content,
              })),
            },
            null,
            2,
          )
        : "No memories at that path.",
    };
  }
  if (call.name === "memory_add") {
    const content = (args.content || args.query || "").trim();
    if (!content) return { text: "memory_add needs a fact to save." };
    if (!isDurableMemory(content)) return { text: "That is not a durable fact to remember." };
    const saved = saveUserMemories(
      ctx.db,
      ctx.userId,
      [{ content, category: (args.category || "other").slice(0, 40) || "other", path: args.path, memoryType: normalizeMemoryType(args.type || args.memoryType || "user") }],
      ctx.conversationId,
    );
    return { text: saved.length ? JSON.stringify(saved) : "Nothing was added." };
  }
  if (call.name === "memory_update") {
    const row = searchMemories(ctx.db, ctx.userId, args.id || "").find((item) => item.id === args.id);
    const next = (args.content || "").trim();
    if (!row || !next || !memoriesOverlap(row.content, next)) {
      return { text: "Memory was not changed." };
    }
    const updated = updateMemory(ctx.db, ctx.userId, args.id || "", {
      content: args.content,
      category: args.category,
      path: args.path,
      memoryType: args.type || args.memoryType,
    });
    return { text: updated ? JSON.stringify(updated) : "Memory not found." };
  }
  if (
    !/\b(forget|vergeten|wis (dit|dat|mijn)|verwijder|delete memory|remove memory)\b/i.test(
      `${ctx.userMessage || ""} ${ctx.previousUser || ""}`,
    )
  ) {
    return { text: "Memory was not deleted." };
  }
  const removed = deleteMemory(ctx.db, ctx.userId, args.id || "");
  return { text: removed ? `Deleted ${args.id}` : "Memory not found." };
}
