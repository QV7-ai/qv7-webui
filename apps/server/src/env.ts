import { z } from "zod";

function readEnv(name: string, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

export function loadEnv() {
  const ollama = readEnv("OLLAMA_BASE_URL", "http://localhost:11434").replace(/\/$/, "");
  if (!/^https?:\/\//i.test(ollama)) {
    throw new Error("OLLAMA_BASE_URL must be http or https");
  }
  return {
    appName: readEnv("APP_NAME", "QV7"),
    appDescription: readEnv("APP_DESCRIPTION", "Self-hosted AI chat"),
    accent: readEnv("PRIMARY_ACCENT", "#FE4901"),
    ollamaBaseUrl: ollama,
    databaseUrl: readEnv("DATABASE_URL", "./data/wlfv-ai.db"),
    uploadsDir: readEnv("UPLOADS_DIR", "./uploads"),
    sessionSecret: readEnv("SESSION_SECRET", "dev-only-change-me"),
    initialAdminEmail: readEnv("INITIAL_ADMIN_EMAIL"),
    initialAdminPassword: readEnv("INITIAL_ADMIN_PASSWORD"),
    host: readEnv("HOST", "0.0.0.0"),
    port: Number(readEnv("PORT", "8787")) || 8787,
    webOrigin: readEnv("WEB_ORIGIN", "http://localhost:5173"),
    nodeEnv: readEnv("NODE_ENV", "development"),
    memoryModel: readEnv("MEMORY_MODEL"),
  };
}

export type Env = ReturnType<typeof loadEnv>;

export const chatBodySchema = z
  .object({
    conversationId: z.string().min(1),
    message: z.string().max(32000),
    modelId: z.string().min(1),
    thinking: z
      .object({
        enabled: z.boolean(),
        level: z.string().optional(),
      })
      .optional(),
    webSearch: z.boolean().optional(),
    codeInterpreter: z.boolean().optional(),
    createImage: z.boolean().optional(),
    editImage: z.boolean().optional(),
    skillIds: z.array(z.string().min(1).max(80)).max(12).optional(),
    canvas: z.boolean().optional(),
    document: z.boolean().optional(),
    canvasTitle: z.string().max(80).optional(),
    canvasHtml: z.string().max(80000).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          text: z.string().max(120000).optional().default(""),
          mime: z.string().max(120).optional(),
          url: z.string().max(400).optional(),
          kind: z.enum(["file", "image", "page"]).optional(),
        }),
      )
      .max(8)
      .optional(),
  })
  .refine((body) => Boolean(body.message.trim()) || Boolean(body.attachments?.length), {
    message: "Enter a message or attach a file.",
  });
