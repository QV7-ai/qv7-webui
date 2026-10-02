import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { UsedMemory } from "@wlfv/shared";

export function MemoryUsed({
  memories,
  label,
  defaultOpen = false,
}: {
  memories: UsedMemory[];
  label: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!memories.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 py-1 text-[13px] text-[var(--muted)] hover:text-[var(--secondary)]"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div className="max-h-64 overflow-y-auto overscroll-contain pb-1 text-[13px] leading-5 text-[var(--muted)]">
          {memories.map((memory) => (
            <p key={memory.id} className="break-words">
              {memory.content}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
