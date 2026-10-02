import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  ARTIFACT_ACTIONS,
  ARTIFACT_TYPES,
  normalizeArtifact,
  takeReplyArtifact,
  type ArtifactFile,
  type ArtifactSource,
  type ArtifactType,
} from "@wlfv/shared";
import { requireUser } from "./auth.ts";
import { loadAppGeneral } from "./app-general.ts";
import type { DB } from "./db/index.ts";
import { artifactVersions, artifacts, conversations } from "./db/schema.ts";

const MAX_CONTENT = 200_000;

export type ArtifactRow = {
  id: string;
  conversationId: string;
  messageId: string | null;
  title: string;
  type: string;
  language: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
};

function publicArtifact(row: typeof artifacts.$inferSelect, version: number): ArtifactRow {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    title: row.title,
    type: row.type,
    language: row.language,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version,
  };
}

function latestVersion(db: DB, artifactId: string) {
  return db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.version))
    .get();
}

function ownedConversation(db: DB, userId: string, conversationId: string) {
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .get();
}

function ownedArtifact(db: DB, userId: string, id: string) {
  return db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId)))
    .get();
}

function addVersion(db: DB, artifactId: string, content: string, source: ArtifactSource, now: number) {
  const previous = latestVersion(db, artifactId);
  const version = (previous?.version || 0) + 1;
  db.insert(artifactVersions)
    .values({ id: randomUUID(), artifactId, version, content, createdAt: now, source })
    .run();
  return version;
}

export function readArtifact(db: DB, userId: string, id: string) {
  const row = ownedArtifact(db, userId, id);
  if (!row) return null;
  const version = latestVersion(db, row.id)?.version || 1;
  return publicArtifact(row, version);
}

export function createArtifact(
  db: DB,
  input: {
    userId: string;
    conversationId: string;
    messageId?: string | null;
    file: ArtifactFile;
    source: ArtifactSource;
  },
) {
  if (!ownedConversation(db, input.userId, input.conversationId)) return null;
  const now = Date.now();
  const id = randomUUID();
  const file = input.file;
  db.insert(artifacts)
    .values({
      id,
      userId: input.userId,
      conversationId: input.conversationId,
      messageId: input.messageId || null,
      title: file.title,
      type: file.type,
      language: file.language,
      content: file.content,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const version = addVersion(db, id, file.content, input.source, now);
  const row = ownedArtifact(db, input.userId, id);
  return row ? publicArtifact(row, version) : null;
}

export function updateArtifact(
  db: DB,
  input: {
    userId: string;
    id: string;
    title?: string;
    type?: ArtifactType;
    language?: string;
    content?: string;
    messageId?: string | null;
    source: ArtifactSource;
  },
) {
  const row = ownedArtifact(db, input.userId, input.id);
  if (!row) return null;
  const now = Date.now();
  const content = input.content === undefined ? row.content : input.content;
  const changed = content !== row.content;
  const next = normalizeArtifact({
    title: input.title === undefined ? row.title : input.title,
    type: input.type || row.type,
    language: input.language === undefined ? row.language : input.language,
    content,
  });
  db.update(artifacts)
    .set({
      title: next.title,
      type: next.type,
      language: next.language,
      content,
      messageId: input.messageId === undefined ? row.messageId : input.messageId,
      updatedAt: now,
    })
    .where(eq(artifacts.id, row.id))
    .run();
  const version = changed ? addVersion(db, row.id, content, input.source, now) : latestVersion(db, row.id)?.version || 1;
  const saved = ownedArtifact(db, input.userId, row.id);
  return saved ? publicArtifact(saved, version) : null;
}

export function restoreArtifact(db: DB, userId: string, id: string, version: number) {
  const row = ownedArtifact(db, userId, id);
  if (!row) return null;
  const previous = db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.artifactId, id), eq(artifactVersions.version, version)))
    .get();
  if (!previous) return null;
  return updateArtifact(db, { userId, id, content: previous.content, source: "user" });
}

export function deleteArtifact(db: DB, userId: string, id: string) {
  const row = ownedArtifact(db, userId, id);
  if (!row) return false;
  db.delete(artifacts).where(eq(artifacts.id, id)).run();
  return true;
}

export function listArtifacts(db: DB, userId: string, conversationId: string) {
  if (!ownedConversation(db, userId, conversationId)) return null;
  const rows = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.conversationId, conversationId)))
    .orderBy(desc(artifacts.updatedAt))
    .all();
  return rows.map((row) => publicArtifact(row, latestVersion(db, row.id)?.version || 1));
}

export function listVersions(db: DB, userId: string, id: string) {
  if (!ownedArtifact(db, userId, id)) return null;
  return db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, id))
    .orderBy(asc(artifactVersions.version))
    .all()
    .map((row) => ({ version: row.version, content: row.content, createdAt: row.createdAt, source: row.source }));
}

export function recordReplyArtifact(
  db: DB,
  input: { userId: string; conversationId: string; messageId: string; content: string; artifactId?: string },
) {
  const file = takeReplyArtifact(input.content);
  if (!file || !file.content.trim()) return null;
  if (input.artifactId) {
    const current = ownedArtifact(db, input.userId, input.artifactId);
    if (current && current.conversationId === input.conversationId) {
      return updateArtifact(db, {
        userId: input.userId,
        id: current.id,
        title: file.title || current.title,
        type: file.type,
        language: file.language,
        content: file.content,
        messageId: input.messageId,
        source: "ai",
      });
    }
  }
  return createArtifact(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    file,
    source: "ai",
  });
}

function parseFile(body: { title?: unknown; type?: unknown; language?: unknown; content?: unknown }) {
  const content = typeof body.content === "string" ? body.content : "";
  if (content.length > MAX_CONTENT) return { error: "This artifact is too large." } as const;
  const type = typeof body.type === "string" ? body.type : "text";
  if (!(ARTIFACT_TYPES as readonly string[]).includes(type)) return { error: "This artifact type is not supported." } as const;
  return {
    file: normalizeArtifact({
      title: typeof body.title === "string" ? body.title : "",
      type,
      language: typeof body.language === "string" ? body.language : "",
      content,
    }),
  } as const;
}

export function registerArtifacts(app: FastifyInstance, db: DB) {
  app.get("/api/conversations/:id/artifacts", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const rows = listArtifacts(db, user.id, id);
    if (!rows) return reply.code(404).send({ error: "Conversation not found." });
    return { artifacts: rows };
  });

  app.post("/api/artifacts", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const general = loadAppGeneral(db);
    if (user.role !== "admin" && !general.toolCanvas) return reply.code(403).send({ error: "Canvas is disabled." });
    const body = (req.body ?? {}) as { conversationId?: unknown; title?: unknown; type?: unknown; language?: unknown; content?: unknown };
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const parsed = parseFile(body);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });
    const saved = createArtifact(db, { userId: user.id, conversationId, file: parsed.file, source: "user" });
    if (!saved) return reply.code(404).send({ error: "Conversation not found." });
    return { artifact: saved };
  });

  app.get("/api/artifacts/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const row = readArtifact(db, user.id, (req.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Artifact not found." });
    return { artifact: row };
  });

  app.patch("/api/artifacts/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const body = (req.body ?? {}) as { title?: unknown; type?: unknown; language?: unknown; content?: unknown };
    if (typeof body.content === "string" && body.content.length > MAX_CONTENT) return reply.code(400).send({ error: "This artifact is too large." });
    if (typeof body.type === "string" && !(ARTIFACT_TYPES as readonly string[]).includes(body.type)) {
      return reply.code(400).send({ error: "This artifact type is not supported." });
    }
    const saved = updateArtifact(db, {
      userId: user.id,
      id: (req.params as { id: string }).id,
      title: typeof body.title === "string" ? body.title : undefined,
      type: typeof body.type === "string" ? (body.type as ArtifactType) : undefined,
      language: typeof body.language === "string" ? body.language : undefined,
      content: typeof body.content === "string" ? body.content : undefined,
      source: "user",
    });
    if (!saved) return reply.code(404).send({ error: "Artifact not found." });
    return { artifact: saved };
  });

  app.delete("/api/artifacts/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const ok = deleteArtifact(db, user.id, (req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: "Artifact not found." });
    return { ok: true };
  });

  app.get("/api/artifacts/:id/versions", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const versions = listVersions(db, user.id, (req.params as { id: string }).id);
    if (!versions) return reply.code(404).send({ error: "Artifact not found." });
    return { versions };
  });

  app.post("/api/artifacts/:id/restore", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const version = Number((req.body as { version?: unknown } | undefined)?.version);
    if (!Number.isInteger(version) || version < 1) return reply.code(400).send({ error: "Choose a version to restore." });
    const saved = restoreArtifact(db, user.id, (req.params as { id: string }).id, version);
    if (!saved) return reply.code(404).send({ error: "Artifact not found." });
    return { artifact: saved };
  });
}

export const artifactActionSchema = ARTIFACT_ACTIONS;
