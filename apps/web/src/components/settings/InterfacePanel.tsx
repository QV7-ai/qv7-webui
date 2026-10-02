import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_INTERFACE, TASK_MODEL_CURRENT, type InterfaceConfig } from "@wlfv/shared";
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

type ListedModel = {
  id: string;
  displayName: string;
  originalName?: string;
  ollamaModel?: string;
  providerKind?: string;
  enabled?: boolean;
  missing?: boolean;
};

const inputClass = "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none";

export function InterfacePanel({ onChange }: { onChange?: (config: InterfaceConfig) => void }) {
  const tr = useT();
  const [config, setConfig] = useState<InterfaceConfig>(DEFAULT_INTERFACE);
  const [models, setModels] = useState<ListedModel[]>([]);
  const [ready, setReady] = useState(false);
  const { saving, status } = useAutoSave(config, ready, async (next) => {
    const saved = await api.send("/api/admin/interface", "PATCH", next);
    onChange?.(saved.config as InterfaceConfig);
  });

  useEffect(() => {
    api
      .get("/api/admin/interface")
      .then((data) => setConfig(data.config as InterfaceConfig))
      .catch(() => undefined)
      .finally(() => setReady(true));
    api
      .get("/api/admin/models")
      .then((data) => setModels((data.models ?? []) as ListedModel[]))
      .catch(() => undefined);
  }, []);

  const usable = models.filter((item) => item.enabled && !item.missing);
  const localModels = usable.filter((item) => item.providerKind !== "openai");
  const externalModels = usable.filter((item) => item.providerKind === "openai");

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("interfaceTitle")}</h2>
      <h3 className="mt-6 text-[15px] font-medium">{tr("tasks")}</h3>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        {tr("tasksHint")}
      </p>
      <Field title={tr("localTaskModel")} hint={tr("localTaskModelHint")}>
        <select
          className={inputClass}
          value={config.localTaskModelId}
          onChange={(event) => setConfig({ ...config, localTaskModelId: event.target.value })}
        >
          <option value={TASK_MODEL_CURRENT}>{tr("currentModel")}</option>
          {localModels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field title={tr("externalTaskModel")} hint={tr("externalTaskModelHint")}>
        <select
          className={inputClass}
          value={config.externalTaskModelId}
          onChange={(event) => setConfig({ ...config, externalTaskModelId: event.target.value })}
        >
          <option value={TASK_MODEL_CURRENT}>{tr("currentModel")}</option>
          {externalModels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      </Field>
      <h3 className="mt-6 text-[15px] font-medium">{tr("toolPermissions")}</h3>
      <p className="mt-1 text-[12px] uppercase tracking-[0.08em] text-[var(--muted)]">{tr("experimental")}</p>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title={tr("toolPermissionsToggle")}
          hint={tr("toolPermissionsHint")}
          checked={config.toolPermissionsEnabled}
          onChange={(toolPermissionsEnabled) => setConfig({ ...config, toolPermissionsEnabled })}
        />
      </div>
      <h3 className="mt-6 text-[15px] font-medium">{tr("titleGeneration")}</h3>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title={tr("titleGenerationToggle")}
          hint={tr("titleGenerationHint")}
          checked={config.titleGenerationEnabled}
          onChange={(titleGenerationEnabled) => setConfig({ ...config, titleGenerationEnabled })}
        />
      </div>
      <SettingsSaveBar saving={saving} status={status} />
    </div>
  );
}
