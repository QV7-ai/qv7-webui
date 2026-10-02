import { useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_IMAGES,
  IMAGE_ENGINE_DEFAULTS,
  type ImageEditEngine,
  type ImageEndpointConfig,
  type ImageGenEngine,
  type ImagesConfig,
} from "@wlfv/shared";
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
const areaClass = "mt-1 min-h-[88px] w-full rounded-lg bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text)] outline-none";

function applyEngine(prev: ImageEndpointConfig, engine: ImageGenEngine): ImageEndpointConfig {
  const defaults = IMAGE_ENGINE_DEFAULTS[engine];
  return { ...prev, engine, apiBaseUrl: defaults.apiBaseUrl, model: defaults.model || prev.model };
}

function EndpointFields({
  value,
  onChange,
  edit,
}: {
  value: ImageEndpointConfig;
  onChange: (next: ImageEndpointConfig) => void;
  edit: boolean;
}) {
  const tr = useT();
  const a1111 = !edit && value.engine === "automatic1111";
  const comfy = value.engine === "comfyui";
  const openaiLike = value.engine === "imagerouter" || value.engine === "openai" || value.engine === "gemini";

  return (
    <>
      <Field title={edit ? tr("imageEditEngine") : tr("imageGenerationEngine")} hint={edit ? tr("imageEditEngineHint") : tr("imageGenerationEngineHint")}>
        <select
          className={inputClass}
          value={value.engine}
          onChange={(event) => onChange(applyEngine(value, event.target.value as ImageGenEngine))}
        >
          <option value="imagerouter">{tr("engineImageRouter")}</option>
          <option value="openai">{tr("engineOpenAI")}</option>
          <option value="comfyui">{tr("engineComfyUi")}</option>
          {edit ? null : <option value="automatic1111">{tr("engineAutomatic1111")}</option>}
          <option value="gemini">{tr("engineGemini")}</option>
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field title={tr("imageModel")}>
          <input className={inputClass} value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value })} />
        </Field>
        <Field title={tr("imageSize")}>
          <input className={inputClass} value={value.size} onChange={(event) => onChange({ ...value, size: event.target.value })} />
        </Field>
        {a1111 ? (
          <Field title={tr("imageSteps")}>
            <input
              type="number"
              min={1}
              max={150}
              className={inputClass}
              value={value.steps}
              onChange={(event) => onChange({ ...value, steps: Number(event.target.value) })}
            />
          </Field>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title={tr("imagePromptGeneration")}
          hint={tr("imagePromptGenerationHint")}
          checked={value.promptGeneration}
          onChange={(promptGeneration) => onChange({ ...value, promptGeneration })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          title={a1111 ? tr("imageA1111BaseUrl") : tr("imageApiBaseUrl")}
          hint={a1111 ? tr("imageA1111BaseUrlHint") : undefined}
        >
          <input
            className={inputClass}
            value={value.apiBaseUrl}
            placeholder={a1111 ? "http://127.0.0.1:7860/" : undefined}
            onChange={(event) => onChange({ ...value, apiBaseUrl: event.target.value })}
          />
        </Field>
        {a1111 ? (
          <Field title={tr("imageApiAuth")} hint={tr("imageApiAuthHint")}>
            <input
              className={inputClass}
              value={value.apiAuth}
              placeholder={tr("imageApiAuthPlaceholder")}
              onChange={(event) => onChange({ ...value, apiAuth: event.target.value })}
            />
          </Field>
        ) : (
          <Field title={tr("imageApiKey")}>
            <input
              type="password"
              autoComplete="off"
              className={inputClass}
              value={value.apiKey}
              placeholder={tr("imageApiKey")}
              onChange={(event) => onChange({ ...value, apiKey: event.target.value })}
            />
          </Field>
        )}
      </div>
      {openaiLike ? (
        <Field title={tr("imageApiVersion")}>
          <input
            className={inputClass}
            value={value.apiVersion}
            placeholder={tr("imageApiVersion")}
            onChange={(event) => onChange({ ...value, apiVersion: event.target.value })}
          />
        </Field>
      ) : null}
      {comfy && !a1111 ? (
        <Field title={tr("imageApiKey")}>
          <input
            type="password"
            autoComplete="off"
            className={inputClass}
            value={value.apiKey}
            onChange={(event) => onChange({ ...value, apiKey: event.target.value })}
          />
        </Field>
      ) : null}
      <Field
        title={tr("imageExtraParams")}
        hint={a1111 ? tr("imageExtraParamsHintA1111") : comfy ? tr("imageExtraParamsHintComfy") : tr("imageExtraParamsHint")}
      >
        <textarea className={areaClass} value={value.extraParams} onChange={(event) => onChange({ ...value, extraParams: event.target.value })} />
      </Field>
    </>
  );
}

export function ImagesPanel() {
  const tr = useT();
  const [config, setConfig] = useState<ImagesConfig>(DEFAULT_IMAGES);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get("/api/admin/images")
      .then((data) => setConfig(data.config as ImagesConfig))
      .catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true);
    try {
      const saved = await api.send("/api/admin/images", "PATCH", config);
      setConfig(saved.config);
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
      <h2 className="text-[22px] font-medium">{tr("imagesTitle")}</h2>
      <div className="mt-2 divide-y divide-[var(--border)]">
        <Toggle
          title={tr("imageGeneration")}
          hint={tr("imageGenerationHint")}
          checked={config.generationEnabled}
          onChange={(generationEnabled) => setConfig({ ...config, generationEnabled })}
        />
      </div>
      <h3 className="mt-6 text-[15px] font-medium">{tr("createImage")}</h3>
      <EndpointFields value={config.create} edit={false} onChange={(create) => setConfig({ ...config, create })} />
      <h3 className="mt-8 text-[15px] font-medium">{tr("editImageSection")}</h3>
      <div className="divide-y divide-[var(--border)]">
        <Toggle
          title={tr("imageEdit")}
          hint={tr("imageEditHint")}
          checked={config.editEnabled}
          onChange={(editEnabled) => setConfig({ ...config, editEnabled })}
        />
      </div>
      <EndpointFields
        value={config.edit}
        edit
        onChange={(edit) =>
          setConfig({
            ...config,
            edit: { ...edit, engine: edit.engine === "automatic1111" ? "imagerouter" : (edit.engine as ImageEditEngine) },
          })
        }
      />
      <SettingsSaveBar saving={saving} status={status} onSave={() => void save()} />
    </div>
  );
}
