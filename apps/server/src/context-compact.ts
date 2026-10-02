export type ContextTurn = {
  id: string;
  role: string;
  content: string;
};

export function estimateTokens(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 3));
}

/** Prompt token budget inside a context window. Empty threshold means 75%. */
export function compactionLimit(window: number, raw?: string, reserve = 0) {
  if (!Number.isFinite(window) || window < 1024) return 0;
  const replyRoom = Math.max(256, Math.floor(reserve) || 0, Math.floor(window * 0.08));
  const headroom = Math.max(512, window - replyRoom);
  const n = Number(String(raw ?? "").trim());
  let target = Math.floor(window * 0.75);
  if (Number.isFinite(n) && n > 0) {
    if (n <= 1) target = Math.floor(window * Math.max(0.5, n));
    else if (n <= 100) target = Math.floor(window * Math.max(0.5, n / 100));
    else target = Math.max(1024, Math.floor(n));
  }
  return Math.min(headroom, Math.max(512, target));
}

export function splitContextTurns(turns: ContextTurn[], budgetTokens: number, summaryAllowance = 900) {
  if (!turns.length) return { keep: [] as ContextTurn[], fold: [] as ContextTurn[] };
  if (budgetTokens <= 0) return { keep: turns, fold: [] as ContextTurn[] };
  const room = Math.max(0, budgetTokens - summaryAllowance);
  const keep: ContextTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content) + 8;
    if (keep.length > 0 && used + cost > room) break;
    keep.push(turns[i]);
    used += cost;
    if (used > room) break;
  }
  keep.reverse();
  if (!keep.length) keep.push(turns[turns.length - 1]);
  const keepIds = new Set(keep.map((item) => item.id));
  return { keep, fold: turns.filter((item) => !keepIds.has(item.id)) };
}

export function foldExceptLatest(turns: ContextTurn[], keepCount: number) {
  const count = Math.max(1, keepCount);
  if (turns.length <= count) return { keep: turns, fold: [] as ContextTurn[] };
  return { keep: turns.slice(-count), fold: turns.slice(0, -count) };
}

export function clipTranscript(previous: string, folded: ContextTurn[], maxChars = 24000) {
  const lines = folded
    .map((item) => {
      const text = item.content.replace(/\s+/g, " ").trim();
      if (!text) return "";
      const who = item.role === "assistant" ? "Assistant" : "User";
      return `${who}: ${text.slice(0, 2000)}`;
    })
    .filter(Boolean);
  let body = lines.join("\n");
  if (body.length > maxChars) {
    const head = Math.floor(maxChars * 0.35);
    const tail = Math.floor(maxChars * 0.6);
    body = `${body.slice(0, head)}\n…\n${body.slice(-tail)}`;
  }
  const prior = previous.trim().slice(0, 8000);
  return prior ? `Previous summary:\n${prior}\n\nNewer messages:\n${body}` : body;
}

export function cleanContextSummary(raw: string) {
  return String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6000);
}

export function fallbackContextSummary(previous: string, folded: ContextTurn[]) {
  const bits = folded.slice(-8).map((item) => {
    const text = item.content.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!text) return "";
    return `${item.role === "assistant" ? "Assistant" : "User"}: ${text}`;
  });
  return [previous.trim(), bits.filter(Boolean).join("\n")].filter(Boolean).join("\n").slice(0, 4000);
}

export function trimTurnContent(content: string, maxTokens: number) {
  const maxChars = Math.max(500, maxTokens * 3);
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n…`;
}

const LOADED_WINDOWS = [2048, 4096, 8192, 12288, 16384, 20480, 24576, 32768, 40960, 49152, 65536, 98304, 131072, 262144];

/** The window this request will actually run in. A loaded model beats the architecture maximum. */
export function resolveContextWindow(input: { explicit?: number; loaded?: number; advertised?: number; usedTokens?: number }) {
  const explicit = Math.round(input.explicit || 0);
  if (explicit > 0) return explicit;
  const loaded = Math.round(input.loaded || 0);
  if (loaded > 0) return loaded;
  const advertised = Math.round(input.advertised || 0);
  const used = Math.round(input.usedTokens || 0);
  if (used > 0) {
    const hit = LOADED_WINDOWS.find((size) => used >= size * 0.9 && used <= size * 1.05 && (!advertised || size <= advertised));
    if (hit) return hit;
  }
  return advertised > 0 ? advertised : 0;
}

export function promptFillsWindow(usedTokens: number, budget: number) {
  return budget > 0 && usedTokens >= budget;
}

export function isContextOverflow(message: string) {
  return /context (?:length|size|window)|exceeds the available context|num_ctx|maximum context|prompt is too (?:long|large)|too many tokens/i.test(message);
}
