import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_CONNECTIONS,
  type ConnectionApiType,
  type ConnectionAuth,
  type ConnectionKind,
  type ConnectionLocation,
  type ConnectionsConfig,
  type ProviderConnection,
} from "@wlfv/shared";
import { appSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import type { Env } from "./env.ts";

const KEY = "connections";
export const DEFAULT_OLLAMA_ID = "ollama-default";

function normalizeProviderUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.hostname === "openrouter.ai" || parsed.hostname === "www.openrouter.ai") &&
      (parsed.pathname === "" || parsed.pathname === "/")
    ) {
      return `${parsed.origin}/api/v1`;
    }
  } catch {
    /* keep as-is */
  }
  return trimmed;
}

function asStringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 80);
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function parseAuth(value: unknown): ConnectionAuth {
  return value === "none" ? "none" : "bearer";
}

function parseApiType(value: unknown): ConnectionApiType {
  return value === "responses" ? "responses" : "chat";
}

function parseLocation(value: unknown, kind: ConnectionKind): ConnectionLocation {
  if (value === "local" || value === "external") return value;
  return kind === "ollama" ? "local" : "external";
}

export function normalizeConnection(raw: unknown, kind: ConnectionKind): ProviderConnection {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = normalizeProviderUrl(String(input.url || ""));
  return {
    id: String(input.id || randomUUID()),
    kind,
    enabled: input.enabled !== false,
    url,
    location: parseLocation(input.location ?? input.connectionType, kind),
    auth: parseAuth(input.auth),
    apiKey: String(input.apiKey ?? "").trim().slice(0, 4000),
    apiType: parseApiType(input.apiType),
    forwardCookies: Boolean(input.forwardCookies),
    headers: String(input.headers ?? "").slice(0, 8000),
    passthrough: String(input.passthrough ?? "").slice(0, 500),
    prefixId: String(input.prefixId ?? "").trim().slice(0, 40),
    provider: String(input.provider || "default").trim().slice(0, 40) || "default",
    modelIds: asStringList(input.modelIds),
    tags: asStringList(input.tags).slice(0, 20),
  };
}

export function defaultOllamaConnection(env: Env): ProviderConnection {
  return normalizeConnection(
    {
      id: DEFAULT_OLLAMA_ID,
      enabled: true,
      url: env.ollamaBaseUrl,
      location: "local",
      auth: "none",
    },
    "ollama",
  );
}

export function normalizeConnections(raw: unknown, env: Env): ConnectionsConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const openai = (Array.isArray(input.openai) ? input.openai : []).map((item) => normalizeConnection(item, "openai"));
  let ollama = (Array.isArray(input.ollama) ? input.ollama : []).map((item) => normalizeConnection(item, "ollama"));
  if (!ollama.length) ollama = [defaultOllamaConnection(env)];
  return {
    openaiEnabled: input.openaiEnabled === true,
    ollamaEnabled: input.ollamaEnabled !== false,
    directConnections: input.directConnections === true,
    cacheBaseModelList: input.cacheBaseModelList === true,
    openai,
    ollama,
  };
}

export function loadConnections(db: DB, env: Env): ConnectionsConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return normalizeConnections({ ...DEFAULT_CONNECTIONS, ollama: [defaultOllamaConnection(env)] }, env);
  try {
    return normalizeConnections(JSON.parse(row.value), env);
  } catch {
    return normalizeConnections({ ...DEFAULT_CONNECTIONS, ollama: [defaultOllamaConnection(env)] }, env);
  }
}

export function saveConnections(db: DB, next: ConnectionsConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}

export function findConnection(config: ConnectionsConfig, id?: string | null) {
  if (!id) return config.ollama.find((item) => item.enabled) ?? config.ollama[0];
  return [...config.openai, ...config.ollama].find((item) => item.id === id);
}

export function connectionHeaders(conn: ProviderConnection) {
  const headers: Record<string, string> = {};
  if (conn.auth === "bearer" && conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  try {
    const host = new URL(conn.url).hostname;
    if (host === "openrouter.ai" || host === "www.openrouter.ai") {
      if (!headers["HTTP-Referer"] && !headers["Referer"] && !headers["http-referer"]) {
        headers["HTTP-Referer"] = "http://localhost";
      }
      if (!headers["X-Title"] && !headers["x-title"]) headers["X-Title"] = "QV7";
    }
  } catch {
    /* ignore invalid url */
  }
  try {
    const extra = conn.headers.trim() ? JSON.parse(conn.headers) : {};
    if (extra && typeof extra === "object" && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
        if (value != null) headers[key] = String(value);
      }
    }
  } catch {
    /* ignore invalid JSON */
  }
  return headers;
}

export function remoteModelName(conn: ProviderConnection, name: string) {
  const prefix = conn.prefixId.trim();
  return prefix ? `${prefix}${name}` : name;
}

export function storageModelKey(conn: ProviderConnection, remote: string) {
  if (conn.kind === "openai") return `openai:${conn.id}:${remote}`;
  if (conn.id === DEFAULT_OLLAMA_ID) return remote;
  return `ollama:${conn.id}:${remote}`;
}

export function isModelIdFilter(filter: string) {
  const value = filter.trim().toLowerCase();
  return Boolean(value) && (value.includes("*") || value === ":free" || value.endsWith("/"));
}

export function modelIdMatches(modelId: string, filter: string) {
  const id = modelId.trim().toLowerCase();
  const value = filter.trim().toLowerCase();
  if (!id || !value) return false;
  if (id === value) return true;
  if (value === ":free" || value === "*:free") return id.endsWith(":free");
  if (value.endsWith("/")) return id.startsWith(value);
  if (value.includes("*")) {
    const escaped = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(id);
  }
  return false;
}

export async function resolveConnectionModelIds(conn: ProviderConnection, listed: string[]) {
  const filters = conn.modelIds.map((item) => item.trim()).filter(Boolean);
  if (!filters.length) return listed;
  const matched = listed.filter((id) => filters.some((filter) => modelIdMatches(id, filter)));
  const extras = filters.filter(
    (filter) => !isModelIdFilter(filter) && !matched.some((id) => id.toLowerCase() === filter.toLowerCase()),
  );
  return [...new Set([...matched, ...extras])];
}
