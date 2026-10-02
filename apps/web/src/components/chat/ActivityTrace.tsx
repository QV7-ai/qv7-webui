import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Brain, ChevronDown, Globe, X } from "lucide-react";
import type { ChatActivity, WebSearchSource } from "@wlfv/shared";
import { useT } from "@/lib/language";
import { isPhoneViewport } from "@/lib/layout";
import type { WaitStage } from "./ModelWait";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (!host || failed) {
    return <Globe size={14} className="shrink-0 text-[var(--muted)]" />;
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      className="h-3.5 w-3.5 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

function SourceList({ sources, empty }: { sources: WebSearchSource[]; empty: string }) {
  if (!sources.length) return <p className="py-1 text-[12px] text-[var(--muted)]">{empty}</p>;
  return (
    <ul className="py-1">
      {sources.slice(0, 8).map((source) => {
        const host = hostOf(source.url);
        return (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.snippet || source.title}
              className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[13px] hover:bg-[var(--hover)]"
            >
              <Favicon host={host} />
              <span className="min-w-0 flex-1 truncate text-[var(--secondary)]">{source.title || host}</span>
              {host ? <span className="max-w-[40%] shrink-0 truncate text-[12px] text-[var(--muted)]">{host}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function stepsFrom(activities?: ChatActivity[], sources?: WebSearchSource[]) {
  if (activities?.length) return activities;
  if (sources?.length) return [{ kind: "search" as const, query: "", sources }];
  return [];
}

export function ActivityTrace({
  activities,
  sources,
  thinking,
  streaming,
  wait,
}: {
  activities?: ChatActivity[];
  sources?: WebSearchSource[];
  thinking?: string;
  streaming?: boolean;
  wait?: WaitStage;
}) {
  const tr = useT();
  const steps = stepsFrom(activities, sources);
  const searches = steps.filter((step) => step.kind === "search");
  const quiet = wait === "searching" || wait === "fetch" || wait === "compacting";
  const hasThinking = Boolean(thinking || (streaming && !quiet));
  const [open, setOpen] = useState(Boolean(streaming));
  const [sheet, setSheet] = useState(false);
  const [openSearch, setOpenSearch] = useState<Record<number, boolean>>({});
  const [thinkingOpen, setThinkingOpen] = useState(true);

  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  useEffect(() => {
    if (thinking) setThinkingOpen(true);
  }, [thinking]);

  if (!steps.length && !thinking && !(streaming && (wait === "searching" || wait === "fetch" || wait === "thinking"))) return null;

  const header = searches.length ? tr("searchedWeb") : streaming ? tr("thinkingDots") : tr("thinking");

  function searchOpen(index: number, fallback: boolean) {
    return openSearch[index] ?? fallback;
  }

  function toggleSearch(index: number, fallback: boolean) {
    setOpenSearch((current) => ({ ...current, [index]: !searchOpen(index, fallback) }));
  }

  const detail = (compact: boolean) => (
    <div className={compact ? "relative space-y-4 pl-8" : "mt-2 space-y-1 border-l border-[var(--border)] pl-3"}>
      {compact ? <div className="absolute bottom-3 left-[14px] top-2 w-px bg-[var(--border)]" /> : null}
      {steps.map((step, index) => {
        if (step.kind === "note") {
          return (
            <div key={`note-${index}`} className={compact ? "relative" : ""}>
              {compact ? <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--muted)]" /> : null}
              <p className="text-[14px] leading-5 text-[var(--text)]">{step.text}</p>
            </div>
          );
        }
        if (step.kind === "fetch") {
          const host = hostOf(step.url);
          return (
            <a
              key={`fetch-${index}`}
              href={step.url}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 text-[14px] text-[var(--text)] ${compact ? "relative" : "py-1.5 text-[13px] text-[var(--secondary)] hover:text-[var(--text)]"}`}
            >
              {compact ? <Globe size={16} className="absolute -left-[25px] top-0.5 bg-[var(--elevated)] text-[var(--muted)]" /> : <Globe size={14} className="text-[var(--muted)]" />}
              <span className="truncate">{host || step.url}</span>
            </a>
          );
        }
        const expanded = searchOpen(index, !compact);
        return (
          <div key={`search-${index}`} className={compact ? "relative" : ""}>
            {compact ? <Globe size={16} className="absolute -left-[25px] top-0.5 bg-[var(--elevated)] text-[var(--muted)]" /> : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              {compact ? null : <span className="text-[var(--secondary)]">{tr("searchedWeb")}</span>}
              {step.query ? (
                <button
                  type="button"
                  className={`inline-flex max-w-full items-center gap-1 text-left ${compact ? "text-[15px] font-medium text-[var(--text)]" : "font-semibold text-[var(--text)]"}`}
                  onClick={() => toggleSearch(index, !compact)}
                >
                  <span className="truncate">{step.query}</span>
                  <ChevronDown size={14} className={`shrink-0 text-[var(--muted)] ${expanded ? "rotate-180" : ""}`} />
                </button>
              ) : (
                <span className="text-[var(--secondary)]">{tr("searchedWeb")}</span>
              )}
            </div>
            {expanded ? <SourceList sources={step.sources} empty={streaming ? tr("waitSearching") : tr("noSearchResults")} /> : null}
          </div>
        );
      })}
      {thinking || (streaming && hasThinking) ? (
        <div className={compact ? "relative" : "pt-1"}>
          {compact ? <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--muted)]" /> : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 py-1 text-[13px] text-[var(--muted)] hover:text-[var(--secondary)]"
            onClick={() => setThinkingOpen((value) => !value)}
          >
            {compact ? null : <Brain size={13} />}
            {streaming ? tr("thinkingDots") : tr("thinking")}
            <ChevronDown size={12} className={thinkingOpen ? "rotate-180" : ""} />
          </button>
          {thinkingOpen && thinking ? (
            <div
              className={`whitespace-pre-wrap break-words pb-1 text-[13px] leading-5 text-[var(--muted)] ${
                compact ? "" : "max-h-64 overflow-y-auto overscroll-contain"
              }`}
            >
              {thinking}
            </div>
          ) : thinkingOpen && streaming ? (
            <p className="pb-1 text-[13px] text-[var(--muted)]">{tr("thinkingDots")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mb-3">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)] hover:text-[var(--secondary)]"
        onClick={() => {
          if (isPhoneViewport()) setSheet(true);
          else setOpen((value) => !value);
        }}
      >
        {searches.length ? <Globe size={13} /> : <Brain size={13} />}
        {header}
        <ChevronDown size={12} className={open && !isPhoneViewport() ? "rotate-180" : ""} />
      </button>
      {open && !isPhoneViewport() ? (
        searches.length ? (
          detail(false)
        ) : thinking ? (
          <div className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap border-l border-[var(--border)] pl-3 text-[13px] leading-5 text-[var(--muted)]">
            {thinking}
          </div>
        ) : null
      ) : null}
      {sheet
        ? createPortal(
            <div className="motion-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-3 sm:items-center">
              <button type="button" className="absolute inset-0" aria-label={tr("close")} onClick={() => setSheet(false)} />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="activity-summary-title"
                className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl"
              >
                <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--hover)] text-[var(--text)]"
                    onClick={() => setSheet(false)}
                    aria-label={tr("close")}
                  >
                    <X size={18} />
                  </button>
                  <h2 id="activity-summary-title" className="flex-1 text-center text-[16px] font-semibold">
                    {tr("activitySummary")}
                  </h2>
                  <span className="h-10 w-10" />
                </div>
                <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-6">{detail(true)}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
