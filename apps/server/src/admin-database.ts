import fs from "node:fs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { conversations, messages, modelCategories, modelConfigs, users } from "./db/schema.ts";
import { checkpointDatabase, databasePath, type DB } from "./db/index.ts";
import { requireAdmin } from "./auth.ts";
import { loadAppGeneral, normalizeAppGeneral, saveAppGeneral } from "./app-general.ts";
import { loadBranding, normalizeBranding, saveBranding } from "./branding.ts";
import { loadInterface, normalizeInterface, saveInterface } from "./interface.ts";
import { loadAuthConfig, normalizeAuthConfig, saveAuthConfig } from "./auth-config.ts";
import { loadConnections, normalizeConnections, saveConnections } from "./connections.ts";
import { loadWebSearch, normalizeWebSearch, saveWebSearch } from "./web-search/config.ts";
import type { Env } from "./env.ts";

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sendDownload(reply: { header: (k: string, v: string) => unknown; send: (b: unknown) => unknown }, name: string, type: string, body: string | Buffer) {
  reply.header("Content-Type", type);
  reply.header("Content-Disposition", `attachment; filename="${name}"`);
  return reply.send(body);
}

export function registerAdminDatabase(app: FastifyInstance, db: DB, env: Env) {
  app.get("/api/admin/database/config", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      general: loadAppGeneral(db),
      branding: loadBranding(db),
      interface: loadInterface(db),
      auth: loadAuthConfig(db),
      connections: loadConnections(db, env),
      webSearch: loadWebSearch(db),
      categories: db.select().from(modelCategories).all(),
      models: db.select().from(modelConfigs).all(),
    };
    return sendDownload(reply, `qv7-config-${stamp()}.json`, "application/json; charset=utf-8", JSON.stringify(payload, null, 2));
  });

  app.post("/api/admin/database/config", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const raw = req.body as Record<string, unknown> | null;
    const payload = raw && typeof raw === "object" ? raw : {};
    const nested = payload.config && typeof payload.config === "object" ? (payload.config as Record<string, unknown>) : payload;
    if (nested.general) saveAppGeneral(db, normalizeAppGeneral(nested.general));
    if (nested.branding) saveBranding(db, normalizeBranding(nested.branding));
    if (nested.interface) saveInterface(db, normalizeInterface(nested.interface));
    if (nested.auth) saveAuthConfig(db, normalizeAuthConfig(nested.auth));
    if (nested.connections) saveConnections(db, normalizeConnections(nested.connections, env));
    if (nested.webSearch) saveWebSearch(db, normalizeWebSearch(nested.webSearch));
    const now = Date.now();
    const categories = Array.isArray(nested.categories) ? nested.categories : [];
    for (const item of categories) {
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: string; name?: string; sortOrder?: number };
      const id = String(row.id || "").trim();
      const name = String(row.name || "").trim();
      if (!id || !name) continue;
      const existing = db.select().from(modelCategories).where(eq(modelCategories.id, id)).get();
      if (existing) {
        db.update(modelCategories)
          .set({ name, sortOrder: row.sortOrder ?? existing.sortOrder, updatedAt: now })
          .where(eq(modelCategories.id, id))
          .run();
      } else {
        db.insert(modelCategories).values({ id, name, sortOrder: row.sortOrder ?? 0, createdAt: now, updatedAt: now }).run();
      }
    }
    const models = Array.isArray(nested.models) ? nested.models : [];
    for (const item of models) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id || "").trim();
      const ollamaModel = String(row.ollamaModel || "").trim();
      const displayName = String(row.displayName || "").trim();
      if (!id || !ollamaModel || !displayName) continue;
      const existing =
        db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get() ||
        db.select().from(modelConfigs).where(eq(modelConfigs.ollamaModel, ollamaModel)).get();
      const values = {
        ollamaModel,
        displayName,
        description: String(row.description ?? existing?.description ?? ""),
        iconPath: (row.iconPath as string | null | undefined) ?? existing?.iconPath ?? null,
        iconType: (row.iconType as string | null | undefined) ?? existing?.iconType ?? null,
        family: String(row.family || existing?.family || "other"),
        enabled: row.enabled == null ? existing?.enabled ?? 0 : row.enabled ? 1 : 0,
        thinkingSupported: row.thinkingSupported == null ? existing?.thinkingSupported ?? 0 : row.thinkingSupported ? 1 : 0,
        thinkingLevels: String(row.thinkingLevels || existing?.thinkingLevels || "[]"),
        thinkValues: String(row.thinkValues || existing?.thinkValues || "[]"),
        visionSupported: row.visionSupported == null ? existing?.visionSupported ?? 0 : row.visionSupported ? 1 : 0,
        toolsSupported: row.toolsSupported == null ? existing?.toolsSupported ?? 0 : row.toolsSupported ? 1 : 0,
        structuredOutputSupported:
          row.structuredOutputSupported == null ? existing?.structuredOutputSupported ?? 0 : row.structuredOutputSupported ? 1 : 0,
        contextLength: (row.contextLength as number | null | undefined) ?? existing?.contextLength ?? null,
        sortOrder: Number(row.sortOrder ?? existing?.sortOrder ?? 0) || 0,
        missing: row.missing == null ? existing?.missing ?? 0 : row.missing ? 1 : 0,
        categoryId: (row.categoryId as string | null | undefined) ?? existing?.categoryId ?? null,
        kind: String(row.kind || existing?.kind || "installed"),
        systemPrompt: String(row.systemPrompt ?? existing?.systemPrompt ?? ""),
        baseModelId: (row.baseModelId as string | null | undefined) ?? existing?.baseModelId ?? null,
        connectionId: (row.connectionId as string | null | undefined) ?? existing?.connectionId ?? null,
        providerKind: String(row.providerKind || existing?.providerKind || "ollama"),
        remoteModel: (row.remoteModel as string | null | undefined) ?? existing?.remoteModel ?? null,
        hidden: row.hidden == null ? existing?.hidden ?? 0 : row.hidden ? 1 : 0,
        isPublic: row.isPublic == null ? existing?.isPublic ?? 1 : row.isPublic ? 1 : 0,
        isMain: row.isMain == null ? existing?.isMain ?? 0 : row.isMain ? 1 : 0,
        generationParams: String(row.generationParams || existing?.generationParams || "{}"),
        updatedAt: now,
      };
      if (existing) {
        db.update(modelConfigs).set(values).where(eq(modelConfigs.id, existing.id)).run();
      } else {
        db.insert(modelConfigs).values({ id, createdAt: Number(row.createdAt) || now, ...values }).run();
      }
    }
    return { ok: true };
  });

  app.get("/api/admin/database/file", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const file = databasePath();
    if (!file || !fs.existsSync(file)) return reply.code(400).send({ error: "The application database file is not available." });
    try {
      checkpointDatabase();
    } catch {
      /* still export the main file */
    }
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="qv7-${stamp()}.db"`);
    return reply.send(fs.createReadStream(file));
  });

  app.get("/api/admin/database/chats", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const people = db
      .select()
      .from(users)
      .all()
      .map((user) => ({
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      }));
    const byUser = new Map(people.map((user) => [user.id, user]));
    const chats = db
      .select()
      .from(conversations)
      .all()
      .map((convo) => ({
        id: convo.id,
        userId: convo.userId,
        username: byUser.get(convo.userId)?.username || "",
        title: convo.title,
        modelId: convo.modelId,
        folderId: convo.folderId,
        archived: Boolean(convo.archived),
        pinned: Boolean(convo.pinned),
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
        messages: db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, convo.id))
          .all()
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            thinking: message.thinking,
            modelId: message.modelId,
            status: message.status,
            createdAt: message.createdAt,
          })),
      }));
    const payload = { exportedAt: new Date().toISOString(), users: people, conversations: chats };
    return sendDownload(reply, `qv7-chats-${stamp()}.json`, "application/json; charset=utf-8", JSON.stringify(payload, null, 2));
  });

  app.get("/api/admin/database/users", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const header = ["id", "email", "username", "displayName", "role", "createdAt", "lastLoginAt"];
    const rows = db
      .select()
      .from(users)
      .all()
      .map((user) =>
        [
          user.id,
          user.email,
          user.username,
          user.displayName || user.username,
          user.role,
          user.createdAt,
          user.lastLoginAt ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    const csv = [header.join(","), ...rows].join("\n");
    return sendDownload(reply, `qv7-users-${stamp()}.csv`, "text/csv; charset=utf-8", csv);
  });
}
