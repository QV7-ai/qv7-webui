import "./load-env.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { loadEnv } from "./env.ts";
import { openDb } from "./db/index.ts";
import { backfillUsageLedger } from "./usage.ts";
import { registerAuth, seedAdmin } from "./auth.ts";
import { registerModels, syncConnectionModels } from "./models.ts";
import { registerChat } from "./chat.ts";
import { registerRest } from "./rest.ts";
import { registerUsers } from "./users.ts";
import { registerFolders } from "./folders.ts";
import { registerSkills } from "./skills.ts";
import { ensureDefaultSkills } from "./default-skills.ts";
import { registerWebSearch } from "./web-search/index.ts";
import { registerAppGeneral } from "./app-general.ts";
import { registerBranding } from "./branding.ts";
import { registerInterface } from "./interface.ts";
import { registerAdminDatabase } from "./admin-database.ts";
import { registerConnections } from "./connections-api.ts";
import { loadConnections } from "./connections.ts";
import { firstOllamaClient } from "./runtime.ts";
import { registerUploads, resolveUploadsDir } from "./uploads.ts";
import { registerAttachments } from "./attachments.ts";
import { registerImages } from "./images/index.ts";
import { registerCanvases } from "./canvases.ts";

async function main() {
  const env = loadEnv();
  const db = openDb(env);
  backfillUsageLedger(db);
  const uploadsDir = resolveUploadsDir(env.uploadsDir);
  await seedAdmin(db, env);
  try {
    await syncConnectionModels(db, env);
    console.log("Models synchronized");
  } catch (error) {
    console.warn("Model sync skipped:", error instanceof Error ? error.message : error);
  }

  const app = Fastify({ logger: true, requestTimeout: 0, connectionTimeout: 0, keepAliveTimeout: 72000 });
  await app.register(cookie);
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    allowList: (req) => req.method === "GET" || req.method === "HEAD",
  });
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 8 },
  });

  app.get("/api/health", async () => {
    const client = firstOllamaClient(loadConnections(db, env));
    if (!client) return { status: "ok", ollama: { connected: false, version: null } };
    try {
      const version = await client.version();
      return { status: "ok", ollama: { connected: true, version } };
    } catch {
      return { status: "ok", ollama: { connected: false, version: null } };
    }
  });

  ensureDefaultSkills(db);
  registerAuth(app, db, env);
  registerUploads(app, uploadsDir);
  registerAttachments(app, db, uploadsDir);
  registerModels(app, db, env, uploadsDir);
  registerChat(app, db, env, uploadsDir);
  registerRest(app, db);
  registerUsers(app, db);
  registerFolders(app, db);
  registerSkills(app, db);
  registerWebSearch(app, db);
  registerImages(app, db);
  registerAppGeneral(app, db);
  registerBranding(app, db, env, uploadsDir);
  registerInterface(app, db);
  registerAdminDatabase(app, db, env);
  registerConnections(app, db, env);
  registerCanvases(app, db);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = [path.resolve(here, "../../web/dist"), path.resolve(process.cwd(), "../web/dist"), path.resolve(process.cwd(), "apps/web/dist")].find(
    (dir) => fs.existsSync(path.join(dir, "index.html")),
  );
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split("?")[0] || "/";
      if (pathname.startsWith("/api")) return reply.code(404).send({ error: "Not found." });
      if (req.method !== "GET" && req.method !== "HEAD") return reply.code(404).send({ error: "Not found." });
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn("Web build not found. GET /chat will 404 until npm run build creates apps/web/dist.");
  }

  await app.listen({ host: env.host, port: env.port });
  app.log.info(`${env.appName} listening on ${env.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
