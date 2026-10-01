import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { t, type UiLang } from "@/lib/i18n";

type ActivityCell = { date: string; tokens: number; modelId: string; color: string };
type UsageData = {
  overview: {
    lifetimeTokens: number;
    peakTokens: number;
    longestActiveChatMs: number;
    currentStreak: number;
    longestStreak: number;
  };
  insights: {
    models: number;
    averageTokensPerChat: number;
    averageMessagesPerActiveDay: number;
    userMessages: number;
    assistantMessages: number;
    totalChats: number;
  };
  topModels: { id: string; name: string; messages: number; tokens: number; color: string }[];
  tools: { name: string; count: number }[];
  activity: { days: ActivityCell[]; weeks: ActivityCell[]; maxDayTokens: number; cumulativeMax: number };
  display: { lifetimeTokens: string; peakTokens: string };
  quota?: {
    unlimited: boolean;
    plan: "free" | "pro";
    usedDay: number;
    usedWeek: number;
    dayLimit: number;
    weekLimit: number;
  };
};

function compact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const value = n / 1_000_000;
    return `${(value >= 10 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, "")}m`;
  }
  if (abs >= 1_000) {
    const value = n / 1_000;
    return `${(value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, "")}k`;
  }
  if (!Number.isInteger(n)) return n.toFixed(1).replace(/\.0$/, "");
  return String(Math.round(n));
}

function duration(ms: number) {
  if (ms < 1000) return "0m";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${total}s`;
}

function monthLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}

function QuotaBar({ label, used, limit, unlimited }: { label: string; used: number; limit: number; unlimited: boolean }) {
  const max = unlimited || limit <= 0 ? Math.max(used, 1) : limit;
  const ratio = unlimited ? 0 : Math.min(1, used / Math.max(max, 1));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-[var(--secondary)]">{label}</span>
        <span className="tabular-nums">
          {unlimited ? "∞" : `${compact(used)} / ${compact(limit)}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[22px] font-medium leading-none">{value}</p>
      <p className="mt-1.5 text-[12px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-[var(--secondary)]">{label}</span>
      <span className="tabular-nums text-[var(--text)]">{value}</span>
    </div>
  );
}

function Heatmap({
  cells,
  columns,
  maxTokens,
  cumulative,
}: {
  cells: ActivityCell[];
  columns: number;
  maxTokens: number;
  cumulative?: boolean;
}) {
  let running = 0;
  const months: { index: number; label: string }[] = [];
    let prev = "";
    for (let col = 0; col < columns; col++) {
      const index = Math.floor((col * cells.length) / columns);
      const label = cells[index] ? monthLabel(cells[index].date) : "";
      if (label && label !== prev && (months.length === 0 || col - months[months.length - 1].index >= 4)) {
        months.push({ index: col, label });
        prev = label;
      }
    }
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[520px]">
        <div className="mb-1 flex h-4 text-[10px] text-[var(--muted)]">
          {months.map((month) => (
            <span key={`${month.label}-${month.index}`} className="absolute" style={{ left: `${(month.index / columns) * 100}%` }}>
              {month.label}
            </span>
          ))}
        </div>
        <div
          className="mt-4 grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoFlow: "column", gridTemplateRows: cells.length === columns ? "repeat(1, 10px)" : "repeat(7, 10px)" }}
        >
          {cells.map((cell) => {
            running += cell.tokens;
            const amount = cumulative ? running : cell.tokens;
            const cap = cumulative ? Math.max(maxTokens, 1) : Math.max(maxTokens, 1);
            const intensity = amount > 0 ? Math.min(1, 0.25 + 0.75 * (amount / cap)) : 0;
            return (
              <div
                key={cell.date}
                title={`${cell.date}: ${compact(cell.tokens)} tokens`}
                className="h-[10px] rounded-[2px]"
                style={{
                  background: cell.tokens > 0 && cell.color ? cell.color : "var(--surface)",
                  opacity: cell.tokens > 0 ? intensity : 1,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function UsagePanel({ language, userId }: { language: UiLang; userId?: string }) {
  const lang = language;
  const [data, setData] = useState<UsageData | null>(null);
  const [range, setRange] = useState<"daily" | "weekly" | "cumulative">("daily");
  const [error, setError] = useState("");

  useEffect(() => {
    const path = userId ? `/api/admin/users/${userId}/usage` : "/api/usage";
    api
      .get(path)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load usage."));
  }, [userId]);

  const totalMessages = (data?.insights.userMessages || 0) + (data?.insights.assistantMessages || 0);
  const userShare = totalMessages ? Math.round((100 * (data?.insights.userMessages || 0)) / totalMessages) : 0;
  const assistantShare = totalMessages ? 100 - userShare : 0;

  const heatmap = useMemo(() => {
    if (!data) return null;
    if (range === "weekly") {
      return { cells: data.activity.weeks, columns: data.activity.weeks.length, max: Math.max(...data.activity.weeks.map((cell) => cell.tokens), 1), cumulative: false };
    }
    return {
      cells: data.activity.days,
      columns: 53,
      max: range === "cumulative" ? Math.max(data.activity.cumulativeMax, 1) : Math.max(data.activity.maxDayTokens, 1),
      cumulative: range === "cumulative",
    };
  }, [data, range]);

  if (error) {
    return (
      <div>
        <h2 className="text-[22px] font-medium">{t(lang, "usage")}</h2>
        <p className="mt-4 text-[13px] text-[var(--danger)]">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h2 className="text-[22px] font-medium">{t(lang, "usage")}</h2>
        <p className="mt-4 text-[13px] text-[var(--muted)]">{t(lang, "loadingUsage")}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[22px] font-medium">{t(lang, "usage")}</h2>
      {data.quota ? (
        <div className="mt-6 space-y-3">
          <p className="text-[13px] font-medium">
            {data.quota.plan === "pro" ? t(lang, "planPro") : t(lang, "planFree")}
            {data.quota.unlimited ? ` · ${t(lang, "roleAdmin")}` : ""}
          </p>
          <QuotaBar
            label={t(lang, "tokensLast24h")}
            used={data.quota.usedDay}
            limit={data.quota.dayLimit}
            unlimited={data.quota.unlimited}
          />
          <QuotaBar
            label={t(lang, "tokensLast7d")}
            used={data.quota.usedWeek}
            limit={data.quota.weekLimit}
            unlimited={data.quota.unlimited}
          />
        </div>
      ) : null}
      <p className="mt-6 text-[13px] font-medium">{t(lang, "overview")}</p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-5">
        <Stat value={data.display.lifetimeTokens} label={t(lang, "lifetimeTokens")} />
        <Stat value={data.display.peakTokens} label={t(lang, "peakTokens")} />
        <Stat value={duration(data.overview.longestActiveChatMs)} label={t(lang, "longestActiveChat")} />
        <Stat value={String(data.overview.currentStreak)} label={t(lang, "currentStreak")} />
        <Stat value={String(data.overview.longestStreak)} label={t(lang, "longestStreak")} />
      </div>
      <div className="mt-8 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium">{t(lang, "tokenActivity")}</p>
        <div className="flex gap-3 text-[12px] text-[var(--muted)]">
          {(["daily", "weekly", "cumulative"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={range === id ? "text-[var(--text)]" : "hover:text-[var(--text)]"}
              onClick={() => setRange(id)}
            >
              {t(lang, id)}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {heatmap ? <Heatmap cells={heatmap.cells} columns={heatmap.columns} maxTokens={heatmap.max} cumulative={heatmap.cumulative} /> : null}
      </div>
      {data.topModels.length ? (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
          {data.topModels.map((model) => (
            <span key={model.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: model.color }} />
              {model.name}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-8 text-[13px] font-medium">{t(lang, "activityInsights")}</p>
      <div className="mt-2">
        <Insight label={t(lang, "models")} value={String(data.insights.models)} />
        <Insight label={t(lang, "avgTokensPerChat")} value={compact(data.insights.averageTokensPerChat)} />
        <Insight label={t(lang, "avgMessagesPerDay")} value={compact(data.insights.averageMessagesPerActiveDay)} />
        <Insight
          label={t(lang, "userMessages")}
          value={`${data.insights.userMessages}${totalMessages ? ` · ${userShare}%` : ""}`}
        />
        <Insight
          label={t(lang, "assistantMessages")}
          value={`${data.insights.assistantMessages}${totalMessages ? ` · ${assistantShare}%` : ""}`}
        />
        <Insight label={t(lang, "totalChats")} value={String(data.insights.totalChats)} />
      </div>
      <p className="mt-8 text-[13px] font-medium">{t(lang, "topModels")}</p>
      <div className="mt-2">
        {data.topModels.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">{t(lang, "noUsageYet")}</p>
        ) : (
          data.topModels.map((model) => (
            <Insight
              key={model.id}
              label={model.name}
              value={`${model.messages} ${t(lang, "messagesCount")} · ${compact(model.tokens)}`}
            />
          ))
        )}
      </div>
      <p className="mt-8 text-[13px] font-medium">{t(lang, "mostUsedTools")}</p>
      <div className="mt-2">
        {data.tools.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">{t(lang, "noToolsYet")}</p>
        ) : (
          data.tools.map((tool) => <Insight key={tool.name} label={tool.name} value={`${tool.count} ${t(lang, "runs")}`} />)
        )}
      </div>
    </div>
  );
}
