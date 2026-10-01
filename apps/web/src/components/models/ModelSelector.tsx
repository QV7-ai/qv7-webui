import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { ChatModel, ModelCategory } from "@wlfv/shared";
import { ModelIcon } from "./ModelIcon";
import { AnimatePresence, motion } from "framer-motion";
import { useT } from "@/lib/language";

type Props = {
  models: ChatModel[];
  categories?: ModelCategory[];
  value?: string;
  onChange: (id: string) => void;
  loadedIds?: string[];
};

function LoadedMark({ loaded, size, ring }: { loaded?: boolean; size: number; ring: string }) {
  if (!loaded) return null;
  const dot = Math.max(7, Math.round(size * 0.28));
  return (
    <span
      className="absolute rounded-full bg-[#22c55e]"
      style={{
        width: dot,
        height: dot,
        right: -1,
        bottom: -1,
        boxShadow: `0 0 0 2px ${ring}`,
      }}
      title="Loaded"
      aria-label="Loaded"
    />
  );
}

function categoryIdsOf(model: ChatModel) {
  if (model.categoryIds?.length) return model.categoryIds;
  return model.categoryId ? [model.categoryId] : [];
}

export function ModelSelector({ models, categories = [], value, onChange, loadedIds = [] }: Props) {
  const tr = useT();
  const loaded = useMemo(() => new Set(loadedIds), [loadedIds]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find((m) => m.id === value) ?? models[0];

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQ("");
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQ("");
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return models.filter(
      (m) =>
        !query ||
        m.displayName.toLowerCase().includes(query) ||
        (m.categoryNames?.length ? m.categoryNames : m.categoryName ? [m.categoryName] : []).join(" ").toLowerCase().includes(query),
    );
  }, [models, q]);
  const groups = useMemo(() => {
    const listed = categories
      .map((category) => ({
        id: category.id,
        label: category.name,
        items: filtered.filter((m) => categoryIdsOf(m).includes(category.id)),
      }))
      .filter((group) => group.items.length);
    const known = new Set(categories.map((category) => category.id));
    const leftoverNames = new Map<string, ChatModel[]>();
    for (const model of filtered) {
      for (const id of categoryIdsOf(model)) {
        if (!known.has(id)) leftoverNames.set(id, [...(leftoverNames.get(id) ?? []), model]);
      }
    }
    for (const [id, items] of leftoverNames) {
      listed.push({ id, label: items[0]?.categoryNames?.[0] || items[0]?.categoryName || "Category", items });
    }
    const uncategorized = filtered.filter((model) => !categoryIdsOf(model).length);
    if (uncategorized.length) {
      listed.push({
        id: "uncategorized",
        label: listed.length ? tr("uncategorized") : "",
        items: uncategorized,
      });
    }
    return listed;
  }, [categories, filtered]);

  if (!models.length) {
    return <span className="text-[13px] text-[var(--muted)]">No models enabled</span>;
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--hover)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="relative inline-flex shrink-0">
          <ModelIcon name={selected.displayName} iconUrl={selected.iconUrl} size={22} />
          <LoadedMark loaded={loaded.has(selected.id)} size={22} ring="var(--bg)" />
        </span>
        <span className="max-w-[min(12rem,calc(100vw-8rem))] truncate text-[14px] font-medium">{selected.displayName}</span>
        <ChevronDown size={14} className={`text-[var(--muted)] ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <Search size={14} className="text-[var(--muted)]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tr("searchModelsDots")}
                className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {groups.map((group) => (
                <div key={group.id} className="py-1">
                  {group.label ? (
                    <p className="px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                      {group.label}
                    </p>
                  ) : null}
                  {group.items.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setQ("");
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--hover)]"
                    >
                      <span className="relative inline-flex shrink-0">
                        <ModelIcon name={m.displayName} iconUrl={m.iconUrl} />
                        <LoadedMark loaded={loaded.has(m.id)} size={28} ring="var(--elevated)" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px]">{m.displayName}</span>
                        {m.description ? (
                          <span className="block truncate text-[11px] text-[var(--muted)]">{m.description}</span>
                        ) : null}
                      </span>
                      {m.id === selected.id ? <Check size={14} className="text-[var(--accent)]" /> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
