import type { ConnectionsConfig, ProviderConnection } from "@wlfv/shared";
import { OllamaClient } from "./services/ollama/client.ts";
import { OllamaProvider } from "./services/ollama/index.ts";
import { OpenAICompatClient } from "./services/openai/client.ts";
import { connectionHeaders, findConnection } from "./connections.ts";
import type { ChatStreamEvent, GenerationSettings } from "@wlfv/shared";

export type ProviderMessage = {
  role: string;
  content: string;
  images?: string[];
};

export function clientForOllama(conn: ProviderConnection) {
  return new OllamaClient(conn.url, connectionHeaders(conn));
}

export function clientForOpenAI(conn: ProviderConnection) {
  return new OpenAICompatClient(conn.url, connectionHeaders(conn), conn.apiType);
}

export function firstOllamaClient(config: ConnectionsConfig) {
  const conn = config.ollama.find((item) => item.enabled && item.url) ?? config.ollama[0];
  if (!conn?.url) return null;
  return clientForOllama(conn);
}

export async function *streamForConnection(
  conn: ProviderConnection,
  input: {
    model: string;
    messages: ProviderMessage[];
    think?: boolean | string;
    signal?: AbortSignal;
    generation?: GenerationSettings;
  },
): AsyncIterable<ChatStreamEvent> {
  if (conn.kind === "openai") {
    yield* clientForOpenAI(conn).streamChat({
      model: input.model,
      messages: input.messages,
      signal: input.signal,
      think: input.think,
    });
    return;
  }
  yield* new OllamaProvider(clientForOllama(conn)).streamChat(input);
}

export async function completeForConnection(
  conn: ProviderConnection,
  input: {
    model: string;
    messages: ProviderMessage[];
    signal?: AbortSignal;
    generation?: GenerationSettings;
  },
) {
  let text = "";
  for await (const event of streamForConnection(conn, input)) {
    if (event.type === "content") text += event.delta;
  }
  return text;
}
