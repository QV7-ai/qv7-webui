import { Loader } from "lucide-react";
import { useT } from "@/lib/language";

export type WaitStage = "searching" | "thinking" | "loading" | "prompt" | "running" | "memory" | "memorySearch" | "fetch" | "image" | "compacting" | "mcp";

const WAIT_KEYS: Record<WaitStage, "waitSearching" | "thinkingDots" | "waitLoading" | "waitPrompt" | "waitRunning" | "waitMemory" | "waitMemorySearch" | "waitFetch" | "waitImage" | "waitCompacting" | "waitMcp"> = {
  searching: "waitSearching",
  thinking: "thinkingDots",
  loading: "waitLoading",
  prompt: "waitPrompt",
  running: "waitRunning",
  memory: "waitMemory",
  memorySearch: "waitMemorySearch",
  fetch: "waitFetch",
  image: "waitImage",
  compacting: "waitCompacting",
  mcp: "waitMcp",
};

export function isActivityWait(stage?: WaitStage) {
  return (
    stage === "searching" ||
    stage === "running" ||
    stage === "memory" ||
    stage === "memorySearch" ||
    stage === "fetch" ||
    stage === "image" ||
    stage === "mcp"
  );
}

/** @deprecated use isActivityWait */
export function isToolWait(stage?: WaitStage) {
  return isActivityWait(stage);
}

export function ModelWait({ stage }: { stage?: WaitStage }) {
  const tr = useT();
  const key = (stage && WAIT_KEYS[stage]) || "waitLoading";
  return (
    <div className="flex items-center gap-2 text-[13px] text-[var(--secondary)]">
      <Loader size={14} className="animate-spin text-[var(--muted)]" />
      <span>{tr(key)}</span>
    </div>
  );
}
