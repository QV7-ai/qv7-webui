import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FOLDER_ICONS, type ChatFolder, type FolderIconName } from "@wlfv/shared";
import { Button } from "@/components/ui/button";
import { FolderGlyph } from "@/components/sidebar/FolderGlyph";
import { useT } from "@/lib/language";

const COLORS = ["#FE4901", "#ef6b5c", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#e4e4e7", "#71717a"];

export function FolderSettingsDialog({
  folder,
  isNew = false,
  onClose,
  onSave,
  onDelete,
}: {
  folder: ChatFolder;
  isNew?: boolean;
  onClose: () => void;
  onSave: (patch: Partial<ChatFolder>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const tr = useT();
  const [name, setName] = useState(folder.name);
  const [icon, setIcon] = useState<FolderIconName>(folder.icon);
  const [iconColor, setIconColor] = useState(folder.iconColor);
  const [systemPrompt, setSystemPrompt] = useState(folder.systemPrompt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(folder.name);
    setIcon(folder.icon);
    setIconColor(folder.iconColor);
    setSystemPrompt(folder.systemPrompt);
  }, [folder]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave({ name, icon, iconColor, systemPrompt });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("folderSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="motion-fade fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label={tr("closeFolderSettings")} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-settings-title"
        className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="folder-settings-title" className="text-[16px] font-medium">
            {isNew ? tr("newFolder") : tr("folderSettings")}
          </h2>
          <button type="button" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={onClose} aria-label={tr("close")}>
            <X size={16} />
          </button>
        </div>
        <label className="block text-[12px] text-[var(--muted)]">
          {tr("folderName")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none"
          />
        </label>
        <p className="mt-4 text-[12px] text-[var(--muted)]">{tr("folderIcon")}</p>
        <div className="mt-2 grid grid-cols-10 gap-1">
          {FOLDER_ICONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setIcon(item)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${icon === item ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"}`}
              aria-label={item}
            >
              <FolderGlyph icon={item} color={iconColor} size={16} />
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-[var(--muted)]">{tr("folderIconColor")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setIconColor(color)}
              className={`h-6 w-6 rounded-full ${iconColor.toLowerCase() === color.toLowerCase() ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--elevated)]" : ""}`}
              style={{ background: color }}
              aria-label={color}
            />
          ))}
          <input
            type="color"
            value={iconColor}
            onChange={(event) => setIconColor(event.target.value)}
            className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
            aria-label={tr("customColor")}
          />
        </div>
        <label className="mt-4 block text-[12px] text-[var(--muted)]">
          {tr("systemPrompt")}
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={5}
            placeholder={tr("folderPrompt")}
            className="mt-1 w-full resize-y rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
          />
        </label>
        {error ? <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p> : null}
        <div className="mt-5 flex items-center justify-between">
          {isNew ? (
            <span />
          ) : (
            <Button
              variant="danger"
              onClick={() =>
                void onDelete().then(onClose).catch((err) => setError(err instanceof Error ? err.message : tr("folderDeleteError")))
              }
            >
              {tr("deleteFolder")}
            </Button>
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>{tr("cancel")}</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? tr("saving") : tr("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
