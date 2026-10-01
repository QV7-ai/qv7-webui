import { saveChatImage } from "../uploads.ts";
import type { ImageEndpointConfig } from "@wlfv/shared";

export type SourceImage = { buf: Buffer; mime: string; name: string };

function parseSize(size: string) {
  const match = String(size || "").match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  const width = match ? Number(match[1]) : 512;
  const height = match ? Number(match[2]) : 512;
  return {
    width: Math.min(2048, Math.max(64, width)),
    height: Math.min(2048, Math.max(64, height)),
  };
}

function aspectFromSize(size: string) {
  const { width, height } = parseSize(size);
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(ratio - 4 / 3) < 0.08) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.08) return "3:4";
  return "1:1";
}

function extraJson(settings: ImageEndpointConfig) {
  try {
    const parsed = JSON.parse(settings.extraParams || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function joinUrl(base: string, path: string) {
  const root = base.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

function withApiVersion(url: string, version: string) {
  if (!version) return url;
  const parsed = new URL(url);
  if (!parsed.searchParams.has("api-version")) parsed.searchParams.set("api-version", version);
  return parsed.toString();
}

function openaiHeaders(settings: ImageEndpointConfig) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  return headers;
}

function basicAuth(settings: ImageEndpointConfig) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.apiAuth.trim()) {
    headers.Authorization = `Basic ${Buffer.from(settings.apiAuth.trim()).toString("base64")}`;
  }
  return headers;
}

function mimeFromBuffer(buf: Buffer) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/png";
}

function downloadHeaders(url: string, authHeaders: Record<string, string>) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const storage = host.startsWith("storage.") || host.includes("blob.") || host.includes("cdn.");
  if (storage || host.endsWith("imagerouter.io")) return { Accept: "image/*,*/*" };
  return { ...authHeaders, Accept: "image/*,*/*" };
}

async function fetchBuffer(url: string, headers: Record<string, string>, signal?: AbortSignal) {
  const attempts = [{ Accept: "image/*,*/*" }, downloadHeaders(url, headers)];
  let lastStatus = 0;
  for (const attempt of attempts) {
    const res = await fetch(url, { headers: attempt, signal, redirect: "follow" });
    lastStatus = res.status;
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`Could not download the generated image (${res.status}).`);
    }
  }
  throw new Error(`Could not download the generated image (${lastStatus}).`);
}

function b64(value: string) {
  return Buffer.from(value.replace(/^data:[^;]+;base64,/, ""), "base64");
}

function firstImageBuffer(json: unknown): Buffer | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  const data = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.images) ? rec.images : null;
  if (data?.length) {
    const item = data[0];
    if (typeof item === "string") {
      if (item.startsWith("http")) return null;
      return b64(item);
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      if (typeof row.b64_json === "string") return b64(row.b64_json);
      if (typeof row.base64 === "string") return b64(row.base64);
    }
  }
  const predictions = Array.isArray(rec.predictions) ? rec.predictions : [];
  for (const pred of predictions) {
    if (!pred || typeof pred !== "object") continue;
    const row = pred as Record<string, unknown>;
    if (typeof row.bytesBase64Encoded === "string") return b64(row.bytesBase64Encoded);
  }
  const candidates = Array.isArray(rec.candidates) ? rec.candidates : [];
  for (const cand of candidates) {
    const parts = ((cand as { content?: { parts?: unknown[] } })?.content?.parts || []) as Record<string, unknown>[];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline && typeof inline === "object" && typeof (inline as { data?: string }).data === "string") {
        return b64((inline as { data: string }).data);
      }
    }
  }
  return null;
}

function asHttpUrl(value: unknown): string | null {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function firstImageUrl(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  const data = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.images) ? rec.images : [];
  for (const item of data) {
    const direct = asHttpUrl(item);
    if (direct) return direct;
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const nested = row.image_url && typeof row.image_url === "object" ? (row.image_url as { url?: string }).url : undefined;
      const url = asHttpUrl(row.url) || asHttpUrl(nested);
      if (url) return url;
    }
  }
  return asHttpUrl(rec.url);
}

async function readJsonError(res: Response) {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; detail?: string; message?: string };
    if (typeof json.error === "string") return json.error;
    if (json.error && typeof json.error === "object" && json.error.message) return json.error.message;
    if (json.detail) return json.detail;
    if (json.message) return json.message;
  } catch {
    /* raw */
  }
  return text.slice(0, 400) || `Image API error (${res.status}).`;
}

async function openaiGenerate(settings: ImageEndpointConfig, prompt: string, signal?: AbortSignal) {
  const extra = extraJson(settings);
  const url = withApiVersion(joinUrl(settings.apiBaseUrl, "/images/generations"), settings.apiVersion);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...openaiHeaders(settings), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model || undefined,
      prompt,
      size: settings.size || "512x512",
      n: 1,
      response_format: "b64_json",
      ...extra,
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readJsonError(res));
  return res.json();
}

async function openaiEdit(settings: ImageEndpointConfig, prompt: string, image: SourceImage, signal?: AbortSignal) {
  const extra = extraJson(settings);
  const url = withApiVersion(joinUrl(settings.apiBaseUrl, "/images/edits"), settings.apiVersion);
  const form = new FormData();
  form.set("prompt", prompt);
  if (settings.model) form.set("model", settings.model);
  if (settings.size) form.set("size", settings.size);
  form.set("n", "1");
  form.set("response_format", "b64_json");
  form.set("image", new Blob([new Uint8Array(image.buf)], { type: image.mime }), image.name || "image.png");
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const res = await fetch(url, { method: "POST", headers: openaiHeaders(settings), body: form, signal });
  if (!res.ok) throw new Error(await readJsonError(res));
  return res.json();
}

async function automatic1111Generate(settings: ImageEndpointConfig, prompt: string, signal?: AbortSignal) {
  const extra = extraJson(settings);
  const { width, height } = parseSize(settings.size);
  const url = joinUrl(settings.apiBaseUrl, "/sdapi/v1/txt2img");
  const res = await fetch(url, {
    method: "POST",
    headers: basicAuth(settings),
    body: JSON.stringify({
      prompt,
      steps: settings.steps,
      width,
      height,
      ...(settings.model ? { override_settings: { sd_model_checkpoint: settings.model } } : {}),
      ...extra,
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readJsonError(res));
  return res.json();
}

function applyTemplate(raw: string, vars: Record<string, string | number>) {
  let out = raw;
  for (const [key, value] of Object.entries(vars)) out = out.split(`%${key}%`).join(String(value));
  return out;
}

async function comfyGenerate(settings: ImageEndpointConfig, prompt: string, signal?: AbortSignal) {
  const { width, height } = parseSize(settings.size);
  const templated = applyTemplate(settings.extraParams || "{}", {
    prompt,
    width,
    height,
    model: settings.model,
    seed: Date.now() % 1_000_000_000,
  });
  let workflow: unknown;
  try {
    workflow = JSON.parse(templated);
  } catch {
    throw new Error("ComfyUI additional parameters must be valid workflow JSON.");
  }
  const payload =
    workflow && typeof workflow === "object" && "prompt" in (workflow as object)
      ? (workflow as Record<string, unknown>)
      : { prompt: workflow };
  const queue = await fetch(joinUrl(settings.apiBaseUrl, "/prompt"), {
    method: "POST",
    headers: { ...openaiHeaders(settings), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!queue.ok) throw new Error(await readJsonError(queue));
  const queued = (await queue.json()) as { prompt_id?: string };
  const id = queued.prompt_id;
  if (!id) throw new Error("ComfyUI did not return a prompt id.");
  for (let i = 0; i < 90; i++) {
    if (signal?.aborted) throw new Error("Image generation was cancelled.");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const hist = await fetch(joinUrl(settings.apiBaseUrl, `/history/${id}`), { headers: openaiHeaders(settings), signal });
    if (!hist.ok) continue;
    const json = (await hist.json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }> }>;
    const entry = json[id];
    if (!entry?.outputs) continue;
    for (const node of Object.values(entry.outputs)) {
      const file = node.images?.[0];
      if (!file?.filename) continue;
      const view = new URL(joinUrl(settings.apiBaseUrl, "/view"));
      view.searchParams.set("filename", file.filename);
      if (file.subfolder) view.searchParams.set("subfolder", file.subfolder);
      if (file.type) view.searchParams.set("type", file.type);
      const img = await fetch(view.toString(), { headers: openaiHeaders(settings), signal });
      if (!img.ok) throw new Error("ComfyUI image download failed.");
      return { _buffer: Buffer.from(await img.arrayBuffer()) };
    }
  }
  throw new Error("ComfyUI timed out waiting for an image.");
}

async function geminiGenerate(settings: ImageEndpointConfig, prompt: string, signal?: AbortSignal) {
  const extra = extraJson(settings);
  const version = settings.apiVersion || "v1beta";
  const model = settings.model || "imagen-4.0-generate-001";
  const url = joinUrl(settings.apiBaseUrl, `/${version}/models/${model}:predict`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.apiKey,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: aspectFromSize(settings.size), ...extra },
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readJsonError(res));
  return res.json();
}

async function geminiEdit(settings: ImageEndpointConfig, prompt: string, image: SourceImage, signal?: AbortSignal) {
  const extra = extraJson(settings);
  const version = settings.apiVersion || "v1beta";
  const model = settings.model || "gemini-2.0-flash-preview-image-generation";
  const url = joinUrl(settings.apiBaseUrl, `/${version}/models/${model}:generateContent`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: image.mime, data: image.buf.toString("base64") } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...extra },
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readJsonError(res));
  return res.json();
}

async function payloadToBuffer(payload: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  if (payload && typeof payload === "object" && "_buffer" in payload) {
    return (payload as { _buffer: Buffer })._buffer;
  }
  const buf = firstImageBuffer(payload);
  if (buf) return buf;
  const url = firstImageUrl(payload);
  if (url) return fetchBuffer(url, headers, signal);
  throw new Error("The image API did not return an image.");
}

export async function generateImageFile(
  uploadsDir: string,
  settings: ImageEndpointConfig,
  prompt: string,
  signal?: AbortSignal,
) {
  let payload: unknown;
  if (settings.engine === "automatic1111") payload = await automatic1111Generate(settings, prompt, signal);
  else if (settings.engine === "comfyui") payload = await comfyGenerate(settings, prompt, signal);
  else if (settings.engine === "gemini") payload = await geminiGenerate(settings, prompt, signal);
  else payload = await openaiGenerate(settings, prompt, signal);
  const buf = await payloadToBuffer(payload, openaiHeaders(settings), signal);
  return saveChatImage(uploadsDir, mimeFromBuffer(buf), buf);
}

export async function editImageFile(
  uploadsDir: string,
  settings: ImageEndpointConfig,
  prompt: string,
  image: SourceImage,
  signal?: AbortSignal,
) {
  if (settings.engine === "automatic1111") throw new Error("Automatic1111 is not available for image edits.");
  let payload: unknown;
  if (settings.engine === "comfyui") payload = await comfyGenerate(settings, prompt, signal);
  else if (settings.engine === "gemini") payload = await geminiEdit(settings, prompt, image, signal);
  else payload = await openaiEdit(settings, prompt, image, signal);
  const buf = await payloadToBuffer(payload, openaiHeaders(settings), signal);
  return saveChatImage(uploadsDir, mimeFromBuffer(buf), buf);
}
