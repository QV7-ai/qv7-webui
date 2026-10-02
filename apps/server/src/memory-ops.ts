const CATEGORIES = new Set(["identity", "preference", "hardware", "software", "work", "project", "location", "other"]);

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

const PATH_NAMES: Record<string, string> = {
  identiteit: "Identity",
  identity: "Identity",
  locatie: "Location",
  location: "Location",
  werk: "Work",
  work: "Work",
  voorkeuren: "Interests",
  preferences: "Interests",
  voorkeur: "Interests",
  interests: "Interests",
  interest: "Interests",
  hobby: "Interests",
  hobbies: "Interests",
  communicatiestijl: "Communication",
  communication: "Communication",
  hardware: "Hardware",
  software: "Software",
  project: "Projects",
  projects: "Projects",
  other: "Other",
  birthday: "Birthday",
  geboortedatum: "Birthday",
};

export function englishMemoryPath(raw: string) {
  const path = normalizeMemoryPath(raw);
  return PATH_NAMES[path.toLowerCase()] || path;
}

export function inferMemoryPath(text: string, category = "") {
  const t = `${text} ${category}`.toLowerCase();
  if (/\b(communicatie|aanspreekvorm|aanspreek|informeel|formeel|tutoy|communication)\b/.test(t)) return "Communication";
  if (/\b(geslacht|leeftijd|geboortedatum|geboorte|gender|birthday|age|naam)\b/.test(t) || category === "identity") {
    return "Identity";
  }
  if (isInterestStatement(text)) return "Interests";
  if (/\b(pc|mini-?pc|gpu|videokaart|hardware|proxmox|homelab|ram|server)\b/.test(t) || category === "hardware") return "Hardware";
  if (/\b(woont|woon|lives in|live in|living in)\b/.test(t) || category === "location") return "Location";
  if (/\b(project|projects)\b/.test(t) || category === "project") return "Projects";
  if (/\b(software|work with)\b/.test(t) || /^(?:i|ik)\s+(?:use|gebruik)\b/.test(text) || category === "software") return "Software";
  if (/\b(job|profession|bedrijf|company|studio|agency|werk|work)\b/.test(t) || category === "work") return "Work";
  if (isPreference(text) || category === "preference") return "Interests";
  return "";
}

export function inferMemoryType(text: string, category = ""): MemoryType {
  if (isPreference(text) || category === "preference") return "preference";
  if (category === "identity" || category === "work") return "user";
  if (isFirstPerson(text) || /:\s*\S/.test(text)) return "user";
  return "context";
}

function withPath(draft: MemoryDraft): MemoryDraft {
  const path = englishMemoryPath(draft.path || inferMemoryPath(draft.content, draft.category));
  return {
    ...draft,
    path,
    memoryType: draft.memoryType ? normalizeMemoryType(draft.memoryType) : inferMemoryType(draft.content, draft.category),
  };
}

const IDENTITY_LABELS: Record<string, string> = {
  geslacht: "Gender",
  gender: "Gender",
  leeftijd: "Age",
  age: "Age",
  geboortedatum: "Birthday",
  birthday: "Birthday",
  geboren: "Birthday",
  born: "Birthday",
  naam: "Name",
  name: "Name",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_INDEX: Record<string, number> = {
  januari: 0,
  februari: 1,
  maart: 2,
  mrt: 2,
  mei: 4,
  juni: 5,
  juli: 6,
  augustus: 7,
  oktober: 9,
  okt: 9,
};
for (const [index, name] of MONTH_NAMES.entries()) {
  MONTH_INDEX[name.toLowerCase()] = index;
  MONTH_INDEX[name.slice(0, 3).toLowerCase()] = index;
}

const MONTH_PATTERN = Object.keys(MONTH_INDEX)
  .sort((a, b) => b.length - a.length)
  .join("|");

function dateWords(month: number, day: number, year?: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const label = `${MONTH_NAMES[month - 1]} ${day}`;
  if (year == null) return label;
  if (year < 1900 || year > 2100) return "";
  return `${label}, ${year}`;
}

export function formatEnglishDate(value: string) {
  const v = clean(value).replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let match = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return dateWords(Number(match[2]), Number(match[3]), Number(match[1]));
  match = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return dateWords(Number(match[2]), Number(match[1]), year);
  }
  match = v.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_PATTERN})\\.?\\s+(\\d{4})$`, "i"));
  if (match) return dateWords(MONTH_INDEX[match[2].toLowerCase()] + 1, Number(match[1]), Number(match[3]));
  match = v.match(new RegExp(`^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:,)?\\s+(\\d{4})$`, "i"));
  if (match) return dateWords(MONTH_INDEX[match[1].toLowerCase()] + 1, Number(match[2]), Number(match[3]));
  match = v.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_PATTERN})\\.?$`, "i"));
  if (match) return dateWords(MONTH_INDEX[match[2].toLowerCase()] + 1, Number(match[1]));
  match = v.match(new RegExp(`^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})$`, "i"));
  if (match) return dateWords(MONTH_INDEX[match[1].toLowerCase()] + 1, Number(match[2]));
  return "";
}

export function extractEnglishDate(text: string) {
  const source = clean(text);
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
    new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_PATTERN})\\.?\\s+\\d{4}\\b`, "i"),
    new RegExp(`\\b(?:${MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}\\b`, "i"),
    new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_PATTERN})\\.?\\b`, "i"),
    new RegExp(`\\b(?:${MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const formatted = match ? formatEnglishDate(match[0]) : "";
    if (formatted) return formatted;
  }
  return "";
}

function englishGender(value: string) {
  const v = clean(value).toLowerCase();
  if (v === "man" || v === "male" || v === "mannelijk") return "Male";
  if (v === "vrouw" || v === "female" || v === "vrouwelijk") return "Female";
  if (/^non[ -]?binary$/.test(v)) return "Non-binary";
  return clean(value);
}

const NAME_STOP = new Set(
  "is the user users dog cat pet called named has have their his her a an my and of was born glad happy here going fine good ok okay not very old".split(
    " ",
  ),
);

function personName(value: string) {
  const name = clean(value).replace(/[.,]$/, "");
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 3) return "";
  if (parts.some((part) => NAME_STOP.has(part.toLowerCase().replace(/'/g, "")) || !/^[\p{L}][\p{L}'-]{0,40}$/u.test(part))) {
    return "";
  }
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function englishName(value: string) {
  return personName(value);
}

function storeIdentityValue(label: string, value: string) {
  if (label === "Birthday") {
    const date = formatEnglishDate(value);
    return date || "";
  }
  if (label === "Age") return /^\d{1,3}$/.test(value) ? value : "";
  if (label === "Gender") return englishGender(value);
  if (label === "Name") return englishName(value);
  return clean(value);
}

export function canonicalIdentityField(raw: string) {
  return IDENTITY_LABELS[String(raw || "").trim().toLowerCase()] || "";
}

export function isDateValue(value: string) {
  const v = clean(value);
  if (!v || v.length > 40) return false;
  if (/\b(gebruiker|user|heeft|videokaart|gpu|ram|pc|woont|werkt|likes|houdt)\b/i.test(v)) return false;
  return Boolean(formatEnglishDate(v));
}

export function stripFalseBirthdayLabel(text: string) {
  const value = clean(text);
  const labeled = value.match(/^(?:geboortedatum|birthday|date of birth|geboren(?:\s+op)?|born(?:\s+on)?)\s*:\s*(.+)$/i);
  if (!labeled) return value;
  const rest = clean(labeled[1]);
  const date = formatEnglishDate(rest);
  if (date) return `Birthday: ${date}`;
  return rest;
}

export function formatIdentityMemory(fields: Record<string, string>) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const label = canonicalIdentityField(key) || key;
    const stored = storeIdentityValue(label, value);
    if (stored) next[label] = stored;
  }
  const order = ["Name", "Gender", "Age", "Birthday"];
  const keys = [...order.filter((key) => next[key]), ...Object.keys(next).filter((key) => !order.includes(key))];
  return keys.map((key) => `${key}: ${next[key]}`).join(", ");
}

export function parseIdentityFields(text: string) {
  const fields: Record<string, string> = {};
  const t = clean(text);
  const setField = (label: string, value: string) => {
    const stored = storeIdentityValue(label, value);
    if (stored) fields[label] = stored;
  };
  for (const match of t.matchAll(/(?:^|[,;]|\n)\s*([\p{L}][\p{L}0-9 /_-]{1,40})\s*:\s*([^,\n;]+)/gu)) {
    const label = canonicalIdentityField(match[1]);
    const value = clean(match[2]).replace(/^(the user|de gebruiker)\s*:?\s*/i, "");
    if (label && value) setField(label, value);
  }
  for (const match of t.matchAll(/\bthe user's (\S+) is ([^.]+)/gi)) {
    const label = canonicalIdentityField(match[1]);
    const value = clean(match[2]);
    if (label && value) setField(label, value);
  }
  const named = t.match(
    /\b(?:my name(?:\s+is)?|i(?:['’]m| am) called|ik heet|mijn naam(?:\s+is)?|naam is)\s+([\p{L}][\p{L}'-]{1,40})/iu,
  );
  if (named?.[1]) setField("Name", named[1]);
  const yearsOld = t.match(/\b(\d{1,3})\s*(?:jaar(?:\s+oud)?|years?\s+old)\b/i);
  const ageIs = t.match(/\b(?:age|leeftijd)(?:\s+is)?\s+(\d{1,3})\b/i);
  const age = yearsOld?.[1] || ageIs?.[1];
  if (age && Number(age) >= 5 && Number(age) <= 120) setField("Age", age);
  if (/\b(geboren|geboortedatum|birthday|date of birth|born)\b/i.test(t)) {
    const date = extractEnglishDate(t);
    if (date) setField("Birthday", date);
  }
  const bare = t.match(/^(?:the user|de gebruiker)\s*:\s*(.+)$/i);
  if (bare?.[1] && !Object.keys(fields).length) {
    const value = clean(bare[1]);
    if (/^\d{1,3}$/.test(value)) setField("Age", value);
    else if (/^(man|vrouw|male|female|mannelijk|vrouwelijk|non-binary|non binary)$/i.test(value)) setField("Gender", value);
    else if (isDateValue(value)) setField("Birthday", value);
    else setField("Name", value);
  }
  return fields;
}

function normalizeCategory(raw: string) {
  const value = raw.trim().toLowerCase();
  if (value === "interests" || value === "interest") return "preference";
  if (value === "projects") return "project";
  if (value === "locations") return "location";
  return CATEGORIES.has(value) ? value : "other";
}

function asOp(row: Record<string, unknown>): MemoryOp | null {
  let content = stripFalseBirthdayLabel(String(row.content ?? row.fact ?? row.memory ?? row.text ?? ""));
  const action = asAction(String(row.action || (content || row.path ? "add" : "")));
  if (!action) return null;
  const category = normalizeCategory(String(row.category || "other"));
  let path = normalizeMemoryPath(String(row.path || ""));
  const ident = canonicalIdentityField(path);
  if (ident && content) {
    const value = content.replace(/^(the user|de gebruiker)\s*:?\s*/i, "").trim();
    const shortValue =
      ident === "Birthday"
        ? isDateValue(value)
        : ident === "Age"
          ? /^\d{1,3}$/.test(value)
          : value.length > 0 && value.length <= 40 && !/\b(heeft|woont|werkt|videokaart|gpu)\b/i.test(value);
    if (shortValue) {
      path = "Identity";
      const parsed = parseIdentityFields(`${ident}: ${value}`);
      content = Object.keys(parsed).length ? formatIdentityMemory(parsed) : `${ident}: ${value}`;
    } else {
      path = inferMemoryPath(content, category) || "";
    }
  } else if (content && Object.keys(parseIdentityFields(content)).length) {
    path = englishMemoryPath(path) || "Identity";
    content = formatIdentityMemory(parseIdentityFields(content));
  }
  return {
    action,
    id: row.id ? String(row.id) : undefined,
    content: content || undefined,
    category: CATEGORIES.has(category) ? category : ident ? "identity" : "other",
    path: englishMemoryPath(path || inferMemoryPath(content, category)) || undefined,
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
  if (/^the user (?:really |mostly |usually |often |always )?(?:likes|loves|enjoys|prefers|uses|owns|has|works|is into)\b/i.test(t)) {
    return true;
  }
  if (/^the user (?:mostly|usually|often|always) \p{L}/iu.test(t)) return true;
  if (personalSummary(t)) return true;
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

function normalizeSpeaker(text: string) {
  return clean(text)
    .replace(/[.!?]+$/, "")
    .replace(/\bi['’]m\b/gi, "i am")
    .replace(/\bim\b/gi, "i am");
}

function tidyList(value: string) {
  const parts = value
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s+en\s+/gi, ", ")
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return value.trim();
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const OWN_VERBS: Record<string, string> = {
  like: "likes",
  love: "loves",
  enjoy: "enjoys",
  prefer: "prefers",
  use: "uses",
  own: "owns",
  have: "has",
  "work with": "works with",
  "work as": "works as",
  "work at": "works at",
  "am into": "is into",
  "houd van": "likes",
  gebruik: "uses",
};

function titleCaseName(raw: string) {
  return clean(raw)
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function petKind(word: string) {
  const value = word.toLowerCase();
  if (value === "hond") return "dog";
  if (value === "kat") return "cat";
  if (value === "huisdier") return "pet";
  return value;
}

function petFact(text: string) {
  const t = normalizeSpeaker(text);
  const loved = t.match(
    /^(?:i|ik)\s+(?:really\s+)?(?:love|like|adore|houd van)\s+(?:my|mijn)\s+(dog|cat|pet|hond|kat|huisdier)(?:\s+(?:called|named|genaamd|heet)\s+([\p{L}][\p{L}'-]{1,40}))?$/iu,
  );
  if (loved) {
    const kind = petKind(loved[1]);
    return loved[2] ? `The user loves their ${kind}, ${titleCaseName(loved[2])}.` : `The user loves their ${kind}.`;
  }
  const owned = t.match(
    /^(?:i|ik)\s+(?:have|own|heb)\s+(?:a|an|een|my|mijn)\s+(dog|cat|pet|hond|kat|huisdier)(?:\s+(?:called|named|genaamd|heet)\s+([\p{L}][\p{L}'-]{1,40}))?$/iu,
  );
  if (owned) {
    const kind = petKind(owned[1]);
    return owned[2] ? `The user's ${kind} is called ${titleCaseName(owned[2])}.` : `The user has a ${kind}.`;
  }
  const named = t.match(
    /^(?:my|mijn)\s+(dog|cat|pet|hond|kat|huisdier)\s+(?:is\s+)?(?:called|named|genaamd|heet)\s+([\p{L}][\p{L}'-]{1,40})$/iu,
  );
  if (!named) return "";
  return `The user's ${petKind(named[1])} is called ${titleCaseName(named[2])}.`;
}

function petSentence(text: string) {
  const direct = petFact(text) || polishStoredPet(text);
  if (direct) return direct;
  const t = clean(text);
  const inverted = t.match(/\b([\p{L}][\p{L}'-]{1,40})\s+is\s+(?:the\s+)?user'?s\s+(dog|cat|pet)\b/iu);
  if (inverted && personName(inverted[1])) {
    return `The user's ${inverted[2].toLowerCase()} is called ${titleCaseName(inverted[1])}.`;
  }
  const called = t.match(
    /\b(dog|cat|pet|hond|kat|huisdier)(?:'s)?\s+(?:is\s+)?(?:called|named|genaamd|heet)\s+([\p{L}][\p{L}'-]{1,40})\b/iu,
  );
  if (called && personName(called[2])) {
    return `The user's ${petKind(called[1])} is called ${titleCaseName(called[2])}.`;
  }
  return "";
}

export function presentMemoryContent(text: string) {
  const value = stripFalseBirthdayLabel(clean(text));
  if (!value) return "";
  const pet = petSentence(value);
  const labeledName = value.match(/(?:^|[,;]|\n)\s*name\s*:\s*([^,\n;]+)/i);
  const nameOk = !labeledName || Boolean(personName(labeledName[1]));
  if (nameOk && !pet) return value;
  const fields = parseIdentityFields(value);
  if (Object.keys(fields).length) {
    const formatted = formatIdentityMemory(fields);
    if (pet && !/\b(dog|cat|pet)\b/i.test(formatted)) return `${formatted}. ${pet}`;
    return formatted || pet || value;
  }
  return pet || value;
}

function polishStoredPet(text: string) {
  const t = clean(text).replace(/\.$/, "");
  const loved = t.match(
    /^the user loves (?:their|his|her) (dog|cat|pet)(?:,)?(?:\s+(?:called|named))?\s+([\p{L}][\p{L}'-]{1,40})$/iu,
  );
  if (loved) return `The user loves their ${loved[1].toLowerCase()}, ${titleCaseName(loved[2])}.`;
  return "";
}

function unwrapMemoryRequest(text: string) {
  const value = clean(text);
  const match = value.match(
    /^(?:please\s+)?(?:can you |could you |would you )?(?:please\s+)?(?:add(?:\s+this)?\s+to\s+memory|remember|save(?:\s+this)?(?:\s+in(?:to)?\s+memory)?|store(?:\s+this)?(?:\s+in\s+memory)?|onthoud(?:\s+dit)?|note|sla op)(?:\s+that|\s+dat)?\s+(.+)$/i,
  );
  const inner = clean(match?.[1] || "");
  if (!inner || isPlaceholder(inner) || isSaveOnlyCommand(inner)) return value;
  return inner;
}

export function rejectedMemoryClaim(content: string, userText: string) {
  const claim = clean(content).toLowerCase();
  const user = clean(userText).toLowerCase();
  if (/\bhobb(?:y|ies)\b|\binterests?\b/.test(claim) && !/\bhobb(?:y|ies)\b|\binterests?\b/.test(user)) return true;
  return false;
}

function personalSummary(text: string) {
  const t = normalizeSpeaker(text);
  if (!t || isQuestion(t) || isTaskRequest(t)) return "";
  const pet = petFact(t);
  if (pet) return pet;
  const mine = t.match(/^(?:my|mijn)\s+([\p{L}][\p{L}\s'-]{0,40}?)\s+(are|is|zijn)\s+(.{2,200})$/iu);
  if (mine && !/^(name|naam|age|leeftijd|birthday|job|profession|day|message|this|that)$/i.test(mine[1].trim())) {
    const subject = mine[1].trim();
    const value = tidyList(mine[3].replace(/\bmy\b/gi, "their"));
    return /^(are|zijn)$/i.test(mine[2])
      ? `The user's ${subject} include ${value}.`
      : `The user's ${subject} is ${value}.`;
  }
  const act = t.match(
    /^(?:i|ik)\s+(?:(really|mostly|usually|often|always)\s+)?(work with|work as|work at|am into|houd van|gebruik|like|love|enjoy|prefer|use|own|have)\s+(.{2,200})$/i,
  );
  if (act && !/^(this|that|it|a question|een vraag)\b/i.test(act[3])) {
    const adverb = act[1] ? `${act[1].toLowerCase()} ` : "";
    const verb = OWN_VERBS[act[2].toLowerCase()] || act[2].toLowerCase();
    return `The user ${adverb}${verb} ${tidyList(act[3].replace(/\bmy\b/gi, "their"))}.`;
  }
  const habit = t.match(/^(?:i|ik)\s+(mostly|usually|often|always)\s+([a-z]{3,20})\s+(.{2,160})$/i);
  if (habit) {
    const verb = habit[2].toLowerCase();
    const conjugated = verb.endsWith("s") ? verb : `${verb}s`;
    return `The user ${habit[1].toLowerCase()} ${conjugated} ${habit[3].replace(/\bmy\b/gi, "their")}.`;
  }
  return "";
}

function isInterestStatement(text: string) {
  const t = normalizeSpeaker(text);
  if (petFact(t)) return false;
  if (/^(?:i|ik)\s+(?:really\s+|mostly\s+|usually\s+|often\s+|always\s+)?(?:like|love|enjoy|prefer|am into)\b/i.test(t)) {
    return true;
  }
  const mine = t.match(/^(?:my|mijn)\s+([\p{L}][\p{L}\s'-]{0,40}?)\s+(?:are|is|zijn)\b/iu);
  if (!mine) return false;
  return !/^(name|naam|age|leeftijd|birthday|job|profession|company|bedrijf)$/i.test(mine[1].trim());
}

export function shouldReviewMemory(text: string) {
  const t = clean(text);
  if (t.length < 8 || isChatFiller(t)) return false;
  return isDurableMemory(t) || Boolean(personalSummary(t)) || isFirstPerson(t);
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
    .replace(/\bIk heet\b/gi, "The user's name is")
    .replace(/\bDe gebruiker heet\b/gi, "The user's name is")
    .replace(/\bIk ben\b/gi, "The user is")
    .replace(/\bDe gebruiker is\b/gi, "The user is")
    .replace(/\bIk heb\b/gi, "The user has")
    .replace(/\bDe gebruiker heeft\b/gi, "The user has")
    .replace(/\bIk woon\b/gi, "The user lives")
    .replace(/\bDe gebruiker woont\b/gi, "The user lives")
    .replace(/\bIk werk\b/gi, "The user works")
    .replace(/\bDe gebruiker werkt\b/gi, "The user works")
    .replace(/\bIk beheer\b/gi, "The user manages")
    .replace(/\bI am\b/gi, "The user is")
    .replace(/\bI'm\b/gi, "The user is")
    .replace(/\bI have\b/gi, "The user has")
    .replace(/\bI live\b/gi, "The user lives")
    .replace(/\bI work\b/gi, "The user works")
    .replace(/\bI own\b/gi, "The user owns")
    .replace(/\bmijn\b/gi, "the user's")
    .replace(/\bmy\b/gi, "the user's");
  const shownPath = englishMemoryPath(path || "");
  const prefix = shownPath && shownPath !== "Identity" && shownPath !== "Birthday" ? `${shownPath}: ` : "";
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
    const stored = storeIdentityValue(label, value);
    if (!stored) continue;
    fields[label] = stored;
  }
  if (!Object.keys(fields).length) return [];
  return [
    withPath({
      content: formatIdentityMemory(fields),
      category: "identity",
      path: "Identity",
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
  if (/\b(dog|cat|pet|hond|kat|huisdier)\b/.test(t) && /\b(called|named|genaamd|loves their)\b/.test(t)) return "pet";
  if (/\b(name is|heet|age is|jaar oud|leeftijd|birthday|geboren|geboortedatum|geslacht|gender)\b/.test(t)) {
    return "identity";
  }
  if (isInterestStatement(text) || /\b(hobby|hobbies|interest|interests|likes|enjoys)\b/.test(t)) return "interests";
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
      if (identityQ && (/identit/i.test(item.path || "") || memoryFactKey(item.content) === "identity")) score += 6;
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
      .filter((item) => memoryFactKey(item.content) === "identity" || /identit/i.test(item.path || ""))
      .slice(0, 8);
  }
  return items.slice(0, 12);
}

function capSentence(text: string) {
  const value = clean(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function summarizeMemoryFact(text: string) {
  let t = stripFalseBirthdayLabel(text)
    .replace(/^(?:k|ik)\s+/i, "ik ")
    .replace(/\s+en ik ben er erg blij mee\.?$/i, "")
    .replace(/\s+and i(?:['’]m| am) (?:very )?(?:happy|glad)(?: with it)?\.?$/i, "");
  const identity = parseIdentityFields(t);
  if (Object.keys(identity).length) {
    const formatted = formatIdentityMemory(identity);
    const pet = petSentence(t);
    if (pet && !/\b(dog|cat|pet)\b/i.test(formatted)) return `${formatted}. ${pet}`;
    return formatted;
  }
  const personal = personalSummary(t);
  if (personal) return personal;
  const polished = polishStoredPet(t);
  if (polished) return polished;
  t = t
    .replace(/\bde gebruiker heeft\b/gi, "the user has")
    .replace(/\bde gebruiker is\b/gi, "the user is")
    .replace(/\bde gebruiker woont\b/gi, "the user lives")
    .replace(/\bde gebruiker werkt(?:\s+als)?\b/gi, "the user works")
    .replace(/\bde gebruiker heet\b/gi, "the user's name is")
    .replace(/\bhet gebruiker\b/gi, "the user")
    .replace(/\bik heb\b/gi, "the user has")
    .replace(/\bi have\b/gi, "the user has")
    .replace(/\bik ben\b/gi, "the user is")
    .replace(/\bi(?:['’]m| am)\b/gi, "the user is")
    .replace(/\bik werk(?:\s+als)?\b/gi, "the user works as")
    .replace(/\bi work(?:\s+as)?\b/gi, "the user works as")
    .replace(/\bik woon\b/gi, "the user lives")
    .replace(/\bi live\b/gi, "the user lives")
    .replace(/\bmijn\b/gi, "the user's")
    .replace(/\bmy\b/gi, "the user's")
    .replace(/\bik\b/gi, "the user");
  if (!/^the user\b/i.test(t)) t = `The user: ${t}`;
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
  if (/\b(name|naam|age|jaar oud|birthday|geboren|born|geslacht|gender|leeftijd)\b/.test(t)) return "identity";
  if (isInterestStatement(text) || isPreference(t)) return "preference";
  if (/\b(pc|mini-?pc|gpu|videokaart|hardware|proxmox|homelab|ram|server)\b/.test(t)) return "hardware";
  if (/\b(software|work with)\b/.test(t) || /^(?:i|ik)\s+(?:use|gebruik)\b/.test(text)) return "software";
  if (/\b(project|projects)\b/.test(t)) return "project";
  if (/\b(woont|woon|lives in|live in|living in)\b/.test(t)) return "location";
  if (/\b(work|job|bedrijf|company|studio|agency)\b/.test(t)) return "work";
  return "other";
}

export function fallbackMemoryDrafts(message: string, previousUser?: string): MemoryDraft[] {
  const current = unwrapMemoryRequest(clean(message));
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
    const category = categorizeMemory(part);
    drafts.push(
      withPath({
        content: summarizeMemoryFact(part),
        category,
        memoryType: isInterestStatement(part) ? "user" : undefined,
      }),
    );
  }
  return drafts.slice(0, 4);
}
