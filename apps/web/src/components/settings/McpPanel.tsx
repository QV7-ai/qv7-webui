import { useEffect, useState } from "react";
import type { McpAuthKind, McpPolicyView, McpServerView } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/language";

const inputClass = "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none";

type Draft = {
  name: string;
  description: string;
  endpoint: string;
  enabled: boolean;
  authKind: McpAuthKind;
  authHeader: string;
  secret: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  endpoint: "",
  enabled: false,
  authKind: "none",
  authHeader: "",
  secret: "",
});

export function McpPanel() {
  const tr = useT();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [, setPolicy] = useState<McpPolicyView>({ allowHosts: [] });
  const [hosts, setHosts] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [edit, setEdit] = useState<(Draft & { id: string; secretKept: boolean }) | null>(null);
  const [error, setError] = useState("");
  const [testNote, setTestNote] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState("");

  function apply(data: { servers?: McpServerView[]; policy?: McpPolicyView; server?: McpServerView | null }) {
    if (data.policy) {
      setPolicy(data.policy);
      setHosts(data.policy.allowHosts.join("\n"));
    }
    if (data.servers) setServers(data.servers);
    if (data.server) setServers((current) => {
      const next = current.filter((item) => item.id !== data.server?.id);
      return data.server ? [...next, data.server] : next;
    });
  }

  useEffect(() => {
    api.get("/api/admin/mcp/servers").then(apply).catch(() => setError(tr("couldNotLoadUsers")));
  }, [tr]);

  async function saveHosts() {
    setBusy("policy");
    setError("");
    try {
      const data = await api.send("/api/admin/mcp/policy", "PATCH", {
        allowHosts: hosts.split(/\n/).map((line) => line.trim()).filter(Boolean),
      });
      apply(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function testDraft() {
    setBusy("test-draft");
    setError("");
    setTestNote("");
    try {
      const data = await api.send("/api/admin/mcp/test", "POST", draft);
      if (data.ok) setTestNote(tr("mcpConnected"));
      else setError(data.message || tr("mcpFailed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  function startEdit(server: McpServerView) {
    setEdit({
      id: server.id,
      name: server.name,
      description: server.description,
      endpoint: server.endpoint,
      enabled: server.enabled,
      authKind: server.authKind,
      authHeader: server.authHeader,
      secret: "",
      secretKept: server.authConfigured,
    });
    setError("");
    setEditNote("");
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy("edit");
    setError("");
    const body: Record<string, unknown> = {
      name: edit.name,
      description: edit.description,
      endpoint: edit.endpoint,
      enabled: edit.enabled,
      authKind: edit.authKind,
    };
    if (edit.authHeader.trim()) body.authHeader = edit.authHeader.trim();
    if (edit.secret) body.secret = edit.secret;
    try {
      apply(await api.send(`/api/admin/mcp/servers/${edit.id}`, "PATCH", body));
      setEdit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function testEdit() {
    if (!edit) return;
    setBusy("test-edit");
    setError("");
    setEditNote("");
    try {
      const data = await api.send("/api/admin/mcp/test", "POST", {
        name: edit.name,
        description: edit.description,
        endpoint: edit.endpoint,
        enabled: edit.enabled,
        authKind: edit.authKind,
        authHeader: edit.authHeader,
        secret: edit.secret,
      });
      if (data.ok) setEditNote(tr("mcpConnected"));
      else setError(data.message || tr("mcpFailed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function addServer() {
    setBusy("add");
    setError("");
    try {
      const data = await api.send("/api/admin/mcp/servers", "POST", draft);
      apply(data);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError("");
    try {
      apply(await api.send(`/api/admin/mcp/servers/${id}`, "PATCH", body));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function run(id: string, action: "test" | "discover") {
    setBusy(`${action}:${id}`);
    setError("");
    try {
      apply(await api.send(`/api/admin/mcp/servers/${id}/${action}`, "POST"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError("");
    try {
      await api.send(`/api/admin/mcp/servers/${id}`, "DELETE");
      setServers((current) => current.filter((item) => item.id !== id));
      setEdit((current) => (current?.id === id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  async function toggleTool(id: string, enabled: boolean) {
    setBusy(id);
    setError("");
    try {
      apply(await api.send(`/api/admin/mcp/tools/${id}`, "PATCH", { enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("mcpFailed"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("mcpTitle")}</h2>
      <p className="mt-1 text-[13px] text-[var(--muted)]">{tr("mcpHint")}</p>
      {error ? <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p> : null}
      <label className="mt-4 block text-[13px] text-[var(--secondary)]">
        {tr("mcpAllowHosts")}
        <textarea value={hosts} onChange={(event) => setHosts(event.target.value)} rows={3} className={`${inputClass} h-auto py-2`} />
        <span className="mt-1 block text-[12px] text-[var(--muted)]">{tr("mcpAllowHostsHint")}</span>
      </label>
      <button type="button" className="mt-2 h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px]" onClick={() => void saveHosts()} disabled={busy === "policy"}>
        {tr("done")}
      </button>

      <div className="mt-6 space-y-3 rounded-xl border border-[var(--border)] p-3">
        <h3 className="text-[15px] font-medium">{tr("mcpAddServer")}</h3>
        <label className="block text-[13px] text-[var(--secondary)]">
          {tr("mcpName")}
          <input className={inputClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="block text-[13px] text-[var(--secondary)]">
          {tr("mcpDescription")}
          <input className={inputClass} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="block text-[13px] text-[var(--secondary)]">
          {tr("mcpEndpoint")}
          <input className={inputClass} value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://" />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">{tr("mcpEndpointHint")}</span>
        </label>
        <label className="block text-[13px] text-[var(--secondary)]">
          {tr("mcpTransport")}
          <select className={inputClass} value="http" onChange={() => undefined}>
            <option value="http">HTTPS</option>
          </select>
        </label>
        <label className="flex items-center justify-between py-1 text-[14px]">
          {tr("mcpEnabled")}
          <Switch checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} label={tr("mcpEnabled")} />
        </label>
        <label className="block text-[13px] text-[var(--secondary)]">
          {tr("mcpAuth")}
          <select className={inputClass} value={draft.authKind} onChange={(event) => setDraft({ ...draft, authKind: event.target.value as McpAuthKind })}>
            <option value="none">{tr("mcpAuthNone")}</option>
            <option value="bearer">{tr("mcpAuthBearer")}</option>
            <option value="header">{tr("mcpAuthHeader")}</option>
          </select>
        </label>
        {draft.authKind === "header" ? (
          <label className="block text-[13px] text-[var(--secondary)]">
            {tr("mcpHeaderName")}
            <input className={inputClass} value={draft.authHeader} onChange={(event) => setDraft({ ...draft, authHeader: event.target.value })} />
          </label>
        ) : null}
        {draft.authKind !== "none" ? (
          <label className="block text-[13px] text-[var(--secondary)]">
            {tr("mcpSecret")}
            <input
              type="password"
              autoComplete="off"
              className={inputClass}
              value={draft.secret}
              onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-11 rounded-lg bg-[var(--accent)] px-3 text-[13px] text-white" onClick={() => void addServer()} disabled={busy === "add" || busy === "test-draft"}>
            {tr("mcpAddServer")}
          </button>
          <button type="button" className="h-11 rounded-lg bg-[var(--surface)] px-3 text-[13px]" onClick={() => void testDraft()} disabled={busy === "add" || busy === "test-draft"}>
            {tr("mcpTest")}
          </button>
        </div>
        {testNote ? <p className="text-[13px] text-[var(--secondary)]">{testNote}</p> : null}
      </div>

      <div className="mt-6 space-y-4">
        {servers.length ? null : <p className="text-[13px] text-[var(--muted)]">{tr("mcpNoServers")}</p>}
        {servers.map((server) => (
          <div key={server.id} className="space-y-2">
          <section className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-medium">{server.name}</h3>
                {server.description ? <p className="mt-1 text-[13px] text-[var(--muted)]">{server.description}</p> : null}
                <p className="mt-1 break-all text-[12px] text-[var(--secondary)]">{server.endpoint}</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {server.status === "ok" ? tr("mcpConnected") : server.status === "error" ? tr("mcpFailed") : tr("mcpStatusUnknown")}
                  {server.statusMessage ? ` · ${server.statusMessage}` : ""}
                  {server.authConfigured ? ` · ${tr("mcpAuthConfigured")}` : ""}
                </p>
              </div>
              <Switch checked={server.enabled} onChange={(enabled) => void patch(server.id, { enabled })} label={tr("mcpEnabled")} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px]" onClick={() => startEdit(server)}>
                {tr("mcpEdit")}
              </button>
              <button type="button" className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px]" onClick={() => void run(server.id, "test")}>
                {tr("mcpTest")}
              </button>
              <button type="button" className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px]" onClick={() => void run(server.id, "discover")}>
                {tr("mcpDiscover")}
              </button>
              <button type="button" className="h-9 rounded-lg px-3 text-[13px] text-[var(--danger)]" onClick={() => void remove(server.id)}>
                {tr("mcpRemove")}
              </button>
            </div>
            <p className="mt-3 text-[12px] text-[var(--muted)]">{tr("mcpToolsOn")}</p>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {server.tools.map((tool) => (
                <li key={tool.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block text-[14px]">{tool.name}</span>
                    {tool.description ? <span className="block text-[12px] text-[var(--muted)]">{tool.description}</span> : null}
                  </span>
                  <Switch checked={tool.enabled} onChange={(enabled) => void toggleTool(tool.id, enabled)} label={tool.name} />
                </li>
              ))}
            </ul>
          </section>
          {edit?.id === server.id ? (
            <section className="space-y-2 rounded-lg border border-[var(--border)] p-2">
              <p className="text-[13px] font-medium">{tr("mcpEditServer")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-[12px] text-[var(--secondary)]">
                  {tr("mcpName")}
                  <input className={inputClass} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
                </label>
                <label className="block text-[12px] text-[var(--secondary)]">
                  {tr("mcpDescription")}
                  <input className={inputClass} value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} />
                </label>
              </div>
              <label className="block text-[12px] text-[var(--secondary)]">
                {tr("mcpEndpoint")}
                <input className={inputClass} value={edit.endpoint} onChange={(event) => setEdit({ ...edit, endpoint: event.target.value })} />
              </label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block text-[12px] text-[var(--secondary)]">
                  {tr("mcpAuth")}
                  <select className={inputClass} value={edit.authKind} onChange={(event) => setEdit({ ...edit, authKind: event.target.value as McpAuthKind })}>
                    <option value="none">{tr("mcpAuthNone")}</option>
                    <option value="bearer">{tr("mcpAuthBearer")}</option>
                    <option value="header">{tr("mcpAuthHeader")}</option>
                  </select>
                </label>
                <label className="flex h-9 items-center gap-2 text-[12px]">
                  {tr("mcpEnabled")}
                  <Switch checked={edit.enabled} onChange={(enabled) => setEdit({ ...edit, enabled })} label={tr("mcpEnabled")} />
                </label>
              </div>
              {edit.authKind === "header" ? (
                <label className="block text-[12px] text-[var(--secondary)]">
                  {tr("mcpHeaderName")}
                  <input className={inputClass} value={edit.authHeader} onChange={(event) => setEdit({ ...edit, authHeader: event.target.value })} />
                </label>
              ) : null}
              {edit.authKind !== "none" ? (
                <label className="block text-[12px] text-[var(--secondary)]">
                  {tr("mcpSecret")}
                  <input
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    value={edit.secret}
                    placeholder={edit.secretKept ? "••••••••" : ""}
                    onChange={(event) => setEdit({ ...edit, secret: event.target.value, secretKept: event.target.value ? false : edit.secretKept })}
                  />
                  {edit.secretKept ? <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{tr("mcpSecretKeep")}</span> : null}
                </label>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="h-8 rounded-lg bg-[var(--accent)] px-2.5 text-[12px] text-white" onClick={() => void saveEdit()} disabled={busy === "edit" || busy === "test-edit"}>
                  {tr("save")}
                </button>
                <button type="button" className="h-8 rounded-lg bg-[var(--surface)] px-2.5 text-[12px]" onClick={() => setEdit(null)}>
                  {tr("cancel")}
                </button>
                <button type="button" className="h-8 rounded-lg bg-[var(--surface)] px-2.5 text-[12px]" onClick={() => void testEdit()} disabled={busy === "edit" || busy === "test-edit"}>
                  {tr("mcpTest")}
                </button>
              </div>
              {editNote ? <p className="text-[12px] text-[var(--secondary)]">{editNote}</p> : null}
            </section>
          ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
