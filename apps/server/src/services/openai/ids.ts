export function openaiBaseUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.hostname === "openrouter.ai" || parsed.hostname === "www.openrouter.ai") &&
      (parsed.pathname === "" || parsed.pathname === "/")
    ) {
      return `${parsed.origin}/api/v1`;
    }
  } catch {
    /* keep as-is */
  }
  return trimmed;
}

export function requestModelId(name: string) {
  const value = name.trim();
  const prefixed = value.match(/^(?:openai|ollama):[^:]+:(.+)$/);
  return prefixed?.[1] || value;
}
