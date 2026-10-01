import type { FastifyInstance } from "fastify";
import type { DB } from "../db/index.ts";
import { requireAdmin, requireUser } from "../auth.ts";
import { loadImages, normalizeImages, saveImages } from "./config.ts";

export function registerImages(app: FastifyInstance, db: DB) {
  app.get("/api/images", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const config = loadImages(db);
    return { generationEnabled: config.generationEnabled, editEnabled: config.editEnabled };
  });

  app.get("/api/admin/images", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadImages(db) };
  });

  app.patch("/api/admin/images", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeImages(payload);
    for (const endpoint of [config.create, config.edit]) {
      if (!endpoint.apiBaseUrl) continue;
      try {
        const parsed = new URL(endpoint.apiBaseUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url");
      } catch {
        return reply.code(400).send({ error: "Enter a valid API base URL (http or https)." });
      }
    }
    saveImages(db, config);
    return { config };
  });
}

export { loadImages } from "./config.ts";
export { generateImageFile, editImageFile } from "./generate.ts";
