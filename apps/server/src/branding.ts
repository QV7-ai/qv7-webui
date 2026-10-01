import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { normalizeTheme, type BrandingConfig, type PublicBranding } from "@wlfv/shared";
import { appSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireAdmin } from "./auth.ts";
import type { Env } from "./env.ts";
import { isStoredIconName, removeStoredIcon, saveModelIcon } from "./uploads.ts";

const KEY = "app_branding";

function asPath(value: unknown) {
  const name = String(value ?? "").trim();
  return isStoredIconName(name) ? name : "";
}

function asAccent(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

export function normalizeBranding(raw: unknown): BrandingConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: String(input.name ?? "").trim().slice(0, 80),
    description: String(input.description ?? "").trim().slice(0, 300),
    accent: asAccent(input.accent),
    footer: String(input.footer ?? "").trim().slice(0, 200),
    logoPath: asPath(input.logoPath),
    faviconPath: asPath(input.faviconPath),
    splashPath: asPath(input.splashPath),
    theme: normalizeTheme(input.theme),
  };
}

export function loadBranding(db: DB): BrandingConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return normalizeBranding({});
  try {
    return normalizeBranding(JSON.parse(row.value));
  } catch {
    return normalizeBranding({});
  }
}

export function saveBranding(db: DB, next: BrandingConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}

function assetUrl(name: string) {
  return name ? `/api/uploads/${name}` : "";
}

export function publicBranding(config: BrandingConfig, env: Env): PublicBranding {
  return {
    name: config.name || env.appName || "QV7",
    description: config.description || env.appDescription,
    accent: config.accent || env.accent,
    footer: config.footer,
    logoUrl: assetUrl(config.logoPath),
    faviconUrl: assetUrl(config.faviconPath),
    splashUrl: assetUrl(config.splashPath),
    theme: config.theme,
  };
}

export function registerBranding(app: FastifyInstance, db: DB, env: Env, uploadsDir: string) {
  app.get("/api/branding", async () => publicBranding(loadBranding(db), env));

  app.get("/api/admin/branding", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const config = loadBranding(db);
    return { config, public: publicBranding(config, env) };
  });

  app.patch("/api/admin/branding", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown } & Record<string, unknown>)?.config ?? req.body;
    const incoming = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const current = loadBranding(db);
    const next = normalizeBranding({
      ...current,
      ...incoming,
      logoPath: incoming.clearLogo ? "" : incoming.logoPath ?? current.logoPath,
      faviconPath: incoming.clearFavicon ? "" : incoming.faviconPath ?? current.faviconPath,
      splashPath: incoming.clearSplash ? "" : incoming.splashPath ?? current.splashPath,
    });
    if (incoming.clearLogo) removeStoredIcon(uploadsDir, current.logoPath);
    if (incoming.clearFavicon) removeStoredIcon(uploadsDir, current.faviconPath);
    if (incoming.clearSplash) removeStoredIcon(uploadsDir, current.splashPath);
    saveBranding(db, next);
    return { config: next, public: publicBranding(next, env) };
  });

  for (const kind of ["logo", "favicon", "splash"] as const) {
    const key = `${kind}Path` as const;
    app.post(`/api/admin/branding/${kind}`, async (req, reply) => {
      const admin = await requireAdmin(req, reply, db);
      if (!admin) return;
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "Choose an image to upload." });
      try {
        const current = loadBranding(db);
        const saved = await saveModelIcon(uploadsDir, file, current[key]);
        const next = { ...current, [key]: saved.name };
        saveBranding(db, next);
        return { config: next, public: publicBranding(next, env) };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not save that image." });
      }
    });
  }
}
