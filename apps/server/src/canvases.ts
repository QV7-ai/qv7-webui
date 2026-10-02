import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireUser } from "./auth.ts";
import { loadAppGeneral } from "./app-general.ts";
import type { DB } from "./db/index.ts";
import { canvasShares } from "./db/schema.ts";

const idPattern = /^[A-Za-z0-9_-]{12,32}$/;

export function registerCanvases(app: FastifyInstance, db: DB) {
  app.post("/api/canvases", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const general = loadAppGeneral(db);
    if (!general.sharingEnabled) return reply.code(403).send({ error: "Sharing is disabled." });
    if (user.role !== "admin" && !general.toolCanvas) return reply.code(403).send({ error: "Canvas is disabled." });
    const body = (req.body ?? {}) as { title?: unknown; html?: unknown };
    const html = typeof body.html === "string" ? body.html : "";
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
    if (!html.trim() || html.length > 80000) return reply.code(400).send({ error: "This page cannot be shared." });
    const id = randomBytes(12).toString("base64url");
    db.insert(canvasShares)
      .values({ id, userId: user.id, title: title || "Page", html, createdAt: Date.now() })
      .run();
    return { id };
  });

  app.get("/c/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!idPattern.test(id)) return reply.code(404).type("text/plain").send("Not found.");
    const row = db.select().from(canvasShares).where(eq(canvasShares.id, id)).get();
    if (!row) return reply.code(404).type("text/plain").send("Not found.");
    return reply
      .type("text/html; charset=utf-8")
      .header("Content-Security-Policy", "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(row.html);
  });
}
