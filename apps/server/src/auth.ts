import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { users, sessions, userSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import type { Env } from "./env.ts";
import { DEFAULT_SYSTEM_PROMPT, parseUserRole } from "@wlfv/shared";
import { isContactEmail, loadAuthConfig, normalizeAuthConfig, pendingOverlay, saveAuthConfig } from "./auth-config.ts";
import { ensureDefaultSkills } from "./default-skills.ts";

const COOKIE = "wlfv_session";
const DAY = 1000 * 60 * 60 * 24 * 14;

export async function seedAdmin(db: DB, env: Env) {
  const existing = db.select().from(users).where(eq(users.role, "admin")).all();
  if (existing.length) return;
  if (!env.initialAdminEmail || !env.initialAdminPassword) return;
  const now = Date.now();
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email: env.initialAdminEmail.toLowerCase(),
      username: "admin",
      displayName: "Admin",
      bio: "",
      gender: "",
      birthday: "",
      passwordHash: await hashPassword(env.initialAdminPassword),
      role: "admin",
      plan: "pro",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(userSettings)
    .values({
      userId: id,
      theme: "dark",
      compact: 0,
      animations: 1,
      memoryEnabled: 1,
      defaultThinking: 0,
      language: "en",
      showUsage: 1,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      generationParams: "{}",
    })
    .run();
  ensureDefaultSkills(db, id);
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export type AuthUser = { id: string; email: string; username: string; displayName: string; role: "admin" | "user" | "pending" };

export async function getUser(req: FastifyRequest, db: DB): Promise<AuthUser | null> {
  const sid = req.cookies[COOKIE];
  if (!sid) return null;
  const row = db.select().from(sessions).where(eq(sessions.id, sid)).get();
  if (!row || row.expiresAt < Date.now()) return null;
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    role: parseUserRole(user.role),
  };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply, db: DB) {
  const user = await getUser(req, db);
  if (!user) {
    reply.code(401).send({ error: "You are not authorized to perform this action." });
    return null;
  }
  if (user.role === "pending") {
    reply.code(403).send({ error: "Your account is pending approval.", code: "PENDING" });
    return null;
  }
  return user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply, db: DB) {
  const user = await requireUser(req, reply, db);
  if (!user) return null;
  if (user.role !== "admin") {
    reply.code(403).send({ error: "You are not authorized to perform this action." });
    return null;
  }
  return user;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-z0-9_]{3,30}$/;

function publicAuthUser(user: { id: string; email: string; username: string; displayName?: string; role: string }) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    role: parseUserRole(user.role),
  };
}

function issueSession(reply: FastifyReply, db: DB, env: Env, userId: string) {
  const id = randomBytes(32).toString("hex");
  const now = Date.now();
  db.insert(sessions)
    .values({ id, userId, expiresAt: now + DAY, createdAt: now })
    .run();
  db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId)).run();
  reply.setCookie(COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    maxAge: DAY / 1000,
  });
}

function uniqueUsername(db: DB, email: string) {
  const local = email.split("@")[0] || "user";
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  if (base.length < 3) base = `${base}user`.slice(0, 30);
  let name = base;
  let n = 1;
  while (db.select().from(users).where(eq(users.username, name)).get()) {
    const suffix = `_${n++}`;
    name = `${base.slice(0, 30 - suffix.length)}${suffix}`;
  }
  return name;
}

export function registerAuth(app: FastifyInstance, db: DB, env: Env) {
  app.get("/api/auth/public", async () => {
    const config = loadAuthConfig(db);
    return { signupsEnabled: config.signupsEnabled };
  });

  app.get("/api/admin/auth", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { config: loadAuthConfig(db) };
  });

  app.patch("/api/admin/auth", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const payload = (req.body as { config?: unknown })?.config ?? req.body;
    const config = normalizeAuthConfig(payload);
    if (!isContactEmail(config.adminContactEmail)) {
      return reply.code(400).send({ error: "Enter a valid admin contact email." });
    }
    saveAuthConfig(db, config);
    return { config };
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const config = loadAuthConfig(db);
    if (!config.signupsEnabled) return reply.code(403).send({ error: "New signups are disabled." });
    const body = req.body as { email?: string; password?: string; username?: string };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    if (!email || !(EMAIL.test(email) || email.endsWith("@localhost"))) {
      return reply.code(400).send({ error: "Enter a valid email address." });
    }
    if (password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters." });
    if (db.select().from(users).where(eq(users.email, email)).get()) {
      return reply.code(409).send({ error: "That email is already in use." });
    }
    let username = (body.username || "").trim().toLowerCase() || uniqueUsername(db, email);
    if (!USERNAME.test(username)) return reply.code(400).send({ error: "Username must be 3–30 characters: lowercase letters, numbers, or underscore." });
    if (db.select().from(users).where(eq(users.username, username)).get()) {
      username = uniqueUsername(db, email);
    }
    const now = Date.now();
    const id = randomUUID();
    db.insert(users)
      .values({
        id,
        email,
        username,
        displayName: username,
        bio: "",
        gender: "",
        birthday: "",
        passwordHash: await hashPassword(password),
        role: config.defaultRole,
        plan: "free",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(userSettings)
      .values({
        userId: id,
        theme: "dark",
        compact: 0,
        animations: 1,
        memoryEnabled: 1,
        defaultThinking: 0,
        language: "en",
        showUsage: 1,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      generationParams: "{}",
    })
    .run();
  ensureDefaultSkills(db, id);
  const created = db.select().from(users).where(eq(users.id, id)).get()!;
    issueSession(reply, db, env, created.id);
    return { user: publicAuthUser(created) };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) return reply.code(400).send({ error: "Email and password are required." });
    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    issueSession(reply, db, env, user.id);
    return { user: publicAuthUser(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) db.delete(sessions).where(eq(sessions.id, sid)).run();
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await getUser(req, db);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const overlay = user.role === "pending" ? pendingOverlay(loadAuthConfig(db)) : undefined;
    return { user, pending: overlay };
  });
}
