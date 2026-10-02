import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { assertSafeMcpUrl, type DnsLookup } from "./ssrf.ts";

export class McpClientError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "McpClientError";
    this.code = code;
  }
}

export type McpAuth = { kind: "none" | "bearer" | "header"; headerName: string; secret: string };

export type McpHttpResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
export type McpHttp = (
  input: { url: string; headers: Record<string, string>; body: string; pinned: string },
  signal: AbortSignal,
) => Promise<McpHttpResponse>;

const MAX_BODY = 256 * 1024;

export async function systemLookup(hostname: string) {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export function pickPinnedAddress(addresses: string[]) {
  return addresses.find((address) => !address.includes(":")) || addresses[0] || "";
}

export function pinnedLookup(pinned: string) {
  const family = pinned.includes(":") ? 6 : 4;
  return (_hostname: string, options: unknown, callback?: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
    const cb = typeof options === "function" ? (options as typeof callback) : callback;
    const opts = typeof options === "object" && options ? (options as { all?: boolean }) : {};
    if (typeof cb !== "function") return;
    if (opts.all) cb(null, [{ address: pinned, family }]);
    else cb(null, pinned, family);
  };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function parseMessages(contentType: string, body: string) {
  if (!body.trim()) return [];
  if (contentType.includes("text/event-stream")) {
    const messages: unknown[] = [];
    for (const chunk of body.split(/\n\n/)) {
      const data = chunk
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      messages.push(JSON.parse(data));
    }
    return messages;
  }
  const parsed = JSON.parse(body) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function defaultHttp(
  input: { url: string; headers: Record<string, string>; body: string; pinned: string },
  signal: AbortSignal,
  timeoutMs: number,
): Promise<McpHttpResponse> {
  const host = new URL(input.url).hostname;
  const agent = new Agent({
    connect: {
      rejectUnauthorized: true,
      servername: host,
      lookup: pinnedLookup(input.pinned),
    },
  });
  try {
    const res = await request(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      dispatcher: agent,
    });
    if (res.statusCode >= 300 && res.statusCode < 400) throw new McpClientError("blocked");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY) {
        await res.body.dump();
        throw new McpClientError("too_large");
      }
      chunks.push(buf);
    }
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(res.headers)) headers[key.toLowerCase()] = value;
    return { status: res.statusCode, headers, body: Buffer.concat(chunks).toString("utf8") };
  } finally {
    await agent.close();
  }
}

function authHeaders(auth: McpAuth) {
  const headers: Record<string, string> = {};
  if (!auth.secret) return headers;
  if (auth.kind === "bearer") headers.Authorization = `Bearer ${auth.secret.replace(/[\r\n]/g, "")}`;
  if (auth.kind === "header" && auth.headerName) headers[auth.headerName] = auth.secret.replace(/[\r\n]/g, "");
  return headers;
}

async function postRpc(opts: {
  href: string;
  pinned: string;
  auth: McpAuth;
  session: string;
  body: unknown;
  http?: McpHttp;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...authHeaders(opts.auth),
    };
    if (opts.session) headers["mcp-session-id"] = opts.session;
    const http = opts.http || ((input, signal) => defaultHttp(input, signal, opts.timeoutMs));
    const res = await http({ url: opts.href, headers, body: JSON.stringify(opts.body), pinned: opts.pinned }, controller.signal);
    if (res.status === 401 || res.status === 403) throw new McpClientError("auth");
    if (res.status < 200 || res.status >= 300) throw new McpClientError("network");
    let messages: unknown[] = [];
    try {
      messages = parseMessages(headerValue(res.headers, "content-type"), res.body);
    } catch {
      throw new McpClientError("protocol");
    }
    return { session: headerValue(res.headers, "mcp-session-id"), messages };
  } catch (error) {
    if (error instanceof McpClientError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") throw new McpClientError("timeout");
    throw new McpClientError("network");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function rpcResult(messages: unknown[], id: number) {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const row = message as { id?: number; error?: { message?: string }; result?: unknown };
    if (row.id !== id) continue;
    if (row.error) {
      const text = String(row.error.message || "").toLowerCase();
      if (text.includes("auth") || text.includes("unauthorized") || text.includes("forbidden")) throw new McpClientError("auth");
      throw new McpClientError("protocol");
    }
    return row.result;
  }
  throw new McpClientError("protocol");
}

export async function runMcp(opts: {
  endpoint: string;
  allowHosts: string[];
  auth: McpAuth;
  method: string;
  params: Record<string, unknown>;
  lookup?: DnsLookup;
  http?: McpHttp;
  timeoutMs?: number;
  signal?: AbortSignal;
}) {
  let destination;
  try {
    destination = await assertSafeMcpUrl(opts.endpoint, opts.allowHosts, opts.lookup || systemLookup);
  } catch {
    throw new McpClientError("blocked");
  }
  const timeoutMs = opts.timeoutMs ?? 15000;
  const pinned = pickPinnedAddress(destination.addresses);
  const initId = 1;
  const init = await postRpc({
    href: destination.href,
    pinned,
    auth: opts.auth,
    session: "",
    timeoutMs,
    signal: opts.signal,
    http: opts.http,
    body: {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "qv7", version: "0.1.0" } },
    },
  });
  rpcResult(init.messages, initId);
  await postRpc({
    href: destination.href,
    pinned,
    auth: opts.auth,
    session: init.session,
    timeoutMs,
    signal: opts.signal,
    http: opts.http,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  }).catch((error) => {
    if (error instanceof McpClientError && error.code === "protocol") return;
    throw error;
  });
  const callId = 2;
  const call = await postRpc({
    href: destination.href,
    pinned,
    auth: opts.auth,
    session: init.session,
    timeoutMs,
    signal: opts.signal,
    http: opts.http,
    body: { jsonrpc: "2.0", id: callId, method: opts.method, params: opts.params },
  });
  return rpcResult(call.messages, callId);
}

export type DiscoveredTool = { name: string; description: string; inputSchema: Record<string, unknown> };

export async function discoverMcpTools(opts: Omit<Parameters<typeof runMcp>[0], "method" | "params">) {
  const result = await runMcp({ ...opts, method: "tools/list", params: {} });
  const tools = result && typeof result === "object" ? (result as { tools?: unknown }).tools : null;
  if (!Array.isArray(tools)) throw new McpClientError("protocol");
  const found: DiscoveredTool[] = [];
  for (const item of tools.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; description?: unknown; inputSchema?: unknown };
    const name = String(row.name || "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) continue;
    const schema = row.inputSchema && typeof row.inputSchema === "object" && !Array.isArray(row.inputSchema) ? (row.inputSchema as Record<string, unknown>) : { type: "object" };
    const encoded = JSON.stringify(schema);
    if (encoded.length > 16000) continue;
    found.push({ name, description: String(row.description || "").slice(0, 500), inputSchema: schema });
  }
  return found;
}

export function toolResultText(result: unknown) {
  if (!result || typeof result !== "object") throw new McpClientError("protocol");
  const row = result as { content?: unknown; isError?: boolean };
  if (!Array.isArray(row.content)) throw new McpClientError("protocol");
  const parts: string[] = [];
  let extra = 0;
  for (const item of row.content.slice(0, 20)) {
    if (!item || typeof item !== "object") {
      extra += 1;
      continue;
    }
    const block = item as { type?: string; text?: string };
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else extra += 1;
  }
  let text = parts.join("\n");
  if (extra) text += `${text ? "\n" : ""}[non-text content omitted]`;
  if (text.length > 100000) throw new McpClientError("too_large");
  return { text, isError: row.isError === true };
}
