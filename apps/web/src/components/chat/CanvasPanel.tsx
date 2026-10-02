import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Code2, Copy, Download, Eye, Share2, X } from "lucide-react";
import type { CanvasDoc } from "@wlfv/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/language";

export function CanvasPanel({
  doc,
  shareBase,
  canShare,
  versionIndex = 0,
  versionCount = 1,
  onVersion,
  onChange,
  onClose,
}: {
  doc: CanvasDoc;
  shareBase?: string;
  canShare?: boolean;
  versionIndex?: number;
  versionCount?: number;
  onVersion?: (index: number) => void;
  onChange: (html: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(doc.html);
  const [shownVersion, setShownVersion] = useState(versionIndex);
  const latestHtml = useRef(doc.html);
  latestHtml.current = doc.html;
  if (shownVersion !== versionIndex) {
    setShownVersion(versionIndex);
    setPreviewHtml(doc.html);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPreviewHtml((current) => (current === latestHtml.current ? current : latestHtml.current));
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  function showPreview() {
    setPreviewHtml(latestHtml.current);
    setMode("preview");
  }

  function download() {
    const blob = new Blob([doc.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "canvas"}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(doc.html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function share() {
    setSharing(true);
    setNotice("");
    try {
      const data = await api.send("/api/canvases", "POST", { title: doc.title, html: doc.html });
      const base = (shareBase || window.location.origin).replace(/\/$/, "");
      await navigator.clipboard.writeText(`${base}/c/${data.id}`);
      setNotice(tr("linkCopied"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tr("couldNotSave"));
    } finally {
      setSharing(false);
      setTimeout(() => setNotice(""), 1600);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col border-[var(--border)] bg-[var(--bg)] md:w-[56%] md:flex-none md:border-l">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button type="button" className="rounded-lg p-2 hover:bg-[var(--hover)] md:hidden" aria-label={tr("close")} onClick={onClose}>
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[14px] font-medium">{doc.title}</h2>
            <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-[var(--surface)] px-2.5 text-[10px] font-medium uppercase leading-none tracking-wide text-[var(--muted)]">{tr("beta")}</span>
          </div>
          <p className="truncate text-[11px] text-[var(--muted)]">{tr("canvasBeta")}</p>
        </div>
        {versionCount > 1 ? (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-30"
              aria-label={tr("previousVersion")}
              disabled={versionIndex <= 0}
              onClick={() => onVersion?.(versionIndex - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-8 text-center text-[12px] tabular-nums text-[var(--muted)]">
              {versionIndex + 1}/{versionCount}
            </span>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-30"
              aria-label={tr("nextVersion")}
              disabled={versionIndex >= versionCount - 1}
              onClick={() => onVersion?.(versionIndex + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
        <div className="flex rounded-lg bg-[var(--surface)] p-0.5">
          <button
            type="button"
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${mode === "preview" ? "bg-[var(--elevated)] text-[var(--text)]" : "text-[var(--muted)]"}`}
            onClick={showPreview}
          >
            <Eye size={14} />
            {tr("canvasPreview")}
          </button>
          <button
            type="button"
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${mode === "code" ? "bg-[var(--elevated)] text-[var(--text)]" : "text-[var(--muted)]"}`}
            onClick={() => setMode("code")}
          >
            <Code2 size={14} />
            {tr("canvasCode")}
          </button>
        </div>
        <button type="button" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={tr("copy")} onClick={() => void copy()}>
          <Copy size={16} />
        </button>
        {canShare ? (
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
            aria-label={tr("share")}
            disabled={sharing}
            onClick={() => void share()}
          >
            <Share2 size={16} />
          </button>
        ) : null}
        <button type="button" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={tr("download")} onClick={download}>
          <Download size={16} />
        </button>
        <button type="button" className="hidden rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] md:inline-flex" aria-label={tr("close")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {copied || notice ? (
        <p className={`px-3 pt-2 text-[12px] ${notice && notice !== tr("linkCopied") ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
          {notice || tr("copied")}
        </p>
      ) : null}
      {mode === "preview" ? (
        <iframe key={shownVersion} title={doc.title} sandbox="allow-scripts" srcDoc={previewHtml} className="min-h-0 w-full flex-1 bg-white" />
      ) : (
        <textarea
          value={doc.html}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-0 w-full flex-1 resize-none bg-[var(--bg)] p-4 font-mono text-[13px] leading-5 outline-none"
        />
      )}
    </section>
  );
}
