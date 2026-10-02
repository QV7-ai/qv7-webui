import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { conversations, folders, messages, modelConfigs, skills, userSettings, users } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireUser } from "./auth.ts";
import { chatBodySchema } from "./env.ts";
import { thinkParam } from "./services/ollama/index.ts";
import { parseShowCapabilities } from "./services/ollama/capabilities.ts";
import { publicErrorMessage, OllamaError } from "./services/ollama/errors.ts";
import { usageFromOllama, type UsageStats, type WebSearchSource, type ChatActivity, DEFAULT_SYSTEM_PROMPT, toolsPromptFor, stripToolMarkup, stripLeakedAssistant, parseGenerationSettings, parseInstructionTone, instructionToneLine, workRoleLabel, CANVAS_PROMPT, CANVAS_DESIGN, TASK_MODEL_CURRENT, type ConnectionsConfig, type ProviderConnection } from "@wlfv/shared";
import { resolveModelConnection, resolveOllamaModel } from "./models.ts";
import { loadWebSearch, runWebSearch } from "./web-search/index.ts";
import { handleImageTurn, imagesEnabledFor } from "./images/turn.ts";
import { loadAppGeneral } from "./app-general.ts";
import { loadBranding } from "./branding.ts";
import { loadInterface } from "./interface.ts";
import { loadConnections } from "./connections.ts";
import { completeForConnection, streamForConnection, type ProviderMessage } from "./runtime.ts";
import { readStoredImage } from "./uploads.ts";
import type { Env } from "./env.ts";
import { extractRunnableBlocks, runCodeBlocks } from "./code-interpreter.ts";
import { repairFalseBirthdayMemories } from "./memory.ts";
import { reviewAndSaveMemories } from "./memory-review.ts";
import { fallbackMemoryDrafts, shouldReviewMemory } from "./memory-ops.ts";
import { buildMemoryContext, MEMORY_REVIEW_INTERVAL_TURNS } from "./memory-context.ts";
import { materializeDocument, preferredDocumentExt } from "./documents.ts";
import { bioAsUserFact, correctIdentityVoice, directIdentityReply } from "./identity.ts";
import { executeToolCall, parseToolCalls, questionNeedsCode, questionNeedsSearch } from "./tools.ts";
import { recordToolRun, recordMessageUsage, assertTokenQuota } from "./usage.ts";
import {
  beginLiveTurn,
  emitChat,
  endLiveTurn,
  notifyChats,
  notifyDeleted,
  overlayLiveMessages,
  SSE_HEADERS,
  subscribeConversation,
  subscribeUser,
  type SseRaw,
} from "./chat-sync.ts";

const aborts = new Map<string, AbortController>();

function resolveTaskModel(
  db: DB,
  env: Env,
  connections: ConnectionsConfig,
  chatModel: typeof modelConfigs.$inferSelect,
  fallbackConn: ProviderConnection,
) {
  const iface = loadInterface(db);
  const sourceKind = resolveModelConnection(db, chatModel).providerKind === "openai" ? "openai" : "ollama";
  let taskRow = chatModel;
  const wanted = env.memoryModel.trim();
  if (wanted) {
    const match = db
      .select()
      .from(modelConfigs)
      .all()
      .find((row) => {
        if (!row.enabled) return false;
        const remote = resolveOllamaModel(db, row);
        return (
          row.id === wanted ||
          row.ollamaModel === wanted ||
          row.displayName === wanted ||
          row.remoteModel === wanted ||
          remote === wanted
        );
      });
    if (match) taskRow = match;
  } else {
    const taskId = sourceKind === "openai" ? iface.externalTaskModelId : iface.localTaskModelId;
    if (taskId && taskId !== TASK_MODEL_CURRENT) {
      const picked = db.select().from(modelConfigs).where(eq(modelConfigs.id, taskId)).get();
      if (picked?.enabled) taskRow = picked;
    }
  }
  const remote = resolveOllamaModel(db, taskRow);
  const taskSource = resolveModelConnection(db, taskRow);
  const taskConn =
    [...connections.openai, ...connections.ollama].find((item) => item.id === taskSource.connectionId) || fallbackConn;
  return { remote, taskConn };
}

function imageMarkdown(content: string) {
  return [...String(content || "").matchAll(/!\[([^\]]*)\]\((\/api\/uploads\/[a-zA-Z0-9.-]+)\)/g)];
}

function textFromContent(content: string) {
  return String(content || "")
    .replace(/!\[([^\]]*)\]\((\/api\/uploads\/[a-zA-Z0-9.-]+)\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isChatImageUrl(url?: string) {
  return Boolean(url && /^\/api\/uploads\/[a-f0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(url));
}

function providerMessage(role: string, content: string, uploadsDir: string): ProviderMessage {
  const images: string[] = [];
  if (role === "user") {
    for (const match of imageMarkdown(content)) {
      const file = readStoredImage(uploadsDir, match[2]);
      if (file) images.push(file.dataUrl);
    }
  }
  return {
    role,
    content: textFromContent(content) || (images.length ? "What is in this image?" : ""),
    ...(images.length ? { images } : {}),
  };
}

function focusSearchText(text: string) {
  const wiki = /\bwikipedia\b/i.test(text);
  const stripped = text
    .replace(
      /\b(?:make it in canvas|in canvas|canvas|create a documentation(?: of)?|documentation of|add (?:some |more )?information (?:of|about)|styling with \w+|add some css|google fonts?|font awesome|feel like a website|still a documents?|look at wikipedia(?: for more information)?|where is it|icons?|css)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9\u00c0-\u024f\s-]+/gi, " ")
    .replace(/\b(?:the|a|an|of|and|with|but|its|it|some|more|about|for|make|add|look)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const seen = new Set<string>();
  const words = stripped.split(" ").filter((word) => {
    const key = word.toLowerCase();
    if (word.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let query = words.join(" ");
  if (wiki && !/\bwikipedia\b/i.test(query)) query = `${query} wikipedia`.trim();
  return query.slice(0, 180);
}

function cleanSearchQuery(raw: string, fallback: string) {
  const line = String(raw || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:search query|query|zoekopdracht)\s*:\s*/i, "")
    .split(/\n/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  const query = line.replace(/\s+/g, " ").trim().slice(0, 180);
  const noisy = /\b(?:canvas|css|google font|font awesome|icon|styling|documentation)\b/i.test(query);
  if (query.length < 3 || noisy) return fallback.slice(0, 180);
  return query;
}

async function summarizeSearchQuery(
  db: DB,
  env: Env,
  connections: ConnectionsConfig,
  chatModel: typeof modelConfigs.$inferSelect,
  fallbackConn: ProviderConnection,
  text: string,
  signal: AbortSignal,
) {
  const source = focusSearchText(text) || text.replace(/\s+/g, " ").trim().slice(0, 180);
  const fallback = source.slice(0, 180);
  if (!source) return "";
  const { remote, taskConn } = resolveTaskModel(db, env, connections, chatModel, fallbackConn);
  if (!remote || !taskConn?.url) return fallback;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  const stop = () => abort.abort();
  signal.addEventListener("abort", stop);
  try {
    const raw = await completeForConnection(taskConn, {
      model: remote,
      messages: [
        {
          role: "system",
          content:
            "Rewrite this as one web search query for the factual subject only. Keep the name of the thing being asked about. Drop requests to build a page, canvas, document, website, CSS, colors, fonts, or icons. If Wikipedia is mentioned, include the word Wikipedia. Reply with the query only, at most 8 words.",
        },
        { role: "user", content: source },
      ],
      signal: abort.signal,
    });
    return cleanSearchQuery(raw, fallback);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

function splitPromptTokens(total: number, weights: { system: number; skills: number; tools: number; conversation: number }) {
  const input = Math.max(0, Math.round(total));
  const sum = weights.system + weights.skills + weights.tools + weights.conversation;
  if (!input || sum <= 0) return { system: 0, skills: 0, tools: 0, conversation: input };
  const system = Math.round((input * weights.system) / sum);
  const skills = Math.round((input * weights.skills) / sum);
  const tools = Math.round((input * weights.tools) / sum);
  return { system, skills, tools, conversation: Math.max(0, input - system - skills - tools) };
}

function feedbackGuidance(db: DB, userId: string) {
  const rows = db
    .select({ content: messages.content, rating: messages.rating })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(messages.role, "assistant"), ne(messages.rating, 0)))
    .orderBy(desc(messages.updatedAt))
    .limit(8)
    .all();
  const clip = (text: string) => {
    const clean = stripToolMarkup(text).replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.length <= 180 ? clean : `${clean.slice(0, 177).trimEnd()}…`;
  };
  const liked = rows.filter((row) => row.rating === 1).map((row) => clip(row.content)).filter(Boolean).slice(0, 4);
  const disliked = rows.filter((row) => row.rating === -1).map((row) => clip(row.content)).filter(Boolean).slice(0, 4);
  if (!liked.length && !disliked.length) return "";
  return [
    "The user rates your replies so you can improve.",
    liked.length ? `Replies they liked:\n${liked.map((line) => `- ${line}`).join("\n")}` : "",
    disliked.length ? `Replies they disliked:\n${disliked.map((line) => `- ${line}`).join("\n")}` : "",
    "Match the style of liked replies. Avoid the pattern of disliked replies.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function activityNote(raw: string) {
  const text = stripToolMarkup(raw).replace(/\s+/g, " ").trim();
  if (text.length < 12) return "";
  const sentence = text.split(/(?<=[.!?])\s/)[0] || text;
  if (sentence.length > 220) return `${sentence.slice(0, 217).trimEnd()}…`;
  return sentence;
}

export function registerChat(app: FastifyInstance, db: DB, env: Env, uploadsDir: string) {
  app.get("/api/conversations", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const q = String((req.query as { q?: string }).q || "").toLowerCase();
    let rows = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, user.id), eq(conversations.temporary, 0)))
      .orderBy(desc(conversations.updatedAt))
      .all();
    if (q) {
      rows = rows.filter((c) => c.title.toLowerCase().includes(q));
    }
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        title: c.title,
        modelId: c.modelId,
        folderId: c.folderId,
        archived: Boolean(c.archived),
        pinned: Boolean(c.pinned),
        unread: Boolean(c.unread),
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      })),
    };
  });

  app.post("/api/conversations", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const body = req.body as { modelId?: string; folderId?: string | null; temporary?: boolean };
    const temporary = Boolean(body.temporary);
    let folderId: string | null = null;
    if (body.folderId) {
      if (!loadAppGeneral(db).foldersEnabled) return reply.code(403).send({ error: "Folders are disabled." });
      const folder = db
        .select()
        .from(folders)
        .where(and(eq(folders.id, body.folderId), eq(folders.userId, user.id)))
        .get();
      if (!folder) return reply.code(400).send({ error: "Folder not found." });
      folderId = folder.id;
    }
    const now = Date.now();
    const id = randomUUID();
    db.insert(conversations)
      .values({
        id,
        userId: user.id,
        title: "New chat",
        modelId: body.modelId ?? null,
        folderId: temporary ? null : folderId,
        thinkingEnabled: 0,
        archived: 0,
        pinned: 0,
        unread: 0,
        temporary: temporary ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (!temporary) notifyChats(user.id, { conversationId: id });
    return { conversation: { id, title: "New chat", modelId: body.modelId ?? null, folderId: temporary ? null : folderId, temporary, createdAt: now, updatedAt: now } };
  });

  app.get("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .all();
    return {
      conversation: {
        id: convo.id,
        title: convo.title,
        modelId: convo.modelId,
        folderId: convo.folderId,
        thinkingEnabled: Boolean(convo.thinkingEnabled),
        thinkingLevel: convo.thinkingLevel,
        temporary: Boolean(convo.temporary),
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
        messages: overlayLiveMessages(
          id,
          msgs.map((m) => {
            let usage: UsageStats | undefined;
            if (m.stats) {
              try {
                usage = JSON.parse(m.stats) as UsageStats;
              } catch {
                usage = undefined;
              }
            }
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              thinking: m.thinking,
              status: m.status,
              usage,
              sources: (() => {
                if (!m.sources) return undefined;
                try {
                  return JSON.parse(m.sources) as WebSearchSource[];
                } catch {
                  return undefined;
                }
              })(),
              activities: (() => {
                if (!m.activities) return undefined;
                try {
                  const parsed = JSON.parse(m.activities) as ChatActivity[];
                  return Array.isArray(parsed) ? parsed : undefined;
                } catch {
                  return undefined;
                }
              })(),
              rating: m.rating || 0,
              createdAt: m.createdAt,
            };
          }),
        ),
      },
    };
  });

  app.post("/api/messages/:id/feedback", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const body = req.body as { rating?: number };
    const rating = body.rating === 1 || body.rating === -1 ? body.rating : 0;
    const row = db
      .select({ id: messages.id, role: messages.role })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(messages.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!row || row.role !== "assistant") return reply.code(404).send({ error: "Message not found." });
    db.update(messages).set({ rating, updatedAt: Date.now() }).where(eq(messages.id, id)).run();
    return { rating };
  });

  app.patch("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    const body = req.body as {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      unread?: boolean;
      modelId?: string;
      folderId?: string | null;
    };
    let folderId = convo.folderId;
    if (body.folderId !== undefined) {
      if (!loadAppGeneral(db).foldersEnabled) return reply.code(403).send({ error: "Folders are disabled." });
      if (body.folderId === null || body.folderId === "") {
        folderId = null;
      } else {
        const folder = db
          .select()
          .from(folders)
          .where(and(eq(folders.id, body.folderId), eq(folders.userId, user.id)))
          .get();
        if (!folder) return reply.code(400).send({ error: "Folder not found." });
        folderId = folder.id;
      }
    }
    const metadataOnly = body.unread != null && body.title == null && body.archived == null && body.pinned == null && body.folderId === undefined && body.modelId == null;
    db.update(conversations)
      .set({
        title: body.title?.trim() || convo.title,
        archived: body.archived == null ? convo.archived : body.archived ? 1 : 0,
        pinned: body.pinned == null ? convo.pinned : body.pinned ? 1 : 0,
        unread: body.unread == null ? convo.unread : body.unread ? 1 : 0,
        modelId: body.modelId ?? convo.modelId,
        folderId,
        updatedAt: metadataOnly ? convo.updatedAt : Date.now(),
      })
      .where(eq(conversations.id, id))
      .run();
    if (!metadataOnly) notifyChats(user.id, { conversationId: id });
    return { ok: true };
  });

  app.post("/api/conversations/:id/clone", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    const now = Date.now();
    const cloneId = randomUUID();
    db.insert(conversations)
      .values({
        id: cloneId,
        userId: user.id,
        title: `${convo.title} copy`,
        modelId: convo.modelId,
        folderId: convo.folderId,
        thinkingEnabled: convo.thinkingEnabled,
        thinkingLevel: convo.thinkingLevel,
        archived: 0,
        pinned: 0,
        unread: 0,
        temporary: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const msgs = db.select().from(messages).where(eq(messages.conversationId, id)).all();
    for (const msg of msgs) {
      const cloneMsgId = randomUUID();
      db.insert(messages)
        .values({
          ...msg,
          id: cloneMsgId,
          conversationId: cloneId,
        })
        .run();
      recordMessageUsage(db, {
        messageId: cloneMsgId,
        userId: user.id,
        conversationId: cloneId,
        modelId: msg.modelId || convo.modelId,
        role: msg.role,
        content: msg.content,
        stats: msg.stats,
        createdAt: msg.createdAt,
      });
    }
    notifyChats(user.id, { conversationId: cloneId });
    return { conversation: { id: cloneId, title: `${convo.title} copy` } };
  });

  app.delete("/api/conversations/:id", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    db.delete(messages).where(eq(messages.conversationId, id)).run();
    db.delete(conversations).where(eq(conversations.id, id)).run();
    notifyDeleted(user.id, id);
    notifyChats(user.id, { conversationId: id, deleted: true });
    return { ok: true };
  });

  app.get("/api/sync", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    subscribeUser(user.id, reply.raw as SseRaw, req.raw);
  });

  app.get("/api/conversations/:id/events", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    subscribeConversation(id, reply.raw as SseRaw, req.raw);
  });

  app.post("/api/chat/stop", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const body = req.body as { conversationId?: string };
    const key = `${user.id}:${body.conversationId || ""}`;
    aborts.get(key)?.abort();
    return { ok: true };
  });

  app.post("/api/chat", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const quota = assertTokenQuota(db, user);
    if (!quota.ok) return reply.code(429).send({ error: quota.message, code: quota.code });
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "The request was invalid." });
    const { conversationId, message, modelId, thinking, webSearch, codeInterpreter, attachments, createImage, editImage, skillIds, canvas, canvasTitle, canvasHtml, document: documentMode } =
      parsed.data;
    const imageMode = editImage ? "edit" : createImage ? "create" : null;
    if (imageMode && !imagesEnabledFor(db, imageMode)) {
      return reply.code(400).send({ error: imageMode === "edit" ? "Image editing is disabled." : "Image generation is disabled." });
    }
    const convo = db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)))
      .get();
    if (!convo) return reply.code(404).send({ error: "Conversation not found." });
    const model = db.select().from(modelConfigs).where(eq(modelConfigs.id, modelId)).get();
    if (!model || !model.enabled) return reply.code(400).send({ error: "The selected model could not be found." });
    const ollamaModel = resolveOllamaModel(db, model);
    if (!imageMode && (!ollamaModel || ollamaModel.startsWith("custom:"))) {
      return reply.code(400).send({ error: "This custom model has no valid base model." });
    }
    const connections = loadConnections(db, env);
    const source = resolveModelConnection(db, model);
    const conn =
      [...connections.openai, ...connections.ollama].find((item) => item.id === source.connectionId) ||
      connections.ollama.find((item) => item.enabled) ||
      connections.ollama[0];
    const providerKind = source.providerKind === "openai" ? "openai" : "ollama";
    if (!imageMode) {
      if (providerKind === "openai" && (!connections.openaiEnabled || !conn || conn.kind !== "openai" || !conn.enabled)) {
        return reply.code(400).send({ error: "This OpenAI connection is disabled." });
      }
      if (providerKind === "ollama" && (!connections.ollamaEnabled || !conn || conn.kind !== "ollama" || !conn.enabled)) {
        return reply.code(400).send({ error: "This Ollama connection is disabled." });
      }
      if (!conn?.url) return reply.code(400).send({ error: "No API connection is configured for this model." });
    }
    if (!imageMode && !ollamaModel) {
      return reply.code(400).send({ error: "This custom model has no valid base model." });
    }
    const searchConfig = loadWebSearch(db);
    if (webSearch && !searchConfig.enabled) {
      return reply.code(400).send({ error: "Web search is disabled." });
    }
    const toolAccess = loadAppGeneral(db);
    if (user.role !== "admin") {
      if (webSearch && !toolAccess.toolWebSearch) return reply.code(403).send({ error: "Web search is disabled." });
      if (codeInterpreter && !toolAccess.toolCode) return reply.code(403).send({ error: "Code interpreter is disabled." });
      if ((canvas || canvasHtml) && !toolAccess.toolCanvas) return reply.code(403).send({ error: "Canvas is disabled." });
    }
    if (imageMode === "create" && !message.trim()) {
      return reply.code(400).send({ error: "Enter a prompt to create an image." });
    }
    if (imageMode === "edit" && !(attachments || []).some((item) => item.kind === "image" && item.url)) {
      return reply.code(400).send({ error: "Attach an image to edit." });
    }

    const detected = parseShowCapabilities({
      thinking: {
        values: JSON.parse(model.thinkValues || "[]") as unknown[],
      },
      capabilities: model.thinkingSupported ? ["thinking"] : [],
    });
    const think = thinkParam(detected, Boolean(thinking?.enabled), thinking?.level);

    const now = Date.now();
    const userMsgId = randomUUID();
    const attachmentNote = (attachments || []).map((item) => item.name).filter(Boolean).join(", ");
    const imageMarks = (attachments || [])
      .filter((item) => (item.kind === "image" || isChatImageUrl(item.url)) && isChatImageUrl(item.url))
      .map((item) => `![${item.name}](${item.url})`);
    const textMarks = (attachments || [])
      .filter((item) => item.kind !== "image" && !isChatImageUrl(item.url) && item.text)
      .map((item) => `### ${item.name}\n${item.text}`);
    const storedUser = [message.trim(), ...imageMarks, ...textMarks].filter(Boolean).join("\n\n") || "Attached files";
    db.insert(messages)
      .values({
        id: userMsgId,
        conversationId,
        role: "user",
        content: storedUser,
        status: "complete",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    recordMessageUsage(db, {
      messageId: userMsgId,
      userId: user.id,
      conversationId,
      modelId: model.id,
      role: "user",
      content: storedUser,
      createdAt: now,
    });

    if (imageMode) {
      try {
        await handleImageTurn({
          db,
          env,
          uploadsDir,
          req,
          reply,
          userId: user.id,
          conversationId,
          convo,
          model,
          message,
          attachments,
          mode: imageMode,
          userMsgId,
          storedUser,
        });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Image generation failed." });
      }
      return;
    }

    const settings = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();
    const generation = parseGenerationSettings((() => {
      try {
        return JSON.parse(settings?.generationParams || "{}");
      } catch {
        return {};
      }
    })());
    let modelGeneration = parseGenerationSettings({});
    try {
      modelGeneration = parseGenerationSettings(JSON.parse(model.generationParams || "{}"));
    } catch {
      modelGeneration = parseGenerationSettings({});
    }
    generation.values = { ...generation.values, ...modelGeneration.values };
    generation.custom = [...generation.custom, ...modelGeneration.custom];
    const memoryOn = !convo.temporary && loadAppGeneral(db).memoriesEnabled && settings?.memoryEnabled !== 0;
    const history = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .all();
    const previousUser = [...history]
      .reverse()
      .find((item) => item.role === "user" && item.id !== userMsgId)?.content;
    const mems = memoryOn ? repairFalseBirthdayMemories(db, user.id) : [];
    const persona = (model.systemPrompt || "").trim();
    const userPrompt = [
      instructionToneLine(parseInstructionTone(settings?.instructionTone), settings?.language === "nl" ? "nl" : "en"),
      (settings?.instructionExtra || "").trim(),
      (settings?.systemPrompt || "").trim() || (webSearch ? DEFAULT_SYSTEM_PROMPT : ""),
    ]
      .filter(Boolean)
      .join("\n\n");
    const folder = convo.folderId && loadAppGeneral(db).foldersEnabled
      ? db.select().from(folders).where(and(eq(folders.id, convo.folderId), eq(folders.userId, user.id))).get()
      : null;
    const folderPrompt = folder?.systemPrompt.trim() || "";
    const chosenSkills = skillIds?.length
      ? db
          .select()
          .from(skills)
          .where(and(eq(skills.userId, user.id), inArray(skills.id, skillIds)))
          .all()
      : [];
    const skillPrompt = chosenSkills.length
      ? `Follow these skills for this message. They are private instructions written by this user:\n${chosenSkills
          .map((skill) => `## ${skill.name}\n${skill.content.trim()}`)
          .join("\n\n")}`
      : "";
    const assistantId = randomUUID();
    const assistantCreatedAt = Date.now();
    db.insert(messages)
      .values({
        id: assistantId,
        conversationId,
        role: "assistant",
        content: "",
        thinking: null,
        modelId: model.id,
        status: "streaming",
        createdAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .run();

    const initialWait = webSearch ? "searching" : thinking?.enabled ? "thinking" : "loading";
    beginLiveTurn({
      userId: user.id,
      conversationId,
      userMessage: { id: userMsgId, content: storedUser, createdAt: now },
      assistantId,
      assistantCreatedAt,
      wait: initialWait,
    });

    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.socket?.setTimeout(0);
    const emit = (event: string, data: unknown) => emitChat(reply.raw as SseRaw, conversationId, event, data);
    const beat = setInterval(() => {
      try {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.write(`event: ping\ndata: {}\n\n`);
      } catch {
        /* client disconnected */
      }
    }, 10000);
    emit("status", { stage: initialWait });

    const controller = new AbortController();
    const key = `${user.id}:${conversationId}`;
    aborts.get(key)?.abort();
    aborts.set(key, controller);
    req.raw.on("close", () => controller.abort());
    const userTurnCount = history.filter((item) => item.role === "user").length;
    const explicitMemory = memoryOn
      ? (async () => {
          const drafts = fallbackMemoryDrafts(storedUser, previousUser ? String(previousUser) : undefined);
          if (!drafts.length) return [];
          return await reviewAndSaveMemories({
            db,
            userId: user.id,
            conversationId,
            conn,
            model: "",
            existing: mems,
            transcript: storedUser.slice(0, 2000),
            currentUser: storedUser,
            previousUser: previousUser ? String(previousUser) : undefined,
          });
        })()
      : Promise.resolve([]);
    const memoryDue = memoryOn && userTurnCount > 0 && userTurnCount % MEMORY_REVIEW_INTERVAL_TURNS === 0;

    let content = "";
    let thinkingText = "";
    let usage: UsageStats | undefined;
    let contextWeights = { system: 0, skills: 0, tools: 0, conversation: 0 };
    let status: "complete" | "interrupted" | "error" = "complete";
    let sources: WebSearchSource[] = [];
    const activities: ChatActivity[] = [];
    const emitActivities = () => emit("activity", { activities: activities.map((item) => ({ ...item })) });
    let currentWait: string = webSearch ? "searching" : "loading";
    const activityWaits = new Set(["searching", "running", "memory", "memorySearch", "fetch", "image"]);
    const emitWait = (stage: string) => {
      currentWait = stage;
      emit("status", { stage });
    };
    try {
      let searchContext = "";
      const loadTools = settings?.loadToolsWhenNeeded === 1;
      const searchAllowed = searchConfig.enabled && (user.role === "admin" || toolAccess.toolWebSearch);
      const codeAllowed = user.role === "admin" || toolAccess.toolCode;
      const currentAsk = (message.trim() || storedUser).replace(/\s+/g, " ").trim();
      const earlierAsk = String(previousUser || "").replace(/\s+/g, " ").trim();
      const refersBack = Boolean(earlierAsk) && /\b(this|that|it|same|deze|dat|dit)\b/i.test(currentAsk);
      const recentUser = history
        .filter((item) => item.role === "user")
        .slice(-3)
        .map((item) => String(item.content || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
      const asked = refersBack ? `${recentUser}\n${currentAsk}` : currentAsk;
      const autoSearch = loadTools && searchAllowed && questionNeedsSearch(refersBack ? `${currentAsk}\n${recentUser}` : currentAsk);
      if ((webSearch && searchConfig.enabled) || autoSearch) {
        emitWait("searching");
        const query = await summarizeSearchQuery(db, env, connections, model, conn, asked, controller.signal);
        const step: ChatActivity = { kind: "search", query, sources: [] };
        activities.push(step);
        emitActivities();
        try {
          const found = await runWebSearch(query, searchConfig, controller.signal);
          sources = found.sources;
          searchContext = found.context;
          step.sources = found.sources;
          emitActivities();
          if (sources.length) emit("sources", { sources });
        } catch {
          /* keep searching label until the model starts */
        }
        if (thinking?.enabled) emitWait("thinking");
      }
      const attached = (attachments || [])
        .filter((item) => item.kind !== "image" && !isChatImageUrl(item.url))
        .map((item) => `### ${item.name}\n${item.text}`)
        .filter((item) => item.trim() !== "###")
        .join("\n\n");
      const brandName = loadBranding(db).name || env.appName || "QV7";
      const account = db.select().from(users).where(eq(users.id, user.id)).get();
      const userName = (account?.displayName || account?.username || user.username || "").trim();
      const callName = (account?.preferredName || "").trim();
      const spokenName = callName || userName;
      const assistantName = (model.kind === "custom" ? model.displayName : brandName).trim() || "the assistant";
      const work = workRoleLabel(account?.work || "");
      const profileLines = [
        spokenName ? `The user's name is ${spokenName}. That name belongs to the user, not to you.` : "",
        userName && spokenName && userName !== spokenName ? `The user's profile name is ${userName}.` : "",
        work ? `The user works as a ${work}. That job belongs to the user, not to you.` : "",
        account?.username ? `The user's username is ${account.username}.` : "",
        account?.gender ? `The user's gender is ${account.gender}.` : "",
        account?.birthday ? `The user's birthday is ${account.birthday}.` : "",
        account?.bio ? `About the user, not about you: ${bioAsUserFact(account.bio)}` : "",
      ].filter(Boolean);
      const memoryQuery = history
        .filter((item) => item.role === "user")
        .slice(-7)
        .map((item) => String(item.content || "").trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(-4000);
      const memoryContext = memoryOn ? buildMemoryContext(mems, memoryQuery || storedUser) : "";
      const offerSearch = Boolean(webSearch) || (loadTools && searchAllowed);
      const offerCode = Boolean(codeInterpreter) || (loadTools && codeAllowed && questionNeedsCode(currentAsk));
      const toolPrompt = userPrompt.includes("```tool") ? "" : toolsPromptFor({ search: offerSearch, memory: false });
      const system = [
        persona || (model.kind === "custom" ? `You are ${model.displayName}, a helpful, precise assistant.` : `You are ${brandName}, a helpful, precise assistant.`),
        spokenName
          ? `You are ${assistantName}, the assistant. The human you are talking to is ${spokenName}. When a name fits, call them ${spokenName}. Do not use the name in every sentence. Never introduce yourself as ${spokenName}. Never say "I am ${spokenName}".`
          : `You are the assistant. The human is the user. Never say the user is an AI or that they are ${assistantName}.`,
        work
          ? `${spokenName || "The user"} is the ${work}. You are not a ${work}. If they ask about their job, describe their work in the second person ("you"). Do not say "I am a ${work}".`
          : "",
        "Reply in the user's language with a normal assistant message. Do not repeat private notes, tool instructions, or code fences unless the user asked for code.",
        thinking?.enabled
          ? "Thinking is shown in a separate panel. Put reasoning only inside <think> and </think>. Do not write a Thinking Process section in the answer. After </think>, write only the answer. Call tools with a ```tool fence, never a <tool_code> tag."
          : "Do not output chain-of-thought.",
        userPrompt,
        toolPrompt,
        folderPrompt,
        skillPrompt,
        canvas
          ? [
              CANVAS_PROMPT,
              CANVAS_DESIGN,
              "Canvas is on for this message. Reply with one short sentence and one ```html file styled with Tailwind classes. Include the Tailwind and Font Awesome lines in the head. Do not output a ```css block. Never output a <canvas> tag.",
              canvasHtml?.trim()
                ? `The user is editing this HTML file${canvasTitle ? ` titled "${canvasTitle.slice(0, 80)}"` : ""}. When they ask for a change, output one new \`\`\`html fence with the complete redesigned file. Keep the same design quality. Do not use a <canvas> tag.\n${canvasHtml.slice(0, 80000)}`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n")
          : "Canvas is off. Do not output a complete HTML document, a ```html page, or a canvas file. If a skill asks for an HTML report or a canvas, answer in normal chat markdown instead.",
        documentMode
          ? `Document is on. After one short sentence, output exactly one fenced file:\n\n\`\`\`document\nfilename: Title.${preferredDocumentExt(message)}\n\nThe full document.\n\`\`\`\n\nWrite the whole document inside the fence. Use Markdown headings and paragraphs. Do not say you cannot create files.`
          : "",
        profileLines.length ? `User profile:\n${profileLines.map((line) => `- ${line}`).join("\n")}` : "",
        memoryContext
          ? `${memoryContext}\n\nUse <memory_context> only when it helps. It is private notes about the user, not about you. Do not paste the whole list. Do not speak in the user's first person.`
          : "",
        feedbackGuidance(db, user.id),
        memoryOn
          ? "Notes about the user are private context. Use them to answer. Do not recite them, and do not write a profile, a tool call, or a program unless the user asked for that."
          : "",
        searchContext
          ? `Web search results (cite with markdown links when used):\n${searchContext}`
          : "",
        webSearch
          ? "Web search is on. Playwright/fetch in the user message means fetch_url. Do not write scraping scripts."
          : offerSearch && !userPrompt.includes("search_web")
            ? "Call search_web only when the question needs current, local, or source-backed facts you do not already know. Then call fetch_url on the most relevant result. Skip search for general knowledge."
            : "",
        attached ? `User-provided attachments. Use them as source material:\n${attached}` : "",
        offerCode
          ? "Code interpreter is available. When a calculation, data transform, or program is required, output a fenced block tagged python-run or javascript-run containing only the program. Do not invent stdout; it will be executed and returned to you."
          : "",
        spokenName
          ? `Reminder: you are ${assistantName}. ${spokenName} is the user${work ? ` and works as a ${work}` : ""}. Speak to ${spokenName}. Do not speak as ${spokenName}${work ? ` or as a ${work}` : ""}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const prior = history
        .filter((m) => m.id !== userMsgId && m.role !== "system")
        .filter((m) => m.role !== "assistant" || Boolean(String(m.content || "").trim()))
        .slice(-22);
      const historyMessages: ProviderMessage[] = [
        { role: "system", content: system },
        ...prior.map((m) => {
          const msg = providerMessage(m.role, m.content, uploadsDir);
          if (m.role === "assistant" && msg.content) msg.content = correctIdentityVoice(msg.content, spokenName, work);
          return msg;
        }),
        providerMessage("user", storedUser, uploadsDir),
      ];
      function weighPrompt(messages: ProviderMessage[]) {
        let systemChars = 0;
        let skills = 0;
        let tools = 0;
        let conversation = 0;
        for (const message of messages) {
          const text = message.content || "";
          if (message.role === "system") {
            const skillLen = skillPrompt && text.includes(skillPrompt) ? skillPrompt.length : 0;
            const toolLen = toolPrompt && text.includes(toolPrompt) ? toolPrompt.length : 0;
            skills += skillLen;
            tools += toolLen;
            systemChars += Math.max(0, text.length - skillLen - toolLen);
          } else if (text.startsWith("Tool results:") || text.startsWith("Code execution results:") || text.includes("```tool")) {
            tools += text.length;
          } else {
            conversation += text.length;
          }
        }
        return { system: systemChars, skills, tools, conversation };
      }

      let insideThink = false;
      let heldFence = "";
      function releaseVisible(delta: string) {
        if (offerCode) return delta;
        heldFence += delta;
        let visible = "";
        while (heldFence) {
          const open = heldFence.indexOf("```");
          if (open < 0) {
            visible += heldFence;
            heldFence = "";
            break;
          }
          visible += heldFence.slice(0, open);
          const rest = heldFence.slice(open);
          const headerEnd = rest.indexOf("\n");
          if (headerEnd < 0) {
            heldFence = rest;
            break;
          }
          const header = rest.slice(3, headerEnd).trim().toLowerCase();
          if (header === "python-run" || header === "javascript-run" || header === "js-run") {
            const close = rest.indexOf("```", headerEnd + 1);
            if (close < 0) {
              heldFence = rest;
              break;
            }
            heldFence = rest.slice(close + 3);
            continue;
          }
          visible += "```";
          heldFence = rest.slice(3);
        }
        return visible;
      }
      function flushHeldFence() {
        if (!heldFence) return "";
        if (/^```(?:python-run|javascript-run|js-run)/i.test(heldFence)) {
          heldFence = "";
          return "";
        }
        const rest = heldFence;
        heldFence = "";
        return rest;
      }
      function splitThink(delta: string) {
        let think = "";
        let visible = "";
        let rest = delta;
        while (rest) {
          if (insideThink) {
            const end = rest.toLowerCase().indexOf("</think>");
            if (end < 0) {
              think += rest;
              rest = "";
            } else {
              think += rest.slice(0, end);
              rest = rest.slice(end + "</think>".length);
              insideThink = false;
            }
          } else {
            const start = rest.toLowerCase().indexOf("<think>");
            if (start < 0) {
              visible += rest;
              rest = "";
            } else {
              visible += rest.slice(0, start);
              rest = rest.slice(start + "<think>".length);
              insideThink = true;
            }
          }
        }
        return { think, visible };
      }

      async function consume(streamMessages: ProviderMessage[]) {
        contextWeights = weighPrompt(streamMessages);
        for await (const event of streamForConnection(conn!, {
          model: ollamaModel || "",
          messages: streamMessages,
          think,
          signal: controller.signal,
          generation,
        })) {
          if (event.type === "status") {
            const generic = event.stage === "loading" || event.stage === "prompt";
            if (generic && (activityWaits.has(currentWait) || currentWait === "thinking")) continue;
            if (generic && thinking?.enabled) {
              emitWait("thinking");
              continue;
            }
            emitWait(event.stage);
          } else if (event.type === "thinking") {
            thinkingText += event.delta;
            if (currentWait !== "thinking") emitWait("thinking");
            if (thinking?.enabled) emit("thinking", { delta: event.delta });
          } else if (event.type === "content") {
            const parts = splitThink(event.delta);
            if (parts.think && thinking?.enabled) {
              thinkingText += parts.think;
              if (currentWait !== "thinking") emitWait("thinking");
              emit("thinking", { delta: parts.think });
            }
            if (parts.visible) {
              const visible = releaseVisible(parts.visible);
              if (visible) {
                content += visible;
                emit("content", { delta: visible });
              }
            }
          } else if (event.type === "error") {
            status = "error";
            emit("error", { message: event.message });
          } else if (event.type === "done") {
            usage = usageFromOllama(event.stats);
          }
        }
        const tail = flushHeldFence();
        if (tail) {
          content += tail;
          emit("content", { delta: tail });
        }
      }

      const canned = directIdentityReply(message, spokenName, work);
      if (canned) {
        content = canned;
        emit("content", { delta: content });
      } else {
        await consume(historyMessages);
      }

      const toolCtx = {
        db,
        userId: user.id,
        conversationId,
        memoryOn,
        searchEnabled: offerSearch,
        searchConfig,
        signal: controller.signal,
        previousUser,
        userMessage: storedUser,
      };
      function publishContent(next: string) {
        content = next;
        emit( "content", { reset: true, delta: content });
      }
      function showReply(text: string) {
        publishContent(stripLeakedAssistant(stripToolMarkup(text), offerCode));
      }

      function toolWaitStage(name: string) {
        if (name === "search_web") return "searching";
        if (name === "fetch_url") return "fetch";
        if (name === "memory_search" || name === "memory_list" || name === "memory_list_paths" || name === "memory_read_path") {
          return "memorySearch";
        }
        if (name.startsWith("memory_")) return "memory";
        return "running";
      }

      function peelThinkingDraft(text: string) {
        const htmlAt = text.search(/```html|<!doctype html/i);
        const marker = text.search(/thinking process\s*:/i);
        if (marker < 0 || (htmlAt >= 0 && marker > htmlAt)) return { think: "", visible: text };
        const end = htmlAt < 0 ? text.length : htmlAt;
        const think = text.slice(marker, end).replace(/<tool_code>[\s\S]*?(?:<\/tool_code>|$)/gi, "").trim();
        const visible = `${text.slice(0, marker)}${text.slice(end)}`.trim();
        return { think, visible };
      }

      for (let round = 0; round < 3 && status === "complete" && !controller.signal.aborted; round++) {
        const peeled = peelThinkingDraft(content);
        if (peeled.think) {
          thinkingText += `${thinkingText ? "\n" : ""}${peeled.think}`;
          if (thinking?.enabled) emit("thinking", { delta: peeled.think });
          content = peeled.visible;
        }
        const calls = parseToolCalls(`${content}\n${thinkingText}`);
        if (!calls.length) break;
        const results: string[] = [];
        if (calls.some((call) => call.name === "search_web" || call.name === "fetch_url")) {
          const note = activityNote(content);
          const last = activities[activities.length - 1];
          if (note && !(last?.kind === "note" && last.text === note)) {
            activities.push({ kind: "note", text: note });
            emitActivities();
          }
        }
        for (const call of calls) {
          emitWait(toolWaitStage(call.name));
          if (call.name === "search_web") {
            const focused = focusSearchText(String(call.arguments.query || call.arguments.q || ""));
            call.arguments.query = focused || focusSearchText(storedUser) || currentAsk.slice(0, 180);
          }
          const searchQuery = (call.arguments.query || call.arguments.q || "").trim();
          const searchStep: Extract<ChatActivity, { kind: "search" }> | null =
            call.name === "search_web" && searchQuery ? { kind: "search", query: searchQuery.slice(0, 180), sources: [] } : null;
          if (searchStep) {
            activities.push(searchStep);
            emitActivities();
          }
          if (call.name === "fetch_url") {
            const url = (call.arguments.url || call.arguments.query || "").trim();
            if (url) {
              activities.push({ kind: "fetch", url });
              emitActivities();
            }
          }
          try {
            const out = await executeToolCall(call, toolCtx);
            if (out.sources?.length) {
              if (searchStep) searchStep.sources = out.sources;
              sources = [...sources, ...out.sources.filter((item) => !sources.some((have) => have.url === item.url))];
              emitActivities();
              emit( "sources", { sources });
            }
            if (call.name === "memory_add" || call.name === "memory_update" || call.name === "memory_delete") {
              emit( "memory", { saved: [out.text] });
            }
            results.push(`${call.name}(${JSON.stringify(call.arguments)})\n${out.text}`);
            if (call.name !== "search_web") recordToolRun(db, user.id, conversationId, call.name);
          } catch (error) {
            results.push(`${call.name}: ${error instanceof Error ? error.message : "Tool failed."}`);
          }
        }
        const resultText = results.join("\n\n");
        showReply(content);
        await consume([
          ...historyMessages,
          { role: "assistant", content: content || "(called tools)" },
          {
            role: "user",
            content: `Tool results:\n${resultText}\n\nUse these results to answer. You may call tools again if needed.`,
          },
        ]);
      }
      showReply(content);
      if (status === "complete" && !controller.signal.aborted && !content.trim()) {
        await consume([
          ...historyMessages,
          {
            role: "user",
            content: "Reply now to the latest user message in their language. Output only the assistant reply. No tools, XML, or chain-of-thought.",
          },
        ]);
        showReply(content);
      }

      if (offerCode && status === "complete" && !controller.signal.aborted && extractRunnableBlocks(content).length) {
        emitWait("running");
        const output = await runCodeBlocks(content);
        if (output) {
          recordToolRun(db, user.id, conversationId, "code_interpreter");
          const note = `\n\n**Code output**\n\`\`\`\n${output}\n\`\`\`\n`;
          content += note;
          emit( "content", { delta: note });
          await consume([
            ...historyMessages,
            { role: "assistant", content },
            { role: "user", content: `Code execution results:\n${output}\n\nContinue from these results if needed.` },
          ]);
        }
      }
      showReply(content);
      if (controller.signal.aborted) status = "interrupted";
      if (status === "complete" && !content.trim()) {
        status = "error";
        emit( "error", {
          message: "The model returned no text. Check the API URL, key, and that the model ID is accepted by the provider.",
        });
      }
      if (status === "complete" && content.trim()) {
        const fixed = correctIdentityVoice(content, spokenName, work);
        if (fixed !== content) {
          content = fixed;
          emit("content", { reset: true, delta: content });
        }
      }
      if (status === "complete" && documentMode && content.trim()) {
        try {
          const saved = await materializeDocument(uploadsDir, content, message);
          if (saved) {
            content = saved.content;
            emit("content", { reset: true, delta: content });
          }
        } catch {
          /* keep the reply if the file cannot be written */
        }
      }
      if (status === "complete") {
        const watermark = loadAppGeneral(db).responseWatermark.trim();
        if (watermark && content.trim()) {
          const note = `\n\n${watermark}`;
          content += note;
          emit( "content", { delta: note });
        }
      }
    } catch (error) {
      if (error instanceof OllamaError && error.code === "REQUEST_ABORTED") status = "interrupted";
      else {
        status = "error";
        const code = error instanceof OllamaError ? error.code : "UNKNOWN";
        emit( "error", {
          message: error instanceof OllamaError && error.message && error.code === "UNKNOWN" ? error.message : publicErrorMessage(code),
        });
      }
    } finally {
      clearInterval(beat);
      if (usage) {
        usage.durationMs = Math.max(0, Date.now() - assistantCreatedAt);
        usage.context = splitPromptTokens(usage.inputTokens, contextWeights);
      }
      aborts.delete(key);
      db.update(messages)
        .set({
          content,
          thinking: thinkingText || null,
          status,
          stats: usage ? JSON.stringify(usage) : null,
          sources: sources.length ? JSON.stringify(sources) : null,
          activities: activities.length ? JSON.stringify(activities) : null,
          updatedAt: Date.now(),
        })
        .where(eq(messages.id, assistantId))
        .run();
      recordMessageUsage(db, {
        messageId: assistantId,
        userId: user.id,
        conversationId,
        modelId: model.id,
        role: "assistant",
        content,
        stats: usage ? JSON.stringify(usage) : null,
        createdAt: assistantCreatedAt,
      });
      let title = convo.title;
      if (convo.title === "New chat") {
        const iface = loadInterface(db);
        if (iface.titleGenerationEnabled) {
          const fallback = (message.trim() || attachmentNote || "New chat").slice(0, 48);
          title = fallback;
          const sourceKind = resolveModelConnection(db, model).providerKind === "openai" ? "openai" : "ollama";
          const taskId = sourceKind === "openai" ? iface.externalTaskModelId : iface.localTaskModelId;
          let taskRow = model;
          if (taskId && taskId !== TASK_MODEL_CURRENT) {
            const picked = db.select().from(modelConfigs).where(eq(modelConfigs.id, taskId)).get();
            if (picked?.enabled) taskRow = picked;
          }
          const remote = resolveOllamaModel(db, taskRow);
          const taskSource = resolveModelConnection(db, taskRow);
          const taskConn =
            [...connections.openai, ...connections.ollama].find((item) => item.id === taskSource.connectionId) || conn;
          if (remote && taskConn?.url) {
            const titleAbort = new AbortController();
            const timer = setTimeout(() => titleAbort.abort(), 8000);
            try {
              const raw = await completeForConnection(taskConn, {
                model: remote,
                messages: [
                  { role: "system", content: "Create a concise 3-6 word title for this chat. Reply with the title only." },
                  { role: "user", content: (message.trim() || attachmentNote || "New chat").slice(0, 400) },
                ],
                signal: titleAbort.signal,
              });
              const generated = raw.replace(/["'`#\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
              if (generated) title = generated;
            } catch {
              title = fallback;
            } finally {
              clearTimeout(timer);
            }
          }
          db.update(conversations).set({ title, modelId: model.id, updatedAt: Date.now() }).where(eq(conversations.id, conversationId)).run();
          emit( "title", { title });
        } else {
          db.update(conversations).set({ modelId: model.id, updatedAt: Date.now() }).where(eq(conversations.id, conversationId)).run();
        }
      } else {
        db.update(conversations).set({ modelId: model.id, updatedAt: Date.now() }).where(eq(conversations.id, conversationId)).run();
      }
      if (status !== "error") emit("done", { messageId: assistantId, usage });
      else emit("done", { messageId: assistantId, usage, error: true });
      endLiveTurn(conversationId);
      reply.raw.end();
      try {
        await explicitMemory;
        if ((memoryDue || shouldReviewMemory(storedUser)) && status === "complete" && !controller.signal.aborted) {
          const task = resolveTaskModel(db, env, connections, model, conn);
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), 12000);
          try {
            await reviewAndSaveMemories({
              db,
              userId: user.id,
              conversationId,
              conn: task.taskConn,
              model: task.remote || "",
              existing: mems,
              transcript: [
                previousUser ? `user: ${String(previousUser).slice(0, 1200)}` : "",
                `user: ${storedUser.slice(0, 1600)}`,
                `assistant_final: ${content.slice(0, 1600)}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
              currentUser: storedUser,
              previousUser: previousUser ? String(previousUser) : undefined,
              signal: abort.signal,
            });
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {
        /* memory review is best-effort */
      }
    }
  });
}
