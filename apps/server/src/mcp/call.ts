import type { DB } from "../db/index.ts";
import type { Env } from "../env.ts";
import { mcpServers } from "../db/schema.ts";
import { discoverMcpTools, runMcp, toolResultText, type McpHttp } from "./client.ts";

export type { McpHttp };
import { loadMcpPolicy, serverAuth } from "./store.ts";

type ServerRow = typeof mcpServers.$inferSelect;

function authOf(db: DB, env: Env, row: ServerRow) {
  return serverAuth(db, env, row);
}

export async function probeMcpServer(db: DB, env: Env, row: ServerRow, http?: McpHttp) {
  await discoverMcpTools({
    endpoint: row.url,
    allowHosts: loadMcpPolicy(db).allowHosts,
    auth: authOf(db, env, row),
    http,
    timeoutMs: 12000,
  });
}

export async function discoverServerTools(db: DB, env: Env, row: ServerRow, http?: McpHttp) {
  return discoverMcpTools({
    endpoint: row.url,
    allowHosts: loadMcpPolicy(db).allowHosts,
    auth: authOf(db, env, row),
    http,
    timeoutMs: 15000,
  });
}

export async function callMcp(db: DB, env: Env, row: ServerRow, name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; http?: McpHttp }) {
  const result = await runMcp({
    endpoint: row.url,
    allowHosts: loadMcpPolicy(db).allowHosts,
    auth: authOf(db, env, row),
    method: "tools/call",
    params: { name, arguments: args },
    http: opts.http,
    timeoutMs: 20000,
    signal: opts.signal,
  });
  return toolResultText(result);
}
