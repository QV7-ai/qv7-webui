import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TASK_MODEL_CURRENT, type ImageEndpointConfig } from "@wlfv/shared";
import { conversations, messages, modelConfigs } from "../db/schema.ts";
import type { DB } from "../db/index.ts";
import { loadConnections } from "../connections.ts";
import { loadInterface } from "../interface.ts";
import { resolveModelConnection, resolveOllamaModel } from "../models.ts";
import { completeForConnection } from "../runtime.ts";
import { readStoredImage } from "../uploads.ts";
import {
  beginLiveTurn,
  emitChat,
  endLiveTurn,
  SSE_HEADERS,
  type SseRaw,
} from "../chat-sync.ts";
import type { Env } from "../env.ts";
import { editImageFile, generateImageFile } from "./generate.ts";
import { recordMessageUsage } from "../usage.ts";
import { loadImages } from "./config.ts";

type ChatModelRow = typeof modelConfigs.$inferSelect;

async function expandPrompt(
  db: DB,
  env: Env,
  model: ChatModelRow,
  settings: ImageEndpointConfig,
  prompt: string,
  signal?: AbortSignal,
) {
  if (!settings.promptGeneration) return prompt;
  const connections = loadConnections(db, env);
  const source = resolveModelConnection(db, model);
  const fallback =
    [...connections.openai, ...connections.ollama].find((item) => item.id === source.connectionId) ||
    connections.ollama.find((item) => item.enabled) ||
    connections.openai.find((item) => item.enabled);
  if (!fallback?.url) return prompt;
  const iface = loadInterface(db);
  const sourceKind = source.providerKind === "openai" ? "openai" : "ollama";
  const taskId = sourceKind === "openai" ? iface.externalTaskModelId : iface.localTaskModelId;
  let taskRow = model;
  if (taskId && taskId !== TASK_MODEL_CURRENT) {
    const picked = db.select().from(modelConfigs).where(eq(modelConfigs.id, taskId)).get();
    if (picked?.enabled) taskRow = picked;
  }
  const remote = resolveOllamaModel(db, taskRow);
  if (!remote) return prompt;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const raw = await completeForConnection(fallback, {
      model: remote,
      messages: [
        { role: "system", content: "Rewrite the user request as a detailed image generation prompt. Reply with the prompt only." },
        { role: "user", content: prompt.slice(0, 4000) },
      ],
      signal: abort.signal,
    });
    const next = raw.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    return next || prompt;
  } catch {
    return prompt;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function handleImageTurn(opts: {
  db: DB;
  env: Env;
  uploadsDir: string;
  req: FastifyRequest;
  reply: FastifyReply;
  userId: string;
  conversationId: string;
  convo: { title: string };
  model: ChatModelRow;
  message: string;
  attachments?: { name: string; url?: string; kind?: string; mime?: string }[];
  mode: "create" | "edit";
  userMsgId: string;
  storedUser: string;
}) {
  const images = loadImages(opts.db);
  const settings = opts.mode === "edit" ? images.edit : images.create;
  const controller = new AbortController();
  opts.req.raw.on("close", () => controller.abort());

  let prompt = opts.message.trim();
  if (opts.mode === "create" && !prompt) throw new Error("Enter a prompt to create an image.");
  if (opts.mode === "edit" && !prompt) prompt = "Edit this image.";
  const sourceAttach = (opts.attachments || []).find((item) => item.kind === "image" && item.url);
  if (opts.mode === "edit") {
    if (!sourceAttach?.url) throw new Error("Attach an image to edit.");
  }

  const assistantId = randomUUID();
  const assistantCreatedAt = Date.now();
  opts.db
    .insert(messages)
    .values({
      id: assistantId,
      conversationId: opts.conversationId,
      role: "assistant",
      content: "",
      thinking: null,
      modelId: opts.model.id,
      status: "streaming",
      createdAt: assistantCreatedAt,
      updatedAt: assistantCreatedAt,
    })
    .run();

  beginLiveTurn({
    userId: opts.userId,
    conversationId: opts.conversationId,
    userMessage: { id: opts.userMsgId, content: opts.storedUser },
    assistantId,
    wait: "image",
  });

  opts.reply.hijack();
  opts.reply.raw.writeHead(200, SSE_HEADERS);
  const emit = (event: string, data: unknown) => emitChat(opts.reply.raw as SseRaw, opts.conversationId, event, data);
  emit("status", { stage: settings.promptGeneration ? "prompt" : "image" });
  prompt = await expandPrompt(opts.db, opts.env, opts.model, settings, prompt, controller.signal);
  emit("status", { stage: "image" });

  let content = "";
  let status: "complete" | "interrupted" | "error" = "complete";
  try {
    const file =
      opts.mode === "edit"
        ? await editImageFile(
            opts.uploadsDir,
            settings,
            prompt,
            (() => {
              const stored = readStoredImage(opts.uploadsDir, sourceAttach!.url!);
              if (!stored) throw new Error("The attached image could not be read.");
              return { buf: Buffer.from(stored.base64, "base64"), mime: stored.mime, name: stored.name };
            })(),
            controller.signal,
          )
        : await generateImageFile(opts.uploadsDir, settings, prompt, controller.signal);
    content = `![${file.name}](${file.url})`;
    emit("content", { delta: content, reset: true });
  } catch (error) {
    status = controller.signal.aborted ? "interrupted" : "error";
    emit("error", { message: error instanceof Error ? error.message : "Image generation failed." });
  } finally {
    opts.db
      .update(messages)
      .set({ content, status, updatedAt: Date.now() })
      .where(eq(messages.id, assistantId))
      .run();
    recordMessageUsage(opts.db, {
      messageId: assistantId,
      userId: opts.userId,
      conversationId: opts.conversationId,
      modelId: opts.model.id,
      role: "assistant",
      content,
      createdAt: assistantCreatedAt,
    });
    if (opts.convo.title === "New chat") {
      const title = (opts.message.trim() || "Image").slice(0, 48);
      opts.db
        .update(conversations)
        .set({ title, modelId: opts.model.id, updatedAt: Date.now() })
        .where(eq(conversations.id, opts.conversationId))
        .run();
      emit("title", { title });
    } else {
      opts.db
        .update(conversations)
        .set({ modelId: opts.model.id, updatedAt: Date.now() })
        .where(eq(conversations.id, opts.conversationId))
        .run();
    }
    emit("done", { messageId: assistantId, error: status === "error" });
    endLiveTurn(opts.conversationId);
    opts.reply.raw.end();
  }
}

export function imagesEnabledFor(db: DB, mode: "create" | "edit") {
  const config = loadImages(db);
  return mode === "edit" ? config.editEnabled : config.generationEnabled;
}

