import { isIP } from "node:net";

export type DnsLookup = (hostname: string) => Promise<string[]>;

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.google", "metadata", "instance-data"]);

export class McpAddressError extends Error {
  constructor() {
    super("blocked");
    this.name = "McpAddressError";
  }
}

function stripDot(host: string) {
  return host.toLowerCase().replace(/\.$/, "");
}

export function normalizeAllowHost(value: string) {
  const host = stripDot(value.trim());
  if (!host || host.length > 253 || host.includes("/") || host.includes(":") || host.includes("*") || /\s/.test(host)) return "";
  if (!/^[a-z0-9.-]+$/.test(host) && !isIpv4(host)) return "";
  return host;
}

function isIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function expandIpv4(host: string) {
  if (isIpv4(host)) return host;
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return "";
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return "";
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return "";
}

function ipv4Private(ip: string) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function mappedV4(ip: string) {
  const lower = ip.toLowerCase();
  const mark = lower.startsWith("::ffff:") ? lower.slice(7) : "";
  return mark && isIpv4(mark) ? mark : "";
}

export function isMetadataAddress(ip: string) {
  const v4 = mappedV4(ip) || (isIpv4(ip) ? ip : "");
  if (v4 === "169.254.169.254" || v4 === "169.254.170.2") return true;
  const v6 = ip.toLowerCase();
  return v6 === "fd00:ec2::254" || v6 === "[fd00:ec2::254]";
}

function isPrivateAddress(ip: string) {
  if (isMetadataAddress(ip)) return true;
  const v4 = mappedV4(ip);
  if (v4) return ipv4Private(v4);
  if (isIpv4(ip)) return ipv4Private(ip);
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("ff")) return true;
  if (v6.startsWith("2001:db8:")) return true;
  return false;
}

function metadataHost(host: string) {
  return METADATA_HOSTS.has(host) || host.endsWith(".metadata.google.internal");
}

export async function assertSafeMcpUrl(raw: string, allowHosts: string[], lookup: DnsLookup) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new McpAddressError();
  }
  if (url.username || url.password || url.search || url.hash) throw new McpAddressError();
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new McpAddressError();
  const host = stripDot(url.hostname.replace(/^\[|\]$/g, ""));
  if (!host || metadataHost(host)) throw new McpAddressError();
  const allowed = new Set(allowHosts.map(stripDot));
  if ((host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) && !allowed.has(host)) throw new McpAddressError();
  const literal = expandIpv4(host);
  const addresses = literal ? [literal] : isIP(host) ? [host] : await lookup(host).catch(() => [] as string[]);
  if (!addresses.length) throw new McpAddressError();
  const trusted = allowed.has(host) || addresses.some((ip) => allowed.has(ip));
  if (url.protocol === "http:" && !trusted) throw new McpAddressError();
  for (const address of addresses) {
    if (isMetadataAddress(address)) throw new McpAddressError();
    if (isPrivateAddress(address) && !trusted) throw new McpAddressError();
  }
  return { href: url.href, host, addresses };
}
