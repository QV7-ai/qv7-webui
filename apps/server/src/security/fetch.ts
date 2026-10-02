import { Agent, request } from "undici";
import { McpAddressError, assertPublicHttpUrl } from "../mcp/ssrf.ts";
import { pickPinnedAddress, pinnedLookup, systemLookup } from "../mcp/client.ts";

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1_000_000;

export class OutboundFetchError extends Error {
  constructor(message = "That address cannot be fetched.") {
    super(message);
    this.name = "OutboundFetchError";
  }
}

async function readLimited(body: AsyncIterable<Uint8Array>, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw new OutboundFetchError("That page is too large.");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchPublicText(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal },
) {
  let current = String(rawUrl || "").trim();
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let checked: { href: string; host: string; addresses: string[] };
    try {
      checked = await assertPublicHttpUrl(current, systemLookup);
    } catch (error) {
      if (error instanceof McpAddressError) {
        console.warn(JSON.stringify({ security: "ssrf_blocked" }));
        throw new OutboundFetchError();
      }
      throw new OutboundFetchError();
    }
    const pinned = pickPinnedAddress(checked.addresses);
    const agent = new Agent({
      connect: {
        rejectUnauthorized: true,
        servername: checked.host,
        lookup: pinnedLookup(pinned),
      },
    });
    try {
      const res = await request(checked.href, {
        method: "GET",
        dispatcher: agent,
        signal: opts?.signal,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: {
          "user-agent": "QV7/1.0",
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8",
          "accept-encoding": "identity",
        },
      });
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        const next = Array.isArray(location) ? location[0] : location;
        await res.body.dump();
        if (!next || hop === MAX_REDIRECTS) throw new OutboundFetchError("That page redirected too many times.");
        current = new URL(next, checked.href).toString();
        continue;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await res.body.dump();
        throw new OutboundFetchError(`Could not fetch that page (${res.statusCode}).`);
      }
      const typeHeader = res.headers["content-type"];
      const contentType = (Array.isArray(typeHeader) ? typeHeader[0] : typeHeader) || "";
      const text = await readLimited(res.body, maxBytes);
      return { url: checked.href, host: checked.host, text, contentType };
    } finally {
      await agent.close();
    }
  }
  throw new OutboundFetchError("That page redirected too many times.");
}
