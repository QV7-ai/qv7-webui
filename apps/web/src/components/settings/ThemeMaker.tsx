import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  THEME_COLOR_KEYS,
  type ThemeColorKey,
  type ThemePalette,
} from "@wlfv/shared";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/language";

const LABELS: Record<ThemeColorKey, "themeBg" | "themeSidebar" | "themeElevated" | "themeSurface" | "themeHover" | "themeText" | "themeSecondary" | "themeMuted" | "themeAccent" | "themeDanger" | "themeUser"> = {
  bg: "themeBg",
  sidebar: "themeSidebar",
  elevated: "themeElevated",
  surface: "themeSurface",
  hover: "themeHover",
  text: "themeText",
  secondary: "themeSecondary",
  muted: "themeMuted",
  accent: "themeAccent",
  danger: "themeDanger",
  user: "themeUser",
};

const DARK_PRESETS: { id: string; label: "presetDefault" | "presetOled" | "presetOcean" | "presetForest"; colors: ThemePalette }[] = [
  { id: "default", label: "presetDefault", colors: DEFAULT_THEME_DARK },
  {
    id: "oled",
    label: "presetOled",
    colors: { ...DEFAULT_THEME_DARK, bg: "#000000", sidebar: "#000000", elevated: "#050505", surface: "#0A0A0A", hover: "#141414", user: "#0A0A0A" },
  },
  {
    id: "ocean",
    label: "presetOcean",
    colors: {
      bg: "#0B1220",
      sidebar: "#0A1020",
      elevated: "#10182B",
      surface: "#172033",
      hover: "#1D2942",
      text: "#E8EEFC",
      secondary: "#A9B6D3",
      muted: "#7D8AAB",
      accent: "#3D8BFD",
      danger: "#EF6B5C",
      user: "#172033",
    },
  },
  {
    id: "forest",
    label: "presetForest",
    colors: {
      bg: "#101612",
      sidebar: "#0E1410",
      elevated: "#161D18",
      surface: "#1E2820",
      hover: "#263128",
      text: "#E7F2EA",
      secondary: "#A8C0B0",
      muted: "#7D9486",
      accent: "#3D9A57",
      danger: "#EF6B5C",
      user: "#1E2820",
    },
  },
];

const LIGHT_PRESETS: { id: string; label: "presetDefault" | "presetOcean"; colors: ThemePalette }[] = [
  { id: "default", label: "presetDefault", colors: DEFAULT_THEME_LIGHT },
  {
    id: "ocean",
    label: "presetOcean",
    colors: {
      ...DEFAULT_THEME_LIGHT,
      bg: "#F3F6FB",
      sidebar: "#E7EEF8",
      elevated: "#FFFFFF",
      surface: "#E7EEF8",
      hover: "#D9E4F5",
      text: "#142033",
      secondary: "#4C5B73",
      muted: "#7D8AAB",
      accent: "#2F6FE0",
      user: "#E7EEF8",
    },
  },
];

function inkOn(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.62 ? "#161513" : "#F5F5F5";
}

export function ThemeMaker({
  enabled,
  mode,
  colors,
  onEnabled,
  onMode,
  onColors,
}: {
  enabled: boolean;
  mode: "dark" | "light";
  colors: ThemePalette;
  onEnabled: (enabled: boolean) => void;
  onMode: (mode: "dark" | "light") => void;
  onColors: (colors: ThemePalette) => void;
}) {
  const tr = useT();
  const presets = mode === "light" ? LIGHT_PRESETS : DARK_PRESETS;

  return (
    <section className="mt-2 border-t border-[var(--border)] py-4">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-[14px] font-medium">{tr("customTheme")}</span>
          <span className="mt-1 block text-[13px] text-[var(--muted)]">{tr("customThemeHint")}</span>
        </span>
        <Switch checked={enabled} onChange={onEnabled} label={tr("customTheme")} />
      </label>
      <div className={`mt-4 ${enabled ? "" : "pointer-events-none opacity-45"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-40 rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none"
            value={mode}
            aria-label={tr("customTheme")}
            onChange={(event) => onMode(event.target.value === "light" ? "light" : "dark")}
          >
            <option value="dark">{tr("themeDark")}</option>
            <option value="light">{tr("themeLight")}</option>
          </select>
          <button
            type="button"
            className="ml-auto h-8 rounded-lg px-2 text-[12px] text-[var(--secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={() => onColors(mode === "light" ? { ...DEFAULT_THEME_LIGHT } : { ...DEFAULT_THEME_DARK })}
          >
            {tr("themeReset")}
          </button>
        </div>
        <p className="mt-4 text-[12px] text-[var(--muted)]">{tr("themePreview")}</p>
        <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]" style={{ background: colors.bg, color: colors.text }}>
          <div className="flex min-h-28">
            <div className="w-20 shrink-0 px-2 py-3 text-[11px]" style={{ background: colors.sidebar, color: colors.muted }}>
              QV7
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-3 py-3">
              <div className="ml-auto max-w-[80%] rounded-lg px-2 py-1 text-[12px]" style={{ background: colors.user }}>
                Hello
              </div>
              <div className="max-w-[80%] rounded-lg px-2 py-1 text-[12px]" style={{ background: colors.elevated, color: colors.secondary }}>
                Hi
              </div>
              <span className="w-fit rounded-md px-2 py-1 text-[12px]" style={{ background: colors.accent, color: inkOn(colors.accent) }}>
                Send
              </span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12px] text-[var(--muted)]">{tr("themePresets")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="h-8 rounded-lg bg-[var(--surface)] px-3 text-[12px] text-[var(--secondary)] hover:text-[var(--text)]"
              onClick={() => onColors({ ...preset.colors })}
            >
              {tr(preset.label)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {THEME_COLOR_KEYS.map((key) => (
            <label key={key} className="block">
              <span className="text-[12px] text-[var(--secondary)]">{tr(LABELS[key])}</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  aria-label={tr(LABELS[key])}
                  className="h-9 w-12 cursor-pointer rounded-lg bg-[var(--surface)]"
                  value={colors[key]}
                  onChange={(event) => onColors({ ...colors, [key]: event.target.value.toUpperCase() })}
                />
                <input
                  className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none"
                  value={colors[key]}
                  onChange={(event) => onColors({ ...colors, [key]: event.target.value })}
                />
              </span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
