import { useT } from "@/lib/language";

export function SettingsSaveBar({ saving, status }: { saving?: boolean; status?: string }) {
  const tr = useT();
  const text = saving ? tr("saving") : status;
  if (!text) return null;
  const failed = !saving && status && status !== tr("saved");
  return (
    <p className={`mt-8 text-[12px] ${failed ? "text-[var(--danger)]" : "text-[var(--muted)]"}`} aria-live="polite">
      {text}
    </p>
  );
}
