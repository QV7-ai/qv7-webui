import type { PublicBranding } from "@wlfv/shared";
import { DEFAULT_LOGO } from "@/lib/branding";

function setMeta(name: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function setLink(rel: string, href: string, extra?: Record<string, string>) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  if (extra) {
    for (const [key, value] of Object.entries(extra)) link.setAttribute(key, value);
  }
}

function paintIcon(letter: string, accent: string, size: number, image?: HTMLImageElement | null) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#141416";
  ctx.fillRect(0, 0, size, size);
  if (image && image.naturalWidth) {
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  } else {
    const pad = size * 0.18;
    ctx.fillStyle = accent || "#fe4901";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, size * 0.16);
    else ctx.rect(pad, pad, size - pad * 2, size - pad * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(size * 0.4)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((letter || "Q").slice(0, 1).toUpperCase(), size / 2, size / 2 + size * 0.02);
  }
  return canvas.toDataURL("image/png");
}

async function loadImage(url: string) {
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);
    return image;
  } catch {
    return null;
  }
}

let manifestObjectUrl = "";

export async function applyWebApp(branding: PublicBranding) {
  const name = branding.name || "QV7";
  const accent = branding.accent || "#fe4901";
  const source = await loadImage(branding.faviconUrl || branding.logoUrl || DEFAULT_LOGO);
  const icon192 = paintIcon(name, accent, 192, source);
  const icon512 = paintIcon(name, accent, 512, source);
  const apple = paintIcon(name, accent, 180, source);
  setMeta("theme-color", accent);
  setMeta("apple-mobile-web-app-title", name);
  if (apple) setLink("apple-touch-icon", apple, { sizes: "180x180" });
  const manifest = {
    id: "/",
    name,
    short_name: name.slice(0, 12),
    description: branding.description || "Self-hosted AI chat",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#141416",
    theme_color: accent,
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  if (manifestObjectUrl) URL.revokeObjectURL(manifestObjectUrl);
  manifestObjectUrl = URL.createObjectURL(blob);
  setLink("manifest", manifestObjectUrl);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (location.protocol !== "https:" && !local) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

export function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
