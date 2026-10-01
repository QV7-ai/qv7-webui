import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const ICON_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

export function resolveUploadsDir(dir: string) {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function isStoredIconName(name: string) {
  return /^[a-f0-9-]+\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(name);
}

export function isStoredImageName(name: string) {
  return /^[a-f0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(name);
}

export function removeStoredIcon(uploadsDir: string, name?: string | null) {
  if (!name || !isStoredIconName(name)) return;
  fs.unlink(path.join(uploadsDir, name), () => undefined);
}

const CHAT_IMAGE_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MAX_CHAT_IMAGE = 8 * 1024 * 1024;

export async function saveChatImage(uploadsDir: string, mime: string, buf: Buffer) {
  const ext = CHAT_IMAGE_MIMES[mime];
  if (!ext) {
    const error = new Error("Use a PNG, JPEG, WebP, or GIF image.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  if (buf.length > MAX_CHAT_IMAGE) {
    const error = new Error("Images must be 8 MB or smaller.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  const name = `${randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, name), buf);
  return { name, type: mime, url: `/api/uploads/${name}` };
}

export function readStoredImage(uploadsDir: string, urlOrName: string) {
  const name = path.basename(String(urlOrName || "").replace(/^\/api\/uploads\//, ""));
  if (!isStoredImageName(name)) return null;
  const root = path.resolve(uploadsDir);
  const abs = path.resolve(root, name);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(abs)) return null;
  const buf = fs.readFileSync(abs);
  const mime = mimeForIcon(name);
  const base64 = buf.toString("base64");
  return { name, mime, base64, dataUrl: `data:${mime};base64,${base64}` };
}

export async function saveModelIcon(uploadsDir: string, file: MultipartFile, previous?: string | null) {
  const fromName = file.filename?.toLowerCase().endsWith(".ico") ? ".ico" : "";
  const ext = ICON_MIMES[file.mimetype] || fromName;
  if (!ext) {
    const error = new Error("Use a PNG, JPEG, WebP, GIF, SVG, or ICO image.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  const buf = await file.toBuffer();
  const name = `${randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, name), buf);
  removeStoredIcon(uploadsDir, previous);
  return { name, type: file.mimetype };
}

function mimeForIcon(file: string) {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".gif")) return "image/gif";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

export function registerUploads(app: FastifyInstance, uploadsDir: string) {
  app.get("/api/uploads/:file", async (req, reply) => {
    const file = path.basename((req.params as { file: string }).file);
    if (!isStoredIconName(file)) return reply.code(404).send({ error: "Not found." });
    const root = path.resolve(uploadsDir);
    const abs = path.resolve(root, file);
    const relative = path.relative(root, abs);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return reply.code(404).send({ error: "Not found." });
    }
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: "Not found." });
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.type(mimeForIcon(file)).send(fs.createReadStream(abs));
  });
}
