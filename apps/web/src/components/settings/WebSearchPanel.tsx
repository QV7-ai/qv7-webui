import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_WEB_SEARCH, type WebSearchConfig } from "@wlfv/shared";
import { api } from "@/lib/api";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/language";

function Toggle({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-4">
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-1 block text-[13px] text-[var(--muted)]">{hint}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={title} />
    </label>
  );
}

function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block py-3">
      <span className="block text-[13px] text-[var(--secondary)]">{title}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}

const inputClass = "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none";

export function WebSearchPanel() {
  const tr = useT();
  const [config, setConfig] = useState<WebSearchConfig>(DEFAULT_WEB_SEARCH);
  const [limit, setLimit] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/admin/web-search").then((data) => {
      const next = data.config as WebSearchConfig;
      setConfig(next);
      setLimit(next.fetchContentLengthLimit == null ? "" : String(next.fetchContentLengthLimit));
    }).catch(() => undefined);
  }, []);

  async function save() {
    const payload: WebSearchConfig = {
      ...config,
      fetchContentLengthLimit: limit.trim() === "" ? null : Number(limit),
    };
    setSaving(true);
    try {
      const saved = await api.send("/api/admin/web-search", "PATCH", payload);
      setConfig(saved.config);
      setLimit(saved.config.fetchContentLengthLimit == null ? "" : String(saved.config.fetchContentLengthLimit));
      setStatus(tr("saved"));
      setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : tr("couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("webSearchTitle")}</h2>
      <div className="mt-2 divide-y divide-[var(--border)]">
        <Toggle
          title={tr("webSearchTitle")}
          hint={tr("webSearchHint")}
          checked={config.enabled}
          onChange={(enabled) => setConfig({ ...config, enabled })}
        />
        <Toggle
          title={tr("webSearchConfirm")}
          hint={tr("webSearchConfirmHint")}
          checked={config.confirmation}
          onChange={(confirmation) => setConfig({ ...config, confirmation })}
        />
      </div>
      <Field title={tr("webSearchEngine")} hint={tr("webSearchEngineHint")}>
        <select
          className={inputClass}
          value={config.engine}
          onChange={() => setConfig({ ...config, engine: "searxng" })}
        >
          <option value="searxng">searxng</option>
        </select>
      </Field>
      <Field title="Searxng Query URL">
        <input
          className={inputClass}
          value={config.searxngQueryUrl}
          onChange={(event) => setConfig({ ...config, searxngQueryUrl: event.target.value })}
        />
      </Field>
      <Field title="Searxng search language (all, en, es, de, fr, etc.)">
        <input
          className={inputClass}
          value={config.searxngLanguage}
          onChange={(event) => setConfig({ ...config, searxngLanguage: event.target.value })}
        />
      </Field>
      <h3 className="mt-6 text-[15px] font-medium">Search Limits</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field title="Search Result Count">
          <input
            type="number"
            min={1}
            max={20}
            className={inputClass}
            value={config.resultCount}
            onChange={(event) => setConfig({ ...config, resultCount: Number(event.target.value) })}
          />
        </Field>
        <Field title="Concurrent Requests">
          <input
            type="number"
            min={1}
            max={10}
            className={inputClass}
            value={config.concurrentRequests}
            onChange={(event) => setConfig({ ...config, concurrentRequests: Number(event.target.value) })}
          />
        </Field>
      </div>
      <p className="text-[12px] text-[var(--muted)]">Control result volume and parallel search requests.</p>
      <Field title="Fetch URL Content Length Limit" hint="Maximum characters to return from fetched URLs. Leave empty for no limit.">
        <input
          className={inputClass}
          value={limit}
          placeholder="No limit"
          onChange={(event) => setLimit(event.target.value)}
        />
      </Field>
      <Field title="Domain Filter List" hint="Restrict or exclude domains using a comma-separated list.">
        <input
          className={inputClass}
          value={config.domainFilter}
          placeholder="Enter domains separated by commas (e.g., example.com,site.org,!excludedsite.com)"
          onChange={(event) => setConfig({ ...config, domainFilter: event.target.value })}
        />
      </Field>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title="Bypass Embedding and Retrieval"
          hint="Use segmented retrieval for focused and relevant content extraction."
          checked={config.bypassEmbedding}
          onChange={(bypassEmbedding) => setConfig({ ...config, bypassEmbedding })}
        />
        <Toggle
          title="Bypass Web Loader"
          hint="Use search results without fetching page contents."
          checked={config.bypassWebLoader}
          onChange={(bypassWebLoader) => setConfig({ ...config, bypassWebLoader })}
        />
        <Toggle
          title="Trust Proxy Environment"
          hint="Fetch page contents without proxy environment variables."
          checked={config.trustProxy}
          onChange={(trustProxy) => setConfig({ ...config, trustProxy })}
        />
      </div>
      <h3 className="mt-8 text-[15px] font-medium">Loader</h3>
      <Field title="Web Loader Engine" hint="Choose how web result pages are fetched and read.">
        <select
          className={inputClass}
          value={config.loaderEngine}
          onChange={(event) => setConfig({ ...config, loaderEngine: event.target.value as WebSearchConfig["loaderEngine"] })}
        >
          <option value="playwright">playwright</option>
          <option value="fetch">fetch</option>
        </select>
      </Field>
      {config.loaderEngine === "playwright" ? (
        <>
          <Field title="Playwright WebSocket URL">
            <input
              className={inputClass}
              value={config.playwrightWsUrl}
              onChange={(event) => setConfig({ ...config, playwrightWsUrl: event.target.value })}
            />
          </Field>
          <Field title="Playwright Timeout (ms)">
            <input
              type="number"
              className={inputClass}
              value={config.playwrightTimeoutMs}
              onChange={(event) => setConfig({ ...config, playwrightTimeoutMs: Number(event.target.value) })}
            />
          </Field>
          <Field title="Concurrent Requests" hint="Limit parallel web loader requests.">
            <input
              type="number"
              min={1}
              max={10}
              className={inputClass}
              value={config.loaderConcurrentRequests}
              onChange={(event) => setConfig({ ...config, loaderConcurrentRequests: Number(event.target.value) })}
            />
          </Field>
        </>
      ) : (
        <Field title="Concurrent Requests" hint="Limit parallel web loader requests.">
          <input
            type="number"
            min={1}
            max={10}
            className={inputClass}
            value={config.loaderConcurrentRequests}
            onChange={(event) => setConfig({ ...config, loaderConcurrentRequests: Number(event.target.value) })}
          />
        </Field>
      )}
      <Field title="Youtube Language" hint="Preferred transcript language codes, separated by commas.">
        <input
          className={inputClass}
          value={config.youtubeLanguage}
          onChange={(event) => setConfig({ ...config, youtubeLanguage: event.target.value })}
        />
      </Field>
      <Field title="Youtube Proxy URL" hint="Proxy URL used for Youtube loader requests.">
        <input
          className={inputClass}
          value={config.youtubeProxyUrl}
          placeholder="Enter proxy URL (e.g. https://user:password@host:port)"
          onChange={(event) => setConfig({ ...config, youtubeProxyUrl: event.target.value })}
        />
      </Field>
      <SettingsSaveBar saving={saving} status={status} onSave={() => void save()} />
    </div>
  );
}
