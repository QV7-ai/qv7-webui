import type { FastifyError, FastifyInstance } from "fastify";
import type { Env } from "../env.ts";

function hostOf(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).host.toLowerCase();
  } catch {
    return "";
  }
}

export function originAllowed(input: {
  origin?: string;
  host?: string;
  forwardedHost?: string;
  webOrigin: string;
  secFetchSite?: string;
}) {
  const site = (input.secFetchSite || "").toLowerCase();
  if (site === "same-origin" || site === "same-site" || site === "none") return true;
  if (site === "cross-site") return false;
  if (!input.origin) return true;
  const originHost = hostOf(input.origin);
  if (!originHost) return false;
  const allowed = [hostOf(input.host), hostOf(input.forwardedHost), hostOf(input.webOrigin)];
  return allowed.includes(originHost);
}

export function cookieSecure(env: Env) {
  return env.nodeEnv === "production" && env.webOrigin.startsWith("https://");
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "script-src 'self' https://cdn.tailwindcss.com https://unpkg.com",
  "connect-src 'self' https://cdn.tailwindcss.com https://unpkg.com",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function installHttpGuards(app: FastifyInstance, env: Env) {
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const forwarded = req.headers["x-forwarded-host"];
    const site = req.headers["sec-fetch-site"];
    if (
      originAllowed({
        origin,
        host: req.headers.host,
        forwardedHost: Array.isArray(forwarded) ? forwarded[0] : forwarded,
        webOrigin: env.webOrigin,
        secFetchSite: Array.isArray(site) ? site[0] : site,
      })
    ) {
      return;
    }
    req.log.warn({ security: "csrf_origin" }, "blocked cross-origin write");
    return reply.code(403).send({ error: "Cross-origin request blocked." });
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    const path = (req.url.split("?")[0] || "/").toLowerCase();
    const type = String(reply.getHeader("content-type") || "");
    const html = type.includes("text/html") && !path.startsWith("/c/");
    if (env.nodeEnv === "production" && html && !reply.getHeader("content-security-policy")) {
      reply.header("Content-Security-Policy", CSP);
    }
    if (cookieSecure(env)) {
      reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    return payload;
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) req.log.error({ err: { message: error.message, code: error.code } }, "request failed");
    if (reply.sent) return;
    if (status === 413) return reply.code(413).send({ error: "Request is too large." });
    if (status === 429) return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    if (status >= 500) return reply.code(500).send({ error: "Something went wrong." });
    const message = error.message && !/[\\/]/.test(error.message) ? error.message.slice(0, 300) : "Request failed.";
    return reply.code(status).send({ error: message });
  });
}

export function intEnv(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
