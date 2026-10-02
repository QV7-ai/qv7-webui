import { parseUsedMemories, type UsedMemory } from "@wlfv/shared";

export type { UsedMemory };

export function attachMemoryUsed<T extends { id: string; content: string; memoriesUsed?: UsedMemory[] }>(
  messages: T[],
  assistantId: string | undefined,
  payload: unknown,
): T[] {
  if (!assistantId) return messages;
  const memories = parseUsedMemories(payload);
  if (!memories.length) return messages;
  return messages.map((message) => (message.id === assistantId ? { ...message, memoriesUsed: memories } : message));
}
