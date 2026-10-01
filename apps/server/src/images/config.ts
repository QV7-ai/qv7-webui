import { eq } from "drizzle-orm";
import {
  DEFAULT_IMAGE_CREATE,
  DEFAULT_IMAGE_EDIT,
  DEFAULT_IMAGES,
  type ImageEditEngine,
  type ImageEndpointConfig,
  type ImageGenEngine,
  type ImagesConfig,
} from "@wlfv/shared";
import { appSettings } from "../db/schema.ts";
import type { DB } from "../db/index.ts";

const KEY = "images";

function asNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseGenEngine(value: unknown, fallback: ImageGenEngine): ImageGenEngine {
  if (value === "imagerouter" || value === "openai" || value === "comfyui" || value === "automatic1111" || value === "gemini") {
    return value;
  }
  if (value === "open ai" || value === "OpenAI") return "openai";
  return fallback;
}

function parseEditEngine(value: unknown, fallback: ImageEditEngine): ImageEditEngine {
  const engine = parseGenEngine(value, fallback);
  return engine === "automatic1111" ? fallback : engine;
}

function parseExtra(value: unknown) {
  const raw = String(value ?? "{}").trim() || "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}

function parseEndpoint(raw: unknown, fallback: ImageEndpointConfig, edit: boolean): ImageEndpointConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const engine = edit ? parseEditEngine(input.engine, fallback.engine as ImageEditEngine) : parseGenEngine(input.engine, fallback.engine);
  return {
    engine,
    model: String(input.model ?? fallback.model).trim().slice(0, 200),
    size: String(input.size ?? fallback.size).trim().slice(0, 40) || fallback.size,
    steps: Math.min(150, Math.max(1, Math.round(asNumber(input.steps, fallback.steps)))),
    promptGeneration: Boolean(input.promptGeneration),
    apiBaseUrl: String(input.apiBaseUrl ?? fallback.apiBaseUrl).trim().slice(0, 500) || fallback.apiBaseUrl,
    apiKey: String(input.apiKey ?? fallback.apiKey).slice(0, 4000),
    apiVersion: String(input.apiVersion ?? fallback.apiVersion).trim().slice(0, 80),
    apiAuth: String(input.apiAuth ?? fallback.apiAuth).slice(0, 400),
    extraParams: parseExtra(input.extraParams ?? fallback.extraParams),
  };
}

export function normalizeImages(raw: unknown): ImagesConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    generationEnabled: input.generationEnabled !== false,
    editEnabled: input.editEnabled !== false,
    create: parseEndpoint(input.create, DEFAULT_IMAGE_CREATE, false),
    edit: parseEndpoint(input.edit, DEFAULT_IMAGE_EDIT, true),
  };
}

export function loadImages(db: DB): ImagesConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return { ...DEFAULT_IMAGES, create: { ...DEFAULT_IMAGE_CREATE }, edit: { ...DEFAULT_IMAGE_EDIT } };
  try {
    return normalizeImages(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_IMAGES, create: { ...DEFAULT_IMAGE_CREATE }, edit: { ...DEFAULT_IMAGE_EDIT } };
  }
}

export function saveImages(db: DB, next: ImagesConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}
