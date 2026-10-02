import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_AUTH_CONFIG, parseUserRole, type AuthConfig } from "@wlfv/shared";
import { api } from "@/lib/api";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { useAutoSave } from "@/components/settings/useAutoSave";
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

export function AuthPanel() {
  const tr = useT();
  const [config, setConfig] = useState<AuthConfig>(DEFAULT_AUTH_CONFIG);
  const [ready, setReady] = useState(false);
  const { saving, status } = useAutoSave(config, ready, (next) => api.send("/api/admin/auth", "PATCH", next));

  useEffect(() => {
    api
      .get("/api/admin/auth")
      .then((data) => setConfig(data.config as AuthConfig))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("authentication")}</h2>
      <Field title={tr("defaultRole")} hint={tr("defaultRoleHint")}>
        <select
          className={inputClass}
          value={config.defaultRole}
          onChange={(event) => setConfig({ ...config, defaultRole: parseUserRole(event.target.value, "pending") })}
        >
          <option value="pending">{tr("rolePending")}</option>
          <option value="user">{tr("roleUser")}</option>
          <option value="admin">{tr("roleAdmin")}</option>
        </select>
      </Field>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title={tr("newSignups")}
          hint={tr("newSignupsHint")}
          checked={config.signupsEnabled}
          onChange={(signupsEnabled) => setConfig({ ...config, signupsEnabled })}
        />
      </div>
      <h3 className="mt-6 text-[15px] font-medium">Admin details</h3>
      <Field title={tr("adminContactEmail")} hint={tr("adminContactEmailHint")}>
        <input
          type="email"
          className={inputClass}
          value={config.adminContactEmail}
          placeholder="admin@example.com"
          onChange={(event) => setConfig({ ...config, adminContactEmail: event.target.value })}
        />
      </Field>
      <Field title={tr("pendingOverlayTitle")}>
        <input
          className={inputClass}
          value={config.pendingOverlayTitle}
          onChange={(event) => setConfig({ ...config, pendingOverlayTitle: event.target.value })}
        />
      </Field>
      <Field title={tr("pendingOverlayContent")}>
        <textarea
          className="mt-1 min-h-[96px] w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
          value={config.pendingOverlayContent}
          onChange={(event) => setConfig({ ...config, pendingOverlayContent: event.target.value })}
        />
      </Field>
      <SettingsSaveBar saving={saving} status={status} />
    </div>
  );
}
