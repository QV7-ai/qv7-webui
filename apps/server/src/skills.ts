import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { UserSkill } from "@wlfv/shared";
import { skills } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireUser } from "./auth.ts";

function publicSkill(row: typeof skills.$inferSelect): UserSkill {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    defaultOn: row.defaultOn === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerSkills(app: FastifyInstance, db: DB) {
  app.get("/api/skills", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const rows = db.select().from(skills).where(eq(skills.userId, user.id)).all();
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { skills: rows.map(publicSkill) };
  });

  app.post("/api/skills", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const body = req.body as { name?: string; content?: string; defaultOn?: boolean };
    const name = String(body.name || "").trim().slice(0, 80);
    const content = String(body.content || "").trim().slice(0, 8000);
    if (!name) return reply.code(400).send({ error: "Enter a skill name." });
    if (!content) return reply.code(400).send({ error: "Enter what this skill should do." });
    const now = Date.now();
    const row = {
      id: randomUUID(),
      userId: user.id,
      name,
      content,
      defaultOn: body.defaultOn ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(skills).values(row).run();
    return { skill: publicSkill(row) };
  });

  app.patch("/api/skills/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(skills).where(and(eq(skills.id, id), eq(skills.userId, user.id))).get();
    if (!row) return reply.code(404).send({ error: "Skill not found." });
    const body = req.body as { name?: string; content?: string; defaultOn?: boolean };
    const name = body.name == null ? row.name : String(body.name).trim().slice(0, 80);
    const content = body.content == null ? row.content : String(body.content).trim().slice(0, 8000);
    const defaultOn = body.defaultOn == null ? row.defaultOn : body.defaultOn ? 1 : 0;
    if (!name) return reply.code(400).send({ error: "Enter a skill name." });
    if (!content) return reply.code(400).send({ error: "Enter what this skill should do." });
    const now = Date.now();
    db.update(skills).set({ name, content, defaultOn, updatedAt: now }).where(eq(skills.id, row.id)).run();
    return { skill: publicSkill({ ...row, name, content, defaultOn, updatedAt: now }) };
  });

  app.delete("/api/skills/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(skills).where(and(eq(skills.id, id), eq(skills.userId, user.id))).get();
    if (!row) return reply.code(404).send({ error: "Skill not found." });
    db.delete(skills).where(eq(skills.id, row.id)).run();
    return { ok: true };
  });
}
