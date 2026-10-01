import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { DEFAULT_INTERFACE, TASK_MODEL_CURRENT, type InterfaceConfig } from "@wlfv/shared";
import { appSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireAdmin } from "./auth.ts";

const KEY = "app_interface";

function asId(value: unknown) {
  const id = String(value ?? "").trim();
  return id || TASK_MODEL_CURRENT;
}

export function normalizeInterface(raw: unknown): InterfaceConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    localTaskModelId: asId(input.localTaskModelId),
    externalTaskModelId: asId(input.externalTaskModelId),
    toolPermissionsEnabled: input.toolPermissionsEnabled === true,
    titleGenerationEnabled: input.titleGenerationEnabled !== false,
  };
}

export function loadInterface(db: DB): InterfaceConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return { ...DEFAULT_INTERFACE };
  try {
    return normalizeInterface(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_INTERFACE };
  }
}

export function saveInterface(db: DB, next: InterfaceConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}

export function registerInterface(app: FastifyInstance, db: DB) {
  app.get("/api/admin/interface", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadInterface(db) };
  });

  app.patch("/api/admin/interface", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeInterface(payload);
    saveInterface(db, config);
    return { config };
  });
}
