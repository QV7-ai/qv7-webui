import { eq } from "drizzle-orm";
import { DEFAULT_AUTH_CONFIG, parseUserRole, type AuthConfig } from "@wlfv/shared";
import { appSettings } from "./db/schema.ts";
import type { DB } from "./db/index.ts";

const KEY = "auth";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthConfig(raw: unknown): AuthConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    defaultRole: parseUserRole(input.defaultRole, DEFAULT_AUTH_CONFIG.defaultRole),
    signupsEnabled: input.signupsEnabled === true,
    adminContactEmail: String(input.adminContactEmail ?? "").trim().slice(0, 200),
    pendingOverlayTitle: String(input.pendingOverlayTitle ?? DEFAULT_AUTH_CONFIG.pendingOverlayTitle).trim().slice(0, 120) || DEFAULT_AUTH_CONFIG.pendingOverlayTitle,
    pendingOverlayContent: String(input.pendingOverlayContent ?? DEFAULT_AUTH_CONFIG.pendingOverlayContent).trim().slice(0, 4000) || DEFAULT_AUTH_CONFIG.pendingOverlayContent,
  };
}

export function loadAuthConfig(db: DB): AuthConfig {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (!row) return { ...DEFAULT_AUTH_CONFIG };
  try {
    return normalizeAuthConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_AUTH_CONFIG };
  }
}

export function saveAuthConfig(db: DB, next: AuthConfig) {
  const value = JSON.stringify(next);
  const existing = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  if (existing) {
    db.update(appSettings).set({ value, updatedAt: Date.now() }).where(eq(appSettings.key, KEY)).run();
  } else {
    db.insert(appSettings).values({ key: KEY, value, updatedAt: Date.now() }).run();
  }
}

export function pendingOverlay(config: AuthConfig) {
  return {
    title: config.pendingOverlayTitle,
    content: config.pendingOverlayContent,
    adminContactEmail: config.adminContactEmail,
  };
}

export function isContactEmail(value: string) {
  return !value || EMAIL.test(value) || value.endsWith("@localhost");
}
