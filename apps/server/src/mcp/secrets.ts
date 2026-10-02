import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Env } from "../env.ts";

function keyMaterial(env: Env) {
  return env.secretKey || env.sessionSecret;
}

function keyFor(env: Env) {
  return scryptSync(keyMaterial(env), "qv7-mcp-secret-v1", 32);
}

export function encryptSecret(plain: string, env: Env) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(env), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(packed: string, env: Env) {
  if (!packed) return "";
  const [version, ivRaw, tagRaw, dataRaw] = packed.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) throw new Error("secret");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(env), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]);
  return plain.toString("utf8");
}
