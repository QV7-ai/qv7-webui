import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/index.ts";
import type { Env } from "../env.ts";
import { requireAdmin, requireUser } from "../auth.ts";
import { discoverMcpTools, McpClientError } from "./client.ts";
import { discoverServerTools, probeMcpServer } from "./call.ts";
import { publicMcpMessage, sanitizeText } from "./sanitize.ts";
import {
  assertEndpoint,
  cleanHeaderName,
  createServer,
  deleteServer,
  getServer,
  listServerViews,
  loadMcpPolicy,
  parseAuthKind,
  replaceDiscoveredTools,
  saveMcpPolicy,
  serverView,
  setServerStatus,
  setToolEnabled,
  updateServer,
} from "./store.ts";
import { listAvailableMcpTools } from "./invoke.ts";

const idSchema = z.string().uuid();
const writeLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };
const probeLimit = { rateLimit: { max: 8, timeWindow: "1 minute" } };

const serverBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(400).optional(),
    endpoint: z.string().min(1).max(500).optional(),
    enabled: z.boolean().optional(),
    authKind: z.enum(["none", "bearer", "header"]).optional(),
    authHeader: z.string().max(40).optional(),
    secret: z.string().max(4000).optional(),
  })
  .strict();

function fail(error: unknown) {
  if (error instanceof McpClientError) return publicMcpMessage(error.code);
  if (error instanceof Error && error.message === "blocked") return publicMcpMessage("blocked");
  if (error instanceof Error && error.message === "header") return "Enter a valid authentication header name.";
  return publicMcpMessage("network");
}

export function registerMcp(app: FastifyInstance, db: DB, env: Env) {
  app.get("/api/admin/mcp/servers", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { servers: listServerViews(db), policy: loadMcpPolicy(db) };
  });

  app.patch("/api/admin/mcp/policy", { config: writeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const body = z.object({ allowHosts: z.array(z.string().max(253)).max(20) }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a valid host allowlist." });
    return { policy: saveMcpPolicy(db, body.data.allowHosts) };
  });

  app.post("/api/admin/mcp/test", { config: probeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const body = serverBody.safeParse(req.body);
    if (!body.success || !body.data.endpoint) return reply.code(400).send({ error: "Enter an HTTPS address." });
    const authKind = parseAuthKind(body.data.authKind);
    if (authKind !== "none" && !body.data.secret) return reply.code(400).send({ error: "Enter the authentication secret." });
    const authHeader = cleanHeaderName(authKind, body.data.authHeader || "");
    if (authKind === "header" && !authHeader) return reply.code(400).send({ error: "Enter a valid authentication header name." });
    let endpoint = "";
    try {
      endpoint = await assertEndpoint(db, body.data.endpoint);
    } catch (error) {
      return reply.code(400).send({ error: fail(error) });
    }
    try {
      await discoverMcpTools({
        endpoint,
        allowHosts: loadMcpPolicy(db).allowHosts,
        auth: { kind: authKind, headerName: authHeader, secret: body.data.secret || "" },
        timeoutMs: 12000,
      });
      return { ok: true, message: "Connected." };
    } catch (error) {
      return { ok: false, message: fail(error) };
    }
  });

  app.post("/api/admin/mcp/servers", { config: writeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const body = serverBody.safeParse(req.body);
    if (!body.success || !body.data.name || !body.data.endpoint) return reply.code(400).send({ error: "Enter a name and an HTTPS address." });
    const authKind = parseAuthKind(body.data.authKind);
    if (authKind !== "none" && !body.data.secret) return reply.code(400).send({ error: "Enter the authentication secret." });
    let endpoint = "";
    try {
      endpoint = await assertEndpoint(db, body.data.endpoint);
    } catch (error) {
      return reply.code(400).send({ error: fail(error) });
    }
    try {
      const id = createServer(db, env, {
        name: body.data.name,
        description: body.data.description || "",
        endpoint,
        enabled: body.data.enabled === true,
        authKind,
        authHeader: body.data.authHeader || "",
        secret: body.data.secret || "",
      });
      const row = getServer(db, id);
      return { server: row ? serverView(db, row) : null };
    } catch (error) {
      return reply.code(400).send({ error: fail(error) });
    }
  });

  app.patch("/api/admin/mcp/servers/:id", { config: writeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Unknown MCP server." });
    const body = serverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Check the server fields." });
    let endpoint: string | undefined;
    if (body.data.endpoint) {
      try {
        endpoint = await assertEndpoint(db, body.data.endpoint);
      } catch (error) {
        return reply.code(400).send({ error: fail(error) });
      }
    }
    try {
      const ok = updateServer(db, env, id.data, { ...body.data, endpoint });
      if (!ok) return reply.code(404).send({ error: "Unknown MCP server." });
    } catch (error) {
      return reply.code(400).send({ error: fail(error) });
    }
    const row = getServer(db, id.data);
    return { server: row ? serverView(db, row) : null };
  });

  app.delete("/api/admin/mcp/servers/:id", { config: writeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Unknown MCP server." });
    if (!deleteServer(db, id.data)) return reply.code(404).send({ error: "Unknown MCP server." });
    return { ok: true };
  });

  app.post("/api/admin/mcp/servers/:id/test", { config: probeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Unknown MCP server." });
    const row = getServer(db, id.data);
    if (!row) return reply.code(404).send({ error: "Unknown MCP server." });
    try {
      await assertEndpoint(db, row.url);
      await probeMcpServer(db, env, row);
      setServerStatus(db, id.data, "ok", "Connected.");
    } catch (error) {
      const message = fail(error);
      setServerStatus(db, id.data, "error", message);
    }
    const next = getServer(db, id.data);
    return { server: next ? serverView(db, next) : null };
  });

  app.post("/api/admin/mcp/servers/:id/discover", { config: probeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Unknown MCP server." });
    const row = getServer(db, id.data);
    if (!row) return reply.code(404).send({ error: "Unknown MCP server." });
    try {
      await assertEndpoint(db, row.url);
      const tools = await discoverServerTools(db, env, row);
      replaceDiscoveredTools(db, id.data, tools);
      setServerStatus(db, id.data, "ok", "Tools updated.");
    } catch (error) {
      setServerStatus(db, id.data, "error", fail(error));
    }
    const next = getServer(db, id.data);
    return { server: next ? serverView(db, next) : null };
  });

  app.patch("/api/admin/mcp/tools/:id", { config: writeLimit }, async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "Unknown MCP tool." });
    const server = setToolEnabled(db, id.data, body.data.enabled);
    if (!server) return reply.code(404).send({ error: "Unknown MCP tool." });
    return { server: serverView(db, server) };
  });

  app.get("/api/mcp/tools", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    return {
      tools: listAvailableMcpTools(db, user.role).map((tool) => ({
        ...tool,
        description: sanitizeText(tool.description, 240),
      })),
    };
  });
}
