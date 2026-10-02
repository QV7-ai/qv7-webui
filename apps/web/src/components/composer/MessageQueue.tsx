import { useEffect, useState } from "react";
import { ArrowUp, Pencil, X } from "lucide-react";
import { useT } from "@/lib/language";

export type QueueItem = {
  id: string;
  text: string;
  attachments: { name: string }[];
};

export function MessageQueue({
  items,
  max,
  onEdit,
  onRemove,
  onSendNow,
}: {
  items: QueueItem[];
  max: number;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
}) {
  const tr = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (editingId && !items.some((item) => item.id === editingId)) setEditingId(null);
  }, [editingId, items]);

  if (!items.length) return null;

  function startEdit(item: QueueItem) {
    setEditingId(item.id);
    setDraft(item.text);
  }

  function saveEdit(item: QueueItem) {
    const text = draft.trim();
    if (!text && !item.attachments.length) {
      onRemove(item.id);
    } else {
      onEdit(item.id, text);
    }
    setEditingId(null);
  }

  return (
    <div className="mb-2 w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)]">
      <p className="border-b border-[var(--border)] px-3 py-2 text-[12px] text-[var(--muted)]">
        {tr("queued")} {items.length}/{max}
      </p>
      <ul>
        {items.map((item) => {
          const files = item.attachments.map((file) => file.name).filter(Boolean);
          const editing = editingId === item.id;
          return (
            <li key={item.id} className="border-b border-[var(--border)] px-3 py-2 last:border-b-0">
              {editing ? (
                <div className="w-full">
                  <textarea
                    value={draft}
                    autoFocus
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(item);
                      }
                    }}
                    className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[14px] leading-5 outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="min-h-11 rounded-lg bg-[var(--text)] px-3 text-[13px] text-[var(--bg)]" onClick={() => saveEdit(item)}>
                      {tr("save")}
                    </button>
                    <button type="button" className="min-h-11 rounded-lg px-3 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]" onClick={() => setEditingId(null)}>
                      {tr("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex w-full items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-5">{item.text || files.join(", ") || "…"}</p>
                    {item.text && files.length ? <p className="mt-1 truncate text-[12px] text-[var(--muted)]">{files.join(", ")}</p> : null}
                  </div>
                  <div className="flex shrink-0">
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                      aria-label={tr("edit")}
                      title={tr("edit")}
                      onClick={() => startEdit(item)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                      aria-label={tr("sendNow")}
                      title={tr("sendNow")}
                      onClick={() => onSendNow(item.id)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                      aria-label={tr("removeFromQueue")}
                      title={tr("removeFromQueue")}
                      onClick={() => onRemove(item.id)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
