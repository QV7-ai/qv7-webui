import { OllamaError } from "../ollama/errors.ts";
import type { ChatStreamEvent } from "@wlfv/shared";
import { openaiBaseUrl, requestModelId } from "./ids.ts";
import { completionTextFromJson, deltaFromOpenAIChunk, errorFromOpenAIChunk, parseOpenAISseLine } from "./stream.ts";

export class OpenAICompatClient {
  constructor(
    private baseUrl: string,
    private extraHeaders: Record<string, string> = {},
    private apiType: "chat" | "responses" = "chat",
  ) {
    this.baseUrl = openaiBaseUrl(baseUrl);
    if (this.baseUrl.includes("openrouter.ai")) {
      this.extraHeaders = {
        "HTTP-Referer": "http://localhost",
        "X-Title": "QV7",
        ...extraHeaders,
      };
    }
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private headers() {
    return { "Content-Type": "application/json", ...this.extraHeaders };
  }

  async request(path: string, init: RequestInit = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const parent = init.signal;
    if (parent) {
      if (parent.aborted) controller.abort();
      else parent.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await fetch(this.url(path), { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && parent?.aborted) throw new OllamaError("REQUEST_ABORTED", "Request aborted");
      if (controller.signal.aborted) throw new OllamaError("TIMEOUT", "Request timed out");
      throw new OllamaError("OLLAMA_UNAVAILABLE", error instanceof Error ? error.message : "Unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwIfNotOk(res: Response) {
    if (res.ok) return;
    const raw = await res.text();
    let message = raw.slice(0, 400) || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const failed = errorFromOpenAIChunk(parsed);
      message = failed || String(parsed.message || message);
    } catch {
      /* keep raw */
    }
    throw new OllamaError("UNKNOWN", message);
  }

  async listModels() {
    const res = await this.request("/models", {}, 20000);
    await this.throwIfNotOk(res);
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? []).map((item) => item.id || "").filter(Boolean);
  }

  async ping() {
    await this.listModels();
    return true;
  }

  async *streamChat(input: {
    model: string;
    messages: { role: string; content: string; images?: string[] }[];
    signal?: AbortSignal;
    think?: boolean | string;
  }): AsyncIterable<ChatStreamEvent> {
    yield { type: "status", stage: "loading" };
    const model = requestModelId(input.model);
    const messages = input.messages.map((message) => {
      if (!message.images?.length) return { role: message.role, content: message.content };
      const mime = "image/jpeg";
      return {
        role: message.role,
        content: [
          { type: "text", text: message.content || "Describe this image." },
          ...message.images.map((image) => ({
            type: "image_url",
            image_url: { url: image.startsWith("data:") ? image : `data:${mime};base64,${image}` },
          })),
        ],
      };
    });
    const path = this.apiType === "responses" ? "/responses" : "/chat/completions";
    const wantReasoning = Boolean(input.think);
    const payload: Record<string, unknown> =
      this.apiType === "responses"
        ? { model, input: messages, stream: true }
        : { model, messages, stream: true };
    if (this.baseUrl.includes("openrouter.ai")) {
      payload.reasoning = wantReasoning
        ? { enabled: true, exclude: false, effort: input.think === "high" || input.think === "low" ? input.think : "medium" }
        : { exclude: true };
    }
    const start = async (body: Record<string, unknown>) =>
      this.request(path, { method: "POST", body: JSON.stringify(body), signal: input.signal }, 10 * 60 * 1000);
    let res = await start(payload);
    if (!res.ok && payload.reasoning) {
      const { reasoning: _ignored, ...withoutReasoning } = payload;
      res = await start(withoutReasoning);
    }
    await this.throwIfNotOk(res);
    if (!res.body) throw new OllamaError("UNKNOWN", "Empty response");
    yield { type: "status", stage: "prompt" };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let sawSse = false;
    let text = "";
    let thinking = "";
    let failed = "";

    const takeChunk = (json: Record<string, unknown>): ChatStreamEvent[] => {
      const events: ChatStreamEvent[] = [];
      const err = errorFromOpenAIChunk(json);
      if (err) {
        failed = err;
        events.push({ type: "error", message: err });
        return events;
      }
      const delta = deltaFromOpenAIChunk(json);
      if (delta.thinking) {
        thinking += delta.thinking;
        if (wantReasoning) events.push({ type: "thinking", delta: delta.thinking });
      }
      if (delta.content) {
        text += delta.content;
        events.push({ type: "content", delta: delta.content });
      }
      const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage) {
        promptTokens = Number(usage.prompt_tokens || 0);
        completionTokens = Number(usage.completion_tokens || 0);
      }
      return events;
    };

    const takeLine = (line: string): ChatStreamEvent[] => {
      try {
        const json = parseOpenAISseLine(line);
        if (!json) return [];
        sawSse = true;
        return takeChunk(json);
      } catch {
        return [];
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const raw of lines) {
        const events = takeLine(raw);
        for (const event of events) {
          yield event;
          if (event.type === "error") return;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      if (buffer.includes("data:")) {
        for (const raw of buffer.split("\n")) {
          const events = takeLine(raw);
          for (const event of events) {
            yield event;
            if (event.type === "error") return;
          }
        }
      } else if (!sawSse) {
        try {
          const parsed = completionTextFromJson(JSON.parse(buffer) as Record<string, unknown>);
          if (parsed.error) {
            yield { type: "error", message: parsed.error };
            return;
          }
          if (parsed.thinking) {
            thinking += parsed.thinking;
            yield { type: "thinking", delta: parsed.thinking };
          }
          if (parsed.content) {
            text += parsed.content;
            yield { type: "content", delta: parsed.content };
          }
        } catch {
          /* not a JSON body */
        }
      }
    }

    if (!failed && !text.trim() && !input.signal?.aborted) {
      const fallback = await this.request(
        path,
        { method: "POST", body: JSON.stringify({ ...payload, stream: false }), signal: input.signal },
        10 * 60 * 1000,
      );
      await this.throwIfNotOk(fallback);
      const json = (await fallback.json()) as Record<string, unknown>;
      const parsed = completionTextFromJson(json);
      if (parsed.error) {
        yield { type: "error", message: parsed.error };
        return;
      }
      if (parsed.thinking && !thinking && wantReasoning) yield { type: "thinking", delta: parsed.thinking };
      if (parsed.content) yield { type: "content", delta: parsed.content };
      const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage) {
        promptTokens = Number(usage.prompt_tokens || 0);
        completionTokens = Number(usage.completion_tokens || 0);
      }
    }

    yield {
      type: "done",
      messageId: "",
      stats: {
        promptEvalCount: promptTokens,
        evalCount: completionTokens,
        totalDuration: 0,
        loadDuration: 0,
        promptEvalDuration: 0,
        evalDuration: 0,
      },
    };
  }
}
