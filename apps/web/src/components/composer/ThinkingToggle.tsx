import { Brain, Check } from "lucide-react";
import { useState } from "react";
import type { ChatModel } from "@wlfv/shared";
import { AnimatePresence, motion } from "framer-motion";
import { useT } from "@/lib/language";

type Props = {
  model?: ChatModel;
  enabled: boolean;
  level?: string;
  onChange: (enabled: boolean, level?: string) => void;
};

export function ThinkingToggle({ model, enabled, level, onChange }: Props) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  if (!model?.capabilities.thinking) return null;
  const levels = model.capabilities.thinkingLevels;
  const options = levels.length
    ? [{ id: "off", label: tr("off") }, ...levels.map((l) => ({ id: l, label: l[0].toUpperCase() + l.slice(1) }))]
    : [
        { id: "off", label: tr("off") },
        { id: "on", label: tr("on") },
      ];
  const current = !enabled ? "off" : level && levels.includes(level) ? level : "on";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] ${
          enabled ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"
        }`}
        aria-label={tr("thinking")}
      >
        <Brain size={14} />
        <span>{tr("thinking")}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-40 mb-2 w-40 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-xl"
          >
            <p className="px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">{tr("thinking")}</p>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id !== "off", option.id === "on" || option.id === "off" ? undefined : option.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
              >
                <Check size={13} className={current === option.id ? "text-[var(--accent)]" : "opacity-0"} />
                {option.label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
