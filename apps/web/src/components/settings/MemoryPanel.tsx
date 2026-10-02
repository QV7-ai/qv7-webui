import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { t, type UiLang } from "@/lib/i18n";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { useAutoSave } from "@/components/settings/useAutoSave";

type Memory = { id: string; content: string; category: string; path?: string; memoryType?: string; updatedAt?: number; createdAt?: number };

function formatEdited(lang: UiLang, at?: number) {
  if (!at) return "";
  const value = at < 1e12 ? at * 1000 : at;
  return new Date(value).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseMemoryList(raw: string): { content: string; category: string; path: string; memoryType: string }[] {
  const text = raw.trim();
  if (!text) return [];
  let items: unknown[] = [];
  if (text.startsWith("[") || text.startsWith("{")) {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) items = data;
    else if (data && typeof data === "object") {
      const record = data as { memories?: unknown; items?: unknown };
      items = Array.isArray(record.memories) ? record.memories : Array.isArray(record.items) ? record.items : [];
    }
  } else {
    items = text.split(/\r?\n/).map((line) => ({ content: line }));
  }
  const seen = new Set<string>();
  return items
    .map((item) => {
      if (typeof item === "string") return { content: item.trim(), category: "other", path: "", memoryType: "user" };
      if (!item || typeof item !== "object") return null;
      const row = item as { content?: unknown; text?: unknown; category?: unknown; path?: unknown; type?: unknown; memoryType?: unknown };
      const content = String(row.content ?? row.text ?? "").trim();
      if (!content) return null;
      return {
        content,
        category: String(row.category || "other"),
        path: String(row.path || ""),
        memoryType: String(row.memoryType || row.type || "user") === "context"
          ? "context"
          : String(row.memoryType || row.type || "") === "preference"
            ? "preference"
            : "user",
      };
    })
    .filter((item): item is { content: string; category: string; path: string; memoryType: string } => {
      if (!item) return false;
      const key = `${item.path}\0${item.content}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function TypeSelect({ lang, value, onChange }: { lang: UiLang; value: string; onChange: (value: string) => void }) {
  return (
    <select
      value={value === "context" || value === "preference" ? value : "user"}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg bg-[var(--elevated)] px-2 text-[13px] outline-none"
    >
      <option value="user">{t(lang, "memoryTypeUser")}</option>
      <option value="preference">{t(lang, "memoryTypePreference")}</option>
      <option value="context">{t(lang, "memoryTypeContext")}</option>
    </select>
  );
}

function typeLabel(lang: UiLang, value?: string) {
  if (value === "context") return t(lang, "memoryTypeContext");
  if (value === "preference") return t(lang, "memoryTypePreference");
  return t(lang, "memoryTypeUser");
}

export function MemoryPanel({ language }: { language: UiLang }) {
  const lang = language;
  const fileRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [path, setPath] = useState("");
  const [memoryType, setMemoryType] = useState("user");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editType, setEditType] = useState("user");
  const [pending, setPending] = useState<
    | { type: "delete"; id: string; content: string }
    | { type: "clear" }
    | { type: "import"; items: { content: string; category: string; path: string; memoryType: string }[] }
    | null
  >(null);
  const [ready, setReady] = useState(false);
  const loadedOnce = useRef(false);
  const { saving, status } = useAutoSave(enabled, ready, (memoryEnabled) => api.send("/api/settings", "PATCH", { memoryEnabled }));

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .get("/api/memory")
        .then((d) => {
          if (cancelled) return;
          if (!loadedOnce.current) {
            loadedOnce.current = true;
            setEnabled(d.enabled !== false);
            setReady(true);
          }
          setMemories(Array.isArray(d.memories) ? d.memories : []);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : t(lang, "memorySaveError"));
        });
    }
    load();
    const onShow = () => load();
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    const poll = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(poll);
    };
  }, [lang]);

  async function confirmPending() {
    if (!pending) return;
    setError("");
    try {
      if (pending.type === "delete") {
        await api.send(`/api/memory/${pending.id}`, "DELETE");
        setMemories((prev) => prev.filter((item) => item.id !== pending.id));
        if (editingId === pending.id) setEditingId(null);
      } else if (pending.type === "clear") {
        await api.send("/api/memory", "DELETE");
        setMemories([]);
        setEditingId(null);
      } else {
        const data = await api.send("/api/memory/import", "POST", { memories: pending.items });
        setMemories(data.memories ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, "memorySaveError"));
    }
    setPending(null);
  }

  return (
    <div>
      <h2 className="text-[22px] font-medium">
        {t(lang, "memory")}{" "}
        <span className="align-middle text-[11px] font-normal text-[var(--muted)]">{t(lang, "experimental")}</span>
      </h2>
      <p className="mt-2 max-w-lg text-[14px] text-[var(--secondary)]">{t(lang, "memoryHint")}</p>
      <label className="mt-6 flex items-center justify-between gap-4 text-[14px]">
        <span>{t(lang, "memoryEnabled")}</span>
        <Switch checked={enabled} onChange={setEnabled} label={t(lang, "memoryEnabled")} />
      </label>
      <SettingsSaveBar saving={saving} status={status} />
      <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-[12px] text-[var(--muted)]">{t(lang, "addMemory")}</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={t(lang, "memoryPlaceholder")}
          className="mt-2 w-full resize-y rounded-lg bg-[var(--elevated)] px-3 py-2 text-[13px] outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TypeSelect lang={lang} value={memoryType} onChange={setMemoryType} />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={t(lang, "memoryPathPlaceholder")}
            className="h-9 min-w-[180px] flex-1 rounded-lg bg-[var(--elevated)] px-3 text-[13px] outline-none"
          />
          <Button
            variant="primary"
            onClick={() => {
              const content = draft.trim();
              if (!content) return;
              setError("");
              void api
                .send("/api/memory", "POST", { content, path, memoryType })
                .then((d) => {
                  setMemories(d.memories ?? []);
                  setDraft("");
                  setPath("");
                  setMemoryType("user");
                })
                .catch((err) => setError(err instanceof Error ? err.message : t(lang, "memorySaveError")));
            }}
          >
            {t(lang, "add")}
          </Button>
        </div>
        {error ? <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,.md,application/json,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void file
              .text()
              .then((text) => {
                try {
                  const items = parseMemoryList(text);
                  if (!items.length) {
                    setError(t(lang, "importEmpty"));
                    return;
                  }
                  setError("");
                  setPending({ type: "import", items });
                } catch {
                  setError(t(lang, "importInvalid"));
                }
              })
              .catch(() => setError(t(lang, "importInvalid")));
          }}
        />
        <Button onClick={() => fileRef.current?.click()}>{t(lang, "importList")}</Button>
        <Button
          disabled={!memories.length}
          onClick={() => {
            const blob = new Blob(
              [
                JSON.stringify(
                  {
                    memories: memories.map((item) => ({
                      type: item.memoryType || "user",
                      content: item.content,
                      path: item.path || "",
                    })),
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "qv7-memories.json";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t(lang, "exportList")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[13px] text-[var(--muted)]">
            {t(lang, "memoryTotal").replace("{count}", String(memories.length))}
          </span>
          {memories.length ? (
            <Button variant="danger" onClick={() => setPending({ type: "clear" })}>
              {t(lang, "clearAll")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {memories.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">{t(lang, "noMemories")}</p>
        ) : (
          memories.map((item) => (
            <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              {editingId === item.id ? (
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg bg-[var(--elevated)] px-3 py-2 text-[13px] outline-none"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TypeSelect lang={lang} value={editType} onChange={setEditType} />
                    <input
                      value={editPath}
                      onChange={(e) => setEditPath(e.target.value)}
                      placeholder={t(lang, "memoryPathPlaceholder")}
                      className="h-9 min-w-[180px] flex-1 rounded-lg bg-[var(--elevated)] px-3 text-[13px] outline-none"
                    />
                    <Button
                      variant="primary"
                      onClick={() => {
                        const content = editContent.trim();
                        if (!content) return;
                        setError("");
                        void api
                          .send(`/api/memory/${item.id}`, "PATCH", {
                            content,
                            path: editPath,
                            memoryType: editType,
                          })
                          .then((d) => {
                            setMemories((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...d.memory } : row)));
                            setEditingId(null);
                          })
                          .catch((err) => setError(err instanceof Error ? err.message : t(lang, "memorySaveError")));
                      }}
                    >
                      {t(lang, "save")}
                    </Button>
                    <Button onClick={() => setEditingId(null)}>{t(lang, "cancel")}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2 text-[14px]">
                    <p>
                      <span className="text-[var(--muted)]">{t(lang, "memoryType")}:</span> {typeLabel(lang, item.memoryType)}
                    </p>
                    <p>
                      <span className="text-[var(--muted)]">{t(lang, "memoryBody")}:</span> {item.content}
                    </p>
                    {item.path ? (
                      <p>
                        <span className="text-[var(--muted)]">{t(lang, "memoryPath")}:</span> {item.path}
                      </p>
                    ) : null}
                    {item.updatedAt || item.createdAt ? (
                      <p>
                        <span className="text-[var(--muted)]">{t(lang, "lastEdited")}:</span>{" "}
                        {formatEdited(lang, item.updatedAt || item.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                      aria-label={t(lang, "edit")}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditContent(item.content);
                        setEditPath(item.path || "");
                        setEditType(item.memoryType === "context" || item.memoryType === "preference" ? item.memoryType : "user");
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--danger)]"
                      aria-label={t(lang, "remove")}
                      onClick={() => setPending({ type: "delete", id: item.id, content: item.content })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={pending?.type === "delete"}
        title={t(lang, "removeMemoryTitle")}
        description={t(lang, "removeMemoryBody")}
        confirmLabel={t(lang, "remove")}
        cancelLabel={t(lang, "cancel")}
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      />
      <ConfirmDialog
        open={pending?.type === "clear"}
        title={t(lang, "clearAllTitle")}
        description={t(lang, "clearAllBody").replace("{count}", String(memories.length))}
        confirmLabel={t(lang, "clearAll")}
        cancelLabel={t(lang, "cancel")}
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      />
      <ConfirmDialog
        open={pending?.type === "import"}
        title={t(lang, "importTitle")}
        description={t(lang, "importBody").replace("{count}", String(pending?.type === "import" ? pending.items.length : 0))}
        confirmLabel={t(lang, "importList")}
        cancelLabel={t(lang, "cancel")}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      />
    </div>
  );
}
