import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { McpAuthKind, McpPolicyView, McpServerView, McpToolView } from "@wlfv/shared";
import { appSettings, mcpServers, mcpTools } from "../db/schema.ts";
import type { DB } from "../db/index.ts";
import type { Env } from "../env.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";
import { sanitizeText } from "./sanitize.ts";
import { assertSafeMcpUrl, normalizeAllowHost, type DnsLookup } from "./ssrf.ts";

const POLICY_KEY = "mcp_policy";

export function callNameFor(id: string) {
  return `mcp_${id.replace(/-/g, "").slice(0, 12)}`;
}

export function loadMcpPolicy(db: DB): McpPolicyView {
  const row = db.select().from(appSettings).where(eq(appSettings.key, POLICY_KEY)).get();
  if (!row) return { allowHosts: [] };
  try {
    const parsed = JSON.parse(row.value) as { allowHosts?: unknown };
    const allowHosts = Array.isArray(parsed.allowHosts)
      ? parsed.allowHosts.map((item) => normalizeAllowHost(String(item))).filter(Boolean).slice(0, 20)
      : [];
    return { allowHosts };
  } catch {
    return { allowHosts: [] };
  }
}

export function saveMcpPolicy(db: DB, allowHosts: string[]) {
  const next = { allowHosts: allowHosts.map((item) => normalizeAllowHost(item)).filter(Boolean).slice(0, 20) };
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, POLICY_KEY)).get();
  if (existing) db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, POLICY_KEY)).run();
  else db.insert(appSettings).values({ key: POLICY_KEY, value, updatedAt: Date.now() }).run();
  return next;
}

function toolView(row: typeof mcpTools.$inferSelect): McpToolView {
  let inputSchema: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.inputSchema) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) inputSchema = parsed as Record<string, unknown>;
  } catch {
    inputSchema = {};
  }
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    inputSchema,
  };
}

export function serverView(db: DB, row: typeof mcpServers.$inferSelect): McpServerView {
  const tools = db.select().from(mcpTools).where(eq(mcpTools.serverId, row.id)).all().map(toolView);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    transport: "http",
    endpoint: row.url,
    authKind: row.authKind === "bearer" || row.authKind === "header" ? row.authKind : "none",
    authHeader: row.authKind === "header" ? row.authHeader : "",
    authConfigured: Boolean(row.secretEnc),
    status: row.status === "ok" || row.status === "error" ? row.status : "unknown",
    statusMessage: row.statusMessage,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tools,
  };
}

export function listServerViews(db: DB) {
  return db.select().from(mcpServers).all().map((row) => serverView(db, row));
}

export function getServer(db: DB, id: string) {
  return db.select().from(mcpServers).where(eq(mcpServers.id, id)).get() || null;
}

const HEADER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const BLOCKED_HEADERS = new Set(["cookie", "set-cookie", "host", "content-length", "transfer-encoding", "connection", "upgrade", "authorization"]);

export function parseAuthKind(value: unknown): McpAuthKind {
  return value === "bearer" || value === "header" ? value : "none";
}

export function cleanHeaderName(kind: McpAuthKind, value: unknown) {
  if (kind !== "header") return "";
  const name = String(value || "").trim();
  if (!HEADER_NAME.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) return "";
  return name;
}

export async function assertEndpoint(db: DB, endpoint: string, lookup?: DnsLookup) {
  const policy = loadMcpPolicy(db);
  const safe = await assertSafeMcpUrl(endpoint, policy.allowHosts, lookup || (await import("./client.ts")).systemLookup);
  return safe.href;
}

export function createServer(
  db: DB,
  env: Env,
  input: { name: string; description: string; endpoint: string; enabled: boolean; authKind: McpAuthKind; authHeader: string; secret: string },
) {
  const now = Date.now();
  const id = randomUUID();
  const authKind = input.authKind;
  const authHeader = cleanHeaderName(authKind, input.authHeader);
  if (authKind === "header" && !authHeader) throw new Error("header");
  db.insert(mcpServers)
    .values({
      id,
      name: sanitizeText(input.name, 80),
      description: sanitizeText(input.description, 400),
      enabled: input.enabled ? 1 : 0,
      transport: "http",
      url: input.endpoint,
      authKind,
      authHeader,
      secretEnc: authKind === "none" ? "" : encryptSecret(input.secret, env),
      status: "unknown",
      statusMessage: "",
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function updateServer(
  db: DB,
  env: Env,
  id: string,
  input: { name?: string; description?: string; endpoint?: string; enabled?: boolean; authKind?: McpAuthKind; authHeader?: string; secret?: string },
) {
  const row = getServer(db, id);
  if (!row) return false;
  const authKind = input.authKind ?? (row.authKind === "bearer" || row.authKind === "header" ? row.authKind : "none");
  const authHeader = input.authHeader === undefined ? row.authHeader : cleanHeaderName(authKind, input.authHeader);
  if (authKind === "header" && !authHeader) throw new Error("header");
  let secretEnc = row.secretEnc;
  if (authKind === "none") secretEnc = "";
  else if (input.secret) secretEnc = encryptSecret(input.secret, env);
  db.update(mcpServers)
    .set({
      name: input.name === undefined ? row.name : sanitizeText(input.name, 80),
      description: input.description === undefined ? row.description : sanitizeText(input.description, 400),
      url: input.endpoint ?? row.url,
      enabled: input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
      authKind,
      authHeader: authKind === "header" ? authHeader : "",
      secretEnc,
      updatedAt: Date.now(),
    })
    .where(eq(mcpServers.id, id))
    .run();
  return true;
}

export function deleteServer(db: DB, id: string) {
  const row = getServer(db, id);
  if (!row) return false;
  db.delete(mcpTools).where(eq(mcpTools.serverId, id)).run();
  db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
  return true;
}

export function setServerStatus(db: DB, id: string, status: "ok" | "error", message: string) {
  db.update(mcpServers)
    .set({ status, statusMessage: sanitizeText(message, 160), lastCheckedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(mcpServers.id, id))
    .run();
}

export function replaceDiscoveredTools(db: DB, serverId: string, tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]) {
  const existing = db.select().from(mcpTools).where(eq(mcpTools.serverId, serverId)).all();
  const byName = new Map(existing.map((row) => [row.name, row]));
  const seen = new Set<string>();
  const now = Date.now();
  for (const tool of tools) {
    seen.add(tool.name);
    const prev = byName.get(tool.name);
    const description = sanitizeText(tool.description, 500);
    const inputSchema = JSON.stringify(tool.inputSchema);
    if (prev) {
      db.update(mcpTools).set({ description, inputSchema, updatedAt: now }).where(eq(mcpTools.id, prev.id)).run();
    } else {
      db.insert(mcpTools)
        .values({
          id: randomUUID(),
          serverId,
          name: tool.name,
          description,
          inputSchema,
          enabled: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
  for (const prev of existing) {
    if (!seen.has(prev.name)) db.delete(mcpTools).where(eq(mcpTools.id, prev.id)).run();
  }
}

export function setToolEnabled(db: DB, id: string, enabled: boolean) {
  const row = db.select().from(mcpTools).where(eq(mcpTools.id, id)).get();
  if (!row) return null;
  db.update(mcpTools).set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() }).where(eq(mcpTools.id, id)).run();
  return getServer(db, row.serverId);
}

export function serverAuth(db: DB, env: Env, row: typeof mcpServers.$inferSelect) {
  let secret = "";
  if (row.secretEnc) {
    try {
      secret = decryptSecret(row.secretEnc, env);
    } catch {
      secret = "";
    }
  }
  const kind = row.authKind === "bearer" || row.authKind === "header" ? row.authKind : "none";
  return { kind, headerName: row.authHeader, secret } as const;
}

export function mcpSecretValues(db: DB, env: Env) {
  const values: string[] = [];
  for (const row of db.select().from(mcpServers).all()) {
    if (!row.secretEnc) continue;
    try {
      const secret = decryptSecret(row.secretEnc, env);
      if (secret.length >= 8) values.push(secret);
    } catch {
      /* skip unreadable secret */
    }
  }
  return values;
}
