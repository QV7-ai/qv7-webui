import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { sessions, userSettings, users } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { hashPassword, requireAdmin, requireUser, verifyPassword } from "./auth.ts";
import { DEFAULT_SYSTEM_PROMPT, parseUserPlan, parseUserRole, parseWorkRole } from "@wlfv/shared";
import { computeUsage, getTokenQuota, listPlanUsage, resetUsage } from "./usage.ts";
import { ensureDefaultSkills } from "./default-skills.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENDERS = new Set(["", "female", "male", "non-binary", "prefer-not", "other"]);
const USERNAME = /^[a-z0-9_]{3,30}$/;

function publicUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName?.trim() || row.username,
    preferredName: row.preferredName || "",
    work: row.work || "",
    bio: row.bio || "",
    gender: row.gender || "",
    birthday: row.birthday || "",
    role: row.role,
    plan: parseUserPlan(row.plan),
    createdAt: row.createdAt,
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validateEmail(email: string) {
  if (email.endsWith("@localhost") || EMAIL.test(email)) return null;
  return "Enter a valid email address.";
}

function validatePassword(password: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

function usernameTaken(db: DB, username: string, exceptId?: string) {
  const row = db.select().from(users).where(eq(users.username, username)).get();
  return Boolean(row && row.id !== exceptId);
}

function validateUsername(username: string) {
  if (!USERNAME.test(username)) return "Username must be 3–30 characters: lowercase letters, numbers, or underscore.";
  return null;
}

function validateBirthday(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid birthday.";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "Enter a valid birthday.";
  if (date.getUTCFullYear() < 1900) return "Enter a valid birthday.";
  if (date.getTime() > Date.now()) return "Birthday cannot be in the future.";
  return null;
}

function emailTaken(db: DB, email: string, exceptId?: string) {
  const row = db.select().from(users).where(eq(users.email, email)).get();
  return Boolean(row && row.id !== exceptId);
}

function adminCount(db: DB) {
  return db.select().from(users).where(eq(users.role, "admin")).all().length;
}

function createSettings(db: DB, userId: string) {
  db.insert(userSettings)
    .values({
      userId,
      theme: "dark",
      compact: 0,
      animations: 1,
      memoryEnabled: 1,
      defaultThinking: 0,
      language: "en",
      showUsage: 1,
      textSize: 100,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      generationParams: "{}",
    })
    .run();
  ensureDefaultSkills(db, userId);
}

function clearSessions(db: DB, userId: string, keepId?: string) {
  const rows = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
  for (const row of rows) {
    if (keepId && row.id === keepId) continue;
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
  }
}

export function registerUsers(app: FastifyInstance, db: DB) {
  app.get("/api/account", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const row = db.select().from(users).where(eq(users.id, user.id)).get();
    if (!row) return reply.code(404).send({ error: "Account not found." });
    return { user: publicUser(row) };
  });

  app.patch("/api/account", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const row = db.select().from(users).where(eq(users.id, user.id)).get();
    if (!row) return reply.code(404).send({ error: "Account not found." });
    const body = req.body as {
      username?: string;
      displayName?: string;
      preferredName?: string;
      work?: string;
      bio?: string;
      gender?: string;
      birthday?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    const displayName = body.displayName != null ? body.displayName.trim().slice(0, 80) : row.displayName || row.username;
    if (!displayName) return reply.code(400).send({ error: "Enter a name." });
    const username = body.username != null ? body.username.trim().toLowerCase() : row.username;
    if (username !== row.username) {
      const usernameError = validateUsername(username);
      if (usernameError) return reply.code(400).send({ error: usernameError });
      if (usernameTaken(db, username, row.id)) return reply.code(409).send({ error: "That username is already in use." });
    }
    const preferredName = body.preferredName != null ? String(body.preferredName).trim().slice(0, 80) : row.preferredName || "";
    const work = body.work != null ? parseWorkRole(body.work) : row.work || "";
    if (body.work != null && body.work !== "" && !work) return reply.code(400).send({ error: "Choose a valid type of work." });
    const bio = body.bio != null ? String(body.bio).trim().slice(0, 500) : row.bio || "";
    const gender = body.gender != null ? String(body.gender) : row.gender || "";
    if (!GENDERS.has(gender)) return reply.code(400).send({ error: "Choose a valid gender." });
    const birthday = body.birthday != null ? String(body.birthday).trim() : row.birthday || "";
    const birthdayError = validateBirthday(birthday);
    if (birthdayError) return reply.code(400).send({ error: birthdayError });
    const email = body.email != null ? normalizeEmail(body.email) : row.email;
    const emailError = validateEmail(email);
    if (emailError) return reply.code(400).send({ error: emailError });
    if (emailTaken(db, email, row.id)) return reply.code(409).send({ error: "That email is already in use." });
    const changingSecret = email !== row.email || Boolean(body.newPassword);
    if (changingSecret) {
      if (!body.currentPassword) return reply.code(400).send({ error: "Enter your current password." });
      if (!(await verifyPassword(row.passwordHash, body.currentPassword))) {
        return reply.code(400).send({ error: "Current password is incorrect." });
      }
    }
    let passwordHash = row.passwordHash;
    if (body.newPassword) {
      const passwordError = validatePassword(body.newPassword);
      if (passwordError) return reply.code(400).send({ error: passwordError });
      passwordHash = await hashPassword(body.newPassword);
    }
    db.update(users)
      .set({
        username,
        displayName,
        preferredName,
        work,
        bio,
        gender,
        birthday,
        email,
        passwordHash,
        updatedAt: Date.now(),
      })
      .where(eq(users.id, row.id))
      .run();
    if (body.newPassword) clearSessions(db, row.id, req.cookies.wlfv_session);
    const next = db.select().from(users).where(eq(users.id, row.id)).get()!;
    return { user: publicUser(next) };
  });

  app.get("/api/admin/users", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const rows = db.select().from(users).all();
    rows.sort((a, b) => a.createdAt - b.createdAt);
    return { users: rows.map(publicUser) };
  });

  app.get("/api/admin/usage", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    return { users: listPlanUsage(db) };
  });

  app.get("/api/admin/users/:id/usage", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return reply.code(404).send({ error: "User not found." });
    return {
      user: { id: row.id, username: row.username, email: row.email, role: row.role, plan: parseUserPlan(row.plan) },
      ...computeUsage(db, row.id),
      quota: getTokenQuota(db, row.id, row.role, row.plan),
    };
  });

  app.post("/api/admin/users/:id/usage/reset", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return reply.code(404).send({ error: "User not found." });
    resetUsage(db, row.id);
    const next = listPlanUsage(db).find((item) => item.id === row.id);
    return { user: next };
  });

  app.post("/api/admin/users", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const body = req.body as { email?: string; username?: string; password?: string; role?: string; plan?: string };
    const email = normalizeEmail(body.email || "");
    const username = (body.username || "").trim().toLowerCase();
    const usernameError = validateUsername(username);
    if (usernameError) return reply.code(400).send({ error: usernameError });
    if (usernameTaken(db, username)) return reply.code(409).send({ error: "That username is already in use." });
    const password = body.password || "";
    const role = parseUserRole(body.role, "user");
    const emailError = validateEmail(email);
    if (emailError) return reply.code(400).send({ error: emailError });
    const passwordError = validatePassword(password);
    if (passwordError) return reply.code(400).send({ error: passwordError });
    if (emailTaken(db, email)) return reply.code(409).send({ error: "That email is already in use." });
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
        role,
        plan: parseUserPlan((body as { plan?: string }).plan, "free"),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    createSettings(db, id);
    const next = db.select().from(users).where(eq(users.id, id)).get()!;
    return { user: publicUser(next) };
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return reply.code(404).send({ error: "User not found." });
    const body = req.body as { email?: string; username?: string; password?: string; role?: string; plan?: string };
    const username = body.username?.trim() || row.username;
    const email = body.email != null ? normalizeEmail(body.email) : row.email;
    const emailError = validateEmail(email);
    if (emailError) return reply.code(400).send({ error: emailError });
    if (emailTaken(db, email, row.id)) return reply.code(409).send({ error: "That email is already in use." });
    let role = row.role;
    if (body.role === "admin" || body.role === "user" || body.role === "pending") {
      if (row.role === "admin" && body.role !== "admin" && adminCount(db) < 2) {
        return reply.code(400).send({ error: "Keep at least one admin." });
      }
      role = body.role;
    }
    const plan = parseUserPlan(body.plan, parseUserPlan(row.plan));
    let passwordHash = row.passwordHash;
    if (body.password) {
      const passwordError = validatePassword(body.password);
      if (passwordError) return reply.code(400).send({ error: passwordError });
      passwordHash = await hashPassword(body.password);
    }
    db.update(users)
      .set({ username, email, role, plan, passwordHash, updatedAt: Date.now() })
      .where(eq(users.id, id))
      .run();
    if (body.password) clearSessions(db, id);
    const next = db.select().from(users).where(eq(users.id, id)).get()!;
    return { user: publicUser(next) };
  });

  app.delete("/api/admin/users/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply, db);
    if (!admin) return;
    const { id } = req.params as { id: string };
    if (id === admin.id) return reply.code(400).send({ error: "You cannot delete your own account." });
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return reply.code(404).send({ error: "User not found." });
    if (row.role === "admin" && adminCount(db) < 2) {
      return reply.code(400).send({ error: "Keep at least one admin." });
    }
    db.delete(sessions).where(eq(sessions.userId, id)).run();
    db.delete(users).where(eq(users.id, id)).run();
    return { ok: true };
  });
}
