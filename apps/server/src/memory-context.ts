import { distinctiveTokens, englishMemoryPath, normalizeMemoryPath, stripFalseBirthdayLabel } from "./memory-ops.ts";

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
  const content = stripFalseBirthdayLabel(memory.content || "");
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

function retrievalTokens(query: string) {
  const tokens = distinctiveTokens(query);
  if (/\b(pc|pcs|mini-?pc|spec|homelab|hardware|gpu|videokaart|ram|server)\b/i.test(query)) {
    tokens.push("hardware");
  }
  if (/\b(wie ben ik|who am i|naam|name|leeftijd|age|birthday)\b/i.test(query)) {
    tokens.push("identiteit");
  }
  return tokens;
}

export function rankMemories(memories: MemoryRow[], query: string, k = MEMORY_RETRIEVE_K) {
  const qTok = retrievalTokens(query);
  if (!qTok.length) return [];
  const qSet = new Set(qTok);
  return memories
    .map((item) => {
      const tokens = distinctiveTokens(`${item.path || ""} ${item.content}`);
      const shared = tokens.filter((token) => qSet.has(token)).length;
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

/** Open WebUI-style system snippet: user notes (capped) + retrieved context. */
export function buildMemoryContext(
  memories: MemoryRow[],
  query: string,
  opts?: { userLimit?: number; contextLimit?: number; k?: number },
) {
  const q = query.trim();
  if (!q || !memories.length) return "";
  const userLimit = Math.max(250, opts?.userLimit ?? MEMORY_USER_CHAR_LIMIT);
  const contextLimit = Math.max(250, opts?.contextLimit ?? MEMORY_CONTEXT_CHAR_LIMIT);
  const k = opts?.k ?? MEMORY_RETRIEVE_K;
  const userAll = [...memories]
    .filter((item) => isUserType(item.memoryType))
    .sort((a, b) => `${a.path || ""}\0${a.updatedAt || 0}`.localeCompare(`${b.path || ""}\0${b.updatedAt || 0}`));
  const userTaken = takeUntil(userAll, userLimit);
  const seen = new Set(userTaken.map((item) => item.id));
  const neighborhood: string[] = [];
  const relevant: string[] = [];

  for (const hint of memoryPathHints(q, memories)) {
    for (const memory of searchMemoryRows(memories, { path: hint, memoryType: "context", limit: 4 })) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      neighborhood.push(memoryLabel(memory));
    }
  }

  for (const memory of rankMemories(memories, q, k)) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    relevant.push(memoryLabel(memory));
  }

  const userPart = section("User Memory", userTaken.map(memoryLabel)).slice(0, userLimit);
  const contextPart = [
    section("Memory Neighborhood", neighborhood),
    section("Relevant Context", relevant),
  ]
    .filter(Boolean)
    .join("\n\n");
  const contextCapped = contextPart.slice(0, contextLimit);
  const rendered = [userPart, contextCapped].filter(Boolean).join("\n\n").trim();
  if (!rendered) return "";
  return `${MEMORY_CONTEXT_OPEN}\n${rendered}\n${MEMORY_CONTEXT_CLOSE}`;
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
