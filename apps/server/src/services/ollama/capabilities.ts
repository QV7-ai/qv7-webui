import type { CapabilityFlag, ModelCapabilities } from "@wlfv/shared";

function normalizeThinkValue(value: unknown): boolean | string | undefined {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "string" && ["low", "medium", "high", "max"].includes(value)) return value;
  return undefined;
}

export type DetectedCapabilities = {
  thinking: CapabilityFlag;
  thinkingLevels: string[];
  thinkValues: Array<boolean | string>;
  vision: CapabilityFlag;
  tools: CapabilityFlag;
  structuredOutput: CapabilityFlag;
};

export function parseShowCapabilities(show: {
  capabilities?: string[];
  thinking?: { values?: unknown[]; default?: unknown };
}): DetectedCapabilities {
  const caps = (show.capabilities ?? []).map((c) => String(c).toLowerCase());
  const values = (show.thinking?.values ?? []).map(normalizeThinkValue).filter((v) => v !== undefined) as Array<
    boolean | string
  >;
  const levels = values.filter((v): v is string => typeof v === "string");
  const thinkingOn = values.some((v) => v === true || typeof v === "string");
  let thinking: CapabilityFlag = false;
  if (show.thinking && Array.isArray(show.thinking.values)) thinking = thinkingOn;
  else if (caps.includes("thinking")) thinking = true;
  else thinking = false;

  const thinkValues: Array<boolean | string> = values.length
    ? values
    : thinking === true
      ? [false, true]
      : [];

  return {
    thinking,
    thinkingLevels: levels,
    thinkValues,
    vision: caps.includes("vision") ? true : caps.length ? false : "unknown",
    tools: caps.includes("tools") ? true : caps.length ? false : "unknown",
    structuredOutput: caps.includes("thinking") || caps.length ? false : "unknown",
  };
}

export function contextLengthFromShow(show: { model_info?: Record<string, unknown>; parameters?: string }) {
  const info = show.model_info || {};
  for (const [key, value] of Object.entries(info)) {
    if (!key.endsWith("context_length")) continue;
    const length = Number(value);
    if (Number.isFinite(length) && length > 0) return Math.round(length);
  }
  const param = String(show.parameters || "").match(/(?:^|\n)\s*num_ctx\s+(\d+)/i);
  const fromParam = Number(param?.[1]);
  if (Number.isFinite(fromParam) && fromParam > 0) return Math.round(fromParam);
  return undefined;
}

export function toPublicCapabilities(detected: DetectedCapabilities): ModelCapabilities {
  return {
    thinking: detected.thinking === true,
    thinkingLevels: detected.thinkingLevels,
    vision: detected.vision === true,
    tools: detected.tools === true,
    structuredOutput: detected.structuredOutput === true,
  };
}

export function thinkParam(detected: DetectedCapabilities, enabled: boolean, level?: string): boolean | string | undefined {
  if (detected.thinking !== true) return undefined;
  const values = detected.thinkValues;
  if (!enabled) return values.includes(false) ? false : undefined;
  if (level && values.includes(level)) return level;
  if (values.includes(true)) return true;
  return undefined;
}
