import { useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { ChevronLeft, ChevronRight, Code2, Copy, Download, Eye, History, MoreHorizontal, Share2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  artifactFilename,
  previewSandbox,
  type ArtifactAction,
  type ArtifactSource,
  type ArtifactType,
} from "@wlfv/shared";
import { canvasPreviewKind, cssPreviewSrcDoc, reactPreviewSrcDoc, scriptPreviewSrcDoc, sourcePreviewText } from "@/components/chat/web-preview";
import { api } from "@/lib/api";
import { useT } from "@/lib/language";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export const artifactPanelClass =
  "flex min-h-0 min-w-0 w-full flex-1 flex-col border-[var(--border)] bg-[var(--bg)] md:w-[56%] md:flex-none md:border-l";
export const artifactChatClass = "max-md:hidden";

type VersionRow = { version: number; content: string; createdAt: number; source: ArtifactSource | string };

const PRISM: Record<string, string> = {
  html: "markup",
  svg: "markup",
  xml: "markup",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  md: "markdown",
  py: "python",
  sh: "bash",
  yml: "yaml",
  rs: "rust",
};

function prismLanguage(language: string) {
  const name = language.toLowerCase();
  return PRISM[name] || name || "text";
}

export function CanvasPanel({
  title,
  content,
  type,
  language,
  saveState = "saved",
  shareBase,
  canShare,
  versionIndex = 0,
  versionCount = 1,
  history = [],
  onVersion,
  onChange,
  onRename,
  onRestore,
  onDelete,
  onClose,
  onAsk,
  onRegenerate,
  onNew,
}: {
  title: string;
  content: string;
  type: ArtifactType;
  language: string;
  saveState?: "saved" | "saving" | "unsaved" | "error";
  shareBase?: string;
  canShare?: boolean;
  versionIndex?: number;
  versionCount?: number;
  history?: VersionRow[];
  onVersion?: (index: number) => void;
  onChange: (content: string) => void;
  onRename?: (title: string) => void;
  onRestore?: (version: number) => void;
  onDelete?: () => void;
  onClose: () => void;
  onAsk?: (action: ArtifactAction) => void;
  onRegenerate?: () => void;
  onNew?: () => void;
}) {
  const tr = useT();
  const previewKind = canvasPreviewKind(type, language);
  const [mode, setMode] = useState<"preview" | "code">(previewKind ? "preview" : "code");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState<"history" | "more" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [shownType, setShownType] = useState(type);
  if (titleDraft !== title && !editingTitle) setTitleDraft(title);
  if (shownType !== type) {
    setShownType(type);
    setMode(previewKind ? "preview" : "code");
  }

  function showPreview() {
    setMode("preview");
  }

  function download() {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFilename(title, type, language);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function share() {
    setSharing(true);
    setNotice("");
    try {
      const data = await api.send("/api/canvases", "POST", { title, html: content });
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

  function commitTitle() {
    setEditingTitle(false);
    const next = titleDraft.trim().slice(0, 80);
    if (!next || next === title) {
      setTitleDraft(title);
      return;
    }
    onRename?.(next);
  }

  const status = saveState === "saving" ? tr("saving") : saveState === "unsaved" || saveState === "error" ? tr("artifactUnsaved") : tr("saved");
  const asks: { action: ArtifactAction; label: string }[] = [
    { action: "fix", label: tr("artifactFix") },
    { action: "improve", label: tr("artifactImprove") },
    { action: "refactor", label: tr("artifactRefactor") },
    { action: "explain", label: tr("artifactExplain") },
    { action: "responsive", label: tr("artifactResponsive") },
    { action: "feature", label: tr("artifactFeature") },
    { action: "convert", label: tr("artifactConvert") },
    { action: "optimize", label: tr("artifactOptimize") },
  ];

  return (
    <section className={artifactPanelClass}>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button type="button" className="rounded-lg px-2 py-2 text-[13px] hover:bg-[var(--hover)] md:hidden" onClick={onClose}>
          {tr("backToChat")}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {editingTitle ? (
              <input
                value={titleDraft}
                aria-label={tr("rename")}
                className="min-w-0 flex-1 rounded-md bg-[var(--surface)] px-2 py-1 text-[14px] outline-none"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setTitleDraft(title);
                    setEditingTitle(false);
                  }
                }}
                autoFocus
              />
            ) : (
              <button type="button" className="min-w-0 truncate text-left text-[14px] font-medium" onClick={() => setEditingTitle(true)}>
                {title}
              </button>
            )}
            <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-[var(--surface)] px-2.5 text-[10px] font-medium uppercase leading-none tracking-wide text-[var(--muted)]">
              {language || type}
            </span>
          </div>
          <p className="truncate text-[11px] text-[var(--muted)]">
            {tr("canvasBeta")}
            {saveState !== "saved" ? ` · ${status}` : ""}
          </p>
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
        {canShare && type === "html" ? (
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
        <div className="relative">
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label={tr("artifactHistory")}
            onClick={() => setMenu((current) => (current === "history" ? null : "history"))}
          >
            <History size={16} />
          </button>
          {menu === "history" ? (
            <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-1 shadow-lg">
              {history.length ? (
                history.map((row) => (
                  <button
                    key={row.version}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
                    onClick={() => {
                      setMenu(null);
                      onRestore?.(row.version);
                    }}
                  >
                    <span>
                      v{row.version} · {row.source === "ai" ? tr("artifactAi") : tr("artifactYou")}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">{tr("artifactRestore")}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-[12px] text-[var(--muted)]">{tr("artifactNoVersions")}</p>
              )}
            </div>
          ) : null}
        </div>
        <div className="relative">
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label={tr("artifactMore")}
            onClick={() => setMenu((current) => (current === "more" ? null : "more"))}
          >
            <MoreHorizontal size={16} />
          </button>
          {menu === "more" ? (
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-1 shadow-lg">
              <button type="button" className="block w-full rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--hover)]" onClick={() => { setMenu(null); onNew?.(); }}>
                {tr("artifactNew")}
              </button>
              <button type="button" className="block w-full rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--hover)]" onClick={() => { setMenu(null); onRegenerate?.(); }}>
                {tr("artifactRegenerate")}
              </button>
              {asks.map((item) => (
                <button
                  key={item.action}
                  type="button"
                  className="block w-full rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
                  onClick={() => {
                    setMenu(null);
                    onAsk?.(item.action);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className="block w-full rounded-lg px-2 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--hover)]"
                onClick={() => {
                  setMenu(null);
                  setConfirmDelete(true);
                }}
              >
                {tr("delete")}
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="hidden rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] md:inline-flex" aria-label={tr("close")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {copied || notice ? (
        <p className={`px-3 pt-2 text-[12px] ${notice && notice !== tr("linkCopied") ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
          {notice || tr("copied")}
        </p>
      ) : null}
      {mode === "preview" && previewKind === "html" ? (
        <iframe title={title} sandbox={previewSandbox("html") || undefined} srcDoc={content} className="min-h-0 w-full flex-1 bg-white" />
      ) : mode === "preview" && previewKind === "svg" ? (
        <iframe
          title={title}
          sandbox=""
          srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;justify-content:center;background:#fff">${content}</body></html>`}
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : mode === "preview" && previewKind === "css" ? (
        <iframe title={title} sandbox="" srcDoc={cssPreviewSrcDoc(content)} className="min-h-0 w-full flex-1 bg-white" />
      ) : mode === "preview" && previewKind === "react" ? (
        <iframe title={title} sandbox="allow-scripts" srcDoc={reactPreviewSrcDoc(content)} className="min-h-0 w-full flex-1 bg-white" />
      ) : mode === "preview" && previewKind === "script" ? (
        <iframe title={title} sandbox="allow-scripts" srcDoc={scriptPreviewSrcDoc(content, language)} className="min-h-0 w-full flex-1 bg-white" />
      ) : mode === "preview" && previewKind === "source" ? (
        <ArtifactCode content={sourcePreviewText(content, language)} language={language} readOnly onChange={onChange} />
      ) : mode === "preview" && previewKind === "markdown" ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[15px] leading-7">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <ArtifactCode content={content} language={language} onChange={onChange} />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={tr("artifactDelete")}
        description={tr("artifactDeleteHint")}
        confirmLabel={tr("delete")}
        cancelLabel={tr("cancel")}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete?.();
        }}
      />
    </section>
  );
}

function ArtifactCode({ content, language, onChange, readOnly }: { content: string; language: string; onChange: (content: string) => void; readOnly?: boolean }) {
  const gutter = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const lines = content.split("\n");
  const highlighted = content.length > 0 && content.length <= 50000;

  function sync(event: UIEvent<HTMLTextAreaElement>) {
    const top = event.currentTarget.scrollTop;
    const left = event.currentTarget.scrollLeft;
    if (gutter.current) gutter.current.scrollTop = top;
    if (highlight.current) {
      highlight.current.scrollTop = top;
      highlight.current.scrollLeft = left;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${content.slice(0, start)}  ${content.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = start + 2;
      el.selectionEnd = start + 2;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div ref={gutter} className="w-10 shrink-0 overflow-hidden border-r border-[var(--border)] py-4 pr-2 text-right font-mono text-[12px] leading-5 text-[var(--muted)]" aria-hidden>
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        {highlighted ? (
          <div ref={highlight} className={`${readOnly ? "absolute inset-0 overflow-auto" : "pointer-events-none absolute inset-0 overflow-hidden"}`} aria-hidden={!readOnly}>
            <SyntaxHighlighter
              language={prismLanguage(language)}
              style={oneDark}
              PreTag="div"
              customStyle={{ margin: 0, padding: 16, background: "transparent", fontSize: 13, lineHeight: "20px", minHeight: "100%" }}
              codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", background: "transparent" } }}
            >
              {content.endsWith("\n") ? content : `${content}\n`}
            </SyntaxHighlighter>
          </div>
        ) : null}
        {readOnly ? null : (
        <textarea
          value={content}
          onChange={(event) => onChange(event.target.value)}
          onScroll={sync}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label={language || "code"}
          className={`absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[13px] leading-5 outline-none ${highlighted ? "text-transparent caret-[var(--text)]" : "text-[var(--text)]"}`}
        />
        )}
      </div>
    </div>
  );
}
