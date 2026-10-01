export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content === "number") return String(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const row = part as { text?: unknown; content?: unknown; output_text?: unknown };
        if (typeof row.text === "string") return row.text;
        if (typeof row.content === "string") return row.content;
        if (typeof row.output_text === "string") return row.output_text;
      }
      return "";
    })
    .join("");
}

function reasoningText(value: unknown): string {
  const plain = textFromContent(value);
  if (plain) return plain;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as { summary?: unknown; text?: unknown; content?: unknown };
  return textFromContent(row.summary) || textFromContent(row.text) || textFromContent(row.content);
}

function textFromReasoningDetails(details: unknown): string {
  if (!Array.isArray(details)) return "";
  return details
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const row = part as { text?: unknown; content?: unknown; type?: unknown };
        if (String(row.type || "").includes("encrypted")) return "";
        const text =
          typeof row.text === "string"
            ? row.text
            : typeof row.content === "string"
              ? row.content
              : typeof (row as { summary?: unknown }).summary === "string"
                ? String((row as { summary?: unknown }).summary)
                : "";
        return text === "[REDACTED]" ? "" : text;
      }
      return "";
    })
    .join("");
}

export function errorFromOpenAIChunk(json: Record<string, unknown>) {
  const err = json.error;
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message?: unknown }).message || "Provider error");
  }
  return "Provider error";
}

export function deltaFromOpenAIChunk(json: Record<string, unknown>) {
  const type = String(json.type || "");
  if (type === "response.output_text.delta" || type === "response.text.delta" || type === "response.refusal.delta") {
    return {
      content: typeof json.delta === "string" ? json.delta : textFromContent(json.delta),
      thinking: "",
    };
  }
  if (
    type === "response.reasoning_text.delta" ||
    type === "response.reasoning.delta" ||
    type === "response.reasoning_summary_text.delta"
  ) {
    return {
      content: "",
      thinking: typeof json.delta === "string" ? json.delta : textFromContent(json.delta),
    };
  }
  if (typeof json.output_text === "string" && json.output_text) {
    return { content: json.output_text, thinking: "" };
  }
  if (typeof json.delta === "string") return { content: json.delta, thinking: "" };

  const choices = json.choices as
    | {
        delta?: {
          content?: unknown;
          text?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          reasoning_details?: unknown;
        };
        message?: {
          content?: unknown;
          text?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          reasoning_details?: unknown;
        };
        text?: unknown;
      }[]
    | undefined;
  const choice = choices?.[0];
  const piece = choice?.delta || choice?.message;
  if (piece) {
    return {
      content: textFromContent(piece.content) || textFromContent(piece.text),
      thinking:
        reasoningText(piece.reasoning_content) ||
        reasoningText(piece.reasoning) ||
        textFromReasoningDetails(piece.reasoning_details),
    };
  }
  if (choice?.text) return { content: textFromContent(choice.text), thinking: "" };
  const delta = json.delta as { text?: unknown; content?: unknown } | undefined;
  if (delta?.text || delta?.content) return { content: textFromContent(delta.text) || textFromContent(delta.content), thinking: "" };
  return { content: "", thinking: "" };
}

export function completionTextFromJson(json: Record<string, unknown>) {
  const failed = errorFromOpenAIChunk(json);
  if (failed) return { error: failed, content: "", thinking: "" };
  const delta = deltaFromOpenAIChunk(json);
  if (delta.content || delta.thinking) return { error: "", ...delta };
  const output = json.output as { content?: unknown }[] | undefined;
  const nested = output?.map((item) => textFromContent(item.content)).join("") || "";
  return { error: "", content: nested || textFromContent(json.content), thinking: "" };
}

export function parseOpenAISseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  return JSON.parse(payload) as Record<string, unknown>;
}
