import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatActivity, WebSearchSource } from "@wlfv/shared";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type SseRaw = ServerResponse & { flush?: () => void };

export type LiveTurn = {
  userId: string;
  conversationId: string;
  userMessage: { id: string; content: string };
  assistantId: string;
  content: string;
  thinking: string;
  wait?: string;
  sources?: WebSearchSource[];
  activities?: ChatActivity[];
};

const liveTurns = new Map<string, LiveTurn>();
const convoSubs = new Map<string, Set<SseRaw>>();
const userSubs = new Map<string, Set<SseRaw>>();

export function writeSse(raw: SseRaw, event: string, data: unknown) {
  try {
    if (raw.writableEnded || raw.destroyed) return;
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    raw.flush?.();
  } catch {
    /* subscriber gone */
  }
}

function addSub(map: Map<string, Set<SseRaw>>, key: string, raw: SseRaw) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(raw);
}

function removeSub(map: Map<string, Set<SseRaw>>, key: string, raw: SseRaw) {
  const set = map.get(key);
  if (!set) return;
  set.delete(raw);
  if (!set.size) map.delete(key);
}

function broadcast(map: Map<string, Set<SseRaw>>, key: string, event: string, data: unknown, except?: SseRaw) {
  const set = map.get(key);
  if (!set) return;
  for (const raw of set) {
    if (raw === except) continue;
    writeSse(raw, event, data);
  }
}

export function getLiveTurn(conversationId: string) {
  return liveTurns.get(conversationId);
}

export function notifyChats(userId: string, extra?: Record<string, unknown>) {
  broadcast(userSubs, userId, "chats", extra ?? {});
}

export function notifyDeleted(userId: string, conversationId: string) {
  broadcast(userSubs, userId, "deleted", { id: conversationId });
}

export function beginLiveTurn(turn: Omit<LiveTurn, "content" | "thinking"> & { content?: string; thinking?: string }) {
  const live: LiveTurn = {
    ...turn,
    content: turn.content || "",
    thinking: turn.thinking || "",
  };
  liveTurns.set(turn.conversationId, live);
  const payload = {
    conversationId: live.conversationId,
    userMessage: live.userMessage,
    assistantId: live.assistantId,
    wait: live.wait,
  };
  broadcast(convoSubs, turn.conversationId, "start", payload);
  notifyChats(turn.userId, { conversationId: turn.conversationId });
}

export function emitChat(origin: SseRaw, conversationId: string, event: string, data: unknown) {
  writeSse(origin, event, data);
  const live = liveTurns.get(conversationId);
  if (live) {
    const payload = data as {
      delta?: string;
      reset?: boolean;
      stage?: string;
      sources?: WebSearchSource[];
      activities?: ChatActivity[];
    };
    if (event === "content") {
      live.content = payload.reset ? payload.delta || "" : live.content + (payload.delta || "");
    } else if (event === "thinking") {
      live.thinking += payload.delta || "";
    } else if (event === "status" && payload.stage) {
      live.wait = payload.stage;
    } else if (event === "sources" && payload.sources) {
      live.sources = payload.sources;
    } else if (event === "activity" && payload.activities) {
      live.activities = payload.activities;
    }
  }
  const fanout =
    live && data && typeof data === "object"
      ? { ...(data as object), assistantId: live.assistantId, conversationId }
      : data;
  broadcast(convoSubs, conversationId, event, fanout, origin);
  if (event === "title" || event === "done") {
    if (live) notifyChats(live.userId, { conversationId });
  }
}

export function endLiveTurn(conversationId: string) {
  liveTurns.delete(conversationId);
}

export function overlayLiveMessages<T extends { id: string; content: string; thinking?: string | null; status?: string; sources?: WebSearchSource[]; activities?: ChatActivity[] }>(
  conversationId: string,
  msgs: T[],
): T[] {
  const live = liveTurns.get(conversationId);
  if (!live) return msgs;
  return msgs.map((m) => {
    if (m.id !== live.assistantId) return m;
    return {
      ...m,
      content: live.content,
      thinking: live.thinking || m.thinking,
      status: "streaming",
      sources: live.sources ?? m.sources,
      activities: live.activities ?? m.activities,
    };
  });
}

export function subscribeUser(userId: string, raw: SseRaw, req: IncomingMessage) {
  addSub(userSubs, userId, raw);
  writeSse(raw, "ready", {});
  const ping = setInterval(() => writeSse(raw, "ping", {}), 20000);
  const stop = () => {
    clearInterval(ping);
    removeSub(userSubs, userId, raw);
  };
  req.on("close", stop);
  raw.on("close", stop);
  return stop;
}

export function subscribeConversation(conversationId: string, raw: SseRaw, req: IncomingMessage) {
  addSub(convoSubs, conversationId, raw);
  const live = liveTurns.get(conversationId);
  if (live) {
    writeSse(raw, "snapshot", {
      conversationId,
      userMessage: live.userMessage,
      assistantId: live.assistantId,
      content: live.content,
      thinking: live.thinking,
      wait: live.wait,
      sources: live.sources,
      activities: live.activities,
    });
  } else {
    writeSse(raw, "ready", { conversationId });
  }
  const ping = setInterval(() => writeSse(raw, "ping", {}), 20000);
  const stop = () => {
    clearInterval(ping);
    removeSub(convoSubs, conversationId, raw);
  };
  req.on("close", stop);
  raw.on("close", stop);
  return stop;
}
