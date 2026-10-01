import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { FOLDER_ICONS, type ChatFolder, type FolderIconName } from "@wlfv/shared";
import { conversations, folders } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireUser } from "./auth.ts";
import { loadAppGeneral } from "./app-general.ts";

const COLOR = /^#([0-9a-fA-F]{6})$/;
const ICONS = new Set<string>(FOLDER_ICONS);

function publicFolder(row: typeof folders.$inferSelect): ChatFolder {
  return {
    id: row.id,
    name: row.name,
    icon: (ICONS.has(row.icon) ? row.icon : "folder") as FolderIconName,
    iconColor: COLOR.test(row.iconColor) ? row.iconColor : "#C9864A",
    systemPrompt: row.systemPrompt,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseIcon(value: unknown): FolderIconName {
  const icon = String(value || "folder");
  return (ICONS.has(icon) ? icon : "folder") as FolderIconName;
}

function parseColor(value: unknown) {
  const color = String(value || "#C9864A").trim();
  return COLOR.test(color) ? color : "#C9864A";
}

export function registerFolders(app: FastifyInstance, db: DB) {
  app.get("/api/folders", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const general = loadAppGeneral(db);
    if (!general.foldersEnabled) return { folders: [] };
    const rows = db.select().from(folders).where(eq(folders.userId, user.id)).all();
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    return { folders: rows.map(publicFolder) };
  });

  app.post("/api/folders", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const general = loadAppGeneral(db);
    if (!general.foldersEnabled) return reply.code(403).send({ error: "Folders are disabled." });
    const body = req.body as { name?: string; icon?: string; iconColor?: string; systemPrompt?: string };
    const name = (body.name || "").trim() || "New folder";
    const existing = db.select().from(folders).where(eq(folders.userId, user.id)).all();
    if (general.maxFolderCount > 0 && existing.length >= general.maxFolderCount) {
      return reply.code(400).send({ error: `You can create at most ${general.maxFolderCount} folders.` });
    }
    const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    const now = Date.now();
    const id = randomUUID();
    db.insert(folders)
      .values({
        id,
        userId: user.id,
        name,
        icon: parseIcon(body.icon),
        iconColor: parseColor(body.iconColor),
        systemPrompt: (body.systemPrompt || "").trim(),
        sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = db.select().from(folders).where(eq(folders.id, id)).get()!;
    return { folder: publicFolder(row) };
  });

  app.patch("/api/folders/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).foldersEnabled) return reply.code(403).send({ error: "Folders are disabled." });
    const { id } = req.params as { id: string };
    const row = db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, user.id))).get();
    if (!row) return reply.code(404).send({ error: "Folder not found." });
    const body = req.body as { name?: string; icon?: string; iconColor?: string; systemPrompt?: string; sortOrder?: number };
    const name = body.name != null ? body.name.trim() || row.name : row.name;
    db.update(folders)
      .set({
        name,
        icon: body.icon != null ? parseIcon(body.icon) : row.icon,
        iconColor: body.iconColor != null ? parseColor(body.iconColor) : row.iconColor,
        systemPrompt: body.systemPrompt != null ? body.systemPrompt : row.systemPrompt,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : row.sortOrder,
        updatedAt: Date.now(),
      })
      .where(eq(folders.id, id))
      .run();
    const next = db.select().from(folders).where(eq(folders.id, id)).get()!;
    return { folder: publicFolder(next) };
  });

  app.delete("/api/folders/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (!loadAppGeneral(db).foldersEnabled) return reply.code(403).send({ error: "Folders are disabled." });
    const { id } = req.params as { id: string };
    const row = db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, user.id))).get();
    if (!row) return reply.code(404).send({ error: "Folder not found." });
    db.update(conversations).set({ folderId: null }).where(eq(conversations.folderId, id)).run();
    db.delete(folders).where(eq(folders.id, id)).run();
    return { ok: true };
  });
}
