import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { conversations, messages, modelConfigs, toolRuns, usageLedger, users } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { parseUserPlan, type UserPlan } from "@wlfv/shared";
import { loadAppGeneral } from "./app-general.ts";
const PALETTE = ["#fe4901", "#3b82f6", "#22c55e", "#a855f7", "#eab308", "#06b6d4", "#f43f5e", "#84cc16", "#fb7185", "#38bdf8"];

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseTokens(stats: string | null) {
  if (!stats) return 0;
  try {
    const data = JSON.parse(stats) as { totalTokens?: number; inputTokens?: number; outputTokens?: number };
    const total = Number(data.totalTokens || 0);
    if (total > 0) return total;
    return Math.max(0, Number(data.inputTokens || 0) + Number(data.outputTokens || 0));
  } catch {
    return 0;
  }
}

function estimateTokens(content: string) {
  const text = content.trim();
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function streaks(days: string[]) {
  const set = new Set(days);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev = "";
  for (const day of sorted) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  const today = dayKey(Date.now());
  const yesterday = addDays(today, -1);
  let cursor = set.has(today) ? today : set.has(yesterday) ? yesterday : "";
  let current = 0;
  while (cursor && set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

function formatCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const value = n / 1_000_000;
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (abs >= 1_000) {
    const value = n / 1_000;
    return `${value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

export function usageFloor(db: DB, userId: string) {
  const row = db.select({ usageResetAt: users.usageResetAt }).from(users).where(eq(users.id, userId)).get();
  return row?.usageResetAt ?? 0;
}

export function tokensUsedSince(db: DB, userId: string, since: number) {
  const floor = Math.max(since, usageFloor(db, userId));
  const events = db
    .select({ tokens: usageLedger.tokens, createdAt: usageLedger.createdAt })
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId))
    .all();
  let total = 0;
  for (const event of events) {
    if (event.createdAt < floor) continue;
    total += event.tokens;
  }
  return total;
}

export function recordMessageUsage(
  db: DB,
  input: {
    messageId: string;
    userId: string;
    conversationId: string;
    modelId?: string | null;
    role: string;
    content: string;
    stats?: string | null;
    createdAt: number;
  },
) {
  const tokens = parseTokens(input.stats || null) || estimateTokens(input.content);
  if (tokens <= 0) return;
  const existing = db.select().from(usageLedger).where(eq(usageLedger.messageId, input.messageId)).get();
  if (existing) {
    db.update(usageLedger)
      .set({
        tokens,
        modelId: input.modelId || existing.modelId,
        role: input.role || existing.role,
      })
      .where(eq(usageLedger.messageId, input.messageId))
      .run();
    return;
  }
  db.insert(usageLedger)
    .values({
      messageId: input.messageId,
      userId: input.userId,
      conversationId: input.conversationId,
      modelId: input.modelId || "",
      role: input.role || "assistant",
      tokens,
      createdAt: input.createdAt,
    })
    .run();
}

export function backfillUsageLedger(db: DB) {
  const have = new Set(db.select({ messageId: usageLedger.messageId }).from(usageLedger).all().map((row) => row.messageId));
  const convos = db
    .select({ id: conversations.id, userId: conversations.userId, modelId: conversations.modelId })
    .from(conversations)
    .all();
  const byId = new Map(convos.map((row) => [row.id, row]));
  const msgs = db.select().from(messages).all();
  for (const msg of msgs) {
    if (have.has(msg.id)) continue;
    const convo = byId.get(msg.conversationId);
    if (!convo) continue;
    recordMessageUsage(db, {
      messageId: msg.id,
      userId: convo.userId,
      conversationId: msg.conversationId,
      modelId: msg.modelId || convo.modelId,
      role: msg.role,
      content: msg.content,
      stats: msg.stats,
      createdAt: msg.createdAt,
    });
  }
}

export function resetUsage(db: DB, userId: string) {
  const now = Date.now();
  db.update(users).set({ usageResetAt: now, updatedAt: now }).where(eq(users.id, userId)).run();
  return now;
}

export function listPlanUsage(db: DB) {
  return db
    .select()
    .from(users)
    .all()
    .filter((row) => row.role !== "admin")
    .map((row) => {
      const quota = getTokenQuota(db, row.id, row.role, row.plan);
      return {
        id: row.id,
        email: row.email,
        username: row.username,
        role: row.role,
        plan: quota.plan,
        usedDay: quota.usedDay,
        usedWeek: quota.usedWeek,
        dayLimit: quota.dayLimit,
        weekLimit: quota.weekLimit,
        lifetimeTokens: tokensUsedSince(db, row.id, 0),
        usageResetAt: row.usageResetAt || 0,
      };
    })
    .sort((a, b) => b.lifetimeTokens - a.lifetimeTokens || a.username.localeCompare(b.username));
}

export type TokenQuota = {
  unlimited: boolean;
  plan: UserPlan;
  usedDay: number;
  usedWeek: number;
  dayLimit: number;
  weekLimit: number;
};

export function getTokenQuota(db: DB, userId: string, role?: string, planValue?: string): TokenQuota {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  const plan = parseUserPlan(planValue ?? row?.plan, "free");
  const isAdmin = (role ?? row?.role) === "admin";
  const limits = loadAppGeneral(db);
  const dayLimit = plan === "pro" ? limits.proDayTokens : limits.freeDayTokens;
  const weekLimit = plan === "pro" ? limits.proWeekTokens : limits.freeWeekTokens;
  const now = Date.now();
  return {
    unlimited: isAdmin,
    plan,
    usedDay: tokensUsedSince(db, userId, now - 24 * 60 * 60 * 1000),
    usedWeek: tokensUsedSince(db, userId, now - 7 * 24 * 60 * 60 * 1000),
    dayLimit,
    weekLimit,
  };
}

export function assertTokenQuota(db: DB, user: { id: string; role: string }): { ok: true } | { ok: false; code: "TOKEN_LIMIT_DAY" | "TOKEN_LIMIT_WEEK"; message: string } {
  const quota = getTokenQuota(db, user.id, user.role);
  if (quota.unlimited) return { ok: true };
  if (quota.dayLimit > 0 && quota.usedDay >= quota.dayLimit) {
    return {
      ok: false,
      code: "TOKEN_LIMIT_DAY",
      message: "You've reached the 24-hour token limit for your plan.",
    };
  }
  if (quota.weekLimit > 0 && quota.usedWeek >= quota.weekLimit) {
    return {
      ok: false,
      code: "TOKEN_LIMIT_WEEK",
      message: "You've reached the weekly token limit for your plan.",
    };
  }
  return { ok: true };
}

export function recordToolRun(db: DB, userId: string, conversationId: string | null, tool: string) {
  const name = tool.trim().slice(0, 80);
  if (!name) return;
  db.insert(toolRuns)
    .values({
      id: randomUUID(),
      userId,
      conversationId,
      tool: name,
      createdAt: Date.now(),
    })
    .run();
}

export function computeUsage(db: DB, userId: string) {
  const floor = usageFloor(db, userId);
  const convos = db.select().from(conversations).where(eq(conversations.userId, userId)).all();
  const models = db.select().from(modelConfigs).all();
  const names = new Map(models.map((row) => [row.id, row.displayName || row.ollamaModel]));
  const convoIds = convos.map((row) => row.id);
  const msgs = (convoIds.length ? db.select().from(messages).where(inArray(messages.conversationId, convoIds)).all() : []).filter(
    (row) => row.createdAt >= floor,
  );
  const runs = db
    .select()
    .from(toolRuns)
    .where(eq(toolRuns.userId, userId))
    .all()
    .filter((row) => row.createdAt >= floor);

  const byConvo = new Map<string, typeof msgs>();
  for (const msg of msgs) {
    const list = byConvo.get(msg.conversationId) || [];
    list.push(msg);
    byConvo.set(msg.conversationId, list);
  }

  let lifetimeTokens = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  const modelStats = new Map<string, { id: string; name: string; messages: number; tokens: number }>();
  const dayTokens = new Map<string, Map<string, number>>();
  const activeDays = new Set<string>();
  const toolCounts = new Map<string, number>();

  function bumpTool(name: string, count = 1) {
    toolCounts.set(name, (toolCounts.get(name) || 0) + count);
  }

  function bumpModel(id: string, tokens: number) {
    const key = id || "unknown";
    const current = modelStats.get(key) || { id: key, name: names.get(key) || key, messages: 0, tokens: 0 };
    current.messages += 1;
    current.tokens += tokens;
    modelStats.set(key, current);
  }

  function bumpDay(ts: number, modelId: string, tokens: number) {
    const key = dayKey(ts);
    activeDays.add(key);
    const byModel = dayTokens.get(key) || new Map<string, number>();
    byModel.set(modelId || "unknown", (byModel.get(modelId || "unknown") || 0) + tokens);
    dayTokens.set(key, byModel);
  }

  for (const msg of msgs) {
    if (msg.role === "user") userMessages += 1;
    else if (msg.role === "assistant") assistantMessages += 1;
    if (msg.sources) {
      try {
        const listed = JSON.parse(msg.sources) as unknown;
        if (Array.isArray(listed) && listed.length) bumpTool("search_web");
      } catch {
        /* ignore */
      }
    }
  }

  const events = db
    .select()
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId))
    .all()
    .filter((row) => row.createdAt >= floor);
  for (const event of events) {
    lifetimeTokens += event.tokens;
    const modelId = event.modelId || "unknown";
    if (event.role === "assistant") bumpModel(modelId, event.tokens);
    bumpDay(event.createdAt, modelId, event.tokens);
  }

  for (const run of runs) bumpTool(run.tool);

  let peakTokens = 0;
  for (const byModel of dayTokens.values()) {
    let dayTotal = 0;
    for (const value of byModel.values()) dayTotal += value;
    peakTokens = Math.max(peakTokens, dayTotal);
  }

  let longestActiveMs = 0;
  for (const convo of convos) {
    const list = (byConvo.get(convo.id) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
    if (list.length < 2) continue;
    longestActiveMs = Math.max(longestActiveMs, list[list.length - 1].createdAt - list[0].createdAt);
  }

  const chats = convos.filter((row) => (byConvo.get(row.id) || []).length > 0).length;
  const totalMessages = userMessages + assistantMessages;
  const { current, longest } = streaks([...activeDays]);
  const topModels = [...modelStats.values()].sort((a, b) => b.tokens - a.tokens || b.messages - a.messages).slice(0, 8);
  const modelColors = Object.fromEntries(topModels.map((row, index) => [row.id, PALETTE[index % PALETTE.length]]));

  const today = dayKey(Date.now());
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 52 * 7 - start.getUTCDay());
  const days: { date: string; tokens: number; modelId: string; color: string }[] = [];
  let cumulative = 0;
  for (let i = 0; i < 53 * 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = date.toISOString().slice(0, 10);
    const byModel = dayTokens.get(key);
    let tokens = 0;
    let modelId = "";
    if (byModel) {
      for (const [id, value] of byModel) {
        tokens += value;
        if (!modelId || value > (byModel.get(modelId) || 0)) modelId = id;
      }
    }
    cumulative += tokens;
    days.push({
      date: key,
      tokens,
      modelId,
      color: modelId ? modelColors[modelId] || PALETTE[PALETTE.length - 1] : "",
    });
  }

  const weeks: { date: string; tokens: number; modelId: string; color: string }[] = [];
  for (let week = 0; week < 53; week++) {
    const slice = days.slice(week * 7, week * 7 + 7);
    const byModel = new Map<string, number>();
    let tokens = 0;
    for (const day of slice) {
      tokens += day.tokens;
      if (day.modelId) byModel.set(day.modelId, (byModel.get(day.modelId) || 0) + day.tokens);
    }
    let modelId = "";
    let best = 0;
    for (const [id, value] of byModel) {
      if (value > best) {
        best = value;
        modelId = id;
      }
    }
    weeks.push({
      date: slice[0]?.date || "",
      tokens,
      modelId,
      color: modelId ? modelColors[modelId] || PALETTE[PALETTE.length - 1] : "",
    });
  }

  return {
    overview: {
      lifetimeTokens,
      peakTokens,
      longestActiveChatMs: longestActiveMs,
      currentStreak: current,
      longestStreak: longest,
    },
    insights: {
      models: modelStats.size,
      averageTokensPerChat: chats ? Math.round(lifetimeTokens / chats) : 0,
      averageMessagesPerActiveDay: activeDays.size ? totalMessages / activeDays.size : 0,
      userMessages,
      assistantMessages,
      totalChats: chats,
    },
    topModels: topModels.map((row) => ({
      ...row,
      color: modelColors[row.id] || PALETTE[0],
    })),
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    activity: {
      days,
      weeks,
      maxDayTokens: peakTokens,
      cumulativeMax: cumulative,
    },
    display: {
      lifetimeTokens: formatCompact(lifetimeTokens),
      peakTokens: formatCompact(peakTokens),
    },
  };
}
