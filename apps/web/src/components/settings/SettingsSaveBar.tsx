import { Button } from "@/components/ui/button";
import { useT } from "@/lib/language";

export function SettingsSaveBar({
  saving,
  status,
  onSave,
  label,
}: {
  saving?: boolean;
  status?: string;
  onSave: () => void;
  label?: string;
}) {
  const tr = useT();
  return (
    <div className="mt-8 flex items-center gap-3">
      <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
        {saving ? tr("saving") : label || tr("save")}
      </Button>
      {status ? <p className="text-[12px] text-[var(--muted)]">{status}</p> : null}
    </div>
  );
}
