const CATEGORIES = new Set(["identity", "preference", "work", "other"]);

export type MemoryType = "user" | "preference" | "context";

export type MemoryOp = {
  action: "add" | "replace" | "remove" | "move";
  id?: string;
  content?: string;
  category?: string;
  path?: string;
  memoryType?: MemoryType;
};

export type MemoryDraft = {
  content: string;
  category: string;
  path?: string;
  memoryType?: MemoryType;
};

function clean(text: string) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asAction(raw: string): MemoryOp["action"] | "" {
  const value = raw.toLowerCase();
  if (value === "add" || value === "create") return "add";
  if (value === "replace" || value === "update" || value === "merge") return "replace";
  if (value === "remove" || value === "delete") return "remove";
  if (value === "move") return "move";
  return "";
}

export function normalizeMemoryPath(raw: string) {
  return String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .slice(0, 80);
}

export function normalizeMemoryType(raw: string): MemoryType {
  const value = String(raw || "").toLowerCase();
  if (value === "context") return "context";
  if (value === "preference" || value === "preferentie" || value === "voorkeur") return "preference";
  return "user";
}

export function inferMemoryPath(text: string, category = "") {
  const t = `${text} ${category}`.toLowerCase();
  if (/\b(communicatie|aanspreekvorm|aanspreek|informeel|formeel|tutoy)\b/.test(t)) return "Communicatiestijl";
  if (/\b(pc|gpu|videokaart|hardware|gaming)\b/.test(t)) return "Hardware";
  if (/\b(woont|woon|lives in|live in|living in)\b/.test(t)) return "Locatie";
  if (/\b(geslacht|leeftijd|geboortedatum|geboorte|gender|birthday|age|naam|name)\b/.test(t) || category === "identity") {
    return "Identiteit";
  }
  if (/\b(work|job|project|bedrijf|company|studio|agency|werk)\b/.test(t) || category === "work") return "Werk";
  if (isPreference(text) || category === "preference") return "Voorkeuren";
  return "";
}

export function inferMemoryType(text: string, category = ""): MemoryType {
  if (isPreference(text) || category === "preference") return "preference";
  if (category === "identity" || category === "work") return "user";
  if (isFirstPerson(text) || /:\s*\S/.test(text)) return "user";
  return "context";
}

function withPath(draft: MemoryDraft): MemoryDraft {
  const path = normalizeMemoryPath(draft.path || inferMemoryPath(draft.content, draft.category));
  return {
    ...draft,
    path,
    memoryType: draft.memoryType ? normalizeMemoryType(draft.memoryType) : inferMemoryType(draft.content, draft.category),
  };
}

const IDENTITY_LABELS: Record<string, string> = {
  geslacht: "Geslacht",
  gender: "Geslacht",
  leeftijd: "Leeftijd",
  age: "Leeftijd",
  geboortedatum: "Geboortedatum",
  birthday: "Geboortedatum",
  geboren: "Geboortedatum",
  naam: "Naam",
  name: "Naam",
};

export function canonicalIdentityField(raw: string) {
  return IDENTITY_LABELS[String(raw || "").trim().toLowerCase()] || "";
}

export function isDateValue(value: string) {
  const v = clean(value);
  if (!v || v.length > 40) return false;
  if (/\b(gebruiker|user|heeft|videokaart|gpu|ram|pc|woont|werkt|likes|houdt)\b/i.test(v)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  if (/^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(v)) return true;
  if (
    /^\d{1,2}\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|oct|nov|dec)\.?(?:\s+\d{4})?$/i.test(
      v,
    )
  ) {
    return true;
  }
  if (
    /^(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}(?:\s*,?\s*\d{4})?$/i.test(
      v,
    )
  ) {
    return true;
  }
  return false;
}

export function stripFalseBirthdayLabel(text: string) {
  const value = clean(text);
  const labeled = value.match(/^(?:geboortedatum|birthday|date of birth|geboren(?:\s+op)?|born(?:\s+on)?)\s*:\s*(.+)$/i);
  if (!labeled) return value;
  const rest = clean(labeled[1]);
  if (isDateValue(rest)) return `Geboortedatum: ${rest}`;
  return rest;
}

export function formatIdentityMemory(fields: Record<string, string>) {
  const next = { ...fields };
  if (next.Geboortedatum && !isDateValue(next.Geboortedatum)) delete next.Geboortedatum;
  if (next.Leeftijd && !/^\d{1,3}$/.test(next.Leeftijd)) delete next.Leeftijd;
  const order = ["Naam", "Geslacht", "Leeftijd", "Geboortedatum"];
  const keys = [...order.filter((key) => next[key]), ...Object.keys(next).filter((key) => !order.includes(key))];
  return keys.map((key) => `${key}: ${next[key]}`).join(", ");
}

export function parseIdentityFields(text: string) {
  const fields: Record<string, string> = {};
  const t = clean(text);
  for (const match of t.matchAll(/(?:^|[,;]|\n)\s*([\p{L}][\p{L}0-9 /_-]{1,40})\s*:\s*([^,\n;]+)/gu)) {
    const label = canonicalIdentityField(match[1]);
    const value = clean(match[2]).replace(/^(the user|de gebruiker)\s*:?\s*/i, "");
    if (!label || !value) continue;
    if (label === "Geboortedatum" && !isDateValue(value)) continue;
    if (label === "Leeftijd" && !/^\d{1,3}$/.test(value)) continue;
    fields[label] = value;
  }
  for (const match of t.matchAll(/\bthe user's (\S+) is ([^.]+)/gi)) {
    const label = canonicalIdentityField(match[1]);
    const value = clean(match[2]);
    if (!label || !value) continue;
    if (label === "Geboortedatum" && !isDateValue(value)) continue;
    if (label === "Leeftijd" && !/^\d{1,3}$/.test(value)) continue;
    fields[label] = value;
  }
  const age = t.match(/\b(\d{1,3})\s*(?:jaar oud|years? old)\b/i) || t.match(/\b(?:age|leeftijd) is (\d{1,3})\b/i);
  if (age?.[1] && Number(age[1]) >= 5 && Number(age[1]) <= 120) fields.Leeftijd = age[1];
  const born = t.match(/\b(?:geboren(?:\s+op)?|birthday(?:\s+is)?|born(?:\s+on)?)\s+([^.,]+)/i);
  if (born?.[1] && isDateValue(born[1])) fields.Geboortedatum = clean(born[1]);
  const bare = t.match(/^(?:the user|de gebruiker)\s*:\s*(.+)$/i);
  if (bare?.[1] && !Object.keys(fields).length) {
    const value = clean(bare[1]);
    if (/^\d{1,3}$/.test(value) && Number(value) >= 5 && Number(value) <= 120) fields.Leeftijd = value;
    else if (/^(man|vrouw|male|female|non-binary|non binary)$/i.test(value)) fields.Geslacht = value;
    else if (isDateValue(value)) fields.Geboortedatum = value;
  }
  return fields;
}

function asOp(row: Record<string, unknown>): MemoryOp | null {
  let content = stripFalseBirthdayLabel(String(row.content ?? row.fact ?? row.memory ?? row.text ?? ""));
  const action = asAction(String(row.action || (content || row.path ? "add" : "")));
  if (!action) return null;
  const category = String(row.category || "other").toLowerCase();
  let path = normalizeMemoryPath(String(row.path || ""));
  const ident = canonicalIdentityField(path);
  if (ident && content) {
    const value = content.replace(/^(the user|de gebruiker)\s*:?\s*/i, "").trim();
    const shortValue =
      ident === "Geboortedatum"
        ? isDateValue(value)
        : ident === "Leeftijd"
          ? /^\d{1,3}$/.test(value)
          : value.length > 0 && value.length <= 40 && !/\b(heeft|woont|werkt|videokaart|gpu)\b/i.test(value);
    if (shortValue) {
      path = "Identiteit";
      const parsed = parseIdentityFields(`${ident}: ${value}`);
      content = Object.keys(parsed).length ? formatIdentityMemory(parsed) : `${ident}: ${value}`;
    } else {
      path = inferMemoryPath(content, category) || "";
    }
  } else if (content && Object.keys(parseIdentityFields(content)).length) {
    path = path || "Identiteit";
    content = formatIdentityMemory(parseIdentityFields(content));
  }
  return {
    action,
    id: row.id ? String(row.id) : undefined,
    content: content || undefined,
    category: CATEGORIES.has(category) ? category : ident ? "identity" : "other",
    path: path || inferMemoryPath(content, category) || undefined,
    memoryType: normalizeMemoryType(String(row.type ?? row.memoryType ?? inferMemoryType(content, category))),
  };
}

export function parseMemoryOperations(raw: string): MemoryOp[] {
  const text = String(raw || "").trim();
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start = objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
  const end = start === objStart ? text.lastIndexOf("}") : text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    const rows: unknown[] = [];
    if (Array.isArray(parsed)) rows.push(...parsed);
    else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const nested = obj.operations ?? obj.memories ?? obj.facts ?? obj.items;
      if (Array.isArray(nested)) rows.push(...nested);
      else rows.push(obj);
    }
    const ops: MemoryOp[] = [];
    for (const item of rows) {
      if (typeof item === "string" && item.trim()) {
        const draft = withPath({ content: item.trim(), category: "other" });
        ops.push({
          action: "add",
          content: draft.content,
          category: draft.category,
          path: draft.path,
          memoryType: draft.memoryType,
        });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const op = asOp(item as Record<string, unknown>);
      if (op) ops.push(op);
    }
    return ops.slice(0, 8);
  } catch {
    return [];
  }
}

function isChatFiller(text: string) {
  const t = clean(text).toLowerCase();
  if (!t) return true;
  if (isGreeting(t) || isSaveOnlyCommand(t) || isPlaceholder(t)) return true;
  if (isQuestion(t) || isTaskRequest(t)) return true;
  if (/^(ja|nee|yes|no|ok|oke|okay|sure|prima|goed|nee hoor)[\s,.!]*$/i.test(t)) return true;
  if (/\b(informatie (voeden|geven)|feed you|tell you|give you (some )?(info|information)|wat informatie)\b/i.test(t)) {
    return true;
  }
  if (/\b(ik ga|i(?:['’]m| am) going to|i will|laat me|let me)\b/i.test(t) && !hasConcreteDetail(t)) return true;
  if (/\b(dat doen|do that|do it)\b/i.test(t) && !hasConcreteDetail(t)) return true;
  return false;
}

function hasConcreteDetail(text: string) {
  const t = clean(text);
  if (/^the user's /i.test(t)) return true;
  if (/[A-Za-z]*\d[A-Za-z0-9-]*/.test(t)) return true;
  if (isPreference(t)) return true;
  if (
    /\b(ik heet|my name is|mijn naam|ik ben \d|i(?:['’]m| am) \d|jaar oud|geboren|i live|ik woon|woont in|lives in|i work|ik werk|i have|ik heb|i own|mijn (?:job|bedrijf|company))\b/i.test(
      t,
    )
  ) {
    return !/\b(informatie|information)\b/i.test(t);
  }
  return false;
}

export function isDurableMemory(text: string) {
  const t = clean(text);
  if (t.length < 8) return false;
  if (isChatFiller(t)) return false;
  if (profileLooksLikeFields(t)) return true;
  return hasConcreteDetail(t);
}

function profileLooksLikeFields(text: string) {
  return /(?:^|,)\s*[\p{L}][\p{L}0-9 /_-]{1,40}\s*:\s*[^,]+/u.test(text);
}

function isGreeting(text: string) {
  return /^(hi|hey|hello|hallo|hoi|yo|sup|ok|okay|thanks|thank you|thx|dag|doei|goedemorgen|goedemiddag|goedenavond)[\s!.]*$/i.test(
    text,
  );
}

export function isCasualChat(text: string) {
  const t = clean(text);
  if (!t) return false;
  if (/\b(wie ben ik|who am i|who im i|how old|hoe oud|waar woon|wat is mijn|who is)\b/i.test(t)) return false;
  if (/^(hoe gaat het|how are you|what's up|whats up)\b/i.test(t)) return true;
  return /^(hi|hey|hello|hallo|hoi|yo|sup|goedemorgen|goedemiddag|goedenavond)\b/i.test(t);
}

/** Rewrite first-person user notes so the model cannot copy "Ik ben …" as its own voice. */
export function memoryLineForPrompt(content: string, path?: string) {
  let t = stripFalseBirthdayLabel(String(content || ""));
  t = t
    .replace(/\bIk heet\b/gi, "De gebruiker heet")
    .replace(/\bIk ben\b/gi, "De gebruiker is")
    .replace(/\bIk heb\b/gi, "De gebruiker heeft")
    .replace(/\bIk woon\b/gi, "De gebruiker woont")
    .replace(/\bIk werk\b/gi, "De gebruiker werkt")
    .replace(/\bIk beheer\b/gi, "De gebruiker beheert")
    .replace(/\bI am\b/gi, "The user is")
    .replace(/\bI'm\b/gi, "The user is")
    .replace(/\bI have\b/gi, "The user has")
    .replace(/\bI live\b/gi, "The user lives")
    .replace(/\bI work\b/gi, "The user works")
    .replace(/\bI own\b/gi, "The user owns")
    .replace(/\bmijn\b/gi, "de gebruiker's")
    .replace(/\bmy\b/gi, "the user's");
  const prefix = path && path !== "Identiteit" && path !== "Geboortedatum" ? `${path}: ` : "";
  return `${prefix}${t}`;
}

function isQuestion(text: string) {
  return /\?$|^(who|what|when|where|why|how|wie|waar|wanneer|waarom|welke|can you|could you|would you|wil je|kan je|kun je|wat is|hoe|leg uit)\b/i.test(
    text,
  );
}

function isTaskRequest(text: string) {
  return /^(write|make|create|explain|help|translate|fix|debug|code|schrijf|maak|leg uit|help me|generate)\b/i.test(text);
}

function isSaveOnlyCommand(text: string) {
  return /^(?:please\s+)?(?:can you |could you |would you )?(?:please\s+)?(?:remember|save|store|onthoudt?|note|sla op)(?:\s+(?:that|dat|this|dit|it))?(?:\s+in(?:to)?\s+(?:memory|het geheugen|memorie))?\s*$/i.test(
    text,
  );
}

function isPlaceholder(text: string) {
  return /^(this|that|it|dit|dat|this in memory|that in memory|in memory|this information|deze informatie)$/i.test(text);
}

function isFirstPerson(text: string) {
  return /\b(i(?:['’]m| am| have| had| own| use| work| live| was| like| prefer| want| need)|my|mine|ik|mijn|wij|onze)\b/i.test(
    text,
  );
}

function isPreference(text: string) {
  return /\b(voorkeur|prefer|preference|communicatie|informeel|formeel|always use|never use|don't use|nooit de|altijd een|aanspreekvorm|tutoy)\b/i.test(
    text,
  ) || (/\b(de gebruiker|the user)\b/i.test(text) && text.length > 40);
}

function profileFieldDrafts(text: string): MemoryDraft[] {
  if (!/(?:^|,)\s*[\p{L}][\p{L}0-9 /_-]{1,40}\s*:/u.test(text)) return [];
  const pairs = [...text.matchAll(/(?:^|,)\s*([\p{L}][\p{L}0-9 /_-]{1,40})\s*:\s*([^,]+)/gu)];
  if (!pairs.length) return [];
  const covered = pairs.reduce((sum, item) => sum + item[0].length, 0);
  if (covered < text.length * 0.6) return [];
  const fields: Record<string, string> = {};
  for (const item of pairs) {
    const key = clean(item[1]);
    const value = clean(item[2]);
    if (!key || !value) continue;
    const label = canonicalIdentityField(key);
    if (!label) continue;
    if (label === "Geboortedatum" && !isDateValue(value)) continue;
    if (label === "Leeftijd" && !/^\d{1,3}$/.test(value)) continue;
    fields[label] = value;
  }
  if (!Object.keys(fields).length) return [];
  return [
    withPath({
      content: formatIdentityMemory(fields),
      category: "identity",
      path: "Identiteit",
      memoryType: "user",
    }),
  ];
}

const STOP_TOKENS = new Set(
  "the user a an and or to of in on with for from has have is was ik heb een het de een met van voor dat die dit this that very erg blij mee okay oke ja nee gebruiker users heeft woont woon lives live living wilt will also alsoo persoonlijke informatie information memory geheugen automatisch automatically toekomst toekomstige gesprekken nieuwe stabiele relevante".split(
    " ",
  ),
);

export function distinctiveTokens(text: string) {
  return (clean(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((item) => !STOP_TOKENS.has(item));
}

export function memoryFactKey(text: string) {
  const t = clean(text).toLowerCase();
  if (Object.keys(parseIdentityFields(t)).length) return "identity";
  if (/\b(name is|heet|age is|jaar oud|leeftijd|birthday|geboren|geboortedatum|geslacht|gender)\b/.test(t)) {
    return "identity";
  }
  if (/\b(communicatie|aanspreekvorm|informeel|formeel|tutoy)\b/.test(t)) return "style";
  if (/\b(woont|woon|lives in|live in|living in)\b/.test(t)) return "location";
  if (/\b(company is|bedrijf|studio|agency)\b/.test(t)) return "company";
  if (/\b(job is|werkt als|works as)\b/.test(t)) return "job";
  return "";
}

const GENERIC_HARDWARE = new Set(
  "ram gb ddr ddr4 ddr5 intel amd mini minipc homelab hardware cpu gpu core processor videokaart gebruiker user pcs laptop server proxmox docker".split(
    " ",
  ),
);

function deviceTokens(text: string) {
  return distinctiveTokens(text).filter((item) => !GENERIC_HARDWARE.has(item) && (/\d/.test(item) || item.length >= 6));
}

function looksLikeHardware(text: string) {
  return /\b(pc|mini-?pc|ram|gpu|videokaart|hardware|intel|ryzen|proxmox|homelab|server)\b/i.test(text);
}

export function memoriesOverlap(left: string, right: string) {
  const leftKey = memoryFactKey(left);
  const rightKey = memoryFactKey(right);
  if (leftKey && rightKey) return leftKey === rightKey;
  if (looksLikeHardware(left) || looksLikeHardware(right)) {
    const leftDev = deviceTokens(left);
    const rightDev = new Set(deviceTokens(right));
    return leftDev.some((item) => rightDev.has(item));
  }
  const leftTok = distinctiveTokens(left);
  const rightTok = distinctiveTokens(right);
  if (!leftTok.length || !rightTok.length) return false;
  const other = new Set(rightTok);
  const shared = leftTok.filter((item) => other.has(item));
  const strong = shared.filter((item) => /\d/.test(item) || item.length >= 6);
  if (!strong.length) return false;
  const shorter = Math.min(leftTok.length, rightTok.length);
  return strong.length >= 2 || shared.length / shorter >= 0.6;
}

export function splitDeviceFacts(content: string) {
  const value = String(content || "").trim();
  if (!value) return [];
  const parts = value
    .split(/\s*,\s*(?:een\s+|a\s+|an\s+)?|\s+en een\s+|\s+and a\s+/i)
    .map((item) => item.replace(/^(?:een|a|an)\s+/i, "").trim())
    .filter(Boolean);
  const devices = parts.filter((item) => /\b(pc|ram|gb|intel|ryzen|gpu|gateway|proxmox|minipc|mini-pc)\b/i.test(item));
  if (devices.length >= 2) return devices;
  return [value];
}

export function selectMemoriesForPrompt<T extends { content: string; path?: string | null }>(items: T[], question: string) {
  if (!items.length) return items;
  const q = clean(question);
  const qTok = new Set(distinctiveTokens(q));
  const identityQ = /\b(wie ben ik|who am i|who im i|naam|how old|hoe oud|leeftijd|birthday)\b/i.test(q);
  const hardwareQ = /\b(pc|pcs|mini-?pc|ram|spec|homelab|hardware|gpu|videokaart|server|proxmox|host)\b/i.test(q);
  const scored = items
    .map((item) => {
      const blob = `${item.path || ""} ${item.content}`;
      let score = distinctiveTokens(blob).filter((token) => qTok.has(token)).length;
      if (identityQ && (/identiteit/i.test(item.path || "") || memoryFactKey(item.content) === "identity")) score += 6;
      if (hardwareQ && (/hardware/i.test(item.path || "") || looksLikeHardware(blob))) score += 6;
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((row) => row.item);
  if (scored.length) return scored;
  if (hardwareQ) return items.filter((item) => looksLikeHardware(`${item.path || ""} ${item.content}`)).slice(0, 16);
  if (identityQ) {
    return items
      .filter((item) => memoryFactKey(item.content) === "identity" || /identiteit/i.test(item.path || ""))
      .slice(0, 8);
  }
  return items.slice(0, 12);
}

function capSentence(text: string) {
  const value = clean(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isDutch(text: string) {
  return /\b(ik|mijn|een|het|de|van|voor|niet|geen|videokaart|gebruiker)\b/i.test(text);
}

export function summarizeMemoryFact(text: string) {
  let t = stripFalseBirthdayLabel(text)
    .replace(/^(?:k|ik)\s+/i, "ik ")
    .replace(/\s+en ik ben er erg blij mee\.?$/i, "")
    .replace(/\s+and i(?:['’]m| am) (?:very )?(?:happy|glad)(?: with it)?\.?$/i, "");
  const identity = parseIdentityFields(t);
  if (Object.keys(identity).length) return formatIdentityMemory(identity);
  t = t.replace(/\bhet gebruiker\b/gi, "de gebruiker").replace(/\bde gebruiker woon\b/gi, "de gebruiker woont");
  if (/^(the user|de gebruiker)\b/i.test(t)) return capSentence(t);
  const dutch = isDutch(t);
  t = t
    .replace(/\bik heb\b/gi, dutch ? "de gebruiker heeft" : "the user has")
    .replace(/\bi have\b/gi, dutch ? "de gebruiker heeft" : "the user has")
    .replace(/\bik ben\b/gi, dutch ? "de gebruiker is" : "the user is")
    .replace(/\bi(?:['’]m| am)\b/gi, dutch ? "de gebruiker is" : "the user is")
    .replace(/\bik werk(?:\s+als)?\b/gi, dutch ? "de gebruiker werkt als" : "the user works as")
    .replace(/\bi work(?:\s+as)?\b/gi, dutch ? "de gebruiker werkt als" : "the user works as")
    .replace(/\bik woon\b/gi, dutch ? "de gebruiker woont" : "the user lives")
    .replace(/\bi live\b/gi, dutch ? "de gebruiker woont" : "the user lives")
    .replace(/\bmijn\b/gi, dutch ? "de gebruiker zijn" : "the user's")
    .replace(/\bmy\b/gi, dutch ? "de gebruiker zijn" : "the user's")
    .replace(/\bik\b/gi, dutch ? "de gebruiker" : "the user");
  if (!/^(the user|de gebruiker)\b/i.test(t)) {
    t = dutch ? `De gebruiker: ${t}` : `The user: ${t}`;
  }
  return capSentence(t);
}

export function pickMemorySummary(previous: string, incoming: string) {
  const prevFields = parseIdentityFields(previous);
  const nextFields = parseIdentityFields(incoming);
  if (Object.keys(prevFields).length && Object.keys(nextFields).length) {
    return formatIdentityMemory({ ...prevFields, ...nextFields });
  }
  const next = summarizeMemoryFact(incoming);
  const old = summarizeMemoryFact(previous);
  if (next.toLowerCase() === old.toLowerCase()) return old;
  const oldTokens = new Set(distinctiveTokens(old));
  const extra = distinctiveTokens(next).filter((item) => !oldTokens.has(item));
  return extra.length ? next : old;
}

export function categorizeMemory(text: string) {
  const t = text.toLowerCase();
  if (isPreference(t)) return "preference";
  if (/\b(work|job|project|bedrijf|company|studio|agency)\b/.test(t)) return "work";
  if (/\b(name|naam|age|jaar oud|birthday|geboren|born|woon|live|geslacht|gender|leeftijd)\b/.test(t)) return "identity";
  return "other";
}

export function fallbackMemoryDrafts(message: string, previousUser?: string): MemoryDraft[] {
  const current = clean(message);
  const source = isSaveOnlyCommand(current) || isPlaceholder(current) ? clean(previousUser || "") : current;
  if (!source || isSaveOnlyCommand(source) || isPlaceholder(source) || isChatFiller(source)) return [];
  const fromFields = profileFieldDrafts(source);
  if (fromFields.length) return fromFields.map((item) => withPath({ ...item, memoryType: "user" }));
  const parts = source
    .split(/\n{2,}/)
    .map((item) => clean(item))
    .filter(Boolean);
  const drafts: MemoryDraft[] = [];
  for (const part of parts.length ? parts : [source]) {
    if (!isDurableMemory(part)) continue;
    drafts.push(
      withPath({
        content: summarizeMemoryFact(part),
        category: categorizeMemory(part),
      }),
    );
  }
  return drafts.slice(0, 4);
}
