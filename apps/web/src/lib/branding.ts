import { normalizeTheme, type PublicBranding } from "@wlfv/shared";
import { rememberBrandingTheme } from "@/lib/theme";

export const DEFAULT_LOGO = "/QV7.png";

export const EMPTY_BRANDING: PublicBranding = {
  name: "QV7",
  description: "",
  accent: "",
  footer: "",
  logoUrl: DEFAULT_LOGO,
  faviconUrl: "",
  splashUrl: "",
  theme: normalizeTheme(null),
};

function setLink(rel: string, href: string) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

export function applyPublicBranding(branding: PublicBranding) {
  const name = branding.name || "QV7";
  document.title = name;
  rememberBrandingTheme(normalizeTheme(branding.theme), branding.accent);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (branding.description) {
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = branding.description;
  }
  setLink("icon", branding.faviconUrl || branding.logoUrl || DEFAULT_LOGO);
  setLink("apple-touch-icon", branding.logoUrl || branding.faviconUrl || DEFAULT_LOGO);
}

export function asPublicBranding(data: Partial<PublicBranding> | null | undefined): PublicBranding {
  return {
    ...EMPTY_BRANDING,
    ...data,
    name: data?.name || "QV7",
    logoUrl: data?.logoUrl || DEFAULT_LOGO,
    faviconUrl: data?.faviconUrl || "",
    splashUrl: data?.splashUrl || "",
    theme: normalizeTheme(data?.theme),
  };
}
