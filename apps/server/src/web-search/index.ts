import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.ts";
import { appSettings } from "../db/schema.ts";
import { requireAdmin, requireUser } from "../auth.ts";
import { loadWebSearch, normalizeWebSearch, saveWebSearch } from "./config.ts";

const CONFIRM_DEFAULT_OFF = "web_search_confirm_default_off";

export function registerWebSearch(app: FastifyInstance, db: DB) {
  const flagged = db.select().from(appSettings).where(eq(appSettings.key, CONFIRM_DEFAULT_OFF)).get();
  if (!flagged) {
    const current = loadWebSearch(db);
    if (current.confirmation) saveWebSearch(db, { ...current, confirmation: false });
    db.insert(appSettings).values({ key: CONFIRM_DEFAULT_OFF, value: "1", updatedAt: Date.now() }).run();
  }
  app.get("/api/web-search", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const config = loadWebSearch(db);
    return { enabled: config.enabled, confirmation: config.confirmation };
  });

  app.get("/api/admin/web-search", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadWebSearch(db) };
  });

  app.patch("/api/admin/web-search", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeWebSearch(payload);
    try {
      new URL(config.searxngQueryUrl.replaceAll("<query>", "test"));
    } catch {
      return reply.code(400).send({ error: "Enter a valid SearXNG query URL." });
    }
    if (config.youtubeProxyUrl) {
      try {
        const parsed = new URL(config.youtubeProxyUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("proxy");
      } catch {
        return reply.code(400).send({ error: "Enter a valid YouTube proxy URL." });
      }
    }
    saveWebSearch(db, config);
    return { config };
  });
}

export { loadWebSearch } from "./config.ts";
export { runWebSearch } from "./search.ts";
