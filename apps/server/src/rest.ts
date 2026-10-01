import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { memories, userSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireUser } from "./auth.ts";
import { repairFalseBirthdayMemories, saveUserMemories, updateMemory } from "./memory.ts";
import { normalizeMemoryType } from "./memory-ops.ts";
import { DEFAULT_SYSTEM_PROMPT, TOOLS_PROMPT, parseGenerationSettings, parseInstructionTone, type GenerationSettings } from "@wlfv/shared";
import { computeUsage, getTokenQuota } from "./usage.ts";
import { loadAppGeneral, publicFeatures } from "./app-general.ts";
import { loadImages } from "./images/index.ts";
import { loadInterface } from "./interface.ts";

function clampTextSize(value: unknown) {
  const n = Math.round(Number(value) / 5) * 5;
  if (!Number.isFinite(n)) return 100;
  return Math.min(140, Math.max(80, n));
}

function normalizeTheme(value: unknown, fallback: string) {
  if (value === "dark" || value === "light" || value === "system" || value === "oled") return value;
  return fallback;
}

export function registerRest(app: FastifyInstance, db: DB) {
  app.get("/api/usage", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    return { ...computeUsage(db, user.id), quota: getTokenQuota(db, user.id, user.role) };
  });

  app.get("/api/memory", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const rows = repairFalseBirthdayMemories(db, user.id);
    const settings = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();
    const features = loadAppGeneral(db);
    if (!features.memoriesEnabled) return { enabled: false, memories: [] };
    return { enabled: settings?.memoryEnabled !== 0, memories: rows };
  });

  app.patch("/api/settings", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const body = req.body as {
      theme?: string;
      memoryEnabled?: boolean;
      language?: string;
      showUsage?: boolean;
      animations?: boolean;
      textSize?: number;
      systemPrompt?: string;
      instructionTone?: string;
      instructionExtra?: string;
      generation?: GenerationSettings;
    };
    const current = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();
    if (body.memoryEnabled != null && !loadAppGeneral(db).memoriesEnabled) {
      return reply.code(403).send({ error: "Memories are disabled." });
    }
    const generationJson =
      body.generation == null
        ? current?.generationParams || "{}"
        : JSON.stringify(parseGenerationSettings(body.generation));
    if (!current) {
      db.insert(userSettings)
        .values({
          userId: user.id,
          theme: normalizeTheme(body.theme, "dark"),
          compact: 0,
          animations: body.animations === false ? 0 : 1,
          memoryEnabled: body.memoryEnabled === false ? 0 : 1,
          language: body.language === "nl" ? "nl" : body.language === "en" ? "en" : "en",
          showUsage: body.showUsage === false ? 0 : 1,
          textSize: body.textSize == null ? 100 : clampTextSize(body.textSize),
          systemPrompt: (body.systemPrompt ?? DEFAULT_SYSTEM_PROMPT).slice(0, 16000),
          instructionTone: parseInstructionTone(body.instructionTone),
          instructionExtra: String(body.instructionExtra || "").slice(0, 4000),
          generationParams: generationJson,
        })
        .run();
    } else {
      db.update(userSettings)
        .set({
          theme: body.theme == null ? current.theme : normalizeTheme(body.theme, current.theme),
          memoryEnabled: body.memoryEnabled == null ? current.memoryEnabled : body.memoryEnabled ? 1 : 0,
          language: body.language == null ? current.language : body.language === "nl" ? "nl" : "en",
          showUsage: body.showUsage == null ? current.showUsage : body.showUsage ? 1 : 0,
          animations: body.animations == null ? current.animations : body.animations ? 1 : 0,
          textSize: body.textSize == null ? current.textSize ?? 100 : clampTextSize(body.textSize),
          systemPrompt: body.systemPrompt == null ? current.systemPrompt : body.systemPrompt.slice(0, 16000),
          instructionTone: body.instructionTone == null ? current.instructionTone : parseInstructionTone(body.instructionTone),
          instructionExtra: body.instructionExtra == null ? current.instructionExtra : String(body.instructionExtra).slice(0, 4000),
          generationParams: generationJson,
        })
        .where(eq(userSettings.userId, user.id))
        .run();
    }
    return { ok: true };
  });

  app.get("/api/settings", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const current = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();
    let generation = parseGenerationSettings({});
    try {
      generation = parseGenerationSettings(JSON.parse(current?.generationParams || "{}"));
    } catch {
      generation = parseGenerationSettings({});
    }
    return {
      theme: current?.theme ?? "dark",
      memoryEnabled: current?.memoryEnabled !== 0,
      showUsage: current?.showUsage !== 0,
      animations: current?.animations !== 0,
      textSize: clampTextSize(current?.textSize ?? 100),
      language: current?.language === "nl" ? "nl" : "en",
      systemPrompt: current?.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      instructionTone: parseInstructionTone(current?.instructionTone),
      instructionExtra: current?.instructionExtra || "",
      generation,
      features: {
        ...publicFeatures(loadAppGeneral(db)),
        toolPermissionsEnabled: loadInterface(db).toolPermissionsEnabled,
        imageGenerationEnabled: loadImages(db).generationEnabled,
        imageEditEnabled: loadImages(db).editEnabled,
      },
    };
  });

  app.post("/api/memory/import", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).memoriesEnabled) return reply.code(403).send({ error: "Memories are disabled." });
    const body = req.body as { memories?: { content?: string; category?: string; path?: string; memoryType?: string; type?: string }[] };
    const drafts = (Array.isArray(body.memories) ? body.memories : [])
      .map((item) => ({
        content: String(item?.content || "").trim(),
        category: String(item?.category || "other").slice(0, 40) || "other",
        path: String(item?.path || ""),
        memoryType: normalizeMemoryType(String(item?.memoryType || item?.type || "user")),
      }))
      .filter((item) => item.content);
    if (!drafts.length) return reply.code(400).send({ error: "No memories to import." });
    const saved = saveUserMemories(db, user.id, drafts);
    const rows = db.select().from(memories).where(eq(memories.userId, user.id)).all();
    return { ok: true, imported: saved.length, memories: rows };
  });

  app.post("/api/memory", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).memoriesEnabled) return reply.code(403).send({ error: "Memories are disabled." });
    const body = req.body as { content?: string; category?: string; path?: string; memoryType?: string; type?: string };
    const content = String(body.content || "").trim();
    if (!content) return reply.code(400).send({ error: "Enter something to remember." });
    const category = String(body.category || "other").slice(0, 40) || "other";
    const saved = saveUserMemories(db, user.id, [
      {
        content,
        category,
        path: String(body.path || ""),
        memoryType: normalizeMemoryType(String(body.memoryType || body.type || "user")),
      },
    ]);
    const rows = db.select().from(memories).where(eq(memories.userId, user.id)).all();
    return { ok: true, saved, memories: rows };
  });

  app.delete("/api/memory", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).memoriesEnabled) return reply.code(403).send({ error: "Memories are disabled." });
    db.delete(memories).where(eq(memories.userId, user.id)).run();
    return { ok: true };
  });

  app.delete("/api/memory/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).memoriesEnabled) return reply.code(403).send({ error: "Memories are disabled." });
    const { id } = req.params as { id: string };
    const row = db.select().from(memories).where(eq(memories.id, id)).get();
    if (!row || row.userId !== user.id) return reply.code(404).send({ error: "Not found." });
    db.delete(memories).where(eq(memories.id, id)).run();
    return { ok: true };
  });

  app.patch("/api/memory/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).memoriesEnabled) return reply.code(403).send({ error: "Memories are disabled." });
    const { id } = req.params as { id: string };
    const body = req.body as { content?: string; category?: string; path?: string; memoryType?: string; type?: string };
    const updated = updateMemory(db, user.id, id, {
      content: body.content,
      category: body.category,
      path: body.path,
      memoryType: body.memoryType || body.type,
    });
    if (!updated) return reply.code(404).send({ error: "Not found." });
    return { memory: updated };
  });

  app.get("/api/tools", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    return { prompt: TOOLS_PROMPT };
  });
}
