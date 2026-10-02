import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "./auth.ts";
import { loadAppGeneral } from "./app-general.ts";
import type { DB } from "./db/index.ts";
import { htmlToText } from "./web-search/search.ts";
import { saveChatImage } from "./uploads.ts";
import { readDocxText } from "./documents.ts";
import { fetchPublicText } from "./security/fetch.ts";
import { intEnv } from "./security/http.ts";

const TEXT_EXT = /\.(txt|md|markdown|csv|json|xml|html|css|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|yml|yaml|toml|ini|log|sql)$/i;
const MAX_CHARS = 80000;

export async function fetchPublicPage(urlValue: string, maxChars = 20000) {
  let page: Awaited<ReturnType<typeof fetchPublicText>>;
  try {
    page = await fetchPublicText(String(urlValue || ""), { timeoutMs: 15000, maxBytes: 1_000_000 });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "That address cannot be fetched.");
  }
  const type = page.contentType || "";
  const text = clip(type.includes("html") || /<\s*html[\s>]/i.test(page.text) ? htmlToText(page.text) : page.text.replace(/\s+/g, " ").trim(), maxChars);
  if (!text) throw new Error("That page had no readable text.");
  return { name: page.host, url: page.url, text };
}

function clip(text: string, max = MAX_CHARS) {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function registerAttachments(app: FastifyInstance, db: DB, uploadsDir: string) {
  const uploadLimit = { config: { rateLimit: { max: intEnv("UPLOAD_RATE_LIMIT", 30, 5, 120), timeWindow: "1 minute" } } };
  app.post("/api/attachments/file", uploadLimit, async (req, reply) => {
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
    if (/\.docx$/i.test(name) || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      try {
        text = clip(readDocxText(buf));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "That Word file could not be read." });
      }
    } else if (/\.doc$/i.test(name)) {
      return reply.code(400).send({ error: "Save that Word file as .docx and upload it again." });
    } else if (mime.startsWith("text/") || mime.includes("json") || TEXT_EXT.test(name)) {
      text = clip(buf.toString("utf8").replace(/^\uFEFF/, ""));
    } else {
      text = `(Binary file attached: ${name}, ${buf.length} bytes.)`;
    }
    return { id: randomUUID(), name, mime, kind: "file", text };
  });

  app.post("/api/attachments/webpage", { config: { rateLimit: { max: intEnv("FETCH_RATE_LIMIT", 20, 5, 60), timeWindow: "1 minute" } } }, async (req, reply) => {
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
