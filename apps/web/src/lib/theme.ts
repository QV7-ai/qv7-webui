import { DEFAULT_THEME_DARK, DEFAULT_THEME_LIGHT, normalizeThemePalette, type BrandingTheme, type ThemePalette } from "@wlfv/shared";

const INLINE = [
  "--bg",
  "--sidebar",
  "--elevated",
  "--surface",
  "--hover",
  "--border",
  "--text",
  "--secondary",
  "--muted",
  "--accent",
  "--accent-soft",
  "--danger",
  "--user",
  "--ring",
  "--code-bg",
];

let theme: BrandingTheme | null = null;
let accent = "";

function rgba(hex: string, alpha: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clearInline() {
  const root = document.documentElement;
  for (const name of INLINE) root.style.removeProperty(name);
}

function applyAccent(hex: string) {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return;
  const value = `#${match[1]}`;
  const root = document.documentElement;
  root.style.setProperty("--accent", value);
  root.style.setProperty("--accent-soft", rgba(value, 0.16));
  root.style.setProperty("--ring", rgba(value, 0.4));
}

function paintPalette(colors: ThemePalette) {
  const root = document.documentElement;
  root.style.setProperty("--bg", colors.bg);
  root.style.setProperty("--sidebar", colors.sidebar);
  root.style.setProperty("--elevated", colors.elevated);
  root.style.setProperty("--surface", colors.surface);
  root.style.setProperty("--hover", colors.hover);
  root.style.setProperty("--text", colors.text);
  root.style.setProperty("--secondary", colors.secondary);
  root.style.setProperty("--muted", colors.muted);
  root.style.setProperty("--danger", colors.danger);
  root.style.setProperty("--user", colors.user);
  root.style.setProperty("--code-bg", colors.sidebar);
  const n = Number.parseInt(colors.text.slice(1), 16);
  const lum = ((0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255);
  root.style.setProperty("--border", lum > 0.6 ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)");
  applyAccent(colors.accent);
}

export function rememberBrandingTheme(next: BrandingTheme | null | undefined, nextAccent = "") {
  theme = next ?? null;
  accent = nextAccent;
  paintBrandingTheme(document.documentElement.dataset.theme || "dark");
}

export function paintBrandingTheme(mode: string) {
  if (!theme) return;
  if (!theme.enabled) {
    clearInline();
    if (accent) applyAccent(accent);
    return;
  }
  const fallback = mode === "light" ? DEFAULT_THEME_LIGHT : DEFAULT_THEME_DARK;
  paintPalette(normalizeThemePalette(mode === "light" ? theme.light : theme.dark, fallback));
}
