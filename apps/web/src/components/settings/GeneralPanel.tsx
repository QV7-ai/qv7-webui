import { useState } from "react";
import type { ReactNode } from "react";
import { TOOLS_PROMPT, type GenerationSettings } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { applyMotion, applyTheme, fieldLabel, t, type UiLang, GENERATION_FIELDS, clampTextSize, DEFAULT_TEXT_SIZE, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from "@/lib/i18n";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";

function Choice({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-lg border px-3 py-1.5 text-[13px] ${
            value === option.id ? "border-[var(--accent)] text-[var(--text)]" : "border-[var(--border)] text-[var(--secondary)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ParamRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2.5 last:border-b-0">
      <span className="min-w-0 shrink text-[13px]">{label}</span>
      <div className="w-44 shrink-0">{children}</div>
    </label>
  );
}

const inputClass =
  "h-8 w-full rounded-lg bg-[var(--surface)] px-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]";

export function GeneralPanel({
  theme,
  language,
  textSize,
  showUsage,
  animations,
  systemPrompt,
  generation,
  onTheme,
  onLanguage,
  onTextSize,
  onShowUsage,
  onAnimations,
  onSystemPrompt,
  onGeneration,
}: {
  theme: string;
  language: UiLang;
  textSize: number;
  showUsage: boolean;
  animations: boolean;
  systemPrompt: string;
  generation: GenerationSettings;
  onTheme: (theme: string) => void;
  onLanguage: (language: UiLang) => void;
  onTextSize: (value: number) => void;
  onShowUsage: (value: boolean) => void;
  onAnimations: (value: boolean) => void;
  onSystemPrompt: (value: string) => void;
  onGeneration: (value: GenerationSettings) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const lang = language;

  function setValue(key: string, value: string) {
    const values = { ...generation.values };
    if (!value) delete values[key];
    else values[key] = value;
    onGeneration({ ...generation, values, show: generation.show });
  }

  function setShow(show: boolean) {
    onGeneration({ ...generation, show });
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await api.send("/api/settings", "PATCH", {
        theme,
        language,
        textSize,
        showUsage,
        animations,
        systemPrompt,
        generation: { ...generation, show: false },
      });
      setStatus(t(lang, "saved"));
      setTimeout(() => setStatus(""), 1200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(lang, "couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-[22px] font-medium">{t(lang, "general")}</h2>
      <p className="mt-6 text-[14px]">{t(lang, "theme")}</p>
      <Choice
        value={theme}
        onChange={(id) => {
          onTheme(id);
          applyTheme(id);
        }}
        options={[
          { id: "dark", label: t(lang, "dark") },
          { id: "oled", label: t(lang, "oled") },
          { id: "light", label: t(lang, "light") },
          { id: "system", label: t(lang, "system") },
        ]}
      />
      <p className="mt-6 text-[14px]">{t(lang, "language")}</p>
      <Choice
        value={language}
        onChange={(id) => {
          const next = id === "nl" ? "nl" : "en";
          onLanguage(next);
          document.documentElement.lang = next;
        }}
        options={[
          { id: "en", label: t(lang, "english") },
          { id: "nl", label: t(lang, "dutch") },
        ]}
      />
      <p className="mt-6 text-[14px]">{t(lang, "textSize")}</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[16px] hover:bg-[var(--hover)] disabled:opacity-30"
          aria-label="-"
          disabled={textSize <= TEXT_SIZE_MIN}
          onClick={() => onTextSize(clampTextSize(textSize - TEXT_SIZE_STEP))}
        >
          −
        </button>
        <span className="min-w-12 text-center text-[13px] tabular-nums">{textSize}%</span>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[16px] hover:bg-[var(--hover)] disabled:opacity-30"
          aria-label="+"
          disabled={textSize >= TEXT_SIZE_MAX}
          onClick={() => onTextSize(clampTextSize(textSize + TEXT_SIZE_STEP))}
        >
          +
        </button>
        <button
          type="button"
          className="rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-30"
          disabled={textSize === DEFAULT_TEXT_SIZE}
          onClick={() => onTextSize(DEFAULT_TEXT_SIZE)}
        >
          {t(lang, "reset")}
        </button>
      </div>
      <label className="mt-6 flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          checked={showUsage}
          onChange={(e) => {
            onShowUsage(e.target.checked);
          }}
        />
        {t(lang, "showUsage")}
      </label>
      <label className="mt-3 flex items-start gap-2 text-[14px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={animations}
          onChange={(e) => {
            onAnimations(e.target.checked);
            applyMotion(e.target.checked);
          }}
        />
        <span>
          {t(lang, "animations")}
          <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{t(lang, "animationsHint")}</span>
        </span>
      </label>
      <label className="mt-8 block text-[14px]">
        {t(lang, "systemPrompt")}
        <textarea
          value={systemPrompt}
          onChange={(e) => onSystemPrompt(e.target.value)}
          rows={10}
          className="mt-2 w-full resize-y rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] outline-none"
        />
      </label>
      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[14px] font-medium">{t(lang, "advanced")}</p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t(lang, "modelParameters")}</p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[12px] text-[var(--accent)] hover:bg-[var(--hover)]"
            onClick={() => setShow(!generation.show)}
          >
            {generation.show ? t(lang, "hide") : t(lang, "show")}
          </button>
        </div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t(lang, "advancedHint")}</p>
        {generation.show ? (
          <div className="mt-4">
            {GENERATION_FIELDS.map((field) => {
              const current = generation.values[field.key] ?? "";
              const label = fieldLabel(lang, field.key);
              if (field.kind === "boolean" || field.kind === "select") {
                return (
                  <ParamRow key={field.key} label={label}>
                    <select
                      className={inputClass}
                      value={current}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    >
                      <option value="">{t(lang, "default")}</option>
                      {(field.options || ["true", "false"]).map((option) => (
                        <option key={option} value={option}>
                          {option || t(lang, "default")}
                        </option>
                      ))}
                    </select>
                  </ParamRow>
                );
              }
              return (
                <ParamRow key={field.key} label={label}>
                  <input
                    className={inputClass}
                    value={current}
                    placeholder={t(lang, "default")}
                      onChange={(e) => {
                        const values = { ...generation.values, [field.key]: e.target.value };
                        onGeneration({ ...generation, values });
                      }}
                  />
                </ParamRow>
              );
            })}
            <div className="mt-4">
              {generation.custom.map((item, index) => (
                <ParamRow key={`${item.key}-${index}`} label={item.key}>
                  <div className="flex gap-1">
                    <input
                      className={inputClass}
                      value={item.value}
                      placeholder={t(lang, "default")}
                      onChange={(e) => {
                        const custom = generation.custom.map((row, i) => (i === index ? { ...row, value: e.target.value } : row));
                        onGeneration({ ...generation, custom });
                      }}
                    />
                    <button
                      type="button"
                      className="text-[11px] text-[var(--danger)]"
                      onClick={() => {
                        const custom = generation.custom.filter((_, i) => i !== index);
                        onGeneration({ ...generation, custom });
                      }}
                    >
                      ×
                    </button>
                  </div>
                </ParamRow>
              ))}
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    className={`${inputClass} min-w-0 flex-1`}
                    placeholder={t(lang, "customKey")}
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                  />
                  <input
                    className={`${inputClass} min-w-0 flex-1`}
                    placeholder={t(lang, "customValue")}
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                  />
                </div>
                <Button
                  className="h-9 w-full shrink-0 whitespace-nowrap"
                  onClick={() => {
                    const key = customKey.trim();
                    if (!key) return;
                    onGeneration({ ...generation, custom: [...generation.custom, { key, value: customValue }] });
                    setCustomKey("");
                    setCustomValue("");
                  }}
                >
                  {t(lang, "addCustom")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-8">
        <p className="text-[14px]">{t(lang, "functions")}</p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface)] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--secondary)]">
          {TOOLS_PROMPT}
        </pre>
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(TOOLS_PROMPT).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
            }
          >
            {copied ? t(lang, "copied") : t(lang, "copy")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const next = systemPrompt.includes("search_web") ? systemPrompt : [systemPrompt.trim(), TOOLS_PROMPT].filter(Boolean).join("\n\n");
              onSystemPrompt(next);
            }}
          >
            {t(lang, "insert")}
          </Button>
        </div>
      </div>
      <SettingsSaveBar saving={saving} status={status} onSave={() => void save()} label={t(lang, "save")} />
    </div>
  );
}
