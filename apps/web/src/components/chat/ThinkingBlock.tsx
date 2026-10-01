import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/language";

export function ThinkingBlock({
  text,
  streaming,
}: {
  text?: string;
  streaming?: boolean;
}) {
  const tr = useT();
  const [open, setOpen] = useState(streaming);
  if (!text && !streaming) return null;
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)] hover:text-[var(--secondary)]"
      >
        <Brain size={13} />
        {streaming ? tr("thinkingDots") : tr("thinking")}
        <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div className="mt-1.5 max-h-40 overflow-y-auto border-l border-[var(--border)] pl-3 text-[13px] leading-5 text-[var(--muted)] whitespace-pre-wrap">
          {text || ""}
        </div>
      ) : null}
    </div>
  );
}
