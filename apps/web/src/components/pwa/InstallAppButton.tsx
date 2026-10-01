import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isIosDevice, isStandaloneApp } from "@/lib/pwa";
import { useT } from "@/lib/language";

type PromptEvent = Event & { prompt: () => Promise<void> };

export function InstallAppButton() {
  const tr = useT();
  const [promptEvent, setPromptEvent] = useState<PromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandaloneApp()) {
      setHidden(true);
      return;
    }
    function onPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as PromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden) return null;
  const ios = isIosDevice() && !isStandaloneApp();
  if (!promptEvent && !ios) return null;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--hover)]"
        onClick={() => {
          if (promptEvent) {
            void promptEvent.prompt().then(() => setPromptEvent(null));
            return;
          }
          setIosHint((value) => !value);
        }}
      >
        <Download size={16} />
        {tr("installApp")}
      </button>
      {iosHint ? (
        <p className="px-2.5 pb-2 text-[11px] leading-4 text-[var(--muted)]">
          {tr("iosInstallHint")}
        </p>
      ) : null}
    </div>
  );
}
