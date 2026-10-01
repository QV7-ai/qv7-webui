import { DEFAULT_AUTH_CONFIG } from "@wlfv/shared";
import { useT } from "@/lib/language";

export function PendingOverlay({
  title,
  content,
  adminContactEmail,
}: {
  title?: string;
  content?: string;
  adminContactEmail?: string;
}) {
  const tr = useT();
  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-6">
        <h1 className="text-[22px] font-medium">{title || DEFAULT_AUTH_CONFIG.pendingOverlayTitle}</h1>
        <p className="mt-3 whitespace-pre-wrap text-[14px] text-[var(--secondary)]">
          {content || DEFAULT_AUTH_CONFIG.pendingOverlayContent}
        </p>
        {adminContactEmail ? (
          <p className="mt-4 text-[13px] text-[var(--muted)]">
            {tr("contact")}{" "}
            <a className="text-[var(--text)] underline" href={`mailto:${adminContactEmail}`}>
              {adminContactEmail}
            </a>
          </p>
        ) : null}
        <button
          type="button"
          className="mt-6 rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] hover:bg-[var(--hover)]"
          onClick={() => void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(() => location.assign("/login"))}
        >
          {tr("signOut")}
        </button>
      </div>
    </div>
  );
}
