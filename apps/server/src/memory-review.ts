import type { ProviderConnection } from "@wlfv/shared";
import { completeForConnection } from "./runtime.ts";
import { saveUserMemories, updateMemory, deleteMemory } from "./memory.ts";
import {
  fallbackMemoryDrafts,
  isDurableMemory,
  memoriesOverlap,
  parseMemoryOperations,
  shouldReviewMemory,
  rejectedMemoryClaim,
  summarizeMemoryFact,
} from "./memory-ops.ts";
import { eq } from "drizzle-orm";
import { memories } from "./db/schema.ts";
import type { DB } from "./db/index.ts";

function groundedInUser(content: string, userText: string) {
  const userTokens = new Set(
    (userText.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((token) => token !== "the" && token !== "user"),
  );
  if (!userTokens.size) return true;
  return (content.toLowerCase().match(/[a-z0-9]{3,}/g) || []).some((token) => userTokens.has(token));
}

function applyOps(
  db: DB,
  userId: string,
  conversationId: string,
  ops: ReturnType<typeof parseMemoryOperations>,
  userText: string,
) {
  const saved: { id: string; content: string; category: string; path: string; memoryType: string }[] = [];
  for (const op of ops) {
    if (op.action === "remove" && op.id) {
      if (deleteMemory(db, userId, op.id)) {
        saved.push({ id: op.id, content: "Removed.", category: "", path: "", memoryType: "" });
      }
      continue;
    }
    if (op.action === "move" && op.id) {
      const updated = updateMemory(db, userId, op.id, { path: op.path || "" });
      if (updated) saved.push(updated);
      continue;
    }
    if (op.action === "replace" && op.id && op.content) {
      const current = db.select().from(memories).where(eq(memories.id, op.id)).get();
      const content = summarizeMemoryFact(op.content);
      if (rejectedMemoryClaim(content, userText)) continue;
      if (!current || current.userId !== userId || !memoriesOverlap(current.content, content)) {
        if (!isDurableMemory(op.content) && !isDurableMemory(content)) continue;
        saved.push(
          ...saveUserMemories(
            db,
            userId,
            [
              {
                content,
                category: op.category || "other",
                path: op.path,
                memoryType: op.memoryType,
              },
            ],
            conversationId,
          ),
        );
        continue;
      }
      const updated = updateMemory(db, userId, op.id, {
        content,
        category: op.category,
        path: op.path,
        memoryType: op.memoryType,
      });
      if (updated) saved.push(updated);
      continue;
    }
    if (op.action === "add" && op.content) {
      const content = summarizeMemoryFact(op.content);
      if (!isDurableMemory(op.content) && !isDurableMemory(content)) continue;
      if (!groundedInUser(content, userText) || rejectedMemoryClaim(content, userText)) continue;
      saved.push(
        ...saveUserMemories(
          db,
          userId,
          [
            {
              content: content,
              category: op.category || "other",
              path: op.path,
              memoryType: op.memoryType,
            },
          ],
          conversationId,
        ),
      );
    }
  }
  return saved;
}

export async function reviewAndSaveMemories(input: {
  db: DB;
  userId: string;
  conversationId: string;
  conn: ProviderConnection;
  model: string;
  existing: { id: string; content: string; category: string; path?: string; memoryType?: string }[];
  transcript: string;
  currentUser?: string;
  previousUser?: string;
  signal?: AbortSignal;
}) {
  const currentUser = (input.currentUser || "").trim();
  if (!currentUser && !input.transcript.trim()) return [];
  const fallback = fallbackMemoryDrafts(currentUser || input.transcript, input.previousUser);
  const asked = currentUser || input.transcript;
  if (!fallback.length && !shouldReviewMemory(asked)) return [];
  let raw = "";
  if (input.conn.url && input.model) {
    const existingText = input.existing.length
      ? input.existing
          .map(
            (item) =>
              `- id=${item.id} type=${item.memoryType || "user"} path=${item.path || ""} content=${item.content}`,
          )
          .join("\n")
      : "(none)";
    try {
      raw = await completeForConnection(input.conn, {
        model: input.model,
        generation:
          input.conn.kind === "openai"
            ? undefined
            : { show: false, values: { format: "json" }, custom: [] },
        messages: [
          {
            role: "system",
            content: "You are a private memory reviewer. Return only valid JSON. No markdown.",
          },
          {
            role: "user",
            content: `Save durable facts the user states about themselves. Return JSON only. No explanation.

Save: identity, hobbies, interests, skills, work, projects, hardware, software, preferences, location, long-term goals.
Do not save questions, greetings, guesses, one-off plans, or things the user did not claim as their own.
"My hobbies are programming and design." saves. "What hobbies should I try?" does not.
"I like gaming." saves. "Do you think gaming is fun?" does not.
Keep Name, Age, and Birthday together on path Identity.
Write content in English, third person. Use the user's own facts, not this example.

{"operations":[{"action":"add","category":"preference","path":"Interests","memoryType":"user","content":"The user's hobbies and interests include design, programming, and IT."}]}

Categories: identity, preference, hardware, software, work, project, location, other.
Paths: Identity, Communication, Interests, Hardware, Software, Work, Projects, Location, Other.
If nothing should be saved: {"operations":[]}

Existing:
${existingText}

User:
${asked.slice(0, 2000)}`,
          },
        ],
        signal: input.signal,
      });
    } catch {
      raw = "";
    }
  }

  const fromModel = applyOps(input.db, input.userId, input.conversationId, parseMemoryOperations(raw), asked);
  if (fromModel.length) return fromModel;
  return applyOps(
    input.db,
    input.userId,
    input.conversationId,
    fallback.map((item) => ({
      action: "add" as const,
      content: item.content,
      category: item.category,
      path: item.path,
      memoryType: item.memoryType,
    })),
    asked,
  );
}
