import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "@/lib/language";

function formatTokens(value: number) {
  const rounded = Math.round(value);
  if (rounded >= 10000) {
    const compact = rounded / 1000;
    const digits = compact >= 100 ? 0 : 1;
    return `${compact.toFixed(digits)}K`;
  }
  return String(rounded);
}

const SLICES = [
  { key: "system", label: "ctxSystem", color: "#9aa0a6" },
  { key: "skills", label: "ctxSkills", color: "#e0a045" },
  { key: "tools", label: "ctxToolCalls", color: "#7c6aef" },
  { key: "conversation", label: "ctxConversation", color: "#e07a6a" },
] as const;

export function ContextUsage({
  parts,
  limit,
}: {
  parts: { system: number; skills: number; tools: number; conversation: number };
  limit: number;
}) {
  const tr = useT();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const slices = SLICES.map((slice) => ({ ...slice, tokens: Math.max(0, Math.round(parts[slice.key] || 0)) }));
  const tokens = slices.reduce((sum, slice) => sum + slice.tokens, 0);
  const known = limit > 0;
  const ratio = known ? Math.min(1, tokens / limit) : 0;
  const percent = Math.round(ratio * 100);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;

  function placePanel() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPlace({ top: rect.top - 8, left });
  }

  useEffect(() => {
    if (!open) return;
    placePanel();
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current?.getBoundingClientRect();
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!panel || !rect) return;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.width - 8));
      const top = Math.max(panel.height + 8, rect.top - 8);
      setPlace({ top, left });
    });
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", placePanel);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placePanel);
    };
  }, [open]);

  const ringColor = percent >= 90 ? "var(--danger)" : percent >= 75 ? "#e0a045" : "var(--accent)";
  const label = known
    ? tr("contextOf", { used: formatTokens(tokens), limit: formatTokens(limit) })
    : tr("contextUsed", { used: formatTokens(tokens) });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
        aria-label={tr("contextUsage")}
        aria-expanded={open}
        title={label}
        onClick={() => {
          placePanel();
          setOpen((value) => !value);
        }}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
          <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="1.6" className="opacity-35" />
          {tokens > 0 ? (
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray={`${circumference * ratio} ${circumference}`}
              transform="rotate(-90 10 10)"
            />
          ) : null}
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="motion-fade fixed z-[80] w-[min(340px,calc(100vw-16px))] -translate-y-full rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
              style={{ top: place.top, left: place.left }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-[var(--text)]">{tr("contextUsage")}</p>
                  {known ? <p className="text-[12px] text-[var(--muted)]">{tr("contextFull", { n: percent })}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[12px] text-[var(--secondary)]">{label}</p>
                  <button
                    type="button"
                    className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    aria-label={tr("close")}
                    onClick={() => setOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                <div className="flex h-full" style={{ width: `${known ? percent : tokens ? 100 : 0}%` }}>
                  {slices.map((slice) => (
                    <div key={slice.key} style={{ width: `${tokens ? (slice.tokens / tokens) * 100 : 0}%`, background: slice.color }} />
                  ))}
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {slices.map((slice) => (
                  <li key={slice.key} className="flex items-center gap-2 text-[13px]">
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: slice.color }} />
                    <span className="min-w-0 flex-1 truncate text-[var(--secondary)]">{tr(slice.label)}</span>
                    <span className="shrink-0 tabular-nums text-[var(--muted)]">{formatTokens(slice.tokens)}</span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
