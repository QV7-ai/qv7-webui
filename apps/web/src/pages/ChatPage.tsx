import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { MessageQueue } from "@/components/composer/MessageQueue";

function TemporaryChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.2 6.2A2.7 2.7 0 0 1 7.9 3.5h8.4a2.7 2.7 0 0 1 2.7 2.7v6.2a2.7 2.7 0 0 1-2.7 2.7H9.1L5.2 18.4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="17.4" cy="7" r="3.7" fill="var(--bg)" stroke="currentColor" strokeWidth="1.7" />
      <path d="M17.4 5.15V7l1.25.85" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
import { useSidebarSwipe } from "@/lib/use-sidebar-swipe";
import type { ChatModel, ChatFolder, ModelCategory, WebSearchSource, ChatActivity, AppFeatures, PublicBranding, UserSkill, UsedMemory, ArtifactAction, ArtifactFile, ArtifactType, McpAvailableTool } from "@wlfv/shared";
import { keepManualEdit } from "@wlfv/shared";
import { DEFAULT_APP_GENERAL } from "@wlfv/shared";
import { api } from "@/lib/api";
import { applyMotion, applyTheme, applyTextSize } from "@/lib/i18n";
import { useLang, useT } from "@/lib/language";
import { PHONE_QUERY } from "@/lib/layout";
import { Sidebar, type ChatSummary } from "@/components/sidebar/Sidebar";
import { ModelSelector } from "@/components/models/ModelSelector";
import { Composer, type ComposerAttachment } from "@/components/composer/Composer";
import { MessageList, listCanvasVersions, splitUserContent, type UiMessage } from "@/components/chat/MessageList";
import { attachMemoryUsed } from "@/components/chat/memory-used";
import { parseUsedMemories } from "@wlfv/shared";
import { CanvasPanel, artifactChatClass } from "@/components/chat/CanvasPanel";
import { SkillsPage } from "@/components/skills/SkillsDialog";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { DEFAULT_LOGO } from "@/lib/branding";

const MAX_QUEUE = 15;

type QueuedMessage = {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  search: boolean;
  createImage: boolean;
  editImage: boolean;
  canvas: boolean;
  document: boolean;
  skillIds: string[];
  mcpCallNames: string[];
};

type OpenFile = { title: string; type: ArtifactType; language: string; content: string };
type ArtifactVersion = { version: number; content: string; createdAt: number; source: string };
type SavedArtifact = { id: string; messageId: string | null; title: string; type: ArtifactType; language: string; content: string };

type ChatStreamPayload = {
  delta?: string;
  reset?: boolean;
  message?: string;
  title?: string;
  stage?: UiMessage["wait"];
  usage?: UiMessage["usage"];
  sources?: WebSearchSource[];
  activities?: ChatActivity[];
  memories?: UsedMemory[];
  memoriesUsed?: UsedMemory[];
  memoryUsed?: boolean;
  memoryIds?: string[];
  assistantId?: string;
  conversationId?: string;
  userMessage?: { id: string; content: string; createdAt?: number };
  assistantCreatedAt?: number;
  content?: string;
  thinking?: string;
  wait?: UiMessage["wait"];
  error?: boolean;
};

function mapLoadedMessage(message: UiMessage & { status?: string }): UiMessage {
  if (message.role === "user") {
    const parsed = splitUserContent(message.content);
    return { ...message, content: parsed.text, images: parsed.images };
  }
  return {
    ...message,
    streaming: message.status === "streaming" || Boolean(message.streaming),
    wait: message.status === "streaming" ? message.wait || "loading" : message.wait,
  };
}

function upsertRemoteTurn(prev: UiMessage[], json: ChatStreamPayload): UiMessage[] {
  if (!json.assistantId) return prev;
  const userRaw = json.userMessage?.content || "";
  const parsed = splitUserContent(userRaw);
  const userMsg: UiMessage | null = json.userMessage
    ? { id: json.userMessage.id, role: "user", content: parsed.text, images: parsed.images, createdAt: json.userMessage.createdAt }
    : null;
  const existing = prev.find((m) => m.id === json.assistantId);
  const asst: UiMessage = {
    id: json.assistantId,
    role: "assistant",
    content: json.content || existing?.content || "",
    thinking: json.thinking ?? (existing?.thinking || ""),
    streaming: true,
    wait: json.wait || json.stage || "loading",
    sources: json.sources,
    activities: json.activities,
    memoriesUsed: (() => {
      const parsed = parseUsedMemories(json.memoriesUsed);
      return parsed.length ? parsed : existing?.memoriesUsed;
    })(),
    canvas: existing?.canvas,
    createdAt: json.assistantCreatedAt || existing?.createdAt,
  };
  const hasAsst = prev.some((m) => m.id === asst.id);
  const hasUser = userMsg ? prev.some((m) => m.id === userMsg.id) : true;
  if (hasAsst) {
    return prev.map((m) => (m.id === asst.id ? { ...m, ...asst, content: asst.content || m.content } : m));
  }
  const next = [...prev];
  if (userMsg && !hasUser) next.push(userMsg);
  next.push(asst);
  return next;
}

function applyRemoteChatEvent(prev: UiMessage[], ev: string, json: ChatStreamPayload): UiMessage[] {
  const assistantId =
    json.assistantId || [...prev].reverse().find((m) => m.role === "assistant" && m.streaming)?.id;
  if (ev === "start" || ev === "snapshot") return upsertRemoteTurn(prev, json);
  if (!assistantId) return prev;
  if (ev === "status" && json.stage) {
    return prev.map((m) => (m.id === assistantId ? { ...m, wait: json.stage, streaming: true } : m));
  }
  if (ev === "sources" && json.sources) {
    return prev.map((m) => (m.id === assistantId ? { ...m, sources: json.sources } : m));
  }
  if (ev === "activity" && json.activities) {
    return prev.map((m) => (m.id === assistantId ? { ...m, activities: json.activities } : m));
  }
  if (ev === "memoryUsed") return attachMemoryUsed(prev, assistantId, json);
  if (ev === "thinking") {
    return prev.map((m) =>
      m.id === assistantId ? { ...m, thinking: (m.thinking || "") + (json.delta || ""), streaming: true } : m,
    );
  }
  if (ev === "content") {
    return prev.map((m) =>
      m.id === assistantId
        ? { ...m, content: json.reset ? json.delta || "" : m.content + (json.delta || ""), streaming: true }
        : m,
    );
  }
  if (ev === "done") {
    return attachMemoryUsed(prev, assistantId, json).map((m) =>
      m.id === assistantId ? { ...m, streaming: false, wait: undefined, usage: json.usage || m.usage } : m,
    );
  }
  return prev;
}

function greetingPeriod(hour: number) {
  if (hour >= 5 && hour < 12) return "greetingMorning" as const;
  if (hour >= 12 && hour < 17) return "greetingAfternoon" as const;
  if (hour >= 17 && hour < 22) return "greetingEvening" as const;
  return "greetingNight" as const;
}

export default function ChatPage({
  branding,
  username,
  displayName,
  isAdmin,
  onUserUpdate,
  onBrandingChange,
}: {
  branding: PublicBranding;
  username: string;
  displayName: string;
  isAdmin: boolean;
  onUserUpdate?: (user: { username: string; displayName?: string }) => void;
  onBrandingChange?: (branding: PublicBranding) => void;
}) {
  const tr = useT();
  const { setLang } = useLang();
  const chatMatch = useMatch("/chat/:conversationId");
  const conversationId = chatMatch?.params.conversationId;
  const { pathname } = useLocation();
  const skillsOpen = pathname === "/skills";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [models, setModels] = useState<ChatModel[]>([]);
  const [loadedIds, setLoadedIds] = useState<string[]>([]);
  const [loadedContexts, setLoadedContexts] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<ModelCategory[]>([]);
  const [modelId, setModelId] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<string | undefined>();
  const [effortSetting, setEffortSetting] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [palette, setPalette] = useState(false);
  const [openNewFolder, setOpenNewFolder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phoneLayout, setPhoneLayout] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(PHONE_QUERY).matches));
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhoneLayout(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useSidebarSwipe({
    open: sidebarOpen,
    onOpen: () => setSidebarOpen(true),
    onClose: () => setSidebarOpen(false),
    enabled: phoneLayout && !settingsOpen && !palette,
  });
  const [settingsTab, setSettingsTab] = useState<"general" | "admin">("general");
  const [showUsage, setShowUsage] = useState(true);
  const [numCtx, setNumCtx] = useState(0);
  const [features, setFeatures] = useState<AppFeatures>({
    sharingEnabled: DEFAULT_APP_GENERAL.sharingEnabled,
    foldersEnabled: DEFAULT_APP_GENERAL.foldersEnabled,
    maxFolderCount: DEFAULT_APP_GENERAL.maxFolderCount,
    memoriesEnabled: DEFAULT_APP_GENERAL.memoriesEnabled,
    webUiUrl: DEFAULT_APP_GENERAL.webUiUrl,
    toolPermissionsEnabled: false,
    imageGenerationEnabled: true,
    imageEditEnabled: true,
    toolWebSearch: true,
    toolCode: true,
    toolCanvas: true,
    toolWebpage: true,
    toolMcp: true,
  });
  const [webSearchOn, setWebSearchOn] = useState(false);
  const [createImageOn, setCreateImageOn] = useState(false);
  const [editImageOn, setEditImageOn] = useState(false);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [webSearchConfirm, setWebSearchConfirm] = useState(false);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);
  const [codeInterpreterOn, setCodeInterpreterOn] = useState(false);
  const [mcpTools, setMcpTools] = useState<McpAvailableTool[]>([]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [canvasOn, setCanvasOn] = useState(false);
  const [documentOn, setDocumentOn] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasFile, setCanvasFile] = useState<OpenFile | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [artifactHistory, setArtifactHistory] = useState<ArtifactVersion[]>([]);
  const artifactIdRef = useRef<string | null>(null);
  const draftRef = useRef("");
  const sentRef = useRef("");
  const saveTimer = useRef<number | null>(null);
  const savedArtifacts = useRef<Record<string, SavedArtifact>>({});
  const preserveEdit = useRef(false);
  const [savedTick, setSavedTick] = useState(0);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const canvasDirty = useRef(false);
  const canvasFollow = useRef(true);
  const canvasVersionRef = useRef(0);
  const canvasMsgId = useRef("");
  const canvasHold = useRef(false);
  const canvasDismissed = useRef("");
  const skillDefaultsApplied = useRef(false);
  const [toolPermission, setToolPermission] = useState<"full" | "ask" | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [toast, setToast] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollLock = useRef(false);
  const scrollGen = useRef(0);
  const userHold = useRef(false);
  const holdScrollTop = useRef(0);
  const followedAssistant = useRef<string | null>(null);
  const skipLoadRef = useRef(false);
  const createdIdRef = useRef<string | null>(null);
  const sendGenRef = useRef(0);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const busyRef = useRef(false);
  const skipQueueRef = useRef(false);
  const conversationIdRef = useRef(conversationId);
  const temporaryRef = useRef(false);
  const temporaryChatIdRef = useRef<string | null>(null);
  temporaryRef.current = temporary;
  const localStreamRef = useRef(false);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    followedAssistant.current = null;
    stick.current = true;
    const tempId = temporaryChatIdRef.current;
    if (!tempId || !conversationId || conversationId === tempId) return;
    temporaryChatIdRef.current = null;
    void api.send(`/api/conversations/${tempId}`, "DELETE").catch(() => undefined);
    setTemporary(false);
  }, [conversationId]);

  function noteStick(el: HTMLElement) {
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function pinToBottom() {
    const el = scroller.current;
    if (!el || !stick.current || userHold.current) return;
    const token = ++scrollGen.current;
    scrollLock.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (scrollGen.current !== token || !scroller.current || userHold.current || !stick.current) {
        if (scrollGen.current === token) scrollLock.current = false;
        return;
      }
      scroller.current.scrollTop = scroller.current.scrollHeight;
      requestAnimationFrame(() => {
        if (scrollGen.current === token) scrollLock.current = false;
      });
    });
  }

  function markHold() {
    userHold.current = true;
    holdScrollTop.current = scroller.current?.scrollTop ?? 0;
  }

  function holdPointer(event: { pointerType: string }) {
    if (event.pointerType === "touch") return;
    markHold();
  }

  function releasePointer(event: { pointerType: string }) {
    if (event.pointerType === "touch") return;
    endHold();
  }

  function endHold() {
    userHold.current = false;
    const el = scroller.current;
    if (!el) return;
    if (!stick.current) {
      noteStick(el);
      return;
    }
    pinToBottom();
  }

  useEffect(() => {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (!last) return;
    if (last.id !== followedAssistant.current) {
      followedAssistant.current = last.id;
      stick.current = true;
    }
    pinToBottom();
  }, [messages]);

  useEffect(() => {
    const el = scroller.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => pinToBottom());
    observer.observe(inner);
    return () => observer.disconnect();
  }, [messages.length, conversationId]);

  function setQueueState(next: QueuedMessage[]) {
    queueRef.current = next;
    setQueue(next);
  }

  const model = models.find((m) => m.id === modelId) ?? models[0];

  useEffect(() => {
    if (!model) return;
    const levels = model.capabilities.thinkingLevels;
    const fromSettings = levels.includes(effortSetting) ? effortSetting : "";
    const fromModel = model.defaults?.thinkingLevel && levels.includes(model.defaults.thinkingLevel) ? model.defaults.thinkingLevel : "";
    const think = (Boolean(model.defaults?.thinking) || Boolean(fromSettings)) && model.capabilities.thinking;
    setThinking(think);
    setThinkingLevel(fromSettings || fromModel || (think ? levels[0] : undefined));
    setWebSearchOn(Boolean(model.defaults?.webSearch));
    setCodeInterpreterOn(Boolean(model.defaults?.codeInterpreter));
    setCreateImageOn(false);
    setEditImageOn(false);
  }, [model?.id, effortSetting]);

  const refreshChats = useCallback(async () => {
    const data = await api.get("/api/conversations");
    setChats(data.conversations ?? []);
  }, []);

  const refreshFolders = useCallback(async () => {
    const data = await api.get("/api/folders");
    setFolders(data.folders ?? []);
  }, []);

  const refreshWebSearch = useCallback(async () => {
    const data = await api.get("/api/web-search");
    setWebSearchAvailable(Boolean(data.enabled));
    setWebSearchConfirm(Boolean(data.confirmation));
    if (!data.enabled) setWebSearchOn(false);
  }, []);

  const refreshSkills = useCallback(async () => {
    const data = await api.get("/api/skills");
    const list = (data.skills ?? []) as UserSkill[];
    setSkills(list);
    setSelectedSkillIds((current) => {
      if (!skillDefaultsApplied.current) {
        skillDefaultsApplied.current = true;
        return list.filter((skill) => skill.defaultOn).map((skill) => skill.id);
      }
      return current.filter((id) => list.some((skill) => skill.id === id));
    });
  }, []);

  const refreshSettings = useCallback(async () => {
    const data = await api.get("/api/settings");
    setShowUsage(data.showUsage !== false);
    const rawCtx = Number(data.generation?.values?.num_ctx);
    setNumCtx(Number.isFinite(rawCtx) && rawCtx > 0 ? rawCtx : 0);
    setEffortSetting(String(data.generation?.values?.reasoning_effort || ""));
    if (data.features) {
      setFeatures(data.features);
      if (!isAdmin) {
        if (!data.features.toolWebSearch) setWebSearchOn(false);
        if (!data.features.toolCode) setCodeInterpreterOn(false);
        if (!data.features.toolCanvas) setCanvasOn(false);
      }
    }
    if (data.features && !data.features.imageGenerationEnabled) setCreateImageOn(false);
    if (data.features && !data.features.imageEditEnabled) setEditImageOn(false);
    applyTheme(data.theme || "dark");
    applyMotion(data.animations !== false);
    if (typeof data.textSize === "number") applyTextSize(data.textSize);
    if (data.language === "nl" || data.language === "en") setLang(data.language);
  }, [isAdmin, setLang]);

  useEffect(() => {
    if (createdIdRef.current === conversationId) {
      canvasHold.current = false;
      return;
    }
    canvasDirty.current = false;
    canvasMsgId.current = "";
    canvasHold.current = true;
    canvasDismissed.current = "";
    canvasFollow.current = true;
    canvasVersionRef.current = 0;
    setCanvasVersion(0);
    setCanvasOpen(false);
    setCanvasFile(null);
    setArtifactId(null);
    artifactIdRef.current = null;
    draftRef.current = "";
    sentRef.current = "";
    savedArtifacts.current = {};
    setArtifactHistory([]);
  }, [conversationId]);

  function adoptFile(file: OpenFile, messageId: string, savedId?: string | null) {
    draftRef.current = file.content;
    sentRef.current = file.content;
    canvasMsgId.current = messageId;
    if (savedId) {
      artifactIdRef.current = savedId;
      setArtifactId(savedId);
    }
    setCanvasFile(file);
    setSaveState("saved");
  }

  function showArtifact(file: ArtifactFile, messageId: string, index = 0) {
    const saved = savedArtifacts.current[messageId];
    const list = listCanvasVersions(messages);
    canvasFollow.current = index === list.length - 1;
    canvasVersionRef.current = index;
    setCanvasVersion(index);
    canvasDirty.current = false;
    canvasDismissed.current = "";
    adoptFile(saved ? { title: saved.title, type: saved.type, language: saved.language, content: saved.content } : file, messageId, saved?.id || null);
    if (!saved) {
      artifactIdRef.current = null;
      setArtifactId(null);
    }
    setCanvasOpen(true);
  }

  function showCanvasVersion(index: number) {
    const list = listCanvasVersions(messages);
    const item = list[index];
    if (!item) return;
    const latest = index === list.length - 1;
    const saved = savedArtifacts.current[item.messageId];
    canvasFollow.current = latest;
    canvasDirty.current = false;
    canvasVersionRef.current = index;
    canvasDismissed.current = "";
    setCanvasVersion(index);
    adoptFile(saved && latest ? { title: saved.title, type: saved.type, language: saved.language, content: saved.content } : item.file, item.messageId, saved?.id || null);
    if (!saved) {
      artifactIdRef.current = null;
      setArtifactId(null);
    }
    setCanvasOpen(true);
  }

  useEffect(() => {
    const list = listCanvasVersions(messages);
    if (canvasHold.current) {
      if (!messages.length) return;
      canvasHold.current = false;
      canvasMsgId.current = list.at(-1)?.messageId || "";
      canvasVersionRef.current = Math.max(0, list.length - 1);
      setCanvasVersion(canvasVersionRef.current);
      return;
    }
    if (preserveEdit.current || keepManualEdit(draftRef.current, sentRef.current)) return;
    if (!list.length) return;
    const index = canvasFollow.current ? list.length - 1 : Math.min(canvasVersionRef.current, list.length - 1);
    const item = list[index];
    if (!item) return;
    const latest = index === list.length - 1;
    const saved = latest ? savedArtifacts.current[item.messageId] : undefined;
    canvasVersionRef.current = index;
    setCanvasVersion(index);
    adoptFile(saved ? { title: saved.title, type: saved.type, language: saved.language, content: saved.content } : item.file, item.messageId, saved?.id);
    if (canvasDismissed.current === item.messageId) return;
    setCanvasOpen(true);
  }, [messages, savedTick]);

  const refreshLoaded = useCallback(async () => {
    const data = await api.get("/api/models/loaded");
    setLoadedIds(data.ids ?? []);
    setLoadedContexts(data.contexts ?? {});
  }, []);

  const refreshModels = useCallback(async () => {
    const data = await api.get("/api/models");
    setModels(data.models ?? []);
    setCategories(data.categories ?? []);
    setModelId((prev) => prev || data.defaultModelId || data.models?.[0]?.id || "");
  }, []);

  useEffect(() => {
    const panel = searchParams.get("settings");
    if (panel == null) return;
    setSettingsOpen(true);
    setSettingsTab(panel === "admin" && isAdmin ? "admin" : "general");
    const next = new URLSearchParams(searchParams);
    next.delete("settings");
    setSearchParams(next, { replace: true });
  }, [searchParams, isAdmin, setSearchParams]);

  const refreshMcpTools = useCallback(() => {
    api.get("/api/mcp/tools").then((data) => setMcpTools(Array.isArray(data.tools) ? data.tools : [])).catch(() => setMcpTools([]));
  }, []);

  useEffect(() => {
    refreshModels().catch(() => undefined);
    refreshLoaded().catch(() => undefined);
    refreshChats().catch(() => undefined);
    refreshFolders().catch(() => undefined);
    refreshSettings().catch(() => undefined);
    refreshWebSearch().catch(() => undefined);
    refreshSkills().catch(() => undefined);
    refreshMcpTools();
  }, [refreshChats, refreshFolders, refreshLoaded, refreshModels, refreshSettings, refreshWebSearch, refreshSkills, refreshMcpTools]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLoaded().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refreshLoaded]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      void api.get("/api/settings").then((data) => {
        if (data.theme === "system") applyTheme("system");
      });
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    const skipLoad = skipLoadRef.current || createdIdRef.current === conversationId;
    if (skipLoad) {
      skipLoadRef.current = false;
    } else {
      createdIdRef.current = null;
      skipQueueRef.current = true;
      sendGenRef.current += 1;
      setQueueState([]);
      abortRef.current?.abort();
      busyRef.current = false;
      localStreamRef.current = false;
      setBusy(false);
    }

    let cancelled = false;
    let source: EventSource | undefined;
    const handlers: { name: string; handler: EventListener }[] = [];

    const startEvents = () => {
      if (cancelled) return;
      source = new EventSource(`/api/conversations/${conversationId}/events`, { withCredentials: true });
      const onEvent = (ev: string) => (event: Event) => {
        if (localStreamRef.current) return;
        const data = "data" in event ? String((event as MessageEvent).data || "{}") : "{}";
        let json: ChatStreamPayload = {};
        try {
          json = JSON.parse(data) as ChatStreamPayload;
        } catch {
          return;
        }
        if (ev === "error" && json.message) setError(json.message);
        if (ev === "title" || ev === "done") void refreshChats();
        if (ev === "ping" || ev === "ready" || ev === "memory") return;
        setMessages((prev) => applyRemoteChatEvent(prev, ev, json));
      };
      for (const name of ["start", "snapshot", "status", "sources", "activity", "memoryUsed", "thinking", "content", "error", "title", "done"]) {
        const handler = onEvent(name) as EventListener;
        source.addEventListener(name, handler);
        handlers.push({ name, handler });
      }
    };

    if (skipLoad) {
      startEvents();
    } else {
      api
        .get(`/api/conversations/${conversationId}`)
        .then((d) => {
          if (cancelled) return;
          setMessages((d.conversation.messages ?? []).map((message: UiMessage & { status?: string }) => mapLoadedMessage(message)));
          void api.get(`/api/conversations/${conversationId}/artifacts`).then((rows) => {
            if (cancelled) return;
            const map: Record<string, SavedArtifact> = {};
            for (const row of (rows.artifacts ?? []) as SavedArtifact[]) {
              if (row.messageId) map[row.messageId] = row;
            }
            savedArtifacts.current = map;
            setSavedTick((value) => value + 1);
          }).catch(() => undefined);
          if (d.conversation.modelId) setModelId(d.conversation.modelId);
          setPendingFolderId(d.conversation.folderId ?? null);
          const isTemporary = Boolean(d.conversation.temporary);
          setTemporary(isTemporary);
          temporaryChatIdRef.current = isTemporary ? conversationId : null;
          startEvents();
        })
        .catch(() => {
          if (!cancelled) startEvents();
        });
    }

    return () => {
      cancelled = true;
      for (const { name, handler } of handlers) source?.removeEventListener(name, handler);
      source?.close();
    };
  }, [conversationId, refreshChats]);

  useEffect(() => {
    const source = new EventSource("/api/sync", { withCredentials: true });
    const onChats = () => {
      void refreshChats();
    };
    const onDeleted = (event: Event) => {
      void refreshChats();
      try {
        const payload = JSON.parse(String((event as MessageEvent).data || "{}")) as { id?: string };
        if (payload.id && conversationIdRef.current === payload.id) navigate("/chat");
      } catch {
        /* ignore */
      }
    };
    source.addEventListener("chats", onChats);
    source.addEventListener("deleted", onDeleted);
    return () => {
      source.removeEventListener("chats", onChats);
      source.removeEventListener("deleted", onDeleted);
      source.close();
    };
  }, [navigate, refreshChats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function discardTemporaryChat() {
    const id = temporaryChatIdRef.current;
    if (!id) return;
    temporaryChatIdRef.current = null;
    void api.send(`/api/conversations/${id}`, "DELETE").catch(() => undefined);
  }

  function newChat(folderId: string | null = null) {
    discardTemporaryChat();
    skipQueueRef.current = true;
    sendGenRef.current += 1;
    abortRef.current?.abort();
    busyRef.current = false;
    localStreamRef.current = false;
    createdIdRef.current = null;
    setQueueState([]);
    setMessages([]);
    setDraft("");
    setError("");
    setBusy(false);
    setAttachments([]);
    setCanvasOpen(false);
    setPendingFolderId(folderId);
    setSelectedSkillIds(skills.filter((skill) => skill.defaultOn).map((skill) => skill.id));
    setSidebarOpen(false);
    if (pathname === "/skills" || conversationId) navigate("/chat");
  }

  function toggleTemporary() {
    setTemporary((on) => !on);
    newChat(null);
  }

  async function send(
    text = draft,
    options?: {
      search?: boolean;
      confirmed?: boolean;
      attachments?: ComposerAttachment[];
      fromQueue?: boolean;
      createImage?: boolean;
      editImage?: boolean;
      canvas?: boolean;
      document?: boolean;
      skillIds?: string[];
      mcpCallNames?: string[];
      artifactAction?: ArtifactAction;
    },
  ) {
    const content = text.trim();
    const pendingAttachments = options?.attachments ?? attachments;
    const useCreate = Boolean(options?.createImage ?? createImageOn) && Boolean(features.imageGenerationEnabled);
    const useEdit = Boolean(options?.editImage ?? editImageOn) && Boolean(features.imageEditEnabled);
    if (!content && !pendingAttachments.length) {
      if (busyRef.current || options?.fromQueue) return;
      const next = queueRef.current[0];
      if (!next) return;
      setQueueState(queueRef.current.slice(1));
      await send(next.text, {
        search: next.search,
        attachments: next.attachments,
        fromQueue: true,
        createImage: next.createImage,
        editImage: next.editImage,
        canvas: next.canvas,
        document: next.document,
        skillIds: next.skillIds,
        mcpCallNames: next.mcpCallNames,
      });
      return;
    }
    if (useEdit && !pendingAttachments.some((item) => item.kind === "image" && item.url)) {
      setError(tr("attachImageToEdit"));
      return;
    }
    if (busyRef.current && !options?.fromQueue) {
      if (queueRef.current.length >= MAX_QUEUE) {
        setError(tr("queueFull"));
        return;
      }
      setQueueState([
        ...queueRef.current,
        {
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: content,
          attachments: pendingAttachments.map((item) => ({ ...item })),
          search: Boolean(options?.search ?? webSearchOn) && webSearchAvailable,
          createImage: useCreate,
          editImage: useEdit,
          canvas: options?.canvas ?? canvasOn,
          document: options?.document ?? documentOn,
          skillIds: options?.skillIds ?? selectedSkillIds,
          mcpCallNames: options?.mcpCallNames ?? selectedMcpIds,
        },
      ]);
      setDraft("");
      setAttachments([]);
      setError("");
      return;
    }
    const editingArtifact = Boolean(canvasOpen && canvasFile);
    const requestedCanvas = Boolean(options?.canvas ?? canvasOn) || editingArtifact || Boolean(options?.artifactAction);
    const useCanvas = requestedCanvas && (isAdmin || features.toolCanvas);
    const useDocument = Boolean(options?.document ?? documentOn);
    const useSearch = Boolean(options?.search ?? webSearchOn) && webSearchAvailable;
    const needsAsk = toolPermission === "ask" && (useSearch || codeInterpreterOn) && !options?.confirmed;
    const needsSearchConfirm =
      toolPermission !== "full" && toolPermission !== "ask" && useSearch && webSearchConfirm && !options?.confirmed;
    if (!options?.fromQueue && (needsAsk || needsSearchConfirm)) {
      setPendingSearch(content || " ");
      return;
    }
    if (!model) {
      setError(tr("noModelsEnabled"));
      return;
    }
    const gen = ++sendGenRef.current;
    skipQueueRef.current = false;
    busyRef.current = true;
    localStreamRef.current = true;
    setBusy(true);
    let id = conversationIdRef.current;
    if (!id) {
      try {
        const created = await api.send("/api/conversations", "POST", {
          modelId: model.id,
          folderId: temporaryRef.current ? null : pendingFolderId,
          temporary: temporaryRef.current,
        });
        if (gen !== sendGenRef.current) return;
        id = created.conversation.id as string;
        if (temporaryRef.current) temporaryChatIdRef.current = id;
        conversationIdRef.current = id;
        createdIdRef.current = id;
        skipLoadRef.current = true;
        navigate(`/chat/${id}`, { replace: true });
      } catch (err) {
        if (gen === sendGenRef.current) {
          busyRef.current = false;
          localStreamRef.current = false;
          setBusy(false);
          setError(err instanceof Error ? err.message : tr("requestFailed"));
        }
        return;
      }
    }
    const imageItems = pendingAttachments.filter((item) => item.kind === "image" && item.url);
    const fileNote = pendingAttachments
      .filter((item) => item.kind !== "image")
      .map((item) => item.name)
      .join(", ");
    const displayed = [content, fileNote ? `Attached: ${fileNote}` : ""].filter(Boolean).join("\n\n");
    if (!options?.fromQueue) {
      setDraft("");
      setAttachments([]);
    }
    setError("");
    preserveEdit.current = options?.artifactAction === "explain";
    if (useCanvas && canvasOpen && !preserveEdit.current) {
      sentRef.current = draftRef.current;
      canvasFollow.current = true;
    }
    const sentAt = Date.now();
    const userMsg: UiMessage = {
      id: `u-${sentAt}`,
      role: "user",
      content: displayed,
      images: imageItems.map((item) => ({ url: item.url!, name: item.name })),
      createdAt: sentAt,
    };
    const asst: UiMessage = {
      id: `a-${sentAt}`,
      role: "assistant",
      createdAt: sentAt,
      content: "",
      thinking: "",
      streaming: true,
      canvas: useCanvas,
      wait: useCreate || useEdit ? "image" : useSearch ? "searching" : "loading",
    };
    setMessages((prev) => [...prev, userMsg, asst]);
    const controller = new AbortController();
    let serverMessageId = asst.id;
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          message: content,
          modelId: model.id,
          thinking: { enabled: thinking && model.capabilities.thinking, level: thinkingLevel },
          webSearch: useSearch,
          codeInterpreter: codeInterpreterOn,
          createImage: useCreate,
          editImage: useEdit,
          canvas: useCanvas,
          document: useDocument,
          canvasTitle: useCanvas && canvasOpen ? canvasFile?.title : undefined,
          canvasHtml: useCanvas && canvasOpen && canvasFile?.type === "html" ? draftRef.current : undefined,
          artifactId: useCanvas && canvasOpen ? artifactIdRef.current || undefined : undefined,
          artifactType: useCanvas && canvasOpen ? canvasFile?.type : undefined,
          artifactLanguage: useCanvas && canvasOpen ? canvasFile?.language : undefined,
          artifactContent: useCanvas && canvasOpen ? draftRef.current : undefined,
          artifactAction: options?.artifactAction,
          skillIds: options?.skillIds ?? selectedSkillIds,
          mcpCallNames: options?.mcpCallNames ?? selectedMcpIds,
          attachments: pendingAttachments.map((item) => ({
            name: item.name,
            text: item.text,
            mime: item.mime,
            url: item.url,
            kind: item.kind,
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        const mapped =
          payload.code === "TOKEN_LIMIT_DAY" ? tr("tokenLimitDay") : payload.code === "TOKEN_LIMIT_WEEK" ? tr("tokenLimitWeek") : payload.error;
        throw new Error(mapped || tr("requestFailed"));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let eventName = "message";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const block of parts) {
          let ev = eventName;
          let data = "";
          for (const raw of block.split("\n")) {
            const line = raw.replace(/\r$/, "");
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          eventName = "message";
          if (!data) continue;
          const json = JSON.parse(data) as {
            delta?: string;
            reset?: boolean;
            message?: string;
            title?: string;
            stage?: "loading" | "prompt" | "searching" | "thinking" | "running" | "memory" | "memorySearch" | "fetch" | "image" | "compacting" | "mcp";
            usage?: UiMessage["usage"];
            sources?: WebSearchSource[];
            activities?: ChatActivity[];
            memories?: UiMessage["memoriesUsed"];
            memoryUsed?: boolean;
            memoryIds?: string[];
            saved?: string[];
            assistantId?: string;
            messageId?: string;
            artifact?: SavedArtifact & { conversationId?: string; createdAt?: number; updatedAt?: number; version?: number };
          };
          const targetId = json.assistantId || json.messageId || asst.id;
          const touch = (prev: UiMessage[], patch: Partial<UiMessage>) =>
            prev.map((m) => (m.id === targetId || m.id === asst.id ? { ...m, ...patch } : m));
          if (ev === "status" && json.stage) {
            setMessages((prev) => touch(prev, { wait: json.stage, streaming: true }));
          } else if (ev === "sources" && json.sources) {
            setMessages((prev) => touch(prev, { sources: json.sources }));
          } else if (ev === "activity" && json.activities) {
            setMessages((prev) => touch(prev, { activities: json.activities }));
          } else if (ev === "memoryUsed") {
            setMessages((prev) => attachMemoryUsed(prev, targetId, json));
          } else if (ev === "thinking") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId || m.id === asst.id ? { ...m, thinking: (m.thinking || "") + (json.delta || "") } : m,
              ),
            );
          } else if (ev === "content") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId || m.id === asst.id
                  ? { ...m, content: json.reset ? json.delta || "" : m.content + (json.delta || ""), streaming: true }
                  : m,
              ),
            );
          } else if (ev === "error") {
            setError(json.message || tr("generateError"));
          } else if (ev === "artifact" && json.artifact) {
            const row = json.artifact;
            artifactIdRef.current = row.id;
            setArtifactId(row.id);
            if (row.messageId) savedArtifacts.current[row.messageId] = row;
            if (keepManualEdit(draftRef.current, sentRef.current)) {
              setSaveState("unsaved");
              void api
                .send(`/api/artifacts/${row.id}`, "PATCH", {
                  title: canvasFile?.title,
                  type: canvasFile?.type,
                  language: canvasFile?.language,
                  content: draftRef.current,
                })
                .then(() => setSaveState("saved"))
                .catch(() => setSaveState("error"));
            } else {
              const next = { title: row.title, type: row.type, language: row.language, content: row.content };
              draftRef.current = next.content;
              sentRef.current = next.content;
              setCanvasFile(next);
              setSaveState("saved");
              if (canvasDismissed.current !== row.messageId) setCanvasOpen(true);
            }
            void api.get(`/api/artifacts/${row.id}/versions`).then((data) => setArtifactHistory(data.versions ?? [])).catch(() => undefined);
          } else if (ev === "title") {
            await refreshChats();
          } else if (ev === "done") {
            const nextId = json.messageId || targetId;
            serverMessageId = nextId;
            setMessages((prev) =>
              attachMemoryUsed(prev, targetId, json).map((m) =>
                m.id === targetId || m.id === asst.id ? { ...m, id: nextId, streaming: false, usage: json.usage || m.usage } : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : tr("reachModelError"));
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) => (m.streaming && (m.id === asst.id || m.id === serverMessageId) ? { ...m, id: serverMessageId, streaming: false } : m)),
      );
      if (abortRef.current === controller) abortRef.current = null;
      refreshChats().catch(() => undefined);
      refreshLoaded().catch(() => undefined);
      if (gen !== sendGenRef.current) return;
      busyRef.current = false;
      localStreamRef.current = false;
      setBusy(false);
      if (skipQueueRef.current) {
        skipQueueRef.current = false;
        return;
      }
      const next = queueRef.current[0];
      if (!next) return;
      setQueueState(queueRef.current.slice(1));
      void send(next.text, {
        search: next.search,
        attachments: next.attachments,
        fromQueue: true,
        createImage: next.createImage,
        editImage: next.editImage,
        canvas: next.canvas,
        document: next.document,
        skillIds: next.skillIds,
        mcpCallNames: next.mcpCallNames,
      });
    }
  }

  function editQueued(id: string, text: string) {
    setQueueState(queueRef.current.map((item) => (item.id === id ? { ...item, text } : item)));
  }

  async function sendQueuedNow(id: string) {
    const item = queueRef.current.find((queued) => queued.id === id);
    if (!item) return;
    setQueueState(queueRef.current.filter((queued) => queued.id !== id));
    if (busyRef.current) await stop();
    await send(item.text, {
      search: item.search,
      attachments: item.attachments,
      fromQueue: true,
      createImage: item.createImage,
      editImage: item.editImage,
      canvas: item.canvas,
      document: item.document,
      skillIds: item.skillIds,
      mcpCallNames: item.mcpCallNames,
    });
  }

  function scheduleSave(content: string) {
    draftRef.current = content;
    setCanvasFile((current) => (current ? { ...current, content } : current));
    setSaveState("unsaved");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const id = artifactIdRef.current;
      const current = canvasFile;
      if (!id || !current) return;
      setSaveState("saving");
      void api
        .send(`/api/artifacts/${id}`, "PATCH", { title: current.title, type: current.type, language: current.language, content: draftRef.current })
        .then(async () => {
          setSaveState("saved");
          const data = await api.get(`/api/artifacts/${id}/versions`);
          setArtifactHistory(data.versions ?? []);
        })
        .catch(() => setSaveState("error"));
    }, 700);
  }

  async function renameOpenArtifact(title: string) {
    setCanvasFile((current) => (current ? { ...current, title } : current));
    const id = artifactIdRef.current;
    if (!id) return;
    await api.send(`/api/artifacts/${id}`, "PATCH", { title }).catch(() => setSaveState("error"));
  }

  async function restoreOpenArtifact(version: number) {
    const id = artifactIdRef.current;
    const local = artifactHistory.find((row) => row.version === version);
    if (!id) {
      if (!local) return;
      draftRef.current = local.content;
      sentRef.current = local.content;
      setCanvasFile((current) => (current ? { ...current, content: local.content } : current));
      return;
    }
    const data = await api.send(`/api/artifacts/${id}/restore`, "POST", { version });
    const next = data.artifact as SavedArtifact;
    draftRef.current = next.content;
    sentRef.current = next.content;
    setCanvasFile({ title: next.title, type: next.type, language: next.language, content: next.content });
    const versions = await api.get(`/api/artifacts/${id}/versions`);
    setArtifactHistory(versions.versions ?? []);
    setSaveState("saved");
  }

  async function deleteOpenArtifact() {
    const id = artifactIdRef.current;
    if (id) await api.send(`/api/artifacts/${id}`, "DELETE").catch(() => undefined);
    artifactIdRef.current = null;
    setArtifactId(null);
    setCanvasFile(null);
    setCanvasOpen(false);
    setArtifactHistory([]);
  }

  function askArtifact(action: ArtifactAction) {
    const text: Record<ArtifactAction, string> = {
      fix: "Fix this artifact.",
      improve: "Improve this artifact.",
      refactor: "Refactor this artifact.",
      explain: "Explain this artifact.",
      responsive: "Make this responsive.",
      feature: "Add a feature to this artifact.",
      convert: "Convert this artifact.",
      optimize: "Optimize this artifact.",
      regenerate: "Regenerate this artifact.",
    };
    void send(text[action], { canvas: true, artifactAction: action });
  }

  async function createBlankArtifact() {
    if (!(isAdmin || features.toolCanvas)) return;
    if (!model) {
      setError(tr("noModelsEnabled"));
      return;
    }
    let id = conversationIdRef.current;
    if (!id) {
      const created = await api.send("/api/conversations", "POST", { modelId: model.id, temporary: temporaryRef.current });
      id = created.conversation.id as string;
      conversationIdRef.current = id;
      createdIdRef.current = id;
      skipLoadRef.current = true;
      navigate(`/chat/${id}`, { replace: true });
    }
    const data = await api.send("/api/artifacts", "POST", {
      conversationId: id,
      title: "Untitled",
      type: "text",
      language: "txt",
      content: "",
    });
    const next = data.artifact as SavedArtifact;
    artifactIdRef.current = next.id;
    setArtifactId(next.id);
    draftRef.current = next.content;
    sentRef.current = next.content;
    setCanvasFile({ title: next.title, type: next.type, language: next.language, content: next.content });
    setCanvasOpen(true);
    setCanvasOn(true);
    setSaveState("saved");
  }

  async function stop() {
    skipQueueRef.current = true;
    sendGenRef.current += 1;
    abortRef.current?.abort();
    busyRef.current = false;
    localStreamRef.current = false;
    setBusy(false);
    const id = conversationIdRef.current;
    if (id) {
      await api.send("/api/chat/stop", "POST", { conversationId: id }).catch(() => undefined);
    }
  }

  const contextUsage = (() => {
    const usage = [...messages].reverse().find((message) => message.role === "assistant" && message.usage)?.usage;
    const output = usage?.outputTokens || 0;
    const split = usage?.context;
    const parts = split
      ? { ...split, conversation: split.conversation + output }
      : { system: 0, skills: 0, tools: 0, conversation: (usage?.inputTokens || 0) + output };
    return {
      promptTokens: (usage?.inputTokens || 0) + output,
      parts,
      numCtx,
      loadedContext: loadedContexts[modelId] || model?.contextLength || 0,
    };
  })();
  const empty = messages.filter((m) => m.role !== "system").length === 0;
  const shownName = (() => {
    const name = (displayName || username).trim();
    if (!name) return username;
    return name.charAt(0).toUpperCase() + name.slice(1);
  })();
  const greeting = tr(greetingPeriod(new Date().getHours()), { name: shownName });

  function emptyIntro() {
    return (
      <>
        <img src={branding.logoUrl || DEFAULT_LOGO} alt="" className="mb-3 h-8 w-8 rounded-md object-contain" />
        <h1 className="text-[22px] font-medium tracking-tight">{greeting}</h1>
        {pendingFolderId ? (
          <p className="mt-2 text-[14px] text-[var(--secondary)]">
            {tr("folderInstructions", { name: folders.find((folder) => folder.id === pendingFolderId)?.name || tr("folders") })}
          </p>
        ) : null}
        {temporary ? <p className="mt-2 text-[14px] text-[var(--secondary)]">{tr("temporaryChatHint")}</p> : null}
      </>
    );
  }

  function composerDock() {
    return (
      <>
        {error ? <p className="mb-2 text-[13px] text-[var(--danger)]">{error}</p> : null}
        <MessageQueue
          items={queue}
          max={MAX_QUEUE}
          onEdit={editQueued}
          onRemove={(id) => setQueueState(queueRef.current.filter((queued) => queued.id !== id))}
          onSendNow={(id) => void sendQueuedNow(id)}
        />
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={() => void stop()}
          busy={busy}
          queueFull={queue.length >= MAX_QUEUE}
          queueCount={queue.length}
          model={model}
          thinking={thinking}
          thinkingLevel={thinkingLevel}
          onThinking={(on, level) => {
            setThinking(on);
            setThinkingLevel(level);
          }}
          webSearchAvailable={webSearchAvailable}
          webSearchEnabled={isAdmin || features.toolWebSearch}
          webSearch={webSearchOn}
          onWebSearch={setWebSearchOn}
          imageGenerationAvailable={features.imageGenerationEnabled}
          createImage={createImageOn}
          onCreateImage={setCreateImageOn}
          imageEditAvailable={features.imageEditEnabled}
          editImage={editImageOn}
          onEditImage={setEditImageOn}
          codeInterpreter={codeInterpreterOn}
          codeInterpreterAvailable={isAdmin || features.toolCode}
          onCodeInterpreter={setCodeInterpreterOn}
          canvas={canvasOn}
          canvasAvailable={isAdmin || features.toolCanvas}
          webpageAvailable={isAdmin || features.toolWebpage}
          onCanvas={setCanvasOn}
          document={documentOn}
          onDocument={setDocumentOn}
          skills={skills}
          selectedSkillIds={selectedSkillIds}
          onToggleSkill={(id) =>
            setSelectedSkillIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
          }
          mcpTools={mcpTools}
          selectedMcpIds={selectedMcpIds}
          onToggleMcp={(callName) =>
            setSelectedMcpIds((current) => (current.includes(callName) ? current.filter((item) => item !== callName) : [...current, callName].slice(0, 12)))
          }
          onRefreshMcp={refreshMcpTools}
          toolPermissionsEnabled={features.toolPermissionsEnabled}
          toolPermission={features.toolPermissionsEnabled ? toolPermission : null}
          onToolPermission={setToolPermission}
          attachments={attachments}
          onAttachments={setAttachments}
          dropZoneRef={chatPaneRef}
          context={contextUsage}
        />
      </>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[var(--bg)] pt-[var(--safe-top)] md:pt-0">
      <Sidebar
        open={sidebarOpen}
        chats={chats}
        folders={folders}
        foldersEnabled={features.foldersEnabled}
        sharingEnabled={features.sharingEnabled}
        activeId={conversationId}
        branding={branding.name}
        logoUrl={branding.logoUrl}
        username={username}
        onNew={() => newChat(null)}
        onNewInFolder={(folderId) => newChat(folderId)}
        onOpen={(id) => {
          navigate(`/chat/${id}`);
          setSidebarOpen(false);
          setChats((current) => current.map((chat) => (chat.id === id ? { ...chat, unread: false } : chat)));
          void api.send(`/api/conversations/${id}`, "PATCH", { unread: false });
        }}
        onDelete={(id) => {
          void api.send(`/api/conversations/${id}`, "DELETE").then(refreshChats);
          if (conversationId === id) navigate("/chat");
        }}
        onSearch={() => setPalette(true)}
        onSkills={() => {
          setSidebarOpen(false);
          navigate("/skills");
        }}
        onSettings={() => {
          setSettingsTab("general");
          setSettingsOpen(true);
        }}
        onCloseMobile={() => setSidebarOpen(false)}
        openNewFolder={openNewFolder}
        onNewFolderOpened={() => setOpenNewFolder(false)}
        onCreateFolder={async (patch) => {
          const data = await api.send("/api/folders", "POST", {
            name: patch.name || tr("newFolder"),
            icon: patch.icon,
            iconColor: patch.iconColor,
            systemPrompt: patch.systemPrompt,
          });
          setFolders((current) => [...current, data.folder]);
          return data.folder as ChatFolder;
        }}
        onUpdateFolder={async (id, patch) => {
          const data = await api.send(`/api/folders/${id}`, "PATCH", patch);
          setFolders((current) => current.map((folder) => (folder.id === id ? data.folder : folder)));
        }}
        onDeleteFolder={async (id) => {
          await api.send(`/api/folders/${id}`, "DELETE");
          setFolders((current) => current.filter((folder) => folder.id !== id));
          setChats((current) => current.map((chat) => (chat.folderId === id ? { ...chat, folderId: null } : chat)));
          if (pendingFolderId === id) setPendingFolderId(null);
        }}
        onMoveChat={(chatId, folderId) => {
          setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, folderId } : chat)));
          void api.send(`/api/conversations/${chatId}`, "PATCH", { folderId }).then(refreshChats);
        }}
        onRenameChat={(chatId, title) => {
          setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, title } : chat)));
          void api.send(`/api/conversations/${chatId}`, "PATCH", { title });
        }}
        onPinChat={(chatId, pinned) => {
          setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, pinned } : chat)));
          void api.send(`/api/conversations/${chatId}`, "PATCH", { pinned }).then(refreshChats);
        }}
        onUnreadChat={(chatId, unread) => {
          setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, unread } : chat)));
          void api.send(`/api/conversations/${chatId}`, "PATCH", { unread });
        }}
        onArchiveChat={(chatId, archived) => {
          setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, archived } : chat)));
          void api.send(`/api/conversations/${chatId}`, "PATCH", { archived });
          if (archived && conversationId === chatId) navigate("/chat");
        }}
        onCloneChat={(chatId) => {
          void api.send(`/api/conversations/${chatId}/clone`, "POST").then((data) => {
            void refreshChats();
            if (data.conversation?.id) navigate(`/chat/${data.conversation.id}`);
          });
        }}
        onShareChat={(chatId) => {
          const base = (features.webUiUrl || window.location.origin).replace(/\/$/, "");
          void navigator.clipboard.writeText(`${base}/chat/${chatId}`).then(() => {
            setToast(tr("linkCopied"));
            setTimeout(() => setToast(""), 1200);
          });
        }}
        onDownloadChat={(chatId) => {
          void api.get(`/api/conversations/${chatId}`).then((data) => {
            const lines = [`# ${data.conversation.title}`, ""];
            for (const message of data.conversation.messages ?? []) {
              if (message.role === "system") continue;
              lines.push(`## ${message.role === "user" ? tr("you") : tr("assistant")}`, "", message.content, "");
            }
            const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${String(data.conversation.title || "chat").replace(/[\\/:*?"<>|]+/g, "-")}.md`;
            link.click();
            URL.revokeObjectURL(url);
          });
        }}
      />
      <div ref={chatPaneRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-20 flex shrink-0 items-center gap-3 bg-[var(--bg)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <button className="rounded-lg p-2 hover:bg-[var(--hover)] md:hidden" onClick={() => setSidebarOpen(true)} aria-label={tr("openSidebar")}>
              <Menu size={18} />
            </button>
            {skillsOpen ? null : <ModelSelector models={models} categories={categories} value={model?.id} onChange={setModelId} loadedIds={loadedIds} />}
          </div>
          {skillsOpen ? null : (
            <button
              type="button"
              className={`ml-auto rounded-lg p-2 hover:bg-[var(--hover)] ${temporary ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--secondary)]"}`}
              aria-label={tr(temporary ? "temporaryChatOn" : "temporaryChat")}
              aria-pressed={temporary}
              title={tr(temporary ? "temporaryChatOn" : "temporaryChat")}
              onClick={toggleTemporary}
            >
              <TemporaryChatIcon />
            </button>
          )}
        </header>
        {skillsOpen ? (
          <SkillsPage
            skills={skills}
            username={username}
            onChange={(next) => {
              setSkills(next);
              setSelectedSkillIds((current) => current.filter((id) => next.some((skill) => skill.id === id)));
            }}
            onDefault={(skill) => {
              setSelectedSkillIds((current) =>
                skill.defaultOn ? (current.includes(skill.id) ? current : [...current, skill.id]) : current.filter((id) => id !== skill.id),
              );
            }}
          />
        ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${canvasOpen ? artifactChatClass : ""}`}>
        {empty ? (
          phoneLayout ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-6">
                <div className="chat-shell w-full">{emptyIntro()}</div>
              </div>
              <div className="chat-shell w-full shrink-0 px-4">{composerDock()}</div>
            </>
          ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
            <div className="min-h-0 flex-1" />
            <div className="chat-shell w-full">
              {emptyIntro()}
              <div className="mt-4">{composerDock()}</div>
            </div>
            <div className="min-h-0 flex-1" />
          </div>
          )
        ) : (
          <>
        <div
          ref={scroller}
          className="chat-scroll min-h-0 min-w-0 w-full flex-1 touch-pan-y overflow-x-clip overflow-y-auto"
          onPointerDown={holdPointer}
          onPointerUp={releasePointer}
          onTouchStart={markHold}
          onTouchEnd={endHold}
          onTouchCancel={endHold}
          onWheel={(e) => {
            if (e.deltaY < 0) stick.current = false;
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (userHold.current) {
              if (el.scrollTop < holdScrollTop.current - 2) stick.current = false;
              return;
            }
            if (!scrollLock.current) noteStick(el);
          }}
        >
          <div className="chat-shell flex min-h-full flex-col px-4">
            <MessageList
              messages={messages}
              assistantName={model?.displayName || branding.name}
              assistantIcon={model?.iconUrl}
              showUsage={showUsage}
              onCopy={async (text) => {
                await navigator.clipboard.writeText(text);
                setToast(tr("copied"));
                setTimeout(() => setToast(""), 1200);
              }}
              onRegenerate={() => {
                const last = [...messages].reverse().find((m) => m.role === "user");
                if (last) void send(last.content);
              }}
              onOpenCanvas={(_doc, index) => showCanvasVersion(index)}
              onOpenArtifact={(file, messageId, index) => showArtifact(file, messageId, index)}
              onRate={(id, rating) => {
                const previous = messages.find((message) => message.id === id)?.rating || 0;
                setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, rating } : message)));
                void api.send(`/api/messages/${id}/feedback`, "POST", { rating }).catch(() => {
                  setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, rating: previous } : message)));
                });
              }}
            />
          </div>
        </div>
        <div className="chat-shell w-full shrink-0 px-4">{composerDock()}</div>
          </>
        )}
        </div>
        {canvasOpen && canvasFile ? (
          <CanvasPanel
            title={canvasFile.title}
            content={canvasFile.content}
            type={canvasFile.type}
            language={canvasFile.language}
            saveState={saveState}
            shareBase={features.webUiUrl}
            canShare={features.sharingEnabled}
            versionIndex={canvasVersion}
            versionCount={listCanvasVersions(messages).length}
            history={artifactHistory}
            onVersion={showCanvasVersion}
            onChange={scheduleSave}
            onRename={(title) => void renameOpenArtifact(title)}
            onRestore={(version) => void restoreOpenArtifact(version)}
            onDelete={() => void deleteOpenArtifact()}
            onAsk={askArtifact}
            onRegenerate={() => {
              const last = [...messages].reverse().find((item) => item.role === "user");
              if (last) void send(last.content, { canvas: true, artifactAction: "regenerate" });
            }}
            onNew={() => void createBlankArtifact()}
            onClose={() => {
              canvasDismissed.current = canvasMsgId.current;
              setCanvasOpen(false);
            }}
          />
        ) : null}
        </div>
        )}
      </div>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        items={[
          { id: "new", label: tr("newChat"), hint: "N", run: () => newChat(null) },
          ...(features.foldersEnabled
            ? [{ id: "folder", label: tr("newFolder"), run: () => setOpenNewFolder(true) }]
            : []),
          { id: "settings", label: tr("openSettings"), run: () => {
            setSettingsTab("general");
            setSettingsOpen(true);
          }},
          ...chats.map((c) => ({
            id: c.id,
            label: c.title,
            hint: tr("chatHint"),
            run: () => navigate(`/chat/${c.id}`),
          })),
        ]}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          void refreshModels();
          void refreshSettings();
          void refreshWebSearch();
        }}
        isAdmin={isAdmin}
        initialTab={settingsTab}
        onShowUsageChange={setShowUsage}
        onFeaturesChange={setFeatures}
        onProfileChange={(user) => {
          onUserUpdate?.(user);
        }}
        onBrandingChange={onBrandingChange}
      />
      {pendingSearch ? (
        <div className="motion-fade fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label={tr("cancelWebSearch")} onClick={() => setPendingSearch(null)} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-5 shadow-2xl">
            <h2 className="text-[16px] font-medium">{toolPermission === "ask" ? tr("allowTools") : tr("searchTheWeb")}</h2>
            <p className="mt-2 text-[13px] text-[var(--secondary)]">
              {toolPermission === "ask" ? tr("allowToolsBody") : tr("searchWebBody")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]" onClick={() => setPendingSearch(null)}>
                {tr("cancel")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-[13px] text-[var(--bg)]"
                onClick={() => {
                  const text = pendingSearch.trim();
                  setPendingSearch(null);
                  void send(text, { confirmed: true });
                }}
              >
                {toolPermission === "ask" ? tr("allow") : tr("searchAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--elevated)] px-3 py-1.5 text-[12px] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
