import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useT } from "@/lib/language";

type Item = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: Item[];
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const hits = useMemo(
    () => items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12),
    [items, q],
  );
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  if (!open) return null;
  return (
    <div className="motion-fade fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 pt-[max(12vh,env(safe-area-inset-top))]" onClick={onClose}>
      <div
        className="motion-pop w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <Search size={16} className="text-[var(--muted)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("searchCommands")}
            className="h-12 w-full bg-transparent text-[14px] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && hits[0]) {
                hits[0].run();
                onClose();
              }
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {hits.map((item) => (
            <button
              key={item.id}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              {item.label}
              {item.hint ? <span className="text-[11px] text-[var(--muted)]">{item.hint}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
