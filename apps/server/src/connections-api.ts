import type { FastifyInstance } from "fastify";
import type { Env } from "./env.ts";
import type { DB } from "./db/index.ts";
import { requireAdmin } from "./auth.ts";
import { clientForOllama, clientForOpenAI } from "./runtime.ts";
import { loadConnections, normalizeConnections, saveConnections } from "./connections.ts";
import { syncConnectionModels } from "./models.ts";

export function registerConnections(app: FastifyInstance, db: DB, env: Env) {
  app.get("/api/admin/connections", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadConnections(db, env) };
  });

  app.patch("/api/admin/connections", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeConnections(payload, env);
    for (const conn of [...config.openai, ...config.ollama]) {
      if (conn.url) {
        try {
          const parsed = new URL(conn.url);
          if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url");
        } catch {
          return reply.code(400).send({ error: `Enter a valid URL for ${conn.url || "this connection"}.` });
        }
      }
    }
    saveConnections(db, config);
    try {
      await syncConnectionModels(db, env);
    } catch {
      /* keep saved config even if sync fails */
    }
    return { config: loadConnections(db, env) };
  });

  app.post("/api/admin/connections/verify", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const body = req.body as { kind?: string; url?: string; id?: string };
    const config = loadConnections(db, env);
    const found = [...config.openai, ...config.ollama].find((item) => item.id === body.id);
    const target = found
      ? { ...found, url: String(body.url || found.url).replace(/\/$/, "") }
      : {
          id: "tmp",
          kind: body.kind === "openai" ? ("openai" as const) : ("ollama" as const),
          enabled: true,
          url: String(body.url || "").replace(/\/$/, ""),
          location: body.kind === "openai" ? ("external" as const) : ("local" as const),
          auth: "none" as const,
          apiKey: "",
          apiType: "chat" as const,
          forwardCookies: false,
          headers: "",
          passthrough: "",
          prefixId: "",
          provider: "default",
          modelIds: [] as string[],
          tags: [] as string[],
        };
    if (!target.url) return reply.code(400).send({ error: "Enter a URL." });
    try {
      if (target.kind === "openai") {
        const models = await clientForOpenAI(target).listModels();
        return { ok: true, models: models.length };
      }
      const client = clientForOllama(target);
      const version = await client.version();
      const models = await client.tags();
      return { ok: true, version, models: models.length };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not reach that connection." });
    }
  });
}
