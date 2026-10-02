import { useEffect, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { DEFAULT_APP_GENERAL, EMPTY_GENERATION, type AppFeatures, type GenerationSettings, type PublicBranding } from "@wlfv/shared";
import { AdminGeneralPanel } from "@/components/settings/AdminGeneralPanel";
import { BrandingPanel } from "@/components/settings/BrandingPanel";
import { InterfacePanel } from "@/components/settings/InterfacePanel";
import { DatabasePanel } from "@/components/settings/DatabasePanel";
import { api } from "@/lib/api";
import { ModelsPanel } from "@/components/models/ModelsPanel";
import { AccountPanel } from "@/components/settings/AccountPanel";
import { ConnectionsPanel } from "@/components/settings/ConnectionsPanel";
import { AuthPanel } from "@/components/settings/AuthPanel";
import { UsersPanel } from "@/components/settings/UsersPanel";
import { WebSearchPanel } from "@/components/settings/WebSearchPanel";
import { ImagesPanel } from "@/components/settings/ImagesPanel";
import { GeneralPanel } from "@/components/settings/GeneralPanel";
import { MemoryPanel } from "@/components/settings/MemoryPanel";
import { UsagePanel } from "@/components/settings/UsagePanel";
import { applyMotion, applyTheme, applyTextSize, t, type UiLang } from "@/lib/i18n";
import { useLang } from "@/lib/language";
import { isPhoneViewport, PHONE_QUERY } from "@/lib/layout";

type Tab = "general" | "usage" | "memory" | "account" | "admin-general" | "branding" | "interface" | "authentication" | "connections" | "users" | "web-search" | "images" | "database" | "admin";

const SETTING_TERMS: Record<Tab, Parameters<typeof t>[1][]> = {
  general: ["theme", "dark", "light", "oled", "system", "language", "english", "dutch", "textSize", "showUsage", "showUsageHint", "loadToolsWhenNeeded", "animations", "systemPrompt", "advanced", "modelParameters"],
  usage: ["tokensLast24h", "tokensLast7d", "lifetimeTokens", "peakTokens", "topModels", "mostUsedTools", "planFree", "planPro"],
  memory: ["memoryEnabled", "addMemory", "importList", "exportList", "clearAll", "memoryPath"],
  account: ["accountName", "accountCallName", "accountWork", "accountUsername", "accountBio", "accountGender", "accountBirthday", "accountEmail", "changePassword", "currentPassword", "newPassword", "signOut"],
  "admin-general": ["responseWatermark", "webUiUrl", "sharing", "folders", "memories", "userTools", "canvas", "codeInterpreter", "attachWebpage", "maxFolderCount", "tokenLimits", "freeDayTokens", "proDayTokens"],
  branding: ["websiteName", "description", "accentColor", "customTheme", "themeBg", "themeAccent", "footer", "logo", "favicon", "splashImage"],
  interface: ["tasks", "localTaskModel", "externalTaskModel", "toolPermissions", "titleGeneration"],
  authentication: ["defaultRole", "newSignups", "adminContactEmail", "pendingOverlayTitle", "rolePending", "roleUser", "roleAdmin"],
  connections: ["connections", "engineOpenAI"],
  users: ["users", "searchUsers", "addUser", "planUsage", "resetUsage"],
  "web-search": ["webSearchTitle", "webSearchConfirm", "webSearchEngine"],
  images: ["imagesTitle", "imageGeneration", "createImage", "editImage", "imageModel", "imageApiKey", "engineComfyUi", "engineGemini"],
  database: ["importConfig", "exportConfig", "databaseFile", "allChats"],
  admin: ["models", "modelCategories", "defaultTools", "thinking", "searchModels"],
};

function MobileChevron() {
  return (
    <span
      aria-hidden
      className="ml-auto h-[8px] w-[8px] shrink-0 rotate-45 border-r-[1.5px] border-t-[1.5px] border-[var(--muted)] opacity-80 md:hidden"
    />
  );
}

export function SettingsDialog({
  open,
  onClose,
  isAdmin,
  initialTab = "general",
  onShowUsageChange,
  onProfileChange,
  onFeaturesChange,
  onBrandingChange,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  initialTab?: Tab;
  onShowUsageChange?: (value: boolean) => void;
  onProfileChange?: (user: { username: string; email: string; displayName?: string }) => void;
  onFeaturesChange?: (features: AppFeatures) => void;
  onBrandingChange?: (branding: PublicBranding) => void;
}) {
  const { setLang } = useLang();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [mobileSection, setMobileSection] = useState<Tab | null>(null);
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState<UiLang>("en");
  const [textSize, setTextSize] = useState(100);
  const [showUsage, setShowUsage] = useState(true);
  const [loadToolsWhenNeeded, setLoadToolsWhenNeeded] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [generation, setGeneration] = useState<GenerationSettings>({ ...EMPTY_GENERATION, values: {}, custom: [] });
  const [accountId, setAccountId] = useState("");
  const [ollama, setOllama] = useState<{ connected: boolean; version: string | null; models: number } | null>(null);
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
  });

  const generalNav: { id: Tab; label: string; badge?: string }[] = [
    { id: "general", label: t(language, "general") },
    { id: "usage", label: t(language, "usage") },
    ...(features.memoriesEnabled
      ? [{ id: "memory" as Tab, label: t(language, "memory"), badge: t(language, "experimental") }]
      : []),
    { id: "account", label: t(language, "account") },
  ];
  const adminNav: { id: Tab; label: string }[] = isAdmin
    ? [
        { id: "admin-general", label: t(language, "adminGeneral") },
        { id: "interface", label: t(language, "interfaceNav") },
        { id: "branding", label: t(language, "brandingNav") },
        { id: "connections", label: t(language, "connections") },
        { id: "admin", label: t(language, "modelsNav") },
        { id: "web-search", label: t(language, "webSearch") },
        { id: "images", label: t(language, "imagesNav") },
        { id: "authentication", label: t(language, "authentication") },
        { id: "users", label: t(language, "users") },
        { id: "database", label: t(language, "databaseNav") },
      ]
    : [];

  const q = query.trim().toLowerCase();
  function matches(item: { id: Tab; label: string }) {
    if (!q) return true;
    const extra = SETTING_TERMS[item.id].map((key) => t(language, key)).join(" ");
    return `${item.label} ${extra}`.toLowerCase().includes(q);
  }
  const visibleGeneral = generalNav.filter(matches);
  const visibleAdmin = adminNav.filter(matches);

  useEffect(() => {
    if (!open || !q || isPhoneViewport()) return;
    const visible = [...visibleGeneral, ...visibleAdmin];
    if (visible.length && !visible.some((item) => item.id === tab)) setTab(visible[0].id);
  }, [open, q, tab, language, isAdmin, features.memoriesEnabled]);

  useEffect(() => {
    if (!open) return;
    setGeneration((prev) => ({ ...prev, show: false }));
    setTab(
      !isAdmin &&
        (initialTab === "admin" ||
          initialTab === "users" ||
          initialTab === "web-search" ||
          initialTab === "images" ||
          initialTab === "database" ||
          initialTab === "admin-general" ||
          initialTab === "branding" ||
          initialTab === "interface" ||
          initialTab === "authentication" ||
          initialTab === "connections")
        ? "general"
        : initialTab,
    );
    setMobileSection(null);
    setQuery("");
    api.get("/api/settings").then((d) => {
      setTheme(d.theme);
      setLanguage(d.language === "nl" ? "nl" : "en");
      setLang(d.language === "nl" ? "nl" : "en");
      setShowUsage(d.showUsage !== false);
      setLoadToolsWhenNeeded(d.loadToolsWhenNeeded === true);
      setAnimations(d.animations !== false);
      applyMotion(d.animations !== false);
      if (typeof d.textSize === "number") {
        setTextSize(d.textSize);
        applyTextSize(d.textSize);
      }
      setSystemPrompt(d.systemPrompt || "");
      setGeneration({ ...(d.generation || { values: {}, custom: [] }), show: false });
      if (d.features) {
        setFeatures(d.features);
        onFeaturesChange?.(d.features);
      }
      applyTheme(d.theme || "dark");
    }).catch(() => undefined);
    api.get("/api/account").then((d) => setAccountId(d.user.id)).catch(() => undefined);
  }, [open, initialTab, isAdmin]);

  useEffect(() => {
    if (!open || !isAdmin || tab !== "admin") return;
    api.get("/api/admin/ollama").then(setOllama).catch(() => setOllama({ connected: false, version: null, models: 0 }));
  }, [open, isAdmin, tab]);

  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const onChange = () => {
      if (!media.matches) setMobileSection(null);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (mobileSection) setMobileSection(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, mobileSection]);

  function openItem(id: Tab) {
    setTab(id);
    if (isPhoneViewport()) setMobileSection(id);
  }

  const pageTitle =
    [...generalNav, ...adminNav].find((item) => item.id === (mobileSection || tab))?.label || t(language, "settings");

  const panel = (
    <>
      {tab === "general" ? (
        <GeneralPanel
          theme={theme}
          language={language}
          textSize={textSize}
          showUsage={showUsage}
          loadToolsWhenNeeded={loadToolsWhenNeeded}
          animations={animations}
          systemPrompt={systemPrompt}
          generation={generation}
          onTheme={setTheme}
          onLanguage={(next) => {
            setLanguage(next);
            setLang(next);
          }}
          onTextSize={(value) => {
            setTextSize(value);
            applyTextSize(value);
          }}
          onShowUsage={(value) => {
            setShowUsage(value);
            onShowUsageChange?.(value);
          }}
          onLoadToolsWhenNeeded={setLoadToolsWhenNeeded}
          onAnimations={setAnimations}
          onSystemPrompt={setSystemPrompt}
          onGeneration={setGeneration}
        />
      ) : null}
      {tab === "usage" ? <UsagePanel language={language} /> : null}
      {tab === "memory" && features.memoriesEnabled ? <MemoryPanel language={language} /> : null}
      {tab === "account" ? <AccountPanel language={language} onProfileChange={onProfileChange} /> : null}
      {tab === "admin-general" && isAdmin ? (
        <AdminGeneralPanel
          onChange={(config) => {
            const next = {
              ...features,
              sharingEnabled: config.sharingEnabled,
              foldersEnabled: config.foldersEnabled,
              maxFolderCount: config.maxFolderCount,
              memoriesEnabled: config.memoriesEnabled,
              webUiUrl: config.webUiUrl,
              toolWebSearch: config.toolWebSearch,
              toolCode: config.toolCode,
              toolCanvas: config.toolCanvas,
              toolWebpage: config.toolWebpage,
            };
            setFeatures(next);
            onFeaturesChange?.(next);
          }}
        />
      ) : null}
      {tab === "branding" && isAdmin ? <BrandingPanel onChange={onBrandingChange} /> : null}
      {tab === "interface" && isAdmin ? (
        <InterfacePanel
          onChange={(config) => {
            const next = { ...features, toolPermissionsEnabled: config.toolPermissionsEnabled };
            setFeatures(next);
            onFeaturesChange?.(next);
          }}
        />
      ) : null}
      {tab === "authentication" && isAdmin ? <AuthPanel /> : null}
      {isAdmin ? (
        <div className={tab === "connections" ? "block" : "hidden"}>
          <ConnectionsPanel />
        </div>
      ) : null}
      {tab === "users" && isAdmin ? <UsersPanel currentUserId={accountId} /> : null}
      {tab === "web-search" && isAdmin ? <WebSearchPanel /> : null}
      {tab === "images" && isAdmin ? <ImagesPanel /> : null}
      {tab === "database" && isAdmin ? <DatabasePanel /> : null}
      {tab === "admin" && isAdmin ? (
        <div>
          {ollama ? (
            <p className="mb-4 text-[13px] text-[var(--secondary)]">
              Ollama {ollama.connected ? `connected${ollama.version ? ` · ${ollama.version}` : ""} · ${ollama.models} installed` : "unreachable"}
            </p>
          ) : null}
          <ModelsPanel />
        </div>
      ) : null}
    </>
  );

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4 lg:p-8">
          <motion.button
            type="button"
            aria-label="Close settings"
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.16 }}
            className="motion-static relative z-10 flex h-[100dvh] w-full max-w-none flex-col overflow-hidden border border-[var(--border)] bg-[var(--elevated)] shadow-2xl md:h-[min(720px,88dvh)] md:max-w-3xl md:rounded-2xl md:flex-row lg:max-w-4xl xl:max-w-5xl"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              (event.currentTarget as HTMLElement).dataset.swipeY = String(touch.clientY);
            }}
            onTouchEnd={(event) => {
              const start = Number((event.currentTarget as HTMLElement).dataset.swipeY || 0);
              const dy = event.changedTouches[0].clientY - start;
              if (start < 90 && dy > 80 && isPhoneViewport()) {
                if (mobileSection) setMobileSection(null);
                else onClose();
              }
            }}
          >
            <aside
              className={`${mobileSection ? "hidden md:flex" : "flex"} min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--bg)] pt-[var(--safe-top)] md:w-52 md:flex-none md:border-r md:border-[var(--border)] md:p-3 md:pt-3 lg:w-56`}
            >
              <div className="flex items-center justify-between px-4 pb-2 pt-2 md:hidden">
                <h2 id="settings-title-mobile" className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
                  {t(language, "settings")}
                </h2>
                <button
                  type="button"
                  className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <p id="settings-title" className="hidden px-3 pb-3 pt-1 text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--muted)] md:block">
                {t(language, "settings")}
              </p>
              <div className="px-4 pb-2 md:px-0">
                <label className="relative block">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t(language, "searchSettings")}
                    aria-label={t(language, "searchSettings")}
                    className="h-10 w-full rounded-lg bg-[var(--surface)] pl-8 pr-2 text-[14px] text-[var(--text)] outline-none md:h-9 md:text-[13px]"
                  />
                </label>
              </div>
              {visibleGeneral.length ? (
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)] md:px-3 md:pb-1.5 md:pt-2">
                {t(language, "settingsGeneral")}
              </p>
              ) : null}
              <div className="flex flex-col gap-1 px-3 pb-2 md:px-0">
                {visibleGeneral.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openItem(item.id)}
                    className={`flex min-h-[52px] w-full items-center rounded-xl px-4 py-3 text-left text-[17px] md:min-h-0 md:rounded-lg md:px-3 md:py-2 md:text-[13px] ${
                      tab === item.id
                        ? "bg-[var(--hover)] text-[var(--text)]"
                        : "text-[var(--text)] hover:bg-[var(--hover)] md:text-[var(--secondary)] md:hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 pr-3">
                      {item.label}
                      {item.badge ? (
                        <span className="ml-1.5 align-middle text-[11px] font-normal text-[var(--muted)] md:text-[10px]">{item.badge}</span>
                      ) : null}
                    </span>
                    <MobileChevron />
                  </button>
                ))}
              </div>
              {visibleAdmin.length ? (
                <>
                  <p className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)] md:px-3 md:pb-1.5">
                    {t(language, "settingsAdmin")}
                  </p>
                  <div className="flex flex-col gap-1 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-0 md:pb-0">
                    {visibleAdmin.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openItem(item.id)}
                        className={`flex min-h-[52px] w-full items-center rounded-xl px-4 py-3 text-left text-[17px] md:min-h-0 md:rounded-lg md:px-3 md:py-2 md:text-[13px] ${
                          tab === item.id
                            ? "bg-[var(--hover)] text-[var(--text)]"
                            : "text-[var(--text)] hover:bg-[var(--hover)] md:text-[var(--secondary)] md:hover:text-[var(--text)]"
                        }`}
                      >
                        <span className="min-w-0 flex-1 pr-3">{item.label}</span>
                        <MobileChevron />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {q && !visibleGeneral.length && !visibleAdmin.length ? (
                <p className="px-4 py-3 text-[13px] text-[var(--muted)] md:px-3">{t(language, "noSettingsFound")}</p>
              ) : null}
            </aside>
            <section
              className={`${mobileSection ? "flex" : "hidden"} relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex`}
            >
              <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-2 py-2 pt-[var(--safe-top)] md:hidden">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[16px] text-[var(--text)] hover:bg-[var(--hover)]"
                  onClick={() => setMobileSection(null)}
                >
                  <ArrowLeft size={20} />
                  {t(language, "back")}
                </button>
                <h2 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">{pageTitle}</h2>
                <button
                  type="button"
                  className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
                <button
                  type="button"
                  className="absolute right-4 top-4 hidden rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] md:block"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
                {panel}
              </div>
            </section>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
