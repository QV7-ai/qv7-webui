import { Check, Copy, Eye, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useT } from "@/lib/language";

const LANG_LABELS: Record<string, string> = {
  html: "HTML",
  xml: "XML",
  svg: "SVG",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  python: "Python",
  py: "Python",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  go: "Go",
  rust: "Rust",
  java: "Java",
  php: "PHP",
  ruby: "Ruby",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  cs: "C#",
  swift: "Swift",
  kotlin: "Kotlin",
  dockerfile: "Dockerfile",
  diff: "Diff",
  text: "Text",
};

type Fence = { lang: string; code: string };

function prismLang(lang: string) {
  const value = lang.toLowerCase();
  if (value === "html" || value === "xml" || value === "svg" || value === "vue") return "markup";
  if (value === "js") return "javascript";
  if (value === "ts") return "typescript";
  if (value === "py") return "python";
  if (value === "sh" || value === "shell" || value === "zsh") return "bash";
  if (value === "yml") return "yaml";
  if (value === "cs") return "csharp";
  if (value === "c++") return "cpp";
  if (value === "md") return "markdown";
  return value || "text";
}

function langLabel(lang: string) {
  const key = lang.toLowerCase();
  return LANG_LABELS[key] || lang || "Code";
}

function extractFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  const re = /```([a-zA-Z0-9+#_-]*)[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    fences.push({ lang: (match[1] || "").toLowerCase(), code: match[2].replace(/\n$/, "") });
  }
  return fences;
}

function looksLikeMarkup(lang: string, code: string) {
  const value = lang.toLowerCase();
  if (["html", "htm", "svg", "vue", "xml"].includes(value)) return true;
  return /^\s*(<!doctype\s+html|<html[\s>]|<svg[\s>])/i.test(code);
}

function buildSrcDoc(html: string, extras: Fence[]) {
  const css = extras
    .filter((item) => item.lang === "css" || item.lang === "scss" || item.lang === "less")
    .map((item) => item.code)
    .join("\n");
  const js = extras
    .filter((item) => item.lang === "js" || item.lang === "javascript")
    .map((item) => item.code)
    .join("\n");
  const styleTag = css ? `<style>${css}</style>` : "";
  const scriptTag = js ? `<script>${js}<\/script>` : "";
  if (/^\s*<svg[\s>]/i.test(html) && !/<html[\s>]/i.test(html)) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styleTag}<style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#fff}</style></head><body>${html}${scriptTag}</body></html>`;
  }
  if (/<!doctype/i.test(html) || /<html[\s>]/i.test(html)) {
    let out = html;
    if (styleTag) out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${styleTag}</head>`) : styleTag + out;
    if (scriptTag) out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${scriptTag}</body>`) : out + scriptTag;
    return out;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;min-height:100%;}</style>${styleTag}</head><body>${html}${scriptTag}</body></html>`;
}

function WebPreview({ srcDoc, onClose }: { srcDoc: string; onClose: () => void }) {
  const tr = useT();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="motion-fade fixed inset-0 z-[80] flex items-stretch justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label={tr("closePreview")} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-preview-title"
        className="relative z-10 flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <p id="web-preview-title" className="text-[14px] font-medium">
            {tr("webPreview")}
          </p>
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label={tr("close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <iframe
          title={tr("webPreview")}
          className="min-h-0 w-full flex-1 bg-white"
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={srcDoc}
        />
      </div>
    </div>,
    document.body,
  );
}

function Code({
  className,
  children,
  extras,
}: {
  className?: string;
  children?: ReactNode;
  extras: Fence[];
}) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const lang = /language-([a-z0-9+#_-]+)/i.exec(className || "")?.[1] || "";
  const code = String(children ?? "").replace(/\n$/, "");
  const block = Boolean(lang) || className?.includes("language-") || code.includes("\n");
  const canPreview = block && looksLikeMarkup(lang, code);

  if (!block) {
    return <code className="rounded bg-[var(--surface)] px-1 py-0.5 font-mono text-[13px]">{code}</code>;
  }

  return (
    <div className="my-3 max-w-full min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--code-bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">{langLabel(lang)}</span>
        <div className="flex items-center gap-2">
          {canPreview ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
              onClick={() => setPreview(true)}
            >
              <Eye size={12} />
              {tr("preview")}
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
            onClick={async () => {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? tr("copied") : tr("copy")}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={prismLang(lang)}
        style={oneDark}
        PreTag="div"
        wrapLongLines
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "transparent",
          fontSize: 13,
          lineHeight: 1.65,
          maxWidth: "100%",
          overflowX: "auto",
        }}
        codeTagProps={{
          style: {
            fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
            background: "transparent",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
      {preview ? <WebPreview srcDoc={buildSrcDoc(code, extras)} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const extras = useMemo(() => extractFences(text), [text]);
  return (
    <div className="prose-wlfv min-w-0 max-w-none overflow-x-auto text-[15.5px] leading-7 text-[var(--text)] [&_a]:text-[var(--accent)] [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-[22px] [&_h1]:font-medium [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[18px] [&_h2]:font-medium [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:my-3 [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--border)] [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: (props) => <Code {...props} extras={extras} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
