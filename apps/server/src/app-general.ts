import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { DEFAULT_APP_GENERAL, type AppFeatures, type AppGeneralConfig } from "@wlfv/shared";
import { appSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireAdmin } from "./auth.ts";

const KEY = "app_general";

function asNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeAppGeneral(raw: unknown): AppGeneralConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    responseWatermark: String(input.responseWatermark ?? "").slice(0, 2000),
    webUiUrl: String(input.webUiUrl ?? "").trim().slice(0, 500),
    sharingEnabled: input.sharingEnabled !== false,
    foldersEnabled: input.foldersEnabled !== false,
    maxFolderCount: Math.min(500, Math.max(0, Math.round(asNumber(input.maxFolderCount, 0)))),
    memoriesEnabled: input.memoriesEnabled !== false,
    toolWebSearch: input.toolWebSearch !== false,
    toolCode: input.toolCode !== false,
    toolCanvas: input.toolCanvas !== false,
    toolWebpage: input.toolWebpage !== false,
    toolMcp: input.toolMcp !== false,
    freeDayTokens: Math.min(1_000_000_000_000, Math.max(0, Math.round(asNumber(input.freeDayTokens, DEFAULT_APP_GENERAL.freeDayTokens)))),
    freeWeekTokens: Math.min(1_000_000_000_000, Math.max(0, Math.round(asNumber(input.freeWeekTokens, DEFAULT_APP_GENERAL.freeWeekTokens)))),
    proDayTokens: Math.min(1_000_000_000_000, Math.max(0, Math.round(asNumber(input.proDayTokens, DEFAULT_APP_GENERAL.proDayTokens)))),
    proWeekTokens: Math.min(1_000_000_000_000, Math.max(0, Math.round(asNumber(input.proWeekTokens, DEFAULT_APP_GENERAL.proWeekTokens)))),
  };
}

export function loadAppGeneral(db: DB): AppGeneralConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return { ...DEFAULT_APP_GENERAL };
  try {
    return normalizeAppGeneral(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_APP_GENERAL };
  }
}

export function saveAppGeneral(db: DB, next: AppGeneralConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}

export function publicFeatures(config: AppGeneralConfig): AppFeatures {
  return {
    sharingEnabled: config.sharingEnabled,
    foldersEnabled: config.foldersEnabled,
    maxFolderCount: config.maxFolderCount,
    memoriesEnabled: config.memoriesEnabled,
    webUiUrl: config.webUiUrl,
    toolPermissionsEnabled: false,
    imageGenerationEnabled: false,
    imageEditEnabled: false,
    toolWebSearch: config.toolWebSearch,
    toolCode: config.toolCode,
    toolCanvas: config.toolCanvas,
    toolWebpage: config.toolWebpage,
    toolMcp: config.toolMcp,
  };
}

export function registerAppGeneral(app: FastifyInstance, db: DB) {
  app.get("/api/admin/general", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadAppGeneral(db) };
  });

  app.patch("/api/admin/general", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeAppGeneral(payload);
    if (config.webUiUrl) {
      try {
        const parsed = new URL(config.webUiUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url");
      } catch {
        return reply.code(400).send({ error: "Enter a valid public WebUI URL (http or https)." });
      }
    }
    saveAppGeneral(db, config);
    return { config };
  });
}
