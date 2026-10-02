import { OllamaError } from "./errors.ts";

function mapStatus(status: number, body: string): OllamaError {
  const lower = body.toLowerCase();
  const safe = body.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
  if (status === 404 || lower.includes("not found")) {
    return new OllamaError("MODEL_NOT_FOUND", safe || "Model not found");
  }
  if (status === 400) return new OllamaError("INVALID_REQUEST", safe || "Invalid request");
  return new OllamaError("UNKNOWN", safe || `HTTP ${status}`);
}

export class OllamaClient {
  constructor(
    private baseUrl: string,
    private extraHeaders: Record<string, string> = {},
  ) {}

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private headers(init?: HeadersInit) {
    return { ...this.extraHeaders, ...(init as Record<string, string> | undefined) };
  }

  async request(path: string, init: RequestInit = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const parent = init.signal;
    if (parent) {
      if (parent.aborted) controller.abort();
      else parent.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(this.url(path), { ...init, headers: this.headers(init.headers), signal: controller.signal });
      return res;
    } catch (error) {
      if (controller.signal.aborted && parent?.aborted) {
        throw new OllamaError("REQUEST_ABORTED", "Request aborted");
      }
      if (controller.signal.aborted) {
        throw new OllamaError("TIMEOUT", "Ollama request timed out");
      }
      throw new OllamaError("OLLAMA_UNAVAILABLE", "The model provider could not be reached.");
    } finally {
      clearTimeout(timer);
    }
  }

  async version() {
    const res = await this.request("/api/version");
    if (!res.ok) throw mapStatus(res.status, await res.text());
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  }

  async tags() {
    const res = await this.request("/api/tags", {}, 20000);
    if (!res.ok) throw mapStatus(res.status, await res.text());
    const data = (await res.json()) as {
      models?: { name?: string; model?: string; details?: { family?: string; families?: string[] } }[];
    };
    return (data.models ?? [])
      .map((m) => m.name || m.model || "")
      .filter(Boolean);
  }

  async ps() {
    const res = await this.request("/api/ps", {}, 8000);
    if (!res.ok) throw mapStatus(res.status, await res.text());
    const data = (await res.json()) as { models?: { name?: string; model?: string; context_length?: number }[] };
    return (data.models ?? [])
      .map((item) => {
        const length = Number(item.context_length);
        return {
          name: item.model || item.name || "",
          contextLength: Number.isFinite(length) && length > 0 ? Math.round(length) : undefined,
        };
      })
      .filter((item) => item.name);
  }

  async unload(name: string) {
    const res = await this.request(
      "/api/generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, prompt: "", keep_alive: 0, stream: false }),
      },
      60000,
    );
    if (!res.ok) throw mapStatus(res.status, await res.text());
    await res.text();
  }

  async show(name: string) {
    const res = await this.request(
      "/api/show",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
      30000,
    );
    if (!res.ok) throw mapStatus(res.status, await res.text());
    return (await res.json()) as {
      capabilities?: string[];
      thinking?: { values?: unknown[]; default?: unknown };
      details?: { family?: string; families?: string[]; parameter_size?: string };
      parameters?: string;
      model_info?: Record<string, unknown>;
    };
  }

  async chatJson(body: Record<string, unknown>, signal?: AbortSignal) {
    const res = await this.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, stream: false }),
        signal,
      },
      10 * 60 * 1000,
    );
    if (!res.ok) throw mapStatus(res.status, await res.text());
    return (await res.json()) as {
      error?: string;
      message?: { content?: string; thinking?: string };
      total_duration?: number;
      load_duration?: number;
      prompt_eval_count?: number;
      prompt_eval_duration?: number;
      eval_count?: number;
      eval_duration?: number;
    };
  }

  async chat(body: Record<string, unknown>, signal?: AbortSignal) {
    const res = await this.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
      10 * 60 * 1000,
    );
    if (!res.ok) throw mapStatus(res.status, await res.text());
    if (!res.body) throw new OllamaError("UNKNOWN", "Empty response");
    return res.body;
  }
}
