import type { ProviderConnection } from "@wlfv/shared";
import { completeForConnection } from "./runtime.ts";
import { saveUserMemories, updateMemory } from "./memory.ts";
import {
  fallbackMemoryDrafts,
  isDurableMemory,
  memoriesOverlap,
  parseMemoryOperations,
  summarizeMemoryFact,
} from "./memory-ops.ts";
import { eq } from "drizzle-orm";
import { memories } from "./db/schema.ts";
import type { DB } from "./db/index.ts";

function applyOps(
  db: DB,
  userId: string,
  conversationId: string,
  ops: ReturnType<typeof parseMemoryOperations>,
) {
  const saved: { id: string; content: string; category: string; path: string; memoryType: string }[] = [];
  for (const op of ops) {
    if (op.action === "remove" || op.action === "move") continue;
    if (op.action === "replace" && op.id && op.content) {
      const current = db.select().from(memories).where(eq(memories.id, op.id)).get();
      const content = summarizeMemoryFact(op.content);
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
  if (!fallback.length && !isDurableMemory(currentUser)) return [];
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
            content: `Write a short third-person summary of each new durable fact. Do not copy the user's message.
Use action "replace" with an existing id ONLY when that memory is the same data being updated (same city, same job, same GPU, same name). Otherwise use "add". Never replace an unrelated memory.

Save only durable facts: type "user" (who they are, job, hardware), "preference" (how to talk, likes), or "context" (other lasting project/setup notes).
Do not save greetings, questions (including who am I / wie ben ik), plans to talk, acknowledgements, or mood-only remarks. Never delete or remove a memory. If they said "save this", save the previous fact, not the command.
Keep Geslacht, Leeftijd and Geboortedatum in one memory with path Identiteit only when the user stated those profile fields. Geboortedatum must be a real date of birth such as "1 januari". Never start an unrelated fact with "Geboortedatum:". Do not create a separate memory per field.
{"operations":[{"action":"add","type":"user","path":"Locatie","content":"De gebruiker woont in Utrecht"}]}
Empty operations if nothing should change.

Existing memories:
${existingText}

Conversation:
${input.transcript.slice(0, 4000)}`,
          },
        ],
        signal: input.signal,
      });
    } catch {
      raw = "";
    }
  }

  const fromModel = applyOps(input.db, input.userId, input.conversationId, parseMemoryOperations(raw));
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
  );
}
