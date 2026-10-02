import { useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, Plus, RefreshCw, Settings, X } from "lucide-react";
import {
  DEFAULT_CONNECTIONS,
  type ConnectionKind,
  type ConnectionsConfig,
  type ProviderConnection,
} from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { useT } from "@/lib/language";

function blank(kind: ConnectionKind): ProviderConnection {
  return {
    id: crypto.randomUUID(),
    kind,
    enabled: true,
    url: kind === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1",
    location: kind === "ollama" ? "local" : "external",
    auth: kind === "openai" ? "bearer" : "none",
    apiKey: "",
    apiType: "chat",
    forwardCookies: false,
    headers: "",
    passthrough: "",
    prefixId: "",
    provider: "default",
    modelIds: [],
    tags: [],
  };
}

export function ConnectionsPanel() {
  const tr = useT();
  const [config, setConfig] = useState<ConnectionsConfig>(DEFAULT_CONNECTIONS);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const configRef = useRef(config);
  const dirtyRef = useRef(false);
  configRef.current = config;

  useEffect(() => {
    let ignore = false;
    api
      .get("/api/admin/connections")
      .then((data) => {
        if (ignore || dirtyRef.current) return;
        const next = data.config as ConnectionsConfig;
        configRef.current = next;
        setConfig(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ignore) setReady(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  function apply(next: ConnectionsConfig) {
    dirtyRef.current = true;
    configRef.current = next;
    setConfig(next);
    return next;
  }

  async function persist(next: ConnectionsConfig) {
    if (!ready) return;
    setSaving(true);
    try {
      const saved = await api.send("/api/admin/connections", "PATCH", { config: next });
      const resolved = saved.config as ConnectionsConfig;
      dirtyRef.current = false;
      configRef.current = resolved;
      setConfig(resolved);
      setStatus(tr("saved"));
      setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : tr("couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  function updateList(kind: ConnectionKind, list: ProviderConnection[]) {
    apply({ ...configRef.current, [kind]: list });
  }

  function saveEditor(conn: ProviderConnection) {
    const current = configRef.current;
    const key = conn.kind;
    const list = current[key];
    const exists = list.some((item) => item.id === conn.id);
    const nextList = exists ? list.map((item) => (item.id === conn.id ? conn : item)) : [...list, conn];
    const next = apply({
      ...current,
      [key]: nextList,
      openaiEnabled: key === "openai" ? true : current.openaiEnabled,
      ollamaEnabled: key === "ollama" ? true : current.ollamaEnabled,
    });
    setEditing(null);
    void persist(next);
  }

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("connections")}</h2>

      <div className="mt-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[14px] font-medium">OpenAI API</p>
        </div>
        <Switch
          checked={config.openaiEnabled}
          onChange={(openaiEnabled) => apply({ ...configRef.current, openaiEnabled })}
          label="OpenAI API"
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-[13px] text-[var(--muted)]">
        <span>Manage OpenAI API Connections</span>
        <button type="button" className="rounded-md p-1 hover:bg-[var(--hover)]" aria-label="Add OpenAI connection" onClick={() => setEditing(blank("openai"))}>
          <Plus size={16} />
        </button>
      </div>
      <div className="mt-1 divide-y divide-[var(--border)]">
        {config.openai.map((conn) => (
          <ConnectionRow
            key={conn.id}
            conn={conn}
            kind="openai"
            onToggle={(enabled) =>
              updateList(
                "openai",
                configRef.current.openai.map((item) => (item.id === conn.id ? { ...item, enabled } : item)),
              )
            }
            onEdit={() => setEditing(conn)}
          />
        ))}
      </div>

      <div className="mt-8 flex items-start justify-between gap-4">
        <p className="text-[14px] font-medium">Ollama API</p>
        <Switch
          checked={config.ollamaEnabled}
          onChange={(ollamaEnabled) => apply({ ...configRef.current, ollamaEnabled })}
          label="Ollama API"
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-[13px] text-[var(--muted)]">
        <span>Manage Ollama API Connections</span>
        <button type="button" className="rounded-md p-1 hover:bg-[var(--hover)]" aria-label="Add Ollama connection" onClick={() => setEditing(blank("ollama"))}>
          <Plus size={16} />
        </button>
      </div>
      <div className="mt-1 divide-y divide-[var(--border)]">
        {config.ollama.map((conn) => (
          <ConnectionRow
            key={conn.id}
            conn={conn}
            kind="ollama"
            onToggle={(enabled) =>
              updateList(
                "ollama",
                configRef.current.ollama.map((item) => (item.id === conn.id ? { ...item, enabled } : item)),
              )
            }
            onEdit={() => setEditing(conn)}
            onPull={() => {
              void api.send("/api/admin/ollama/refresh", "POST").then(() => setStatus("Models refreshed")).catch((err) => setStatus(err instanceof Error ? err.message : "Refresh failed"));
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[var(--muted)]">
        Trouble accessing Ollama? Make sure the URL includes the port, for example http://127.0.0.1:11434.
      </p>

      <p className="mt-8 text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">User Connections</p>
      <div className="mt-3 flex items-start justify-between gap-4 py-2">
        <span>
          <span className="block text-[14px] font-medium">Direct Connections</span>
          <span className="mt-1 block text-[13px] text-[var(--muted)]">
            Direct Connections allow users to connect to their own OpenAI compatible API endpoints.
          </span>
        </span>
        <Switch
          checked={config.directConnections}
          onChange={(directConnections) => apply({ ...configRef.current, directConnections })}
          label="Direct Connections"
        />
      </div>
      <div className="flex items-start justify-between gap-4 py-2">
        <span>
          <span className="block text-[14px] font-medium">Cache Base Model List</span>
          <span className="mt-1 block text-[13px] text-[var(--muted)]">
            Base Model List Cache speeds up access by fetching base models only at startup or on settings save—faster, but may not show recent base model changes.
          </span>
        </span>
        <Switch
          checked={config.cacheBaseModelList}
          onChange={(cacheBaseModelList) => apply({ ...configRef.current, cacheBaseModelList })}
          label="Cache Base Model List"
        />
      </div>
      <SettingsSaveBar saving={saving || !ready} status={status} onSave={() => void persist(configRef.current)} />

      {editing ? (
        <ConnectionEditor
          conn={editing}
          onClose={() => setEditing(null)}
          onSave={saveEditor}
          onDelete={() => {
            const current = configRef.current;
            const list = current[editing.kind].filter((item) => item.id !== editing.id);
            setEditing(null);
            void persist(apply({ ...current, [editing.kind]: list }));
          }}
        />
      ) : null}
    </div>
  );
}

function ConnectionRow({
  conn,
  kind,
  onToggle,
  onEdit,
  onPull,
}: {
  conn: ProviderConnection;
  kind: ConnectionKind;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onPull?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{conn.url || "New connection"}</p>
      </div>
      {kind === "ollama" && onPull ? (
        <button type="button" className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--text)]" aria-label="Refresh models" onClick={onPull}>
          <Download size={14} />
        </button>
      ) : null}
      <button type="button" className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--text)]" aria-label="Edit connection" onClick={onEdit}>
        <Settings size={14} />
      </button>
      <Switch checked={conn.enabled} onChange={onToggle} label={`Enable ${conn.url}`} />
    </div>
  );
}

function ConnectionEditor({
  conn,
  onClose,
  onSave,
  onDelete,
}: {
  conn: ProviderConnection;
  onClose: () => void;
  onSave: (conn: ProviderConnection) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(conn);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [verify, setVerify] = useState("");
  const inputClass = "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none";

  async function ping() {
    setVerify("Checking…");
    try {
      const data = await api.send("/api/admin/connections/verify", "POST", { id: draft.id, kind: draft.kind, url: draft.url });
      setVerify(data.version ? `Connected · ${data.version}` : `Connected · ${data.models} models`);
    } catch (err) {
      setVerify(err instanceof Error ? err.message : "Unreachable");
    }
  }

  return (
    <div className="motion-fade fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close editor" onClick={onClose} />
      <div className="motion-pop relative z-10 max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-medium">Edit Connection</h3>
          <button type="button" className="rounded-lg p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-[var(--muted)]">Connection Type</span>
          <span>{draft.location === "local" ? "Local" : "External"}</span>
        </div>
        <label className="mt-4 block text-[12px] text-[var(--muted)]">
          URL
          <div className="mt-1 flex items-center gap-2">
            <input className={`${inputClass} mt-0 flex-1`} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <button type="button" className="rounded-md p-2 text-[var(--muted)] hover:bg-[var(--hover)]" aria-label="Test connection" onClick={() => void ping()}>
              <RefreshCw size={14} />
            </button>
            <Switch checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} label="Enable connection" />
          </div>
        </label>
        {verify ? <p className="mt-1 text-[12px] text-[var(--muted)]">{verify}</p> : null}
        <p className="mt-4 text-[12px] text-[var(--muted)]">Auth</p>
        <div className="mt-1 flex items-center gap-2">
          <select className="h-9 rounded-lg bg-[var(--surface)] px-2 text-[13px]" value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value === "none" ? "none" : "bearer" })}>
            <option value="none">None</option>
            <option value="bearer">Bearer</option>
          </select>
          {draft.auth === "bearer" ? (
            <>
              <input
                className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                placeholder="API Key"
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              <button type="button" className="rounded-md p-2 text-[var(--muted)]" aria-label="Toggle API key" onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </>
          ) : null}
        </div>
        {draft.kind === "openai" ? (
          <div className="mt-4 flex items-center justify-between text-[13px]">
            <span className="text-[var(--muted)]">API Type</span>
            <select className="h-8 rounded-lg bg-[var(--surface)] px-2 text-[13px]" value={draft.apiType} onChange={(e) => setDraft({ ...draft, apiType: e.target.value === "responses" ? "responses" : "chat" })}>
              <option value="chat">Chat Completions</option>
              <option value="responses">Responses</option>
            </select>
          </div>
        ) : null}
        <button type="button" className="mt-4 text-[13px] text-[var(--muted)]" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "▾ Advanced" : "▸ Advanced"}
        </button>
        {advanced ? (
          <div className="mt-3 space-y-3">
            {draft.kind === "openai" ? (
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[13px]">Forward cookies</span>
                  <span className="text-[12px] text-[var(--muted)]">Forward cookies from your WebUI request to this server.</span>
                </span>
                <Switch checked={draft.forwardCookies} onChange={(forwardCookies) => setDraft({ ...draft, forwardCookies })} />
              </div>
            ) : null}
            <label className="block text-[12px] text-[var(--muted)]">
              Headers
              <textarea className="mt-1 min-h-[64px] w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] outline-none" placeholder="Enter additional headers in JSON format" value={draft.headers} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
            </label>
            {draft.kind === "openai" ? (
              <label className="block text-[12px] text-[var(--muted)]">
                Passthrough params
                <input className={inputClass} value={draft.passthrough} onChange={(e) => setDraft({ ...draft, passthrough: e.target.value })} placeholder="thinking, output_config" />
              </label>
            ) : null}
            <label className="block text-[12px] text-[var(--muted)]">
              Prefix ID
              <input className={inputClass} value={draft.prefixId} onChange={(e) => setDraft({ ...draft, prefixId: e.target.value })} placeholder="Prefix ID" />
            </label>
            {draft.kind === "openai" ? (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--muted)]">Provider</span>
                <select className="h-8 rounded-lg bg-[var(--surface)] px-2 text-[13px]" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
                  <option value="default">Default</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="azure">Azure</option>
                </select>
              </div>
            ) : null}
            <div>
              <p className="text-[12px] text-[var(--muted)]">Model IDs</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {draft.kind === "ollama"
                  ? `Leave empty to include all models from “${draft.url || "this connection"}/api/tags”.`
                  : "Add exact model IDs (for example openrouter/free or google/gemma-2-9b-it:free). Use :free only if you want every free OpenRouter model. Leave empty to fetch every model."}
              </p>
              <div className="mt-2 space-y-1">
                {draft.modelIds.map((id) => (
                  <div key={id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{id}</span>
                    <button type="button" className="text-[var(--muted)]" onClick={() => setDraft({ ...draft, modelIds: draft.modelIds.filter((item) => item !== id) })}>
                      −
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="h-8 min-w-0 flex-1 rounded-lg bg-[var(--surface)] px-2 text-[13px]"
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const value = modelDraft.trim();
                    if (!value || draft.modelIds.includes(value)) return;
                    setDraft({ ...draft, modelIds: [...draft.modelIds, value] });
                    setModelDraft("");
                  }}
                  placeholder="google/gemma-2-9b-it:free"
                />
                <button
                  type="button"
                  className="rounded-md p-1 hover:bg-[var(--hover)]"
                  onClick={() => {
                    const value = modelDraft.trim();
                    if (!value || draft.modelIds.includes(value)) return;
                    setDraft({ ...draft, modelIds: [...draft.modelIds, value] });
                    setModelDraft("");
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div>
              <p className="text-[12px] text-[var(--muted)]">Tags</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {draft.tags.map((tag) => (
                  <button key={tag} type="button" className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px]" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((item) => item !== tag) })}>
                    {tag} ×
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="h-8 min-w-0 flex-1 rounded-lg bg-[var(--surface)] px-2 text-[13px]" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add a tag..." />
                <button
                  type="button"
                  className="rounded-md px-2 text-[13px] hover:bg-[var(--hover)]"
                  onClick={() => {
                    const value = tagDraft.trim();
                    if (!value || draft.tags.includes(value)) return;
                    setDraft({ ...draft, tags: [...draft.tags, value] });
                    setTagDraft("");
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex items-center justify-between">
          <button type="button" className="text-[13px] text-[var(--danger)]" onClick={onDelete}>
            Delete
          </button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
