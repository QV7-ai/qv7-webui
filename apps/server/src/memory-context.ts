import { parseUsedMemories, type UsedMemory } from "@wlfv/shared";
import { distinctiveTokens, englishMemoryPath, memoryFactKey, normalizeMemoryPath, presentMemoryContent } from "./memory-ops.ts";

export const MEMORY_CONTEXT_OPEN = "<memory_context>";
export const MEMORY_CONTEXT_CLOSE = "</memory_context>";
export const MEMORY_USER_CHAR_LIMIT = 2000;
export const MEMORY_CONTEXT_CHAR_LIMIT = 2000;
export const MEMORY_RETRIEVE_K = 8;
export const MEMORY_SEARCH_K = 5;
export const MEMORY_REVIEW_INTERVAL_TURNS = 10;

export type MemoryRow = {
  id: string;
  content: string;
  path?: string | null;
  memoryType?: string | null;
  updatedAt?: number | null;
};

function pathParts(path?: string | null) {
  return String(path || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function memoryLabel(memory: Pick<MemoryRow, "content" | "path">) {
  const content = presentMemoryContent(memory.content || "");
  let path = englishMemoryPath(String(memory.path || "").trim());
  if (/^(birthday|geboortedatum)$/i.test(path) && !/^Birthday:/i.test(content)) path = "";
  return path ? `${path}: ${content}` : content;
}

function isUserType(type?: string | null) {
  const value = String(type || "user").toLowerCase();
  return value !== "context";
}

export function memoryPathHints(query: string, memories: MemoryRow[], limit = 6) {
  const lowered = query.toLowerCase();
  if (!lowered.trim()) return [];
  const hints: string[] = [];
  for (const memory of [...memories].sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")))) {
    const path = String(memory.path || "").trim();
    if (!path || hints.includes(path)) continue;
    const parts = pathParts(path);
    const last = parts[parts.length - 1] || path;
    if (lowered.includes(path.toLowerCase()) || lowered.includes(last.toLowerCase())) hints.push(path);
    else if (parts.some((part) => part.length >= 3 && lowered.includes(part.toLowerCase()))) hints.push(path);
    if (hints.length >= limit) break;
  }
  return hints;
}

function pathRank(memoryPath: string | null | undefined, lookupPath: string) {
  const memory = normalizeMemoryPath(memoryPath || "");
  const lookup = normalizeMemoryPath(lookupPath);
  if (!memory || !lookup) return null;
  if (memory === lookup) return [0, 0] as const;
  if (memory.startsWith(`${lookup}/`)) return [1, pathParts(memory).length - pathParts(lookup).length] as const;
  if (lookup.startsWith(`${memory}/`)) return [2, pathParts(lookup).length - pathParts(memory).length] as const;
  const parent = (path: string) => pathParts(path).slice(0, -1).join("/");
  if (parent(memory) && parent(memory) === parent(lookup)) return [3, 0] as const;
  const shared = pathParts(memory).filter((part) => pathParts(lookup).includes(part)).length;
  if (shared) return [4, -shared] as const;
  const last = (path: string) => pathParts(path).at(-1);
  if (last(memory) && last(memory) === last(lookup)) return [5, 0] as const;
  return null;
}

export function searchMemoryRows(
  memories: MemoryRow[],
  opts: { query?: string; path?: string; memoryId?: string; memoryType?: string; limit?: number },
) {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  let rows = [...memories];
  if (opts.memoryId) rows = rows.filter((item) => item.id === opts.memoryId);
  if (opts.memoryType && opts.memoryType !== "all") {
    const want = opts.memoryType.toLowerCase();
    rows = rows.filter((item) => String(item.memoryType || "user").toLowerCase() === want);
  }
  const lookup = normalizeMemoryPath(opts.path || "");
  if (lookup) {
    const base = pathParts(lookup).at(-1) || lookup;
    rows = rows.filter((item) => {
      if (pathRank(item.path, lookup)) return true;
      const hay = `${item.path || ""}\n${item.content || ""}`.toLowerCase();
      return hay.includes(lookup.toLowerCase()) || hay.includes(base.toLowerCase());
    });
  }
  const query = (opts.query || "").trim().toLowerCase();
  if (query) {
    rows = rows.filter(
      (item) => item.content.toLowerCase().includes(query) || String(item.path || "").toLowerCase().includes(query),
    );
  }
  return rows
    .sort((a, b) => {
      const ra = lookup ? pathRank(a.path, lookup) : null;
      const rb = lookup ? pathRank(b.path, lookup) : null;
      const aKey = ra ? ra[0] * 100 + ra[1] : 900;
      const bKey = rb ? rb[0] * 100 + rb[1] : 900;
      if (aKey !== bKey) return aKey - bKey;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    })
    .slice(0, limit);
}

function foldToken(token: string) {
  if (token === "dogs" || token === "honden") return "dog";
  if (token === "cats" || token === "katten") return "cat";
  if (token === "pets") return "pet";
  return token;
}

function asksAboutPet(query: string) {
  return /\b(dogs?|cats?|pets?|honden?|katten?|huisdier)\b/i.test(query);
}

function retrievalTokens(query: string) {
  const tokens = distinctiveTokens(query);
  if (/\b(pc|pcs|mini-?pc|spec|homelab|hardware|gpu|videokaart|ram|server)\b/i.test(query)) {
    tokens.push("hardware");
  }
  if (!asksAboutPet(query) && /\b(wie ben ik|who am i|naam|name|leeftijd|age|birthday)\b/i.test(query)) {
    tokens.push("identiteit");
  }
  if (/\bdogs?\b|\bhonden?\b/i.test(query)) tokens.push("dog");
  if (/\bcats?\b|\bkatten?\b/i.test(query)) tokens.push("cat");
  if (/\bpets?\b|\bhuisdier/i.test(query)) tokens.push("pet");
  return tokens.map(foldToken);
}

export function rankMemories(memories: MemoryRow[], query: string, k = MEMORY_RETRIEVE_K) {
  const qTok = retrievalTokens(query);
  if (!qTok.length) return [];
  const qSet = new Set(qTok);
  const petQuery = asksAboutPet(query);
  return memories
    .map((item) => {
      const tokens = distinctiveTokens(`${item.path || ""} ${item.content}`).map(foldToken);
      let sharedTokens = tokens.filter((token) => qSet.has(token));
      if (petQuery && memoryFactKey(item.content) === "identity" && !/\b(dog|cat|pet|hond|kat)\b/i.test(item.content)) {
        sharedTokens = sharedTokens.filter((token) => token !== "name" && token !== "naam" && token !== "identiteit" && token !== "identity");
      }
      const shared = sharedTokens.length;
      const pathHit = pathParts(item.path).some((part) => part.length >= 3 && query.toLowerCase().includes(part.toLowerCase()));
      const score = shared + (pathHit ? 2 : 0);
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0))
    .slice(0, Math.max(1, k))
    .map((row) => row.item);
}

function takeUntil(items: MemoryRow[], limit: number) {
  const taken: MemoryRow[] = [];
  let used = 0;
  for (const item of items) {
    const line = `- ${memoryLabel(item)}`;
    if (used && used + line.length + 1 > limit) break;
    taken.push(item);
    used += line.length + 1;
  }
  return taken;
}

function section(title: string, labels: string[]) {
  if (!labels.length) return "";
  const unique = [...new Set(labels.map((item) => item.trim()).filter(Boolean))];
  unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return `[${title}]\n${unique.map((item) => `- ${item}`).join("\n")}`;
}

function publicMemoryText(memory: MemoryRow) {
  return presentMemoryContent(memory.content || "")
    .replace(/<\/?memory_context>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function lineIncluded(rendered: string, memory: MemoryRow) {
  return rendered.split("\n").includes(`- ${memoryLabel(memory)}`);
}

export type MemoryUsageMeta = {
  memoryUsed: boolean;
  memoryIds: string[];
  memories: UsedMemory[];
  context: string;
};

const EMPTY_MEMORY_USAGE: MemoryUsageMeta = { memoryUsed: false, memoryIds: [], memories: [], context: "" };

/** Open WebUI-style system snippet: user notes (capped) + retrieved context. */
export function composeMemoryContext(
  memories: MemoryRow[],
  query: string,
  opts?: { userLimit?: number; contextLimit?: number; k?: number },
) {
  const q = query.trim();
  if (!q || !memories.length) return { text: "", used: [] as UsedMemory[] };
  const userLimit = Math.max(250, opts?.userLimit ?? MEMORY_USER_CHAR_LIMIT);
  const contextLimit = Math.max(250, opts?.contextLimit ?? MEMORY_CONTEXT_CHAR_LIMIT);
  const k = opts?.k ?? MEMORY_RETRIEVE_K;
  const userAll = [...memories]
    .filter((item) => isUserType(item.memoryType))
    .sort((a, b) => `${a.path || ""}\0${a.updatedAt || 0}`.localeCompare(`${b.path || ""}\0${b.updatedAt || 0}`));
  const userTaken = takeUntil(userAll, userLimit);
  const seen = new Set(userTaken.map((item) => item.id));
  const retrieved = new Set<string>();
  const neighborhood: MemoryRow[] = [];
  const relevant: MemoryRow[] = [];

  for (const hint of memoryPathHints(q, memories)) {
    for (const memory of searchMemoryRows(memories, { path: hint, memoryType: "context", limit: 4 })) {
      retrieved.add(memory.id);
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      neighborhood.push(memory);
    }
  }

  for (const memory of rankMemories(memories, q, k)) {
    retrieved.add(memory.id);
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    relevant.push(memory);
  }

  const userPart = section("User Memory", userTaken.map(memoryLabel)).slice(0, userLimit);
  const contextPart = [
    section("Memory Neighborhood", neighborhood.map(memoryLabel)),
    section("Relevant Context", relevant.map(memoryLabel)),
  ]
    .filter(Boolean)
    .join("\n\n");
  const contextCapped = contextPart.slice(0, contextLimit);
  const rendered = [userPart, contextCapped].filter(Boolean).join("\n\n").trim();
  if (!rendered) return { text: "", used: [] as UsedMemory[] };
  const used: UsedMemory[] = [];
  const seenIds = new Set<string>();
  for (const memory of [...userTaken, ...neighborhood, ...relevant]) {
    if (!memory.id || !retrieved.has(memory.id) || seenIds.has(memory.id) || !lineIncluded(rendered, memory)) continue;
    const content = publicMemoryText(memory);
    if (!content) continue;
    seenIds.add(memory.id);
    used.push({ id: memory.id, content });
  }
  return { text: `${MEMORY_CONTEXT_OPEN}\n${rendered}\n${MEMORY_CONTEXT_CLOSE}`, used: parseUsedMemories(used) };
}

export function buildMemoryContext(
  memories: MemoryRow[],
  query: string,
  opts?: { userLimit?: number; contextLimit?: number; k?: number },
) {
  return composeMemoryContext(memories, query, opts).text;
}

function retrievedMemoryIds(memories: MemoryRow[], query: string) {
  const ids = new Set<string>();
  for (const hint of memoryPathHints(query, memories)) {
    for (const memory of searchMemoryRows(memories, { path: hint, memoryType: "context", limit: 4 })) ids.add(memory.id);
  }
  for (const memory of rankMemories(memories, query)) ids.add(memory.id);
  return ids;
}

export function memoryUsageForTurn(input: {
  enabled: boolean;
  userId: string;
  memories: Array<MemoryRow & { userId?: string | null }>;
  query: string;
  current?: string;
}): MemoryUsageMeta {
  if (!input.enabled) return { ...EMPTY_MEMORY_USAGE, memoryIds: [], memories: [] };
  try {
    const owned = input.memories.filter((row) => row.userId == null || row.userId === input.userId);
    const built = composeMemoryContext(owned, input.query);
    const ids = new Set(owned.map((row) => row.id));
    const focus = (input.current || "").trim();
    const focusIds = focus ? retrievedMemoryIds(owned, focus) : null;
    const memories = built.used.filter((row) => ids.has(row.id) && (!focusIds || focusIds.has(row.id)));
    if (!built.text || !memories.length) {
      return { memoryUsed: false, memoryIds: [], memories: [], context: built.text };
    }
    return {
      memoryUsed: true,
      memoryIds: memories.map((row) => row.id),
      memories,
      context: built.text,
    };
  } catch {
    return { ...EMPTY_MEMORY_USAGE, memoryIds: [], memories: [] };
  }
}

export function memoryUsedPayload(meta: MemoryUsageMeta) {
  if (!meta.memoryUsed || !meta.memories.length) return null;
  return { memoryUsed: true as const, memoryIds: meta.memoryIds, memories: meta.memories };
}

export function listMemoryPathGroups(memories: MemoryRow[], limit = 100) {
  const cap = Math.max(1, Math.min(limit, 500));
  const grouped = new Map<string, { path: string; type: string; count: number; updatedAt: number; children: string[] }>();
  for (const memory of memories) {
    const type = String(memory.memoryType || "user");
    const path = String(memory.path || "");
    const key = `${path}\0${type}`;
    const current = grouped.get(key) || { path, type, count: 0, updatedAt: 0, children: [] };
    current.count += 1;
    current.updatedAt = Math.max(current.updatedAt, memory.updatedAt || 0);
    grouped.set(key, current);
  }
  const paths = [...grouped.values()].map((item) => item.path).filter(Boolean);
  for (const group of grouped.values()) {
    if (!group.path) continue;
    const prefix = `${group.path}/`;
    const children: string[] = [];
    for (const candidate of paths) {
      if (!candidate.startsWith(prefix)) continue;
      const child = `${prefix}${candidate.slice(prefix.length).split("/")[0]}`;
      if (!children.includes(child)) children.push(child);
    }
    group.children = children.slice(0, 20);
  }
  const groups = [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { paths: groups.slice(0, cap), count: groups.length };
}

export function readMemoryPath(memories: MemoryRow[], path: string, limit = 50) {
  const lookup = normalizeMemoryPath(path);
  if (!lookup) return { path: "", parents: [] as string[], children: [] as string[], memories: [] as MemoryRow[] };
  const cap = Math.max(1, Math.min(limit, 100));
  const parts = pathParts(lookup);
  const pathSet = new Set(memories.map((item) => normalizeMemoryPath(item.path || "")).filter(Boolean));
  const parents = parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"))
    .filter((value) => pathSet.has(value));
  const children = [
    ...new Set(
      memories
        .map((item) => normalizeMemoryPath(item.path || ""))
        .filter((value) => value.startsWith(`${lookup}/`))
        .map((value) => `${lookup}/${value.slice(lookup.length + 1).split("/")[0]}`),
    ),
  ].sort();
  const selected = memories.filter((item) => {
    const value = normalizeMemoryPath(item.path || "");
    if (value === lookup || parents.includes(value)) return true;
    return value.startsWith(`${lookup}/`);
  });
  const rank = (item: MemoryRow) => {
    const value = normalizeMemoryPath(item.path || "");
    if (value === lookup) return 0;
    if (value.startsWith(`${lookup}/`)) return 1;
    return 2;
  };
  return {
    path: lookup,
    parents,
    children: children.slice(0, 50),
    memories: selected
      .sort((a, b) => rank(a) - rank(b) || pathParts(a.path).length - pathParts(b.path).length || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, cap),
  };
}
