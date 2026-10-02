import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { memories } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { canonicalIdentityField, englishMemoryPath, formatIdentityMemory, inferMemoryPath, memoriesOverlap, memoryFactKey, normalizeMemoryPath, normalizeMemoryType, parseIdentityFields, pickMemorySummary, stripFalseBirthdayLabel, summarizeMemoryFact, type MemoryDraft } from "./memory-ops.ts";
import { rankMemories } from "./memory-context.ts";

export type { MemoryDraft };

const MONTHS =
  "jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|t)?|apr(?:il)?|may|mei|jun(?:e|i)?|jul(?:y|i)?|aug(?:ustus|ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function categorize(text: string) {
  const t = text.toLowerCase();
  if (/\b(name|naam|heette|ik heet|age|jaar oud|birthday|geboren|born)\b/.test(t)) return "identity";
  if (/\b(live|woon|from|uit|city|stad|language|taal)\b/.test(t)) return "identity";
  if (/\b(like|dislike|prefer|voorkeur|favorite|liever)\b/.test(t)) return "preference";
  if (/\b(work|job|project|bedrijf|company|studio|agency)\b/.test(t)) return "work";
  return "other";
}

function clean(text: string) {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function title(text: string) {
  const value = clean(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isPlaceholderFact(text: string) {
  return /^(this|that|it|dit|dat|this in memory|that in memory|dit in het geheugen|in memory|this information|that information|deze informatie)$/i.test(
    clean(text),
  );
}

function isSaveOnlyCommand(text: string) {
  return /^(?:please\s+)?(?:can you |could you |would you )?(?:please\s+)?(?:remember|save|store|onthoudt?|note|sla op)(?:\s+(?:that|dat|this|dit|it))?(?:\s+in(?:to)?\s+(?:memory|het geheugen|memorie))?\s*$/i.test(
    clean(text),
  );
}

function stripSaveWrapper(text: string) {
  const value = clean(text);
  const leading = value.match(
    /^(?:please\s+)?(?:can you |could you |would you )?(?:please\s+)?(?:remember|save|store|onthoudt?|note)(?:\s+that|\s+dat)?[:\s]+(.+)$/i,
  );
  const slaOp = value.match(/^(?:please\s+)?sla op(?:\s+dat)?[:\s]+(.+)$/i);
  const trailing = value.match(/^(.+?)[,.]?\s+(?:please\s+)?(?:save|remember|onthoudt?|sla op)(?:\s+(?:that|dat|this|dit))?(?:\s+in(?:to)?\s+(?:memory|het geheugen))?$/i);
  const inner = clean(leading?.[1] || slaOp?.[1] || trailing?.[1] || "");
  if (inner && !isPlaceholderFact(inner) && !isSaveOnlyCommand(inner)) return inner;
  if (isSaveOnlyCommand(value) || (inner && isPlaceholderFact(inner))) return "";
  return value;
}

function nameValue(raw: string) {
  const cut = raw.split(/[,.]/)[0].split(/\s+(?:en|and|kan|jaar|old|from|born|i was|i am|i['’]m|\bim\b|ik)\b/i)[0] || raw;
  const name = clean(cut.replace(/^(called|named|genaamd)\s+/i, "")).replace(/[^\p{L}' -]/gu, "").trim();
  return name.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
}

function parseName(text: string) {
  const value = clean(text);
  const match = value.match(
    /(?:^|\b)(?:my name is|i(?:['’]m| am)(?: called| named)?|ik heet|mijn naam is)\s+(.+)$/i,
  );
  const name = match?.[1] ? nameValue(match[1]) : "";
  if (name && name.split(/\s+/).length <= 4) return { content: `The user's name is ${name}`, category: "identity" };
  return null;
}

function parseAge(text: string) {
  const match = clean(text).match(
    /(?:i(?:['’]?m| am)|ik ben)\s+(\d{1,3})\s*(?:years? old|jaar(?: oud)?)?|(?:i am|ik ben)\s+(\d{1,3})\b|\b(\d{1,3})\s*(?:years? old|jaar oud)\b/i,
  );
  const age = match?.[1] || match?.[2] || match?.[3];
  if (!age) return null;
  const n = Number(age);
  if (n < 5 || n > 120) return null;
  return { content: `The user's age is ${n}`, category: "identity" };
}

function parseBirthday(text: string) {
  const value = clean(text);
  const monthDay = new RegExp(
    `(?:(?:was\\s+)?born(?:\\s+on)?|birthday(?:\\s+is)?|geboren(?:\\s+op)?|date of birth(?:\\s+is)?|i(?:['’]?m| am) from|ik kom uit)\\s+(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{2,4}|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4})`,
    "i",
  );
  const looseDate = new RegExp(`\\b(\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{2,4}|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})\\b`, "i");
  const hit = value.match(monthDay)?.[1] || (/(born|birthday|geboren|from|uit)/i.test(value) ? value.match(looseDate)?.[1] : "");
  if (!hit) return null;
  return { content: `The user's birthday is ${clean(hit)}`, category: "identity" };
}

function parseHome(text: string) {
  const value = clean(text);
  const match = value.match(/\b(?:i live in|ik woon in|i(?:['’]m| am) from|ik kom uit)\s+(.+)$/i);
  const place = clean(match?.[1] || "");
  if (!place || parseBirthday(value) || /\d/.test(place)) return null;
  if (place.split(/\s+/).length > 8) return null;
  return { content: `The user is from ${place}`, category: "identity" };
}

function parseJob(text: string) {
  const value = clean(text);
  const match = value.match(
    /\b(?:i work as(?:\s+as)?|i(?:['’]?m| am)(?: working)? as|i work at|ik werk als|ik werk bij|my (?:job|role|title) is|ik ben werkzaam als)\s+(?:an?\s+)?(.+)$/i,
  );
  const job = clean(match?.[1] || "").replace(/^(as|a|an)\s+/i, "");
  if (!job || job.split(/\s+/).length > 12) return null;
  return { content: `The user's job is ${job}`, category: "work" };
}

function parseCompany(text: string) {
  const value = clean(text);
  const match = value.match(
    /\b(?:(?:company|studio|agency|bedrijf)\s+(?:called|named|genaamd|genoemd)|my (?:company|studio|agency|bedrijf)(?:'s name)? is(?: called)?|ik heb (?:een )?[\w\s]{0,40}?(?:bedrijf|studio|agency) (?:genaamd|genoemd|dat heet))\s+(.+)$/i,
  );
  const name = clean(match?.[1] || "");
  if (!name || name.split(/\s+/).length > 10) return null;
  return { content: `The user's company is ${name}`, category: "work" };
}

export function extractFactsFromText(message: string): MemoryDraft[] {
  const text = clean(message);
  if (!text) return [];
  const facts = [parseName(text), parseBirthday(text), parseAge(text), parseHome(text), parseCompany(text), parseJob(text)].filter(
    (item): item is MemoryDraft => Boolean(item),
  );
  return facts;
}

function isPersonalFactStatement(text: string) {
  return /\b(i work|ik werk|i have .{0,60}(company|studio|agency|bedrijf)|my (job|company|role|title)|ik heb een .{0,60}(bedrijf|studio)|i own|my name is|ik heet|i was born|ik ben \d)/i.test(
    text,
  );
}

function fallbackFact(text: string): MemoryDraft | null {
  const value = title(text);
  if (value.length < 2 || value.length > 400) return null;
  if (isPlaceholderFact(value) || isSaveOnlyCommand(value)) return null;
  return { content: value, category: categorize(value) };
}

export function extractExplicitMemories(message: string, previousUser?: string): MemoryDraft[] {
  const text = clean(message);
  if (!text) return [];
  const found: MemoryDraft[] = [];
  const wrapped = stripSaveWrapper(text);
  const saveCommand = isSaveOnlyCommand(text) || (wrapped === "" && /save|remember|onthoud|sla op|memory/i.test(text));

  if (saveCommand) {
    const fromPrevious = extractFactsFromText(previousUser || "");
    if (fromPrevious.length) found.push(...fromPrevious);
    else {
      const fallback = fallbackFact(stripSaveWrapper(previousUser || "") || previousUser || "");
      if (fallback) found.push(fallback);
    }
  } else {
    found.push(...extractFactsFromText(wrapped || text));
    if (!found.length && (isPersonalFactStatement(wrapped || text) || (wrapped && wrapped !== text))) {
      const fallback = fallbackFact(wrapped || text);
      if (fallback) found.push(fallback);
    }
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    const key = item.content.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isIdentityMemory(item: { content: string; path?: string | null }) {
  return (
    memoryFactKey(item.content) === "identity" ||
    Boolean(canonicalIdentityField(item.path || "")) ||
    /^(identiteit|identity)$/i.test(String(item.path || ""))
  );
}

export function saveUserMemories(db: DB, userId: string, drafts: MemoryDraft[], conversationId?: string | null) {
  const saved: { id: string; content: string; category: string; path: string; memoryType: string }[] = [];
  if (!drafts.length) return saved;
  const now = Date.now();
  const merge = Boolean(conversationId);
  let existing = db.select().from(memories).where(eq(memories.userId, userId)).all();

  for (const draft of drafts) {
    const content = stripFalseBirthdayLabel(draft.content);
    const category = draft.category || "other";
    let path = normalizeMemoryPath(draft.path || inferMemoryPath(content, category));
    path = englishMemoryPath(path);
    if (/^(birthday|geboortedatum)$/i.test(path) && !/^Birthday:/i.test(content)) {
      path = inferMemoryPath(content, category) || "";
    }
    const memoryType = normalizeMemoryType(draft.memoryType || "user");
    if (merge) {
      const related = existing.find((item) => memoriesOverlap(item.content, content));
      if (related) {
        const merged = pickMemorySummary(related.content, content);
        const updated = updateMemory(db, userId, related.id, {
          content: merged,
          category: isIdentityMemory({ content, path }) ? "identity" : category,
          path: isIdentityMemory({ content, path }) ? "Identity" : englishMemoryPath(path || related.path),
          memoryType,
        });
        existing = existing.map((item) => (item.id === related.id && updated ? { ...item, ...updated, updatedAt: now } : item));
        if (updated) saved.push(updated);
        continue;
      }
    }
    const stored = stripFalseBirthdayLabel(merge ? summarizeMemoryFact(content) : content);
    if (/^(birthday|geboortedatum)$/i.test(path) && !/^Birthday:/i.test(stored)) {
      path = inferMemoryPath(stored, category) || "";
    }
    if (!stored) continue;
    if (existing.some((item) => item.content.toLowerCase() === stored.toLowerCase())) continue;
    const id = randomUUID();
    db.insert(memories)
      .values({
        id,
        userId,
        content: stored,
        category,
        memoryType,
        path,
        importance: 70,
        sourceConversationId: conversationId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    existing.push({
      id,
      userId,
      content: stored,
      category,
      memoryType,
      path,
      importance: 70,
      sourceConversationId: conversationId || null,
      createdAt: now,
      updatedAt: now,
    });
    saved.push({ id, content: stored, category, path, memoryType });
  }

  return saved;
}

export function searchMemories(db: DB, userId: string, query: string, limit = 5) {
  const rows = db.select().from(memories).where(eq(memories.userId, userId)).all();
  const mapped = rows.map((row) => ({
    id: row.id,
    content: row.content,
    category: row.category,
    path: row.path,
    memoryType: row.memoryType,
    updatedAt: row.updatedAt,
  }));
  const q = query.trim();
  if (!q) return mapped.slice(0, Math.max(limit, 20));
  const ranked = rankMemories(mapped, q, Math.max(1, Math.min(limit, 20)));
  if (ranked.length) return ranked;
  const lower = q.toLowerCase();
  return mapped
    .filter(
      (row) =>
        row.id.toLowerCase().includes(lower) ||
        row.content.toLowerCase().includes(lower) ||
        row.category.toLowerCase().includes(lower) ||
        row.path.toLowerCase().includes(lower) ||
        row.memoryType.toLowerCase().includes(lower),
    )
    .slice(0, limit);
}

export function updateMemory(
  db: DB,
  userId: string,
  id: string,
  patch: { content?: string; category?: string; path?: string; memoryType?: string },
) {
  const row = db.select().from(memories).where(eq(memories.id, id)).get();
  if (!row || row.userId !== userId) return null;
  const content = stripFalseBirthdayLabel(patch.content ?? row.content);
  const category = (patch.category ?? row.category).trim().slice(0, 40) || row.category;
  let path = patch.path == null ? englishMemoryPath(row.path) : englishMemoryPath(patch.path);
  if (/^(birthday|geboortedatum)$/i.test(path) && !/^Birthday:/i.test(content)) {
    path = inferMemoryPath(content, category) || "";
  }
  const memoryType = patch.memoryType == null ? row.memoryType : normalizeMemoryType(patch.memoryType);
  if (!content) return null;
  const updatedAt = Date.now();
  db.update(memories)
    .set({ content, category, path, memoryType, updatedAt })
    .where(eq(memories.id, id))
    .run();
  return { id, content, category, path, memoryType, updatedAt };
}

export function repairFalseBirthdayMemories(db: DB, userId: string) {
  const rows = db.select().from(memories).where(eq(memories.userId, userId)).all();
  const now = Date.now();
  for (const row of rows) {
    let content = stripFalseBirthdayLabel(row.content);
    const identity = parseIdentityFields(content);
    if (Object.keys(identity).length) content = formatIdentityMemory(identity);
    let path = englishMemoryPath(row.path);
    if (/^(birthday|geboortedatum)$/i.test(path) && !/^Birthday:/i.test(content)) {
      path = inferMemoryPath(content, row.category) || "";
    }
    if (Object.keys(identity).length) path = "Identity";
    if (content === row.content && path === row.path) continue;
    db.update(memories).set({ content, path, updatedAt: now }).where(eq(memories.id, row.id)).run();
    row.content = content;
    row.path = path;
  }
  return rows;
}

export function deleteMemory(db: DB, userId: string, id: string) {
  const row = db.select().from(memories).where(eq(memories.id, id)).get();
  if (!row || row.userId !== userId) return false;
  db.delete(memories).where(eq(memories.id, id)).run();
  return true;
}
