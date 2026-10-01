import { detectModelFamily } from "@wlfv/shared";
import { OllamaClient } from "./client.ts";
import { parseShowCapabilities, thinkParam, toPublicCapabilities } from "./capabilities.ts";
import { parseNdjson } from "./ndjson.ts";
import type { ChatStreamEvent, GenerationSettings } from "@wlfv/shared";
import { toOllamaGeneration } from "@wlfv/shared";

export class OllamaProvider {
  constructor(private client: OllamaClient) {}

  listModels() {
    return this.client.tags();
  }

  async getModelInfo(model: string) {
    const show = await this.client.show(model);
    return {
      name: model,
      family: detectModelFamily(model),
      detected: parseShowCapabilities(show),
      public: toPublicCapabilities(parseShowCapabilities(show)),
    };
  }

  async *streamChat(input: {
    model: string;
    messages: { role: string; content: string; images?: string[] }[];
    think?: boolean | string;
    signal?: AbortSignal;
    generation?: GenerationSettings;
  }): AsyncIterable<ChatStreamEvent> {
    const mapped = toOllamaGeneration(input.generation || { show: false, values: {}, custom: [] });
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.images?.length
          ? {
              images: message.images.map((image) => (image.includes(",") ? image.slice(image.indexOf(",") + 1) : image)),
            }
          : {}),
      })),
      stream: mapped.stream,
      ...mapped.body,
    };
    if (Object.keys(mapped.options).length) body.options = mapped.options;
    if (input.think !== undefined && mapped.body.think === undefined) body.think = input.think;
    yield { type: "status", stage: "loading" };
    if (!mapped.stream) {
      const chunk = await this.client.chatJson(body, input.signal);
      yield { type: "status", stage: "prompt" };
      if (chunk.error) {
        yield { type: "error", message: chunk.error };
        return;
      }
      if (chunk.message?.thinking) yield { type: "thinking", delta: chunk.message.thinking };
      if (chunk.message?.content) yield { type: "content", delta: chunk.message.content };
      yield {
        type: "done",
        messageId: "",
        stats: {
          totalDuration: Number(chunk.total_duration ?? 0),
          loadDuration: Number(chunk.load_duration ?? 0),
          promptEvalCount: Number(chunk.prompt_eval_count ?? 0),
          promptEvalDuration: Number(chunk.prompt_eval_duration ?? 0),
          evalCount: Number(chunk.eval_count ?? 0),
          evalDuration: Number(chunk.eval_duration ?? 0),
        },
      };
      return;
    }
    const stream = await this.client.chat(body, input.signal);
    yield { type: "status", stage: "prompt" };
    for await (const chunk of parseNdjson(stream)) {
      if (typeof chunk.error === "string") {
        yield { type: "error", message: chunk.error };
        return;
      }
      const message = chunk.message as { content?: string; thinking?: string } | undefined;
      if (message?.thinking) yield { type: "thinking", delta: message.thinking };
      if (message?.content) yield { type: "content", delta: message.content };
      if (chunk.done) {
        yield {
          type: "done",
          messageId: "",
          stats: {
            totalDuration: Number(chunk.total_duration ?? 0),
            loadDuration: Number(chunk.load_duration ?? 0),
            promptEvalCount: Number(chunk.prompt_eval_count ?? 0),
            promptEvalDuration: Number(chunk.prompt_eval_duration ?? 0),
            evalCount: Number(chunk.eval_count ?? 0),
            evalDuration: Number(chunk.eval_duration ?? 0),
          },
        };
      }
    }
  }
}

export { thinkParam };
