import { ArrowUp, Brain, Check, ChevronRight, FileText, FileUp, Globe, ImagePlus, Images, Link2, PanelsTopLeft, Plus, Shield, ShieldAlert, Sparkles, Square, Terminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChatModel } from "@wlfv/shared";
import { api } from "@/lib/api";
import { ContextUsage } from "./ContextUsage";
import { ThinkingToggle } from "./ThinkingToggle";
import { useT } from "@/lib/language";
import { isPhoneViewport, PHONE_QUERY } from "@/lib/layout";

const ASK_PROMPTS = ["askPrompt1", "askPrompt2", "askPrompt3", "askPrompt4", "askPrompt5", "askPrompt6", "askPrompt7", "askPrompt8"] as const;

export type ComposerAttachment = {
  id: string;
  name: string;
  text: string;
  mime?: string;
  url?: string;
  kind?: "file" | "image" | "page";
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  queueFull?: boolean;
  queueCount?: number;
  model?: ChatModel;
  thinking: boolean;
  thinkingLevel?: string;
  onThinking: (enabled: boolean, level?: string) => void;
  webSearchAvailable?: boolean;
  webSearchEnabled?: boolean;
  webSearch?: boolean;
  onWebSearch?: (enabled: boolean) => void;
  imageGenerationAvailable?: boolean;
  createImage?: boolean;
  onCreateImage?: (enabled: boolean) => void;
  imageEditAvailable?: boolean;
  editImage?: boolean;
  onEditImage?: (enabled: boolean) => void;
  codeInterpreter?: boolean;
  codeInterpreterAvailable?: boolean;
  onCodeInterpreter?: (enabled: boolean) => void;
  canvas?: boolean;
  canvasAvailable?: boolean;
  document?: boolean;
  onDocument?: (on: boolean) => void;
  webpageAvailable?: boolean;
  onCanvas?: (enabled: boolean) => void;
  skills?: { id: string; name: string }[];
  selectedSkillIds?: string[];
  onToggleSkill?: (id: string) => void;
  toolPermissionsEnabled?: boolean;
  toolPermission?: "full" | "ask" | null;
  onToolPermission?: (mode: "full" | "ask" | null) => void;
  attachments: ComposerAttachment[];
  onAttachments: (next: ComposerAttachment[]) => void;
  dropZoneRef?: RefObject<HTMLElement | null>;
  context?: {
    promptTokens: number;
    parts?: { system: number; skills: number; tools: number; conversation: number };
    numCtx: number;
    loadedContext?: number;
  };
};

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  queueFull,
  queueCount = 0,
  model,
  thinking,
  thinkingLevel,
  onThinking,
  webSearchAvailable,
  webSearchEnabled = true,
  webSearch,
  onWebSearch,
  imageGenerationAvailable,
  createImage,
  onCreateImage,
  imageEditAvailable,
  editImage,
  onEditImage,
  codeInterpreter,
  codeInterpreterAvailable = true,
  onCodeInterpreter,
  canvas,
  canvasAvailable = true,
  webpageAvailable = true,
  onCanvas,
  document: documentOn,
  onDocument,
  skills = [],
  selectedSkillIds = [],
  onToggleSkill,
  toolPermissionsEnabled,
  toolPermission,
  onToolPermission,
  attachments,
  onAttachments,
  dropZoneRef,
  context,
}: Props) {
  const tr = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef(attachments);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<null | { id: "tools" | "skills" | "effort"; top: number }>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [toolQuery, setToolQuery] = useState("");
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [pageOpen, setPageOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [toolError, setToolError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phone, setPhone] = useState(() => isPhoneViewport());
  const [askIndex, setAskIndex] = useState(() => Math.floor(Math.random() * ASK_PROMPTS.length));
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0, width: 0, above: true });
  const [sheetSection, setSheetSection] = useState<null | "tools" | "skills" | "effort">(null);

  attachmentsRef.current = attachments;

  function hasFiles(event: DragEvent) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  const [cursor, setCursor] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mention = useMemo(() => {
    const upto = value.slice(0, cursor);
    const match = upto.match(/(^|\s)([@/])([^\s@/]*)$/);
    if (!match) return null;
    return { trigger: match[2], query: match[3], start: upto.length - match[2].length - match[3].length };
  }, [value, cursor]);

  const mentionItems = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    const tools: { id: string; kind: "tool" | "skill"; label: string; icon: ReactNode; run: () => void }[] = [];
    if (webSearchAvailable && webSearchEnabled) {
      tools.push({ id: "web", kind: "tool", label: tr("webSearchChip"), icon: <Globe size={15} />, run: () => onWebSearch?.(true) });
    }
    if (codeInterpreterAvailable) {
      tools.push({ id: "code", kind: "tool", label: tr("codeInterpreter"), icon: <Terminal size={15} />, run: () => onCodeInterpreter?.(true) });
    }
    if (canvasAvailable) {
      tools.push({ id: "canvas", kind: "tool", label: tr("canvas"), icon: <PanelsTopLeft size={15} />, run: () => onCanvas?.(true) });
    }
    tools.push({ id: "document", kind: "tool", label: tr("document"), icon: <FileText size={15} />, run: () => onDocument?.(true) });
    if (imageGenerationAvailable) {
      tools.push({
        id: "image",
        kind: "tool",
        label: tr("createImage"),
        icon: <ImagePlus size={15} />,
        run: () => {
          onCreateImage?.(true);
          onEditImage?.(false);
        },
      });
    }
    if (imageEditAvailable) {
      tools.push({
        id: "edit",
        kind: "tool",
        label: tr("editImage"),
        icon: <Images size={15} />,
        run: () => {
          onEditImage?.(true);
          onCreateImage?.(false);
        },
      });
    }
    const skillItems = skills.map((skill) => ({
      id: skill.id,
      kind: "skill" as const,
      label: skill.name,
      icon: <Sparkles size={15} />,
      run: () => {
        if (!selectedSkillIds.includes(skill.id)) onToggleSkill?.(skill.id);
      },
    }));
    const ordered = mention.trigger === "@" ? [...skillItems, ...tools] : [...tools, ...skillItems];
    return ordered.filter((item) => item.label.toLowerCase().includes(query)).slice(0, 8);
  }, [mention, webSearchAvailable, webSearchEnabled, codeInterpreterAvailable, canvasAvailable, imageGenerationAvailable, imageEditAvailable, skills, selectedSkillIds, tr, onWebSearch, onCodeInterpreter, onCanvas, onDocument, onCreateImage, onEditImage, onToggleSkill]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.trigger, mention?.query]);

  function applyMention(item: (typeof mentionItems)[number]) {
    if (!mention) return;
    const token = `${mention.trigger}${item.label} `;
    const next = value.slice(0, mention.start) + token + value.slice(cursor);
    onChange(next);
    item.run();
    const pos = mention.start + token.length;
    setCursor(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  function onKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionItems.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((index) => (index - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mentionItems[Math.min(mentionIndex, mentionItems.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCursor(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const canQueue = Boolean(value.trim() || attachments.length);
      const canDrain = !busy && queueCount > 0 && !canQueue;
      if ((canQueue && !queueFull) || canDrain) onSend();
    }
  }

  function placeMenu() {
    const rect = plusRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.top - 8, left: Math.max(8, rect.left) });
  }

  function placeMention() {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.top > 220;
    setMentionPos({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      above,
    });
  }

  useEffect(() => {
    if (!menuOpen) {
      setSubmenu(null);
      setSheetSection(null);
    }
  }, [menuOpen]);

  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    if (!mention) return;
    placeMention();
    window.addEventListener("resize", placeMention);
    window.addEventListener("scroll", placeMention, true);
    return () => {
      window.removeEventListener("resize", placeMention);
      window.removeEventListener("scroll", placeMention, true);
    };
  }, [mention, value, attachments.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAskIndex((current) => (current + 1) % ASK_PROMPTS.length);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (submenu?.id !== "skills") setSkillQuery("");
    if (submenu?.id !== "tools") setToolQuery("");
  }, [submenu?.id]);

  function coarsePointer() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function showSubmenu(id: "tools" | "skills" | "effort", row: HTMLButtonElement) {
    const menu = menuRef.current?.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (!menu) return;
    if (coarsePointer()) ref.current?.blur();
    setSubmenu({ id, top: item.top - menu.top });
  }

  function submenuPlace() {
    if (typeof window === "undefined") return "right" as const;
    const width = 224;
    const edge = 8;
    if (menuPos.left + width + edge + width <= window.innerWidth - edge) return "right" as const;
    if (menuPos.left - edge - width >= edge) return "left" as const;
    return "above" as const;
  }

  useEffect(() => {
    if (!menuOpen) return;
    placeMenu();
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || plusRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", placeMenu);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", placeMenu);
    };
  }, [menuOpen]);

  async function uploadFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setUploading(true);
    setToolError("");
    try {
      const next = [...attachmentsRef.current];
      for (const file of list.slice(0, 8 - next.length)) {
        const data = await api.upload("/api/attachments/file", file);
        next.push({
          id: data.id,
          name: data.name || file.name,
          text: data.text || "",
          mime: data.mime,
          url: data.url,
          kind: data.kind,
        });
      }
      onAttachments(next);
    } catch (error) {
      setToolError(error instanceof Error ? error.message : tr("uploadError"));
    } finally {
      setUploading(false);
      setMenuOpen(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    const zone = dropZoneRef?.current;
    if (!zone) return;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const next = event.relatedTarget as Node | null;
      if (next && zone.contains(next)) return;
      setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void uploadFiles(event.dataTransfer?.files ?? null);
    };
    zone.addEventListener("dragenter", enter);
    zone.addEventListener("dragover", over);
    zone.addEventListener("dragleave", leave);
    zone.addEventListener("drop", drop);
    const blockWindow = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", blockWindow);
    window.addEventListener("drop", blockWindow);
    return () => {
      zone.removeEventListener("dragenter", enter);
      zone.removeEventListener("dragover", over);
      zone.removeEventListener("dragleave", leave);
      zone.removeEventListener("drop", drop);
      window.removeEventListener("dragover", blockWindow);
      window.removeEventListener("drop", blockWindow);
    };
  }, [dropZoneRef]);

  async function attachPage() {
    const url = pageUrl.trim();
    if (!url) return;
    setUploading(true);
    setToolError("");
    try {
      const data = await api.send("/api/attachments/webpage", "POST", { url });
      onAttachments([...attachments, { id: data.id, name: data.name || url, text: data.text, kind: "page" }]);
      setPageUrl("");
      setPageOpen(false);
      setMenuOpen(false);
    } catch (error) {
      setToolError(error instanceof Error ? error.message : tr("attachPageError"));
    } finally {
      setUploading(false);
    }
  }

  const canSend = Boolean(value.trim() || attachments.length);
  const sendEnabled = canSend ? !queueFull : !busy && queueCount > 0;
  const flyoutSide = submenuPlace();
  const skillQueryText = skillQuery.trim().toLowerCase();
  const skillMatches = skills.filter((skill) => skill.name.toLowerCase().includes(skillQueryText));
  const toolQueryText = toolQuery.trim().toLowerCase();
  const effortLevels = model?.capabilities.thinking ? model.capabilities.thinkingLevels : [];
  const effortLabel = (level: string) => (level ? level[0].toUpperCase() + level.slice(1) : "");
  const toolRows: {
    id: string;
    label: string;
    icon: ReactNode;
    checked?: boolean;
    disabled?: boolean;
    beta?: boolean;
    experimental?: boolean;
    onClick: () => void;
  }[] = [
    ...(codeInterpreterAvailable
      ? [
          {
            id: "code",
            label: tr("codeInterpreter"),
            icon: <Terminal size={15} className="text-[var(--muted)]" />,
            checked: codeInterpreter,
            onClick: () => onCodeInterpreter?.(!codeInterpreter),
          },
        ]
      : []),
    ...(webSearchEnabled
      ? [
          {
            id: "web",
            label: tr("webSearchChip"),
            icon: <Globe size={15} className="text-[var(--muted)]" />,
            checked: webSearch,
            disabled: !webSearchAvailable,
            beta: true,
            onClick: () => onWebSearch?.(!webSearch),
          },
        ]
      : []),
    ...(webpageAvailable
      ? [
          {
            id: "page",
            label: tr("attachWebpage"),
            icon: <Link2 size={15} className="text-[var(--muted)]" />,
            onClick: () => {
              setMenuOpen(false);
              setPageUrl("");
              setToolError("");
              setPageOpen(true);
            },
          },
        ]
      : []),
    ...(canvasAvailable
      ? [
          {
            id: "canvas",
            label: tr("canvas"),
            icon: <PanelsTopLeft size={15} className="text-[var(--muted)]" />,
            checked: canvas,
            beta: true,
            onClick: () => onCanvas?.(!canvas),
          },
        ]
      : []),
    {
      id: "document",
      label: tr("document"),
      icon: <FileText size={15} className="text-[var(--muted)]" />,
      checked: documentOn,
      experimental: true,
      onClick: () => onDocument?.(!documentOn),
    },
    ...(toolPermissionsEnabled
      ? [
          {
            id: "full",
            label: tr("fullAccess"),
            icon: <Shield size={15} className="text-[var(--muted)]" />,
            checked: toolPermission === "full",
            onClick: () => onToolPermission?.(toolPermission === "full" ? null : "full"),
          },
          {
            id: "ask",
            label: tr("askForApproval"),
            icon: <ShieldAlert size={15} className="text-[var(--muted)]" />,
            checked: toolPermission === "ask",
            onClick: () => onToolPermission?.(toolPermission === "ask" ? null : "ask"),
          },
        ]
      : []),
  ].filter((row) => row.label.toLowerCase().includes(toolQueryText));

  return (
    <>
    <div className="composer-pad shrink-0 pb-[var(--safe-bottom)]">
      <div ref={boxRef} className="rounded-2xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
        {attachments.length ? (
          <div className="flex flex-wrap gap-2 pb-2 pt-1">
            {attachments.map((item) =>
              item.kind === "image" && item.url ? (
                <span key={item.id} className="relative block">
                  <img src={item.url} alt={item.name} className="h-[72px] w-[72px] rounded-xl object-cover" />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--elevated)] text-[var(--muted)] shadow"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onAttachments(attachments.filter((entry) => entry.id !== item.id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <span key={item.id} className="flex items-center gap-1 rounded-lg bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--secondary)]">
                  {item.name}
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onAttachments(attachments.filter((entry) => entry.id !== item.id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ),
            )}
          </div>
        ) : null}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onFocus={() => {
            requestAnimationFrame(() => {
              window.scrollTo(0, 0);
              document.documentElement.scrollTop = 0;
              document.body.scrollTop = 0;
            });
          }}
          onKeyDown={onKey}
          onPaste={(event) => {
            const files = event.clipboardData?.files;
            if (files?.length) {
              event.preventDefault();
              void uploadFiles(files);
            }
          }}
          rows={1}
          placeholder={createImage ? tr("createImage") : editImage ? tr("editImage") : tr(ASK_PROMPTS[askIndex])}
          className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-1 py-2 text-[15px] outline-none placeholder:text-[var(--muted)]"
        />
        {toolError ? <p className="px-1 pb-1 text-[12px] text-[var(--danger)]">{toolError}</p> : null}
        <div className="flex items-center justify-between gap-2 pb-0.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <button
              ref={plusRef}
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                menuOpen || webSearch || codeInterpreter || canvas || documentOn || createImage || editImage || attachments.length || toolPermission || selectedSkillIds.length
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)]"
              }`}
              aria-label="Add"
              aria-expanded={menuOpen}
              onClick={() => {
                if (phone) ref.current?.blur();
                placeMenu();
                setMenuOpen((open) => !open);
              }}
            >
              <Plus size={18} />
            </button>
            <ContextUsage
              parts={context?.parts || { system: 0, skills: 0, tools: 0, conversation: context?.promptTokens || 0 }}
              limit={context?.loadedContext || model?.contextLength || context?.numCtx || model?.numCtx || 0}
            />
            {webSearch ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("webSearchChip")} · {tr("beta")}</span>
            ) : null}
            {createImage ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("createImageChip")}</span>
            ) : null}
            {editImage ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("editImageChip")}</span>
            ) : null}
            {codeInterpreter ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("codeChip")}</span>
            ) : null}
            {canvas ? (
              <button type="button" className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]" title={tr("canvasBeta")} onClick={() => onCanvas?.(false)}>
                {tr("canvas")} · {tr("beta")}
              </button>
            ) : null}
            {documentOn ? (
              <button type="button" className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]" onClick={() => onDocument?.(false)}>
                {tr("document")} · {tr("experimental")}
              </button>
            ) : null}
            {toolPermission === "full" ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("fullAccess")}</span>
            ) : null}
            {toolPermission === "ask" ? (
              <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">{tr("askApproval")}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ThinkingToggle
              model={model}
              enabled={thinking}
              level={thinkingLevel}
              onChange={onThinking}
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--text)]"
                aria-label="Stop"
              >
                <Square size={10} fill="currentColor" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSend}
              disabled={!sendEnabled}
              title={queueFull && canSend ? tr("queueFull") : undefined}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--bg)] disabled:opacity-25"
              aria-label="Send"
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
      {mention
        ? createPortal(
            <div
              className={`motion-fade fixed z-[70] max-h-52 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-[0_8px_30px_rgba(0,0,0,0.28)] ${mentionPos.above ? "-translate-y-full" : ""}`}
              style={{ top: mentionPos.top, left: mentionPos.left, width: mentionPos.width }}
            >
              {mentionItems.length ? (
                mentionItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex h-11 w-full items-center gap-2 px-3 text-left text-[14px] ${index === mentionIndex ? "bg-[var(--hover)]" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => applyMention(item)}
                  >
                    <span className="text-[var(--muted)]">{item.icon}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate">{item.label}</span>
                      {item.id === "canvas" || item.id === "web" || item.id === "document" ? (
                        <span className="shrink-0 rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{item.id === "document" ? tr("experimental") : tr("beta")}</span>
                      ) : null}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">{item.kind === "skill" ? tr("skills") : tr("tools")}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-[13px] text-[var(--muted)]">{tr("mentionEmpty")}</p>
              )}
            </div>,
            document.body,
          )
        : null}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
      {pageOpen ? (
        <div className="motion-fade fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label={tr("cancelAttach")} onClick={() => setPageOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="attach-webpage-title"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="attach-webpage-title" className="text-[16px] font-medium">
                {tr("attachWebpage")}
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"
                onClick={() => setPageOpen(false)}
                aria-label={tr("close")}
              >
                <X size={16} />
              </button>
            </div>
            <label className="block text-[12px] text-[var(--muted)]">
              {tr("url")}
              <input
                autoFocus
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void attachPage();
                  }
                  if (e.key === "Escape") setPageOpen(false);
                }}
                placeholder="https://"
                className="mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none"
              />
            </label>
            {toolError ? <p className="mt-2 text-[12px] text-[var(--danger)]">{toolError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]"
                onClick={() => setPageOpen(false)}
              >
                {tr("cancel")}
              </button>
              <button
                type="button"
                disabled={uploading || !pageUrl.trim()}
                className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-[13px] text-[var(--bg)] disabled:opacity-40"
                onClick={() => void attachPage()}
              >
                {uploading ? tr("adding") : tr("attach")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {menuOpen && phone
        ? createPortal(
            <div className="motion-fade fixed inset-0 z-[80] flex items-end">
              <button type="button" className="absolute inset-0 bg-black/55" aria-label={tr("close")} onClick={() => setMenuOpen(false)} />
              <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-to-chat-title"
                className="relative max-h-[86svh] w-full overflow-y-auto rounded-t-3xl bg-[var(--elevated)] px-4 pb-[max(1.25rem,var(--safe-bottom))] pt-4 shadow-2xl"
              >
                <div className="relative mb-4 flex items-center justify-center">
                  <button
                    type="button"
                    className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text)]"
                    aria-label={tr("close")}
                    onClick={() => setMenuOpen(false)}
                  >
                    <X size={18} />
                  </button>
                  <h2 id="add-to-chat-title" className="text-[16px] font-medium">
                    {tr("addToChat")}
                  </h2>
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${1 + Number(Boolean(imageGenerationAvailable)) + Number(Boolean(imageEditAvailable))}, minmax(0, 1fr))` }}
                >
                  <button
                    type="button"
                    disabled={uploading}
                    className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] px-2 text-[13px] disabled:opacity-50"
                    onClick={() => fileRef.current?.click()}
                  >
                    <FileUp size={22} />
                    {tr("uploadFiles")}
                  </button>
                  {imageGenerationAvailable ? (
                    <button
                      type="button"
                      className={`flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl px-2 text-[13px] ${createImage ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface)]"}`}
                      onClick={() => {
                        const next = !createImage;
                        onCreateImage?.(next);
                        if (next) onEditImage?.(false);
                      }}
                    >
                      <ImagePlus size={22} />
                      {tr("createImage")}
                    </button>
                  ) : null}
                  {imageEditAvailable ? (
                    <button
                      type="button"
                      className={`flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl px-2 text-[13px] ${editImage ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface)]"}`}
                      onClick={() => {
                        const next = !editImage;
                        onEditImage?.(next);
                        if (next) onCreateImage?.(false);
                      }}
                    >
                      <Images size={22} />
                      {tr("editImage")}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {effortLevels.length ? (
                    <>
                      <button
                        type="button"
                        className="flex h-12 w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 text-left text-[15px]"
                        onClick={() => setSheetSection((current) => (current === "effort" ? null : "effort"))}
                      >
                        <Brain size={18} className="text-[var(--muted)]" />
                        <span className="min-w-0 flex-1">{tr("reasoningEffort")}</span>
                        {thinking && thinkingLevel ? <span className="text-[12px] text-[var(--muted)]">{effortLabel(thinkingLevel)}</span> : null}
                        <ChevronRight size={16} className={`text-[var(--muted)] ${sheetSection === "effort" ? "rotate-90" : ""}`} />
                      </button>
                      {sheetSection === "effort" ? (
                        <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                          {effortLevels.map((level) => (
                            <button
                              key={level}
                              type="button"
                              className="flex h-11 w-full items-center justify-between gap-2 px-4 text-left text-[15px]"
                              onClick={() => onThinking(true, level)}
                            >
                              <span>{effortLabel(level)}</span>
                              {thinking && thinkingLevel === level ? <Check size={16} className="shrink-0 text-[var(--accent)]" /> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="flex h-12 w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 text-left text-[15px]"
                    onClick={() => setSheetSection((current) => (current === "tools" ? null : "tools"))}
                  >
                    <Terminal size={18} className="text-[var(--muted)]" />
                    <span className="min-w-0 flex-1">{tr("tools")}</span>
                    <ChevronRight size={16} className={`text-[var(--muted)] ${sheetSection === "tools" ? "rotate-90" : ""}`} />
                  </button>
                  {sheetSection === "tools" ? (
                    <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                      <div className="border-b border-[var(--border)] p-2">
                        <input
                          value={toolQuery}
                          onChange={(event) => setToolQuery(event.target.value)}
                          placeholder={tr("searchTools")}
                          aria-label={tr("searchTools")}
                          className="h-10 w-full rounded-xl bg-[var(--elevated)] px-3 text-[14px] outline-none"
                        />
                      </div>
                      {toolRows.length ? (
                        toolRows.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            disabled={row.disabled}
                            className="flex h-11 w-full items-center justify-between gap-2 px-4 text-left text-[15px] disabled:opacity-40"
                            onClick={row.onClick}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              {row.icon}
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <span className="truncate">{row.label}</span>
                                  {row.beta || row.experimental ? <span className="shrink-0 rounded-full bg-[var(--elevated)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{row.experimental ? tr("experimental") : tr("beta")}</span> : null}
                                </span>
                              </span>
                            </span>
                            {row.checked ? <Check size={16} className="shrink-0 text-[var(--accent)]" /> : null}
                          </button>
                        ))
                      ) : (
                        <p className="px-4 py-3 text-[13px] text-[var(--muted)]">{tr("noToolMatches")}</p>
                      )}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="flex h-12 w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 text-left text-[15px]"
                    onClick={() => setSheetSection((current) => (current === "skills" ? null : "skills"))}
                  >
                    <Sparkles size={18} className="text-[var(--muted)]" />
                    <span className="min-w-0 flex-1">{tr("skills")}</span>
                    <ChevronRight size={16} className={`text-[var(--muted)] ${sheetSection === "skills" ? "rotate-90" : ""}`} />
                  </button>
                  {sheetSection === "skills" ? (
                    <div className="overflow-hidden rounded-2xl bg-[var(--surface)]">
                      <div className="border-b border-[var(--border)] p-2">
                        <input
                          value={skillQuery}
                          onChange={(event) => setSkillQuery(event.target.value)}
                          placeholder={tr("searchSkills")}
                          aria-label={tr("searchSkills")}
                          className="h-10 w-full rounded-xl bg-[var(--elevated)] px-3 text-[14px] outline-none"
                        />
                      </div>
                      {!skills.length ? (
                        <p className="px-4 py-3 text-[13px] text-[var(--muted)]">{tr("noSkills")}</p>
                      ) : skillMatches.length ? (
                        <div className="max-h-[13.75rem] overflow-y-auto overscroll-contain">
                          {skillMatches.map((skill) => {
                            const on = selectedSkillIds.includes(skill.id);
                            return (
                              <button
                                key={skill.id}
                                type="button"
                                className="flex h-11 w-full items-center justify-between gap-2 px-4 text-left text-[15px]"
                                onClick={() => onToggleSkill?.(skill.id)}
                              >
                                <span className="truncate">{skill.name}</span>
                                {on ? <Check size={16} className="shrink-0 text-[var(--accent)]" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="px-4 py-3 text-[13px] text-[var(--muted)]">{tr("noSkillMatches")}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {menuOpen && !phone ? (
        <div ref={menuRef} className="motion-fade fixed z-50 -translate-y-full" style={{ top: menuPos.top, left: menuPos.left }}>
          <div className="relative w-56 rounded-xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-xl">
            <button
              type="button"
              disabled={uploading}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)] disabled:opacity-50"
              onMouseEnter={() => setSubmenu(null)}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={15} className="text-[var(--muted)]" />
              {tr("uploadFiles")}
            </button>
            {imageGenerationAvailable ? (
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  const next = !createImage;
                  onCreateImage?.(next);
                  if (next) onEditImage?.(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <ImagePlus size={15} className="text-[var(--muted)]" />
                  {tr("createImage")}
                </span>
                {createImage ? <Check size={14} className="text-[var(--accent)]" /> : null}
              </button>
            ) : null}
            {imageEditAvailable ? (
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)]"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  const next = !editImage;
                  onEditImage?.(next);
                  if (next) onCreateImage?.(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <Images size={15} className="text-[var(--muted)]" />
                  {tr("editImage")}
                </span>
                {editImage ? <Check size={14} className="text-[var(--accent)]" /> : null}
              </button>
            ) : null}
            {effortLevels.length ? (
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)] ${submenu?.id === "effort" ? "bg-[var(--hover)]" : ""}`}
                onMouseEnter={(event) => {
                  if (!coarsePointer()) showSubmenu("effort", event.currentTarget);
                }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => (submenu?.id === "effort" ? setSubmenu(null) : showSubmenu("effort", event.currentTarget))}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Brain size={15} className="shrink-0 text-[var(--muted)]" />
                  <span className="truncate">{tr("reasoningEffort")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[var(--muted)]">
                  {thinking && thinkingLevel ? <span className="text-[12px]">{effortLabel(thinkingLevel)}</span> : null}
                  <ChevronRight size={14} />
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)] ${submenu?.id === "tools" ? "bg-[var(--hover)]" : ""}`}
              onMouseEnter={(event) => {
                if (!coarsePointer()) showSubmenu("tools", event.currentTarget);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => (submenu?.id === "tools" ? setSubmenu(null) : showSubmenu("tools", event.currentTarget))}
            >
              <span className="flex items-center gap-2">
                <Terminal size={15} className="text-[var(--muted)]" />
                {tr("tools")}
              </span>
              <ChevronRight size={14} className="text-[var(--muted)]" />
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--hover)] ${submenu?.id === "skills" ? "bg-[var(--hover)]" : ""}`}
              onMouseEnter={(event) => {
                if (!coarsePointer()) showSubmenu("skills", event.currentTarget);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => (submenu?.id === "skills" ? setSubmenu(null) : showSubmenu("skills", event.currentTarget))}
            >
              <span className="flex items-center gap-2">
                <Sparkles size={15} className="text-[var(--muted)]" />
                {tr("skills")}
              </span>
              <ChevronRight size={14} className="text-[var(--muted)]" />
            </button>
            {submenu ? (
              <div
                className={`absolute w-56 ${
                  flyoutSide === "right" ? "left-full pl-1" : flyoutSide === "left" ? "right-full pr-1" : "bottom-full left-0 mb-1"
                }`}
                style={flyoutSide === "above" ? undefined : { bottom: 0 }}
              >
                <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] shadow-xl">
                  {submenu.id === "effort" ? (
                    <div className="py-1">
                      {effortLevels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[13px] hover:bg-[var(--hover)]"
                          onClick={() => onThinking(true, level)}
                        >
                          <span>{effortLabel(level)}</span>
                          {thinking && thinkingLevel === level ? <Check size={14} className="shrink-0 text-[var(--accent)]" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {submenu.id === "tools" ? (
                    <>
                      <div className="border-b border-[var(--border)] p-2">
                        <input
                          ref={(node) => {
                            if (node && !coarsePointer()) node.focus();
                          }}
                          value={toolQuery}
                          onChange={(event) => setToolQuery(event.target.value)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          placeholder={tr("searchTools")}
                          aria-label={tr("searchTools")}
                          className="h-8 w-full rounded-lg bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none"
                        />
                      </div>
                      <div className="max-h-[360px] overflow-y-auto [scrollbar-width:thin]">
                        {toolRows.length ? (
                          toolRows.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              disabled={row.disabled}
                              className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[13px] leading-5 hover:bg-[var(--hover)] disabled:opacity-40"
                              onClick={row.onClick}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {row.icon}
                                <span className="min-w-0">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate">{row.label}</span>
                                    {row.beta || row.experimental ? <span className="shrink-0 rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{row.experimental ? tr("experimental") : tr("beta")}</span> : null}
                                  </span>
                                </span>
                              </span>
                              {row.checked ? <Check size={14} className="shrink-0 text-[var(--accent)]" /> : null}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-[12px] text-[var(--muted)]">{tr("noToolMatches")}</p>
                        )}
                      </div>
                    </>
                  ) : submenu.id === "skills" ? (
                    <>
                      <div className="border-b border-[var(--border)] p-2">
                        <input
                          ref={(node) => {
                            if (node && !coarsePointer()) node.focus();
                          }}
                          value={skillQuery}
                          onChange={(event) => setSkillQuery(event.target.value)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          placeholder={tr("searchSkills")}
                          aria-label={tr("searchSkills")}
                          className="h-8 w-full rounded-lg bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none"
                        />
                      </div>
                      <div className="max-h-[360px] overflow-y-auto [scrollbar-width:thin]">
                        {!skills.length ? (
                          <p className="px-3 py-2 text-[12px] text-[var(--muted)]">{tr("noSkills")}</p>
                        ) : skillMatches.length ? (
                          skillMatches.map((skill) => {
                            const on = selectedSkillIds.includes(skill.id);
                            return (
                              <button
                                key={skill.id}
                                type="button"
                                className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[13px] leading-5 hover:bg-[var(--hover)]"
                                onClick={() => onToggleSkill?.(skill.id)}
                              >
                                <span className="truncate">{skill.name}</span>
                                {on ? <Check size={14} className="shrink-0 text-[var(--accent)]" /> : null}
                              </button>
                            );
                          })
                        ) : (
                          <p className="px-3 py-2 text-[12px] text-[var(--muted)]">{tr("noSkillMatches")}</p>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
    {dragging && dropZoneRef?.current
      ? createPortal(
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg)_78%,transparent)]">
            <div className="rounded-2xl border-2 border-dashed border-[var(--accent)] bg-[var(--elevated)] px-8 py-6 text-center shadow-xl">
              <p className="text-[16px] font-medium">{tr("dropImage")}</p>
              <p className="mt-1 text-[13px] text-[var(--secondary)]">{tr("dropImageTypes")}</p>
            </div>
          </div>,
          dropZoneRef.current,
        )
      : null}
    </>
  );
}
