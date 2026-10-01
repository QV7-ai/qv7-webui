import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Copy,
  Download,
  FolderInput,
  Mail,
  MoreHorizontal,
  Pencil,
  Pin,
  Share2,
  Trash2,
} from "lucide-react";
import type { ChatFolder } from "@wlfv/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/language";

export function ChatMenu({
  chat,
  folders,
  sharingEnabled = true,
  onShare,
  onDownload,
  onRename,
  onUnread,
  onPin,
  onClone,
  onMove,
  onArchive,
  onDelete,
}: {
  chat: { unread?: boolean; pinned?: boolean; archived?: boolean };
  folders: ChatFolder[];
  sharingEnabled?: boolean;
  onShare: () => void;
  onDownload: () => void;
  onRename: () => void;
  onUnread: () => void;
  onPin: () => void;
  onClone: () => void;
  onMove: (folderId: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  function place() {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 192) });
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setMoveOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function run(action: () => void) {
    action();
    setOpen(false);
    setMoveOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className={cn(
          "rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
        )}
        aria-label={tr("chatOptions")}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          place();
          setOpen((value) => !value);
          setMoveOpen(false);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="fixed z-[80] w-48 rounded-xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-2xl" style={{ top: pos.top, left: pos.left }}>
          {sharingEnabled ? <MenuItem icon={<Share2 size={14} />} label={tr("share")} onClick={() => run(onShare)} /> : null}
          <MenuItem icon={<Download size={14} />} label={tr("download")} onClick={() => run(onDownload)} />
          <MenuItem icon={<Pencil size={14} />} label={tr("rename")} onClick={() => run(onRename)} />
          <MenuItem
            icon={<Mail size={14} />}
            label={chat.unread ? tr("markRead") : tr("markUnread")}
            onClick={() => run(onUnread)}
          />
          <MenuItem icon={<Pin size={14} />} label={chat.pinned ? tr("unpin") : tr("pin")} onClick={() => run(onPin)} />
          <MenuItem icon={<Copy size={14} />} label={tr("clone")} onClick={() => run(onClone)} />
          {folders.length ? (
          <div
            className="relative"
            onMouseEnter={() => setMoveOpen(true)}
            onMouseLeave={() => setMoveOpen(false)}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
              onClick={() => setMoveOpen((value) => !value)}
            >
              <FolderInput size={14} className="text-[var(--muted)]" />
              {tr("move")}
            </button>
            {moveOpen ? (
              <div className="absolute left-full top-0 z-[90] ml-1 min-w-40 rounded-xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-2xl">
                <button
                  type="button"
                  className="flex w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
                  onClick={() => run(() => onMove(null))}
                >
                  {tr("noFolder")}
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="flex w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
                    onClick={() => run(() => onMove(folder.id))}
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}
          <MenuItem
            icon={<Archive size={14} />}
            label={chat.archived ? tr("unarchive") : tr("archive")}
            onClick={() => run(onArchive)}
          />
          <MenuItem icon={<Trash2 size={14} />} label={tr("delete")} danger onClick={() => run(onDelete)} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]",
        danger ? "text-[var(--danger)]" : "",
      )}
      onClick={onClick}
    >
      <span className={danger ? "" : "text-[var(--muted)]"}>{icon}</span>
      {label}
    </button>
  );
}
