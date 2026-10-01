import type { UsageStats } from "@wlfv/shared";
import { useT } from "@/lib/language";

function fmt(n: number, digits = 1) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 100) return Math.round(n).toString();
  return n.toFixed(digits).replace(/\.0$/, "");
}

function fmtDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function UsageLine({ usage }: { usage: UsageStats }) {
  const tr = useT();
  const parts = [
    tr("usageIn", { n: usage.inputTokens }),
    tr("usageOut", { n: usage.outputTokens }),
    tr("usageTok", { n: usage.totalTokens }),
  ];
  const time = fmtDuration(usage.durationMs);
  if (time) parts.push(tr("usageTime", { n: time }));
  if (usage.tokensPerSecond > 0) parts.push(tr("usageToks", { n: fmt(usage.tokensPerSecond) }));
  if (usage.promptTokensPerSecond > 0) parts.push(tr("usagePromptToks", { n: fmt(usage.promptTokensPerSecond) }));
  return <p className="mt-2 text-[11px] text-[var(--muted)]">{parts.join(" · ")}</p>;
}
