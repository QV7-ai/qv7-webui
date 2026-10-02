import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { hashPassword, registerAuth } from "../auth.ts";
import { sandboxEnv } from "../code-interpreter.ts";
import { closeDb, openDb } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { memories, sessions, users } from "../db/schema.ts";
import { loadEnv } from "../env.ts";
import { registerRest } from "../rest.ts";
import { registerUsers } from "../users.ts";
import { installHttpGuards, originAllowed } from "./http.ts";

test("cross-origin writes are limited to the app host", () => {
  const webOrigin = "http://localhost:5173";
  assert.equal(originAllowed({ host: "app.example", webOrigin }), true);
  assert.equal(originAllowed({ origin: "https://app.example", host: "app.example", webOrigin: "https://app.example" }), true);
  assert.equal(originAllowed({ origin: "http://localhost:5173", host: "127.0.0.1:8787", webOrigin }), true);
  assert.equal(
    originAllowed({ origin: "http://192.168.1.113:5173", host: "127.0.0.1:8787", webOrigin, secFetchSite: "same-origin" }),
    true,
  );
  assert.equal(originAllowed({ origin: "https://evil.example", host: "app.example", webOrigin: "https://app.example" }), false);
  assert.equal(
    originAllowed({ origin: "https://evil.example", host: "app.example", webOrigin: "https://app.example", secFetchSite: "cross-site" }),
    false,
  );
  assert.equal(originAllowed({ origin: "not a url", host: "app.example", webOrigin }), false);
});

test("code execution does not receive server secrets", () => {
  process.env.SESSION_SECRET = "session-secret-value";
  process.env.QV7_SECRET_KEY = "qv7-secret-value";
  process.env.INITIAL_ADMIN_PASSWORD = "admin-password-value";
  const env = sandboxEnv();
  const joined = Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n");
  assert.equal(joined.includes("session-secret-value"), false);
  assert.equal(joined.includes("qv7-secret-value"), false);
  assert.equal(joined.includes("admin-password-value"), false);
  assert.equal("SESSION_SECRET" in env, false);
  assert.equal(env.PYTHONUNBUFFERED, "1");
});

test("sessions are signed and memories stay with their owner", async () => {
  const file = path.join(os.tmpdir(), `qv7-sec-${randomUUID()}.db`);
  const env = { ...loadEnv(), databaseUrl: file, sessionSecret: "test-session-secret-value", webOrigin: "http://localhost:5173" };
  const db = openDb(env);
  const now = Date.now();
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email: "owner@example.com",
      username: "owner",
      displayName: "Owner",
      passwordHash: await hashPassword("correct-password"),
      role: "user",
      plan: "free",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(memories)
    .values({ id: "mem-1", userId: id, content: "secret note", category: "other", path: "", memoryType: "user", createdAt: now, updatedAt: now })
    .run();
  const app = Fastify({ bodyLimit: 64 });
  await app.register(cookie, { secret: env.sessionSecret });
  installHttpGuards(app, env);
  registerAuth(app, db, env);
  registerRest(app, db);
  registerUsers(app, db);
  try {
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "missing@example.com", password: "correct-password" } });
    assert.equal(bad.statusCode, 401);
    assert.equal(JSON.stringify(bad.json()).includes("correct-password"), false);
    const forged = await app.inject({ method: "GET", url: "/api/memory", headers: { cookie: "wlfv_session=not-a-signed-session" } });
    assert.equal(forged.statusCode, 401);
    const cross = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { email: "owner@example.com", password: "correct-password" },
    });
    assert.equal(cross.statusCode, 403);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:5173" },
      payload: { email: "owner@example.com", password: "correct-password" },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(JSON.stringify(login.json()).includes("passwordHash"), false);
    const setCookie = String(login.headers["set-cookie"] || "");
    const session = setCookie.split(";")[0] || "";
    assert.equal(session.startsWith("wlfv_session="), true);
    assert.equal(session.includes("."), true);
    const other = randomUUID();
    const otherSid = randomUUID();
    db.insert(users)
      .values({
        id: other,
        email: "other@example.com",
        username: "other",
        displayName: "Other",
        passwordHash: "x",
        role: "user",
        plan: "free",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(sessions).values({ id: otherSid, userId: other, expiresAt: now + 60_000, createdAt: now }).run();
    const stolen = await app.inject({
      method: "DELETE",
      url: "/api/memory/mem-1",
      headers: { cookie: `wlfv_session=${app.signCookie(otherSid)}`, origin: "http://localhost:5173" },
    });
    assert.equal(stolen.statusCode, 404);
    assert.equal(db.select().from(memories).where(eq(memories.id, "mem-1")).get()?.content, "secret note");
    const admin = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: session },
    });
    assert.equal(admin.statusCode, 403);
    const huge = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:5173", "content-type": "application/json" },
      payload: `{"email":"owner@example.com","password":"${"a".repeat(200)}"}`,
    });
    assert.equal(huge.statusCode, 413);
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: session, origin: "http://localhost:5173" } });
    assert.equal(logout.statusCode, 200);
    const after = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session } });
    assert.equal(after.statusCode, 401);
  } finally {
    await app.close();
    closeDb();
    fs.rmSync(file, { force: true });
  }
});
