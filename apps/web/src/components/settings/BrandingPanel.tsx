import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { DEFAULT_BRANDING, normalizeTheme, type BrandingConfig, type PublicBranding } from "@wlfv/shared";
import { api } from "@/lib/api";
import { applyPublicBranding } from "@/lib/branding";
import { rememberBrandingTheme } from "@/lib/theme";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { ThemeMaker } from "@/components/settings/ThemeMaker";
import { useT } from "@/lib/language";

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

function ImageSlot({
  title,
  hint,
  preview,
  accept,
  onPick,
  onClear,
}: {
  title: string;
  hint: string;
  preview?: string;
  accept: string;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="py-3">
      <p className="text-[13px] text-[var(--secondary)]">{title}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-[var(--surface)]"
          onClick={() => fileRef.current?.click()}
          aria-label={`Upload ${title.toLowerCase()}`}
        >
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-contain p-1" />
          ) : (
            <span className="text-[11px] text-[var(--muted)]">Upload</span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-[var(--muted)]">{hint}</p>
          {preview ? (
            <button type="button" className="mt-1 inline-flex items-center gap-1 text-[12px] text-[var(--danger)]" onClick={onClear}>
              <X size={12} />
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function BrandingPanel({ onChange }: { onChange?: (branding: PublicBranding) => void }) {
  const tr = useT();
  const [config, setConfig] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [splashUrl, setSplashUrl] = useState("");
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [pendingFavicon, setPendingFavicon] = useState<File | null>(null);
  const [pendingSplash, setPendingSplash] = useState<File | null>(null);
  const [clearLogo, setClearLogo] = useState(false);
  const [clearFavicon, setClearFavicon] = useState(false);
  const [clearSplash, setClearSplash] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const saved = useRef<PublicBranding | null>(null);

  useEffect(() => {
    api
      .get("/api/admin/branding")
      .then((data) => {
        const next = { ...DEFAULT_BRANDING, ...(data.config as BrandingConfig), theme: normalizeTheme((data.config as BrandingConfig)?.theme) };
        setConfig(next);
        const pub = data.public as PublicBranding;
        saved.current = pub;
        setReady(true);
        setLogoUrl(pub.logoUrl || "");
        setFaviconUrl(pub.faviconUrl || "");
        setSplashUrl(pub.splashUrl || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (saved.current) applyPublicBranding(saved.current);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const accent = config.theme.enabled ? config.theme.dark.accent : config.accent;
    rememberBrandingTheme(config.theme, accent);
  }, [ready, config.theme, config.accent]);

  useEffect(() => {
    if (!pendingLogo) return;
    const url = URL.createObjectURL(pendingLogo);
    setLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingLogo]);

  useEffect(() => {
    if (!pendingFavicon) return;
    const url = URL.createObjectURL(pendingFavicon);
    setFaviconUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFavicon]);

  useEffect(() => {
    if (!pendingSplash) return;
    const url = URL.createObjectURL(pendingSplash);
    setSplashUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingSplash]);

  async function save() {
    setSaving(true);
    try {
      let data = await api.send("/api/admin/branding", "PATCH", {
        name: config.name,
        description: config.description,
        accent: config.theme.enabled ? config.theme.dark.accent : config.accent,
        theme: config.theme,
        footer: config.footer,
        clearLogo,
        clearFavicon,
        clearSplash,
      });
      if (pendingLogo) data = await api.upload("/api/admin/branding/logo", pendingLogo);
      if (pendingFavicon) data = await api.upload("/api/admin/branding/favicon", pendingFavicon);
      if (pendingSplash) data = await api.upload("/api/admin/branding/splash", pendingSplash);
      const next = { ...DEFAULT_BRANDING, ...data.config, theme: normalizeTheme(data.config?.theme) };
      setConfig(next);
      const pub = data.public as PublicBranding;
      saved.current = pub;
      setLogoUrl(pub.logoUrl || "");
      setFaviconUrl(pub.faviconUrl || "");
      setSplashUrl(pub.splashUrl || "");
      setPendingLogo(null);
      setPendingFavicon(null);
      setPendingSplash(null);
      setClearLogo(false);
      setClearFavicon(false);
      setClearSplash(false);
      onChange?.(pub);
      setStatus(tr("saved"));
      setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : tr("couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  const accentValue = config.accent && /^#[0-9a-f]{6}$/i.test(config.accent) ? config.accent : "#FE4901";

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("brandingNav")}</h2>
      <p className="mt-2 text-[13px] text-[var(--muted)]">{tr("brandingLead")}</p>
      <Field title={tr("websiteName")} hint={tr("websiteNameHint")}>
        <input className={inputClass} value={config.name} placeholder="QV7" onChange={(event) => setConfig({ ...config, name: event.target.value })} />
      </Field>
      <Field title={tr("description")} hint={tr("descriptionHint")}>
        <input
          className={inputClass}
          value={config.description}
          placeholder="Self-hosted AI chat"
          onChange={(event) => setConfig({ ...config, description: event.target.value })}
        />
      </Field>
      <Field title={tr("accentColor")} hint={tr("accentColorHint")}>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            aria-label={tr("accentColor")}
            className="h-9 w-12 cursor-pointer rounded-lg bg-[var(--surface)]"
            value={accentValue}
            onChange={(event) => setConfig({ ...config, accent: event.target.value.toUpperCase() })}
          />
          <input
            className={`${inputClass} mt-0 flex-1`}
            value={config.accent}
            placeholder="#FE4901"
            onChange={(event) => setConfig({ ...config, accent: event.target.value })}
          />
        </div>
      </Field>
      <ThemeMaker
        enabled={config.theme.enabled}
        mode={themeMode}
        colors={config.theme[themeMode]}
        onEnabled={(enabled) => setConfig({ ...config, theme: { ...config.theme, enabled } })}
        onMode={setThemeMode}
        onColors={(colors) => setConfig({ ...config, theme: { ...config.theme, [themeMode]: colors } })}
      />
      <Field title={tr("footer")} hint={tr("footerHint")}>
        <input className={inputClass} value={config.footer} placeholder="Powered by QV7" onChange={(event) => setConfig({ ...config, footer: event.target.value })} />
      </Field>
      <ImageSlot
        title={tr("logo")}
        hint={tr("logoHint")}
        preview={clearLogo ? "" : logoUrl}
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        onPick={(file) => {
          setPendingLogo(file);
          setClearLogo(false);
        }}
        onClear={() => {
          setPendingLogo(null);
          setLogoUrl("");
          setClearLogo(true);
        }}
      />
      <ImageSlot
        title={tr("favicon")}
        hint={tr("faviconHint")}
        preview={clearFavicon ? "" : faviconUrl}
        accept="image/png,image/svg+xml,image/x-icon,.ico"
        onPick={(file) => {
          setPendingFavicon(file);
          setClearFavicon(false);
        }}
        onClear={() => {
          setPendingFavicon(null);
          setFaviconUrl("");
          setClearFavicon(true);
        }}
      />
      <ImageSlot
        title={tr("splashImage")}
        hint={tr("splashHint")}
        preview={clearSplash ? "" : splashUrl}
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        onPick={(file) => {
          setPendingSplash(file);
          setClearSplash(false);
        }}
        onClear={() => {
          setPendingSplash(null);
          setSplashUrl("");
          setClearSplash(true);
        }}
      />
      <SettingsSaveBar saving={saving} status={status} onSave={() => void save()} />
    </div>
  );
}
