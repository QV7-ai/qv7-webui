import { Copy, FileText, PanelsTopLeft, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ChatActivity, UsageStats, WebSearchSource } from "@wlfv/shared";
import { parseCanvases, stripCanvas, stripToolMarkup, type CanvasDoc } from "@wlfv/shared";
import { Markdown } from "./Markdown";
import { ActivityTrace } from "./ActivityTrace";
import { UsageLine } from "./UsageLine";
import { ModelWait, type WaitStage } from "./ModelWait";
import { ModelIcon } from "@/components/models/ModelIcon";
import { useLang, useT } from "@/lib/language";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string | null;
  streaming?: boolean;
  wait?: WaitStage;
  usage?: UsageStats;
  sources?: WebSearchSource[];
  activities?: ChatActivity[];
  images?: { url: string; name: string }[];
  canvas?: boolean;
  rating?: number;
  createdAt?: number;
};

function messageStamp(ts: number | undefined, lang: "en" | "nl", today: string, yesterday: string) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const locale = lang === "nl" ? "nl-NL" : "en-GB";
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  const dayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const diff = Math.round((dayNumber(new Date()) - dayNumber(date)) / 86400000);
  const now = new Date();
  const day =
    diff === 0
      ? today
      : diff === 1
        ? yesterday
        : diff > 1 && diff < 7
          ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date)
          : new Intl.DateTimeFormat(locale, {
              day: "numeric",
              month: "short",
              year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
            }).format(date);
  return `${day} ${time}`;
}

export function splitDocuments(content: string) {
  const docs: { url: string; name: string }[] = [];
  const text = String(content || "").replace(/\[\[doc:(\/api\/uploads\/[a-zA-Z0-9.-]+)\|([^\]]+)\]\]/g, (_full, url: string, name: string) => {
    docs.push({ url, name });
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), docs };
}

export function splitUserContent(content: string) {
  const images: { url: string; name: string }[] = [];
  const text = String(content || "")
    .replace(/!\[([^\]]*)\]\((\/api\/uploads\/[^)]+)\)/g, (_full, name: string, url: string) => {
      images.push({ name: name || "Image", url });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

export function MessageList({
  messages,
  assistantName,
  assistantIcon,
  showUsage,
  onCopy,
  onRegenerate,
  onOpenCanvas,
  onRate,
}: {
  messages: UiMessage[];
  assistantName: string;
  assistantIcon?: string;
  showUsage?: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onOpenCanvas?: (doc: CanvasDoc) => void;
  onRate?: (id: string, rating: number) => void;
}) {
  const tr = useT();
  const { lang } = useLang();
  return (
    <div className="min-w-0 space-y-8 py-6 sm:py-8">
      {messages
        .filter((m) => m.role !== "system")
        .map((m) => {
          const stamp = messageStamp(m.createdAt, lang, tr("today"), tr("yesterday"));
          return m.role === "user" ? (
            <div key={m.id} className="motion-rise flex justify-end">
              <div className="max-w-[min(85%,36rem)]">
              <div className="rounded-2xl bg-[var(--user)] px-4 py-2.5 text-[15px] leading-6">
                {m.images?.length ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {m.images.map((image) => (
                      <img key={image.url} src={image.url} alt={image.name} className="max-h-48 max-w-full rounded-xl object-cover" />
                    ))}
                  </div>
                ) : null}
                {m.content ? <div className="whitespace-pre-wrap">{m.content}</div> : null}
              </div>
              {stamp ? <time className="mt-1 block px-1 text-right text-[11px] text-[var(--muted)]" dateTime={new Date(m.createdAt || 0).toISOString()}>{stamp}</time> : null}
              </div>
            </div>
          ) : (
            <div key={m.id} className="motion-rise min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--muted)]">
                <ModelIcon name={assistantName} iconUrl={assistantIcon} size={18} />
                {assistantName}
                {stamp ? <time className="text-[11px]" dateTime={new Date(m.createdAt || 0).toISOString()}>{stamp}</time> : null}
              </div>
              <ActivityTrace
                activities={m.activities}
                sources={m.sources}
                thinking={m.thinking || ""}
                streaming={Boolean(m.streaming)}
                wait={m.wait}
              />
              {(() => {
                const showCanvas = m.canvas !== false;
                const canvases = showCanvas ? parseCanvases(m.content) : [];
                const visibleSource = stripToolMarkup(showCanvas ? stripCanvas(m.content) : m.content);
                const files = splitDocuments(visibleSource);
                const visible = files.text;
                const traced = Boolean(m.thinking || m.activities?.length || m.sources?.length);
                const waiting = Boolean(m.streaming && !visible && !traced);
                return (
                  <>
                    {waiting ? <ModelWait stage={m.wait || "loading"} /> : null}
                    {canvases.map((doc) => (
                      <button
                        key={doc.title + doc.html.length}
                        type="button"
                        className="mb-3 flex w-full max-w-md items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-left hover:bg-[var(--hover)]"
                        onClick={() => onOpenCanvas?.(doc)}
                      >
                        <PanelsTopLeft size={18} className="shrink-0 text-[var(--accent)]" />
                        <span className="min-w-0">
                          <span className="block text-[12px] text-[var(--muted)]">{tr("canvas")}</span>
                          <span className="block truncate text-[14px] font-medium">{doc.title}</span>
                        </span>
                      </button>
                    ))}
                    {files.docs.map((doc) => (
                      <a
                        key={doc.url}
                        href={doc.url}
                        download={doc.name}
                        className="mb-3 flex w-full max-w-md items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-left hover:bg-[var(--hover)]"
                      >
                        <FileText size={18} className="shrink-0 text-[var(--accent)]" />
                        <span className="min-w-0">
                          <span className="block text-[12px] text-[var(--muted)]">{tr("document")}</span>
                          <span className="block truncate text-[14px] font-medium">{doc.name}</span>
                        </span>
                      </a>
                    ))}
                    {visible ? <Markdown text={visible} /> : null}
                    {!visible && m.streaming && m.thinking && !waiting ? (
                      <span className="inline-block h-4 w-[2px] animate-pulse bg-[var(--accent)]" />
                    ) : null}
                  </>
                );
              })()}
              {showUsage && !m.streaming && m.usage ? <UsageLine usage={m.usage} /> : null}
              {!m.streaming && m.content ? (
                <div className="mt-2 flex gap-1 text-[var(--muted)]">
                  <button type="button" className="rounded-md p-1.5 hover:bg-[var(--hover)]" onClick={() => onCopy(m.content)} aria-label={tr("copy")}>
                    <Copy size={14} />
                  </button>
                  <button type="button" className="rounded-md p-1.5 hover:bg-[var(--hover)]" onClick={onRegenerate} aria-label={tr("regenerate")}>
                    <RefreshCw size={14} />
                  </button>
                  {onRate && !m.id.startsWith("a-") ? (
                    <>
                      <button
                        type="button"
                        className={`rounded-md p-1.5 hover:bg-[var(--hover)] ${m.rating === 1 ? "text-[var(--accent)]" : ""}`}
                        aria-pressed={m.rating === 1}
                        aria-label={tr("like")}
                        onClick={() => onRate(m.id, m.rating === 1 ? 0 : 1)}
                      >
                        <ThumbsUp size={14} fill={m.rating === 1 ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className={`rounded-md p-1.5 hover:bg-[var(--hover)] ${m.rating === -1 ? "text-[var(--accent)]" : ""}`}
                        aria-pressed={m.rating === -1}
                        aria-label={tr("dislike")}
                        onClick={() => onRate(m.id, m.rating === -1 ? 0 : -1)}
                      >
                        <ThumbsDown size={14} fill={m.rating === -1 ? "currentColor" : "none"} />
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="rounded-md p-1.5 hover:bg-[var(--hover)]" aria-label={tr("edit")}>
                    <Pencil size={14} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
