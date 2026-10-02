export type Role = "user" | "assistant" | "system";
export type UserRole = "admin" | "user" | "pending";
export type MessageStatus = "complete" | "interrupted" | "error" | "streaming";
export type ModelFamily = "llama" | "phi" | "mistral" | "qwen" | "gemma" | "other";
export type ThemePreference = "dark" | "light" | "system";
export type CapabilityFlag = true | false | "unknown";

export type ThinkingMode =
  | { enabled: false }
  | { enabled: true; level?: string };

export type ModelCapabilities = {
  thinking: boolean;
  thinkingLevels: string[];
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
};

export type ModelDefaults = {
  thinking?: boolean;
  thinkingLevel?: string;
  webSearch?: boolean;
  codeInterpreter?: boolean;
};

export type ChatModel = {
  id: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  family: ModelFamily;
  categoryId?: string;
  categoryName?: string;
  categoryIds?: string[];
  categoryNames?: string[];
  kind?: "installed" | "custom";
  capabilities: ModelCapabilities;
  defaults?: ModelDefaults;
  contextLength?: number;
  numCtx?: number;
};

export type ModelCategory = {
  id: string;
  name: string;
  sortOrder: number;
};

export type UserSkill = {
  id: string;
  name: string;
  content: string;
  defaultOn: boolean;
  createdAt: number;
  updatedAt: number;
};

export const FOLDER_ICONS = [
  "folder",
  "briefcase",
  "code",
  "book",
  "heart",
  "star",
  "home",
  "rocket",
  "bot",
  "sparkles",
  "graduation",
  "music",
  "camera",
  "globe",
  "shield",
  "zap",
  "coffee",
  "gamepad",
  "lightbulb",
  "leaf",
] as const;

export type FolderIconName = (typeof FOLDER_ICONS)[number];

export type ChatFolder = {
  id: string;
  name: string;
  icon: FolderIconName;
  iconColor: string;
  systemPrompt: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokensPerSecond: number;
  promptTokensPerSecond: number;
  durationMs: number;
  context?: { system: number; skills: number; tools: number; conversation: number };
};

export function usageFromOllama(stats?: Record<string, number> | null): UsageStats | undefined {
  if (!stats) return;
  const inputTokens = Math.max(0, Math.round(stats.promptEvalCount || 0));
  const outputTokens = Math.max(0, Math.round(stats.evalCount || 0));
  if (!inputTokens && !outputTokens) return;
  const evalSeconds = (stats.evalDuration || 0) / 1e9;
  const promptSeconds = (stats.promptEvalDuration || 0) / 1e9;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    tokensPerSecond: evalSeconds > 0 ? outputTokens / evalSeconds : 0,
    promptTokensPerSecond: promptSeconds > 0 ? inputTokens / promptSeconds : 0,
    durationMs: (stats.totalDuration || 0) / 1e6,
  };
}

export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
};

export type UsedMemory = { id: string; content: string };

export function parseUsedMemories(raw: unknown): UsedMemory[] {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { memories?: unknown }).memories)
      ? (value as { memories: unknown[] }).memories
      : [];
  const used: UsedMemory[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: unknown }).id || "").trim();
    const content = String((item as { content?: unknown }).content || "")
      .replace(/<\/?memory_context>/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    if (!id || !content || id.length > 80 || seen.has(id)) continue;
    seen.add(id);
    used.push({ id, content });
    if (used.length >= 24) break;
  }
  return used;
}

export type ChatActivity =
  | { kind: "search"; query: string; sources: WebSearchSource[] }
  | { kind: "note"; text: string }
  | { kind: "fetch"; url: string };

export type WebSearchConfig = {
  enabled: boolean;
  confirmation: boolean;
  engine: "searxng";
  searxngQueryUrl: string;
  searxngLanguage: string;
  resultCount: number;
  concurrentRequests: number;
  fetchContentLengthLimit: number | null;
  domainFilter: string;
  bypassEmbedding: boolean;
  bypassWebLoader: boolean;
  trustProxy: boolean;
  loaderEngine: "playwright" | "fetch";
  playwrightWsUrl: string;
  playwrightTimeoutMs: number;
  loaderConcurrentRequests: number;
  youtubeLanguage: string;
  youtubeProxyUrl: string;
};

export type AppGeneralConfig = {
  responseWatermark: string;
  webUiUrl: string;
  sharingEnabled: boolean;
  foldersEnabled: boolean;
  maxFolderCount: number;
  memoriesEnabled: boolean;
  toolWebSearch: boolean;
  toolCode: boolean;
  toolCanvas: boolean;
  toolWebpage: boolean;
  freeDayTokens: number;
  freeWeekTokens: number;
  proDayTokens: number;
  proWeekTokens: number;
};

export type AppFeatures = {
  sharingEnabled: boolean;
  foldersEnabled: boolean;
  maxFolderCount: number;
  memoriesEnabled: boolean;
  webUiUrl: string;
  toolPermissionsEnabled: boolean;
  imageGenerationEnabled: boolean;
  imageEditEnabled: boolean;
  toolWebSearch: boolean;
  toolCode: boolean;
  toolCanvas: boolean;
  toolWebpage: boolean;
};

export type ImageGenEngine = "imagerouter" | "openai" | "comfyui" | "automatic1111" | "gemini";
export type ImageEditEngine = "imagerouter" | "openai" | "comfyui" | "gemini";

export type ImageEndpointConfig = {
  engine: ImageGenEngine;
  model: string;
  size: string;
  steps: number;
  promptGeneration: boolean;
  apiBaseUrl: string;
  apiKey: string;
  apiVersion: string;
  apiAuth: string;
  extraParams: string;
};

export type ImagesConfig = {
  generationEnabled: boolean;
  editEnabled: boolean;
  create: ImageEndpointConfig;
  edit: ImageEndpointConfig;
};

export const DEFAULT_IMAGE_CREATE: ImageEndpointConfig = {
  engine: "imagerouter",
  model: "black-forest-labs/FLUX-2-klein-9b",
  size: "512x512",
  steps: 50,
  promptGeneration: false,
  apiBaseUrl: "https://api.imagerouter.io/v1/openai",
  apiKey: "",
  apiVersion: "",
  apiAuth: "",
  extraParams: "{}",
};

export const DEFAULT_IMAGE_EDIT: ImageEndpointConfig = {
  ...DEFAULT_IMAGE_CREATE,
  engine: "imagerouter",
};

export const DEFAULT_IMAGES: ImagesConfig = {
  generationEnabled: true,
  editEnabled: true,
  create: { ...DEFAULT_IMAGE_CREATE },
  edit: { ...DEFAULT_IMAGE_EDIT },
};

export const IMAGE_ENGINE_DEFAULTS: Record<ImageGenEngine, { apiBaseUrl: string; model: string }> = {
  imagerouter: { apiBaseUrl: "https://api.imagerouter.io/v1/openai", model: "black-forest-labs/FLUX-2-klein-9b" },
  openai: { apiBaseUrl: "https://api.openai.com/v1", model: "dall-e-3" },
  comfyui: { apiBaseUrl: "http://127.0.0.1:8188", model: "" },
  automatic1111: { apiBaseUrl: "http://127.0.0.1:7860", model: "" },
  gemini: { apiBaseUrl: "https://generativelanguage.googleapis.com", model: "imagen-4.0-generate-001" },
};

export const DEFAULT_APP_GENERAL: AppGeneralConfig = {
  responseWatermark: "",
  webUiUrl: "",
  sharingEnabled: true,
  foldersEnabled: true,
  maxFolderCount: 0,
  memoriesEnabled: true,
  toolWebSearch: true,
  toolCode: true,
  toolCanvas: true,
  toolWebpage: true,
  freeDayTokens: 3_000_000,
  freeWeekTokens: 10_000_000,
  proDayTokens: 10_000_000,
  proWeekTokens: 30_000_000,
};

export type UserPlan = "free" | "pro";

export function parseUserPlan(value: unknown, fallback: UserPlan = "free"): UserPlan {
  return value === "pro" || value === "free" ? value : fallback;
}

export const TASK_MODEL_CURRENT = "current";

export type InterfaceConfig = {
  localTaskModelId: string;
  externalTaskModelId: string;
  toolPermissionsEnabled: boolean;
  titleGenerationEnabled: boolean;
};

export const DEFAULT_INTERFACE: InterfaceConfig = {
  localTaskModelId: TASK_MODEL_CURRENT,
  externalTaskModelId: TASK_MODEL_CURRENT,
  toolPermissionsEnabled: false,
  titleGenerationEnabled: true,
};

export const THEME_COLOR_KEYS = ["bg", "sidebar", "elevated", "surface", "hover", "text", "secondary", "muted", "accent", "danger", "user"] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemePalette = Record<ThemeColorKey, string>;

export type BrandingTheme = {
  enabled: boolean;
  dark: ThemePalette;
  light: ThemePalette;
};

export const DEFAULT_THEME_DARK: ThemePalette = {
  bg: "#1A1A1F",
  sidebar: "#17171A",
  elevated: "#17171A",
  surface: "#27272A",
  hover: "#2A2A2E",
  text: "#F5F5F5",
  secondary: "#A1A1AA",
  muted: "#71717A",
  accent: "#FE4901",
  danger: "#EF6B5C",
  user: "#27272A",
};

export const DEFAULT_THEME_LIGHT: ThemePalette = {
  bg: "#F6F5F2",
  sidebar: "#EEEDE9",
  elevated: "#FFFFFF",
  surface: "#EEEDE9",
  hover: "#E6E4DE",
  text: "#161513",
  secondary: "#5C5A57",
  muted: "#8A8782",
  accent: "#FE4901",
  danger: "#EF6B5C",
  user: "#ECEAE4",
};

export function themeHex(value: unknown, fallback: string) {
  const match = String(value ?? "").trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

export function normalizeThemePalette(raw: unknown, fallback: ThemePalette): ThemePalette {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = { ...fallback };
  for (const key of THEME_COLOR_KEYS) next[key] = themeHex(input[key], fallback[key]);
  return next;
}

export function normalizeTheme(raw: unknown): BrandingTheme {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: input.enabled === true,
    dark: normalizeThemePalette(input.dark, DEFAULT_THEME_DARK),
    light: normalizeThemePalette(input.light, DEFAULT_THEME_LIGHT),
  };
}

export type BrandingConfig = {
  name: string;
  description: string;
  accent: string;
  footer: string;
  logoPath: string;
  faviconPath: string;
  splashPath: string;
  theme: BrandingTheme;
};

export type PublicBranding = {
  name: string;
  description: string;
  accent: string;
  footer: string;
  logoUrl: string;
  faviconUrl: string;
  splashUrl: string;
  theme: BrandingTheme;
};

export const DEFAULT_BRANDING: BrandingConfig = {
  name: "",
  description: "",
  accent: "",
  footer: "",
  logoPath: "",
  faviconPath: "",
  splashPath: "",
  theme: { enabled: false, dark: { ...DEFAULT_THEME_DARK }, light: { ...DEFAULT_THEME_LIGHT } },
};

export type AuthConfig = {
  defaultRole: UserRole;
  signupsEnabled: boolean;
  adminContactEmail: string;
  pendingOverlayTitle: string;
  pendingOverlayContent: string;
};

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  defaultRole: "pending",
  signupsEnabled: false,
  adminContactEmail: "",
  pendingOverlayTitle: "Account pending",
  pendingOverlayContent: "Your account is waiting for an administrator to approve access.",
};

export function parseUserRole(value: unknown, fallback: UserRole = "user"): UserRole {
  return value === "admin" || value === "user" || value === "pending" ? value : fallback;
}

export type ConnectionKind = "openai" | "ollama";
export type ConnectionAuth = "none" | "bearer";
export type ConnectionApiType = "chat" | "responses";
export type ConnectionLocation = "local" | "external";

export type ProviderConnection = {
  id: string;
  kind: ConnectionKind;
  enabled: boolean;
  url: string;
  location: ConnectionLocation;
  auth: ConnectionAuth;
  apiKey: string;
  apiType: ConnectionApiType;
  forwardCookies: boolean;
  headers: string;
  passthrough: string;
  prefixId: string;
  provider: string;
  modelIds: string[];
  tags: string[];
};

export type ConnectionsConfig = {
  openaiEnabled: boolean;
  ollamaEnabled: boolean;
  directConnections: boolean;
  cacheBaseModelList: boolean;
  openai: ProviderConnection[];
  ollama: ProviderConnection[];
};

export const DEFAULT_CONNECTIONS: ConnectionsConfig = {
  openaiEnabled: false,
  ollamaEnabled: true,
  directConnections: false,
  cacheBaseModelList: false,
  openai: [],
  ollama: [],
};

export const DEFAULT_WEB_SEARCH: WebSearchConfig = {
  enabled: false,
  confirmation: false,
  engine: "searxng",
  searxngQueryUrl: "https://example.com/search?q=<query>",
  searxngLanguage: "all",
  resultCount: 8,
  concurrentRequests: 5,
  fetchContentLengthLimit: null,
  domainFilter: "",
  bypassEmbedding: false,
  bypassWebLoader: false,
  trustProxy: false,
  loaderEngine: "playwright",
  playwrightWsUrl: "ws://playwright:3000",
  playwrightTimeoutMs: 30000,
  loaderConcurrentRequests: 3,
  youtubeLanguage: "en,nl",
  youtubeProxyUrl: "",
};

export type ChatStreamEvent =
  | { type: "status"; stage: "loading" | "prompt" | "searching" | "running" }
  | { type: "sources"; sources: WebSearchSource[] }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string }
  | { type: "title"; title: string }
  | { type: "done"; messageId: string; stats?: Record<string, number> }
  | { type: "error"; message: string };

export const FAMILY_LABELS: Record<ModelFamily, string> = {
  llama: "Llama",
  phi: "Phi",
  mistral: "Mistral",
  qwen: "Qwen",
  gemma: "Gemma",
  other: "Other",
};

export function detectModelFamily(name: string): ModelFamily {
  const leaf = (name.split("/").pop() || name).toLowerCase();
  const base = leaf.split(":")[0];
  if (base.includes("llama")) return "llama";
  if (base.includes("mistral") || base.includes("mixtral")) return "mistral";
  if (base.includes("qwen")) return "qwen";
  if (base.includes("gemma")) return "gemma";
  if (base.startsWith("phi") || base.includes("-phi")) return "phi";
  if (leaf.includes("llama")) return "llama";
  if (leaf.includes("mistral") || leaf.includes("mixtral")) return "mistral";
  if (leaf.includes("qwen")) return "qwen";
  if (leaf.includes("gemma")) return "gemma";
  if (leaf.includes("phi")) return "phi";
  return "other";
}

export const TOOL_NAMES = [
  "search_web",
  "fetch_url",
  "memory_search",
  "memory_add",
  "memory_update",
  "memory_delete",
  "memory_list",
  "memory_list_paths",
  "memory_read_path",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const SEARCH_TOOLS_PROMPT = `search_web
  Search the web. Only works when web search is enabled.
  arguments: { "query": string }

fetch_url
  Open a public http(s) page on the server (this is the fetch/Playwright step). Never write a browser script.
  arguments: { "url": string }`;

export const MEMORY_TOOLS_PROMPT = `memory_search
  Search memories by content, path, type, or id. Returns up to 5 matches with ids.
  arguments: { "query": string }

memory_list
  List stored memories (id, type, path, content). Use when you need a broader view than search.
  arguments: {}

memory_list_paths
  List memory paths (groups) and counts.
  arguments: {}

memory_read_path
  Read memories at a path, including child paths.
  arguments: { "path": string }

memory_add
  Save a durable fact. type is "user" or "context". Optional path groups related notes (e.g. Hardware).
  arguments: { "content": string, "type"?: "user" | "context", "path"?: string }

memory_update
  Replace a memory by id from memory_search.
  arguments: { "id": string, "content"?: string, "type"?: "user" | "context", "path"?: string }

memory_delete
  Delete a memory by id when the user asked to forget it.
  arguments: { "id": string }`;

export function toolsPromptFor(opts: { search?: boolean; memory?: boolean }) {
  const parts = [opts.search ? SEARCH_TOOLS_PROMPT : "", opts.memory ? MEMORY_TOOLS_PROMPT : ""].filter(Boolean);
  if (!parts.length) return "";
  return `Available functions. Call them only with a fenced tool block. Do not invent results; wait for the tool response.

\`\`\`tool
{"name":"search_web","arguments":{"query":"example"}}
\`\`\`

Never put search_web, fetch_url, or memory_* in python/code fences. Never write Playwright, Selenium, Puppeteer, or other browser-automation scripts. If the user asks to use Playwright or fetch, call fetch_url — the server opens the page. Never write fake search results. Do not narrate the tool process to the user.

${parts.join("\n\n")}

You may call more than one function. After results return, answer the user.`;
}

export const TOOLS_PROMPT = toolsPromptFor({ search: true, memory: true });

export const DEFAULT_SYSTEM_PROMPT = "";

export const INSTRUCTION_TONES = ["default", "professional", "empathetic", "direct"] as const;
export type InstructionTone = (typeof INSTRUCTION_TONES)[number];

export function parseInstructionTone(value: unknown): InstructionTone {
  return INSTRUCTION_TONES.includes(value as InstructionTone) ? (value as InstructionTone) : "default";
}

const TONE_LINES: Record<InstructionTone, { en: string; nl: string }> = {
  default: { en: "", nl: "" },
  professional: {
    en: "Write in a professional tone: clear, polished, and businesslike.",
    nl: "Schrijf in een professionele toon: helder, verzorgd en zakelijk.",
  },
  empathetic: {
    en: "Write in an empathetic tone: warm, understanding, and supportive.",
    nl: "Schrijf in een empathische toon: warm, begripvol en ondersteunend.",
  },
  direct: {
    en: "Write in a direct tone: short, straightforward, and to the point.",
    nl: "Schrijf in een directe toon: kort, duidelijk en ter zake.",
  },
};

export function instructionToneLine(tone: InstructionTone, language: "en" | "nl") {
  return TONE_LINES[tone][language];
}

export const WORK_GROUPS = [
  { id: "technology", en: "Technology", nl: "Technologie" },
  { id: "design", en: "Design and media", nl: "Design en media" },
  { id: "business", en: "Business", nl: "Zakelijk" },
  { id: "finance", en: "Finance and law", nl: "Financiën en recht" },
  { id: "science", en: "Science and education", nl: "Wetenschap en onderwijs" },
  { id: "health", en: "Health", nl: "Zorg" },
  { id: "public", en: "Public service", nl: "Publieke sector" },
  { id: "trades", en: "Trades and industry", nl: "Techniek en industrie" },
  { id: "other", en: "Other work", nl: "Ander werk" },
] as const;

export const WORK_ROLES = [
  { id: "software", group: "technology", en: "Software engineer", nl: "Softwareontwikkelaar" },
  { id: "data", group: "technology", en: "Data scientist", nl: "Datawetenschapper" },
  { id: "it", group: "technology", en: "IT support", nl: "IT-ondersteuning" },
  { id: "security", group: "technology", en: "Cybersecurity", nl: "Cybersecurity" },
  { id: "product", group: "technology", en: "Product manager", nl: "Productmanager" },
  { id: "designer", group: "design", en: "Designer", nl: "Ontwerper" },
  { id: "writer", group: "design", en: "Writer", nl: "Schrijver" },
  { id: "artist", group: "design", en: "Artist", nl: "Kunstenaar" },
  { id: "photographer", group: "design", en: "Photographer", nl: "Fotograaf" },
  { id: "filmmaker", group: "design", en: "Filmmaker", nl: "Filmmaker" },
  { id: "musician", group: "design", en: "Musician", nl: "Muzikant" },
  { id: "founder", group: "business", en: "Founder", nl: "Oprichter" },
  { id: "executive", group: "business", en: "Executive", nl: "Directeur" },
  { id: "consultant", group: "business", en: "Consultant", nl: "Consultant" },
  { id: "marketing", group: "business", en: "Marketing", nl: "Marketing" },
  { id: "sales", group: "business", en: "Sales", nl: "Verkoop" },
  { id: "operations", group: "business", en: "Operations", nl: "Operatie" },
  { id: "hr", group: "business", en: "Human resources", nl: "Personeelszaken" },
  { id: "support", group: "business", en: "Customer support", nl: "Klantenservice" },
  { id: "project", group: "business", en: "Project manager", nl: "Projectmanager" },
  { id: "accountant", group: "finance", en: "Accountant", nl: "Accountant" },
  { id: "finance", group: "finance", en: "Financial analyst", nl: "Financieel analist" },
  { id: "lawyer", group: "finance", en: "Lawyer", nl: "Jurist" },
  { id: "researcher", group: "science", en: "Researcher", nl: "Onderzoeker" },
  { id: "scientist", group: "science", en: "Scientist", nl: "Wetenschapper" },
  { id: "teacher", group: "science", en: "Teacher", nl: "Docent" },
  { id: "professor", group: "science", en: "Professor", nl: "Hoogleraar" },
  { id: "student", group: "science", en: "Student", nl: "Student" },
  { id: "doctor", group: "health", en: "Doctor", nl: "Arts" },
  { id: "nurse", group: "health", en: "Nurse", nl: "Verpleegkundige" },
  { id: "therapist", group: "health", en: "Therapist", nl: "Therapeut" },
  { id: "pharmacist", group: "health", en: "Pharmacist", nl: "Apotheker" },
  { id: "government", group: "public", en: "Government", nl: "Overheid" },
  { id: "nonprofit", group: "public", en: "Nonprofit", nl: "Non-profit" },
  { id: "social", group: "public", en: "Social worker", nl: "Maatschappelijk werker" },
  { id: "engineer", group: "trades", en: "Engineer", nl: "Ingenieur" },
  { id: "architect", group: "trades", en: "Architect", nl: "Architect" },
  { id: "construction", group: "trades", en: "Construction", nl: "Bouw" },
  { id: "electrician", group: "trades", en: "Electrician", nl: "Elektricien" },
  { id: "mechanic", group: "trades", en: "Mechanic", nl: "Monteur" },
  { id: "manufacturing", group: "trades", en: "Manufacturing", nl: "Productie" },
  { id: "retail", group: "other", en: "Retail", nl: "Detailhandel" },
  { id: "hospitality", group: "other", en: "Hospitality", nl: "Horeca" },
  { id: "chef", group: "other", en: "Chef", nl: "Kok" },
  { id: "farmer", group: "other", en: "Farmer", nl: "Agrariër" },
  { id: "driver", group: "other", en: "Driver", nl: "Chauffeur" },
  { id: "realestate", group: "other", en: "Real estate", nl: "Makelaar" },
  { id: "journalist", group: "other", en: "Journalist", nl: "Journalist" },
  { id: "other", group: "other", en: "Other", nl: "Anders" },
] as const;

const WORK_IDS = new Set<string>(WORK_ROLES.map((role) => role.id));

export function parseWorkRole(value: unknown) {
  const id = String(value || "");
  return WORK_IDS.has(id) ? id : "";
}

export function workRoleLabel(id: string) {
  return WORK_ROLES.find((role) => role.id === id)?.en || "";
}

export const TOOL_NAME_RE =
  "search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories|list_memory_paths|read_memory_path";

function isBrowserScript(inner: string) {
  return /playwright|sync_playwright|selenium|puppeteer|webdriver|page\.goto\s*\(/i.test(inner);
}

function toolishFenceBody(inner: string) {
  const body = inner.replace(/```[a-zA-Z0-9+#_-]*[^\n]*\n?/g, "").replace(/```/g, "").trim();
  if (!body) return false;
  if (isBrowserScript(body)) return true;
  if (new RegExp(`^(?:${TOOL_NAME_RE})\\b`, "i").test(body)) return true;
  if (new RegExp(`\\b(?:${TOOL_NAME_RE})\\b`, "i").test(body) && body.length < 500) return true;
  if (/here are the results/i.test(body) && /https?:\/\//i.test(body)) return true;
  if (/(?:^|\n)\s*\d+\.\s*(?:URL|url)\s*:\s*https?:\/\//i.test(body)) return true;
  return false;
}

export type CanvasDoc = {
  title: string;
  kind: "html" | "doc";
  html: string;
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CANVAS_TAILWIND = `<script src="https://cdn.tailwindcss.com"></script>`;
const CANVAS_ICONS = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">`;

function ensureCanvasAssets(html: string) {
  let next = html;
  if (!/cdn\.tailwindcss\.com/i.test(next) && /<\/head>/i.test(next)) next = next.replace(/<\/head>/i, `${CANVAS_TAILWIND}\n</head>`);
  if (!/font-awesome/i.test(next) && /<\/head>/i.test(next)) next = next.replace(/<\/head>/i, `${CANVAS_ICONS}\n</head>`);
  if (/<body\b(?![^>]*\bclass=)/i.test(next)) next = next.replace(/<body\b/i, '<body class="bg-slate-50 font-sans text-slate-800 antialiased"');
  return next;
}

function canvasShell(title: string, body: string) {
  const safeTitle = escapeHtml(title || "Document");
  return ensureCanvasAssets(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
${CANVAS_ICONS}
${CANVAS_TAILWIND}
</head>
<body class="bg-slate-50 font-sans text-slate-800 antialiased">
${body}
</body>
</html>`);
}

function unwrapCanvasTag(body: string) {
  const wrapped = body.trim().match(/^<canvas\b[^>]*>([\s\S]*)<\/canvas>$/i);
  return wrapped ? wrapped[1].trim() : body.trim();
}

function toCanvasDoc(kindRaw: string | undefined, raw: string): CanvasDoc {
  let body = unwrapCanvasTag(raw.replace(/\s+$/, ""));
  let title = "";
  const titleLine = body.match(/^title:\s*(.+)\r?\n/);
  if (titleLine) {
    title = titleLine[1].trim().slice(0, 80);
    body = unwrapCanvasTag(body.slice(titleLine[0].length));
  }
  const looksHtml = /<html[\s>]/i.test(body) || /<!doctype html/i.test(body);
  const kind = kindRaw === "doc" ? "doc" : "html";
  if (!title) {
    title =
      body.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ||
      body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
      (kind === "doc" ? "Document" : "Page");
  }
  if (looksHtml) return { title, kind, html: ensureCanvasAssets(body.trim()) };
  const inner = /<\/?[a-z][^>]*>/i.test(body) ? body : `<p>${escapeHtml(body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  return { title, kind, html: canvasShell(title, inner) };
}

function isPageFragment(body: string) {
  const regions = body.match(/<(?:header|main|section|footer|article)\b/gi) || [];
  if (regions.length >= 2) return true;
  const utilities = body.match(/\b(?:bg|text|rounded|shadow|grid|flex|px|py|max-w|font|border)-[a-z0-9[\]:/-]+/g) || [];
  return utilities.length >= 6;
}

function isCanvasFile(fence: string, body: string) {
  if (/^```canvas/i.test(fence)) return true;
  return /<!doctype html/i.test(body) || /<html[\s>]/i.test(body) || /<style[\s>]/i.test(body) || /^<canvas\b/i.test(body.trim()) || isPageFragment(body);
}

function isStyleOnly(body: string) {
  const trimmed = body.trim();
  return /^<style\b/i.test(trimmed) && /<\/style>\s*$/i.test(trimmed) && !/<html[\s>]/i.test(trimmed) && !/<!doctype/i.test(trimmed);
}

function looksLikeCss(body: string) {
  const trimmed = body.trim();
  if (!trimmed || /<!doctype|<html[\s>]|<script\b|\bfunction\b|\b(?:const|let|import)\b/i.test(trimmed)) return false;
  if (isStyleOnly(trimmed)) return true;
  if (/<\/?[a-z][^>]*>/i.test(trimmed)) return false;
  return trimmed.split("}").length > 2 && /[.#a-z*][^{]{0,80}\{/.test(trimmed);
}

function cssText(body: string) {
  const wrapped = body.trim().match(/^<style\b[^>]*>([\s\S]*)<\/style>$/i);
  return (wrapped ? wrapped[1] : body).trim();
}

function withCanvasCss(html: string, css: string) {
  if (!css.trim()) return html;
  if (/<\/style>/i.test(html)) return html.replace(/<\/style>/i, `\n${css}\n</style>`);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `<style>\n${css}\n</style></head>`);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n<style>\n${css}\n</style>`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head><style>\n${css}\n</style></head>`);
  return `<style>\n${css}\n</style>\n${html}`;
}

type FencePiece = { full: string; lang: string; body: string };

function canvasFences(text: string): FencePiece[] {
  const pieces: FencePiece[] = [];
  const closed = /```([^\n`]*)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  while ((match = closed.exec(text))) {
    pieces.push({ full: match[0], lang: match[1].trim().toLowerCase(), body: match[2] });
    lastEnd = match.index + match[0].length;
  }
  const open = text.slice(lastEnd).match(/```([^\n`]*)\n([\s\S]*)$/);
  if (open) pieces.push({ full: open[0], lang: open[1].trim().toLowerCase(), body: open[2] });
  return pieces;
}

function fenceRole(piece: FencePiece, hasDoc: boolean): "doc" | "css" | "keep" {
  const lang = piece.lang.split(/\s+/)[0] || "";
  if (lang === "css" || lang === "scss" || lang === "style") return piece.body.trim() ? "css" : "keep";
  const canvasLang = lang === "html" || lang === "canvas" || lang.startsWith("canvas");
  if (canvasLang && piece.body.trim() && isCanvasFile("```" + piece.lang, piece.body) && !isStyleOnly(piece.body)) return "doc";
  if ((canvasLang || lang === "") && (isStyleOnly(piece.body) || (hasDoc && looksLikeCss(piece.body)))) return "css";
  return "keep";
}

function readCanvas(text: string) {
  const pieces = canvasFences(text);
  const hasDoc = pieces.some((piece) => fenceRole(piece, false) === "doc");
  const docs: CanvasDoc[] = [];
  const css: string[] = [];
  const hidden = new Set<string>();
  for (const piece of pieces) {
    const role = fenceRole(piece, hasDoc);
    if (role === "doc") {
      docs.push(toCanvasDoc(piece.lang.includes("doc") ? "doc" : "html", piece.body));
      hidden.add(piece.full);
    } else if (role === "css" && hasDoc) {
      const rules = cssText(piece.body);
      if (rules) css.push(rules);
      hidden.add(piece.full);
    }
  }
  if (docs.length && css.length) {
    const last = docs[docs.length - 1];
    last.html = withCanvasCss(last.html, css.join("\n\n"));
  }
  return { docs, hidden };
}

export function parseCanvases(text: string): CanvasDoc[] {
  return readCanvas(text).docs;
}

export function stripCanvas(text: string) {
  const { hidden } = readCanvas(text);
  if (!hidden.size) return text.trim();
  let out = text;
  for (const full of hidden) out = out.split(full).join("");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export const CANVAS_PROMPT = `When the user wants a document, article, letter, webpage, landing page, or small web app, reply with one short sentence and one complete HTML file in a single \`\`\`html fence. Do not paste the page outside the file. On a revision, output the whole file again, not a diff.

Style the page with Tailwind classes on the elements, the way a Gemini canvas does. Do not write a \`\`\`css fence. Do not put the design in a separate style block. Do not use a <canvas> tag. Do not use LaTeX or dollar-sign math.`;

export const CANVAS_DESIGN = `Build one finished HTML document. The head must include exactly these two lines, then the page:

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<script src="https://cdn.tailwindcss.com"></script>

<body class="bg-slate-50 font-sans text-slate-800 antialiased">

Page shape, in this order:
1. A full-width header with a gradient (from-blue-700 to-indigo-800 when the user asks for blue; otherwise the color they asked for), centered text, a rounded pill label, a large extrabold title, and an italic subtitle.
2. A main column, max-w-4xl mx-auto, with space-y-8.
3. A quick-facts card: white, rounded-2xl, shadow, border, and a 2-to-4 column grid of small fact tiles.
4. At least four more white cards. Each card has an h2 with a Font Awesome icon (class "fa-solid fa-...") and a bottom border, then real paragraphs or a list. Include a tinted callout inside one card.
5. A dark footer, text-center text-sm.

Use only Tailwind classes for color, spacing, type, radius, and shadow. Stack grids on small screens with grid-cols-1 sm:grid-cols-2. Write in the user's language. Fill every card with specific facts. A heading plus three plain paragraphs is a failed page. One \`\`\`html fence only.`;

function stripThinkingDraft(text: string) {
  const withoutTags = text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "");
  const htmlAt = withoutTags.search(/```html|<!doctype html/i);
  const marker = withoutTags.search(/thinking process\s*:/i);
  if (marker < 0 || (htmlAt >= 0 && marker > htmlAt)) return withoutTags;
  const end = htmlAt < 0 ? withoutTags.length : htmlAt;
  return `${withoutTags.slice(0, marker)}${withoutTags.slice(end)}`;
}

export function isProgramBlock(code: string) {
  const body = code.trim();
  if (!body || body.length > 20000) return false;
  if (/^(?:user profile\b|the user's |<memory_context>|memory_context\b)/i.test(body)) return false;
  return /^(?:import |from |def |class |print\(|for |while |if |#|const |let |var |function |console\.|return )/m.test(body) || /[{};]/.test(body);
}

export function stripLeakedAssistant(text: string, keepCode = false) {
  let out = String(text || "");
  const fence = /```(?:python-run|javascript-run|js-run)\s*\n([\s\S]*?)```/gi;
  out = keepCode
    ? out.replace(fence, (full, inner: string) => (isProgramBlock(inner) ? full : ""))
    : out.replace(fence, "");
  if (!keepCode) {
    out = out.replace(/```(?:python-run|javascript-run|js-run)[\s\S]*$/gi, "");
    out = out.replace(/\n*\*\*Code output\*\*\n```[\s\S]*?```/gi, "");
  }
  out = out
    .replace(/<memory_context>[\s\S]*?<\/memory_context>/gi, "")
    .replace(/(?:^|\n)User profile:\n(?:[ \t]*- .*(?:\n|$))+/gi, "\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripToolMarkup(text: string) {
  text = stripThinkingDraft(text);
  const hasTool = new RegExp(`\\b(?:${TOOL_NAME_RE})\\b`, "i").test(text);
  const hasBrowserScript = isBrowserScript(text);
  let out = text
    .replace(/```(?:tool|json)\s*\n[\s\S]*?```/gi, "")
    .replace(/```[a-zA-Z0-9+#_-]*[^\n]*\n([\s\S]*?)```/g, (full, inner: string) => (hasTool || toolishFenceBody(inner) ? "" : full))
    .replace(/<tool_code>[\s\S]*?(?:<\/tool_code>|$)/gi, "")
    .replace(/<(search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi, "")
    .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, "")
    .replace(/\[(search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories)\s*\([\s\S]*?\)\]/gi, "")
    .replace(/\b(?:search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories)\s*\([^)]*\)/gi, "")
    .replace(new RegExp(`^\\s*(?:${TOOL_NAME_RE})\\s+("[^"]+"|'[^']+'|https?:\\S+|\\S+)\\s*$`, "gim"), "")
    .replace(new RegExp(`^\\s*(?:${TOOL_NAME_RE})\\s*$`, "gim"), "")
    .replace(/^call\s+(?:search_web|fetch_url|memory_search|memory_add|memory_update|memory_delete|memory_list|memory_list_paths|memory_read_path|search_memories|add_memory|list_memories)\b.*$/gim, "");
  if (hasTool) {
    out = out.replace(/^(?:first[,']? i(?:['’]ll| will)|to find the answer|let['’]?s use the |now, i will perform).*$/gim, "");
    out = out.replace(/^.*\b(?:i will wait for the response|searching for)\b.*$/gim, "");
  }
  if (hasBrowserScript) {
    out = out.replace(/this script uses playwright[\s\S]*$/gi, "");
    out = out.replace(/the (?:above )?script uses playwright[\s\S]*$/gi, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export type GenerationSettings = {
  show: boolean;
  values: Record<string, string>;
  custom: { key: string; value: string }[];
};

export const EMPTY_GENERATION: GenerationSettings = { show: false, values: {}, custom: [] };

export type GenerationField = {
  key: string;
  kind: "text" | "number" | "boolean" | "select";
  options?: string[];
  option?: string;
  top?: boolean;
};

export const GENERATION_FIELDS: GenerationField[] = [
  { key: "stream", kind: "boolean" },
  { key: "stream_delta_chunk_size", kind: "number" },
  { key: "context_compaction_threshold", kind: "number" },
  { key: "function_calling", kind: "select", options: ["native", "default", "disabled"] },
  { key: "reasoning_tags", kind: "text" },
  { key: "seed", kind: "number", option: "seed" },
  { key: "stop", kind: "text", option: "stop" },
  { key: "temperature", kind: "number", option: "temperature" },
  { key: "reasoning_effort", kind: "select", options: ["low", "medium", "high", "max"] },
  { key: "logit_bias", kind: "text", option: "logit_bias" },
  { key: "max_tokens", kind: "number", option: "num_predict" },
  { key: "top_k", kind: "number", option: "top_k" },
  { key: "top_p", kind: "number", option: "top_p" },
  { key: "min_p", kind: "number", option: "min_p" },
  { key: "frequency_penalty", kind: "number", option: "frequency_penalty" },
  { key: "presence_penalty", kind: "number", option: "presence_penalty" },
  { key: "mirostat", kind: "number", option: "mirostat" },
  { key: "mirostat_eta", kind: "number", option: "mirostat_eta" },
  { key: "mirostat_tau", kind: "number", option: "mirostat_tau" },
  { key: "repeat_last_n", kind: "number", option: "repeat_last_n" },
  { key: "tfs_z", kind: "number", option: "tfs_z" },
  { key: "repeat_penalty", kind: "number", option: "repeat_penalty" },
  { key: "use_mmap", kind: "boolean", option: "use_mmap" },
  { key: "use_mlock", kind: "boolean", option: "use_mlock" },
  { key: "think", kind: "select", options: ["true", "false"], top: true },
  { key: "format", kind: "select", options: ["json"], top: true },
  { key: "num_keep", kind: "number", option: "num_keep" },
  { key: "num_ctx", kind: "number", option: "num_ctx" },
  { key: "num_batch", kind: "number", option: "num_batch" },
  { key: "num_thread", kind: "number", option: "num_thread" },
  { key: "num_gpu", kind: "number", option: "num_gpu" },
  { key: "keep_alive", kind: "text", top: true },
];

export const GENERATION_LABELS: Record<string, { en: string; nl: string }> = {
  stream: { en: "Stream Chat Response", nl: "Chatantwoord streamen" },
  stream_delta_chunk_size: { en: "Stream Delta Chunk Size", nl: "Stream delta chunkgrootte" },
  context_compaction_threshold: { en: "Context Compaction Threshold", nl: "Drempel contextcompactie" },
  function_calling: { en: "Function Calling", nl: "Functie-aanroepen" },
  reasoning_tags: { en: "Reasoning Tags", nl: "Redeneertags" },
  seed: { en: "Seed", nl: "Seed" },
  stop: { en: "Stop Sequence", nl: "Stopsequentie" },
  temperature: { en: "Temperature", nl: "Temperatuur" },
  reasoning_effort: { en: "Reasoning Effort", nl: "Redeneerinspanning" },
  logit_bias: { en: "logit_bias", nl: "logit_bias" },
  max_tokens: { en: "max_tokens", nl: "max_tokens" },
  top_k: { en: "top_k", nl: "top_k" },
  top_p: { en: "top_p", nl: "top_p" },
  min_p: { en: "min_p", nl: "min_p" },
  frequency_penalty: { en: "frequency_penalty", nl: "frequency_penalty" },
  presence_penalty: { en: "presence_penalty", nl: "presence_penalty" },
  mirostat: { en: "mirostat", nl: "mirostat" },
  mirostat_eta: { en: "mirostat_eta", nl: "mirostat_eta" },
  mirostat_tau: { en: "mirostat_tau", nl: "mirostat_tau" },
  repeat_last_n: { en: "repeat_last_n", nl: "repeat_last_n" },
  tfs_z: { en: "tfs_z", nl: "tfs_z" },
  repeat_penalty: { en: "repeat_penalty", nl: "repeat_penalty" },
  use_mmap: { en: "use_mmap", nl: "use_mmap" },
  use_mlock: { en: "use_mlock", nl: "use_mlock" },
  think: { en: "think (Ollama)", nl: "think (Ollama)" },
  format: { en: "format (Ollama)", nl: "format (Ollama)" },
  num_keep: { en: "num_keep (Ollama)", nl: "num_keep (Ollama)" },
  num_ctx: { en: "num_ctx (Ollama)", nl: "num_ctx (Ollama)" },
  num_batch: { en: "num_batch (Ollama)", nl: "num_batch (Ollama)" },
  num_thread: { en: "num_thread (Ollama)", nl: "num_thread (Ollama)" },
  num_gpu: { en: "num_gpu (Ollama)", nl: "num_gpu (Ollama)" },
  keep_alive: { en: "keep_alive (Ollama)", nl: "keep_alive (Ollama)" },
};

function coerceValue(field: GenerationField, raw: string): unknown {
  const value = raw.trim();
  if (!value) return undefined;
  if (field.key === "stop") return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  if (field.key === "logit_bias") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (field.kind === "boolean" || value === "true" || value === "false") return value === "true";
  if (field.kind === "number" && Number.isFinite(Number(value))) return Number(value);
  if (field.key === "format" && value === "") return undefined;
  if (field.key === "think") return value === "true" ? true : value === "false" ? false : value;
  return value;
}

export function parseGenerationSettings(raw: unknown): GenerationSettings {
  if (!raw || typeof raw !== "object") return { ...EMPTY_GENERATION, values: {}, custom: [] };
  const input = raw as Record<string, unknown>;
  const values =
    input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? Object.fromEntries(Object.entries(input.values as Record<string, unknown>).map(([key, item]) => [key, String(item ?? "")]))
      : {};
  const custom = Array.isArray(input.custom)
    ? input.custom
        .map((item) => {
          const row = item as { key?: string; value?: string };
          return { key: String(row.key || "").trim(), value: String(row.value ?? "") };
        })
        .filter((item) => item.key)
    : [];
  return { show: false, values, custom };
}

export function toOllamaGeneration(settings: GenerationSettings): { stream: boolean; body: Record<string, unknown>; options: Record<string, unknown> } {
  const options: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  let stream = true;
  for (const field of GENERATION_FIELDS) {
    const raw = settings.values[field.key];
    if (raw == null || String(raw).trim() === "" || String(raw).trim().toLowerCase() === "default") continue;
    if (field.key === "stream") {
      stream = String(raw) !== "false";
      continue;
    }
    if (field.key === "stream_delta_chunk_size" || field.key === "context_compaction_threshold" || field.key === "function_calling" || field.key === "reasoning_tags" || field.key === "reasoning_effort") {
      continue;
    }
    const coerced = coerceValue(field, String(raw));
    if (coerced === undefined) continue;
    if (field.top) {
      if (field.key === "keep_alive") body.keep_alive = coerced;
      else if (field.key === "format") body.format = coerced;
      else if (field.key === "think") body.think = coerced;
    } else if (field.option) options[field.option] = coerced;
  }
  for (const item of settings.custom) {
    if (!item.key.trim() || !String(item.value).trim()) continue;
    const num = Number(item.value);
    options[item.key.trim()] = Number.isFinite(num) && String(num) === item.value.trim() ? num : item.value;
  }
  return { stream, body, options };
}
