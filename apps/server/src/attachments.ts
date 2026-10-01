import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import type { FastifyInstance } from "fastify";
import { requireUser } from "./auth.ts";
import { loadAppGeneral } from "./app-general.ts";
import type { DB } from "./db/index.ts";
import { htmlToText } from "./web-search/search.ts";
import { saveChatImage } from "./uploads.ts";

const TEXT_EXT = /\.(txt|md|markdown|csv|json|xml|html|css|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|yml|yaml|toml|ini|log|sql)$/i;
const MAX_CHARS = 80000;

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export async function fetchPublicPage(urlValue: string, maxChars = 20000) {
  let parsed: URL;
  try {
    parsed = new URL(String(urlValue || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new Error("Enter a valid http(s) URL.");
  }
  if (isPrivateHost(parsed.hostname)) throw new Error("That address cannot be fetched.");
  const res = await undiciFetch(parsed.toString(), {
    dispatcher: new Agent(),
    headers: { "User-Agent": "QV7/1.0 (+fetch_url)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Could not fetch that page (${res.status}).`);
  const raw = await res.text();
  const type = res.headers.get("content-type") || "";
  const text = clip(type.includes("html") ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim(), maxChars);
  if (!text) throw new Error("That page had no readable text.");
  return { name: parsed.hostname, url: parsed.toString(), text };
}

function clip(text: string, max = MAX_CHARS) {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function registerAttachments(app: FastifyInstance, db: DB, uploadsDir: string) {
  app.post("/api/attachments/file", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Choose a file to upload." });
    const buf = await file.toBuffer();
    const name = file.filename || "file";
    const mime = file.mimetype || "";
    if (mime.startsWith("image/")) {
      try {
        const saved = await saveChatImage(uploadsDir, mime, buf);
        return { id: randomUUID(), name, mime: saved.type, url: saved.url, kind: "image", text: "" };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not save that image." });
      }
    }
    let text = "";
    if (mime.startsWith("text/") || mime.includes("json") || TEXT_EXT.test(name)) {
      text = clip(buf.toString("utf8"));
    } else {
      text = `(Binary file attached: ${name}, ${buf.length} bytes.)`;
    }
    return { id: randomUUID(), name, mime, kind: "file", text };
  });

  app.post("/api/attachments/webpage", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    if (user.role !== "admin" && !loadAppGeneral(db).toolWebpage) return reply.code(403).send({ error: "Attach webpage is disabled." });
    const body = req.body as { url?: string };
    try {
      const page = await fetchPublicPage(String(body.url || ""));
      return { id: randomUUID(), name: page.name, url: page.url, text: page.text, kind: "page" };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not fetch that page." });
    }
  });
}
