import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, LogOut, Pin, Plus, ScrollText, Search, Settings, Sparkles, X } from "lucide-react";
import type { ChatFolder } from "@wlfv/shared";
import { cn } from "@/lib/cn";
import { FolderGlyph } from "@/components/sidebar/FolderGlyph";
import { FolderSettingsDialog } from "@/components/sidebar/FolderSettingsDialog";
import { InstructionsDialog } from "@/components/sidebar/InstructionsDialog";
import { ChatMenu } from "@/components/sidebar/ChatMenu";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import { DEFAULT_LOGO } from "@/lib/branding";
import { useT } from "@/lib/language";

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
  folderId?: string | null;
  archived?: boolean;
  pinned?: boolean;
  unread?: boolean;
};

function emptyFolder(name: string): ChatFolder {
  return {
    id: "",
    name,
    icon: "folder",
    iconColor: "#C9864A",
    systemPrompt: "",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function groupLabel(ts: number, labels: { today: string; yesterday: string; previous7days: string; older: string }) {
  const d = new Date(ts);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = start(now) - start(d);
  if (diff === 0) return labels.today;
  if (diff === 86400000) return labels.yesterday;
  if (diff < 86400000 * 7) return labels.previous7days;
  return labels.older;
}

export function Sidebar({
  open,
  chats,
  folders,
  activeId,
  onNew,
  onNewInFolder,
  onOpen,
  onDelete,
  onSearch,
  onSkills,
  onSettings,
  onCloseMobile,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveChat,
  onRenameChat,
  onPinChat,
  onUnreadChat,
  onArchiveChat,
  onCloneChat,
  onShareChat,
  onDownloadChat,
  branding,
  logoUrl,
  username,
  foldersEnabled = true,
  sharingEnabled = true,
  openNewFolder = false,
  onNewFolderOpened,
}: {
  open: boolean;
  chats: ChatSummary[];
  folders: ChatFolder[];
  activeId?: string;
  onNew: () => void;
  onNewInFolder: (folderId: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
  onSkills: () => void;
  onSettings: () => void;
  onCloseMobile: () => void;
  onCreateFolder: (patch: Partial<ChatFolder>) => Promise<ChatFolder>;
  onUpdateFolder: (id: string, patch: Partial<ChatFolder>) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveChat: (chatId: string, folderId: string | null) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onPinChat: (chatId: string, pinned: boolean) => void;
  onUnreadChat: (chatId: string, unread: boolean) => void;
  onArchiveChat: (chatId: string, archived: boolean) => void;
  onCloneChat: (chatId: string) => void;
  onShareChat: (chatId: string) => void;
  onDownloadChat: (chatId: string) => void;
  branding: string;
  logoUrl?: string;
  username: string;
  foldersEnabled?: boolean;
  sharingEnabled?: boolean;
  openNewFolder?: boolean;
  onNewFolderOpened?: () => void;
}) {
  const tr = useT();
  const [editing, setEditing] = useState<ChatFolder | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const isDraft = Boolean(editing && !editing.id);

  useEffect(() => {
    if (!openNewFolder) return;
    setEditing(emptyFolder(tr("newFolder")));
    onNewFolderOpened?.();
  }, [openNewFolder, onNewFolderOpened]);

  function isOpen(id: string) {
    return openFolders[id] !== false;
  }

  const visible = chats.filter((chat) => !chat.archived);
  const archived = chats.filter((chat) => chat.archived);
  const unfiled = foldersEnabled ? visible.filter((chat) => !chat.folderId) : visible;
  const groups = new Map<string, ChatSummary[]>();
  for (const chat of unfiled) {
    const label = groupLabel(chat.updatedAt, {
      today: tr("today"),
      yesterday: tr("yesterday"),
      previous7days: tr("previous7days"),
      older: tr("older"),
    });
    groups.set(label, [...(groups.get(label) ?? []), chat]);
  }

  return (
    <>
      {open ? (
        <button className="motion-fade absolute inset-0 z-30 bg-black/50 md:hidden" aria-label={tr("closeSidebar")} onClick={onCloseMobile} />
      ) : null}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex w-[min(272px,86vw)] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] pb-[var(--safe-bottom)] transition-transform duration-200 ease-out md:static md:z-0 md:w-60 md:pb-0 lg:w-[272px]",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-4">
          <img src={logoUrl || DEFAULT_LOGO} alt="" className="h-7 w-7 rounded-md object-contain" />
          <span className="text-[14px] font-medium tracking-tight">{branding}</span>
          <button className="ml-auto rounded-lg p-2 md:hidden" onClick={onCloseMobile} aria-label={tr("closeSidebar")}>
            <X size={16} />
          </button>
        </div>
        <div className="px-2">
          <button
            onClick={onNew}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--hover)]"
          >
            <Plus size={16} />
            {tr("newChat")}
          </button>
          {foldersEnabled ? (
          <button
            onClick={() => setEditing(emptyFolder(tr("newFolder")))}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--hover)]"
          >
            <FolderPlus size={16} />
            {tr("newFolder")}
          </button>
          ) : null}
          <button
            onClick={onSearch}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]"
          >
            <Search size={16} />
            {tr("search")}
          </button>
          <button
            type="button"
            onClick={onSkills}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]"
          >
            <Sparkles size={16} />
            {tr("skills")}
          </button>
          <button
            type="button"
            onClick={() => {
              setInstructionsOpen(true);
              onCloseMobile();
            }}
            className="mb-3 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[var(--secondary)] hover:bg-[var(--hover)]"
          >
            <ScrollText size={16} />
            {tr("instructions")}
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {foldersEnabled
            ? folders.map((folder) => {
            const items = visible.filter((chat) => chat.folderId === folder.id);
            const expanded = isOpen(folder.id);
            return (
              <div key={folder.id} className="mb-1 rounded-lg">
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setOpenFolders((current) => ({ ...current, [folder.id]: !expanded }))}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]"
                  >
                    {expanded ? <ChevronDown size={12} className="shrink-0 text-[var(--muted)]" /> : <ChevronRight size={12} className="shrink-0 text-[var(--muted)]" />}
                    <FolderGlyph icon={folder.icon} color={folder.iconColor} />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <div className="flex shrink-0 items-center pr-1">
                      <button
                        type="button"
                        className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
                        aria-label={tr("newChatInFolder")}
                        onClick={() => onNewInFolder(folder.id)}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
                        aria-label={tr("folderSettings")}
                        onClick={() => setEditing(folder)}
                      >
                        <Settings size={12} />
                      </button>
                    </div>
                  </div>
                {expanded
                  ? items.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        active={activeId === chat.id}
                        nested
                        folders={foldersEnabled ? folders : []}
                        sharingEnabled={sharingEnabled}
                        onOpen={onOpen}
                        onDelete={onDelete}
                        onMoveChat={onMoveChat}
                        onRenameChat={onRenameChat}
                        onPinChat={onPinChat}
                        onUnreadChat={onUnreadChat}
                        onArchiveChat={onArchiveChat}
                        onCloneChat={onCloneChat}
                        onShareChat={onShareChat}
                        onDownloadChat={onDownloadChat}
                      />
                    ))
                  : null}
              </div>
            );
          })
          : null}
          <div className="mt-2 rounded-lg">
            {[...groups.entries()].map(([label, items]) => (
              <div key={label} className="mb-3">
                <p className="px-2.5 pb-1 text-[11px] text-[var(--muted)]">{label}</p>
                {items.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={activeId === chat.id}
                    folders={foldersEnabled ? folders : []}
                    sharingEnabled={sharingEnabled}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onMoveChat={onMoveChat}
                    onRenameChat={onRenameChat}
                    onPinChat={onPinChat}
                    onUnreadChat={onUnreadChat}
                    onArchiveChat={onArchiveChat}
                    onCloneChat={onCloneChat}
                    onShareChat={onShareChat}
                    onDownloadChat={onDownloadChat}
                  />
                ))}
              </div>
            ))}
            {archived.length ? (
              <div className="mb-3">
                <p className="px-2.5 pb-1 text-[11px] text-[var(--muted)]">{tr("archived")}</p>
                {archived.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={activeId === chat.id}
                    folders={foldersEnabled ? folders : []}
                    sharingEnabled={sharingEnabled}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onMoveChat={onMoveChat}
                    onRenameChat={onRenameChat}
                    onPinChat={onPinChat}
                    onUnreadChat={onUnreadChat}
                    onArchiveChat={onArchiveChat}
                    onCloneChat={onCloneChat}
                    onShareChat={onShareChat}
                    onDownloadChat={onDownloadChat}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </nav>
        <div className="border-t border-[var(--border)] p-2">
          <InstallAppButton />
          <button
            type="button"
            onClick={onSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--hover)]"
          >
            <Settings size={16} />
            {tr("settings")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--hover)]"
            onClick={() => void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(() => location.assign("/login"))}
          >
            <LogOut size={16} />
            {tr("signOut")}
          </button>
        </div>
      </aside>
      {editing ? (
        <FolderSettingsDialog
          folder={editing}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (!editing.id) {
              const created = await onCreateFolder(patch);
              setEditing(null);
              setOpenFolders((current) => ({ ...current, [created.id]: true }));
              return;
            }
            await onUpdateFolder(editing.id, patch);
          }}
          onDelete={isDraft ? async () => undefined : () => onDeleteFolder(editing.id)}
        />
      ) : null}
      <InstructionsDialog open={instructionsOpen} username={username} logoUrl={logoUrl} onClose={() => setInstructionsOpen(false)} />
    </>
  );
}

function ChatRow({
  chat,
  active,
  nested,
  folders,
  onOpen,
  onDelete,
  onMoveChat,
  onRenameChat,
  onPinChat,
  onUnreadChat,
  onArchiveChat,
  onCloneChat,
  onShareChat,
  onDownloadChat,
  sharingEnabled = true,
}: {
  chat: ChatSummary;
  active: boolean;
  nested?: boolean;
  folders: ChatFolder[];
  sharingEnabled?: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveChat: (chatId: string, folderId: string | null) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onPinChat: (chatId: string, pinned: boolean) => void;
  onUnreadChat: (chatId: string, unread: boolean) => void;
  onArchiveChat: (chatId: string, archived: boolean) => void;
  onCloneChat: (chatId: string) => void;
  onShareChat: (chatId: string) => void;
  onDownloadChat: (chatId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);

  function commitRename() {
    const next = title.trim();
    setRenaming(false);
    if (next && next !== chat.title) onRenameChat(chat.id, next);
    else setTitle(chat.title);
  }

  return (
    <div className={cn("group relative", nested && "pl-4")}>
      {renaming ? (
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              setTitle(chat.title);
              setRenaming(false);
            }
          }}
          className="mb-0.5 h-8 w-full rounded-lg bg-[var(--surface)] px-2.5 text-[13px] outline-none"
        />
      ) : (
        <button
          onClick={() => onOpen(chat.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 pr-8 text-left text-[13px]",
            active ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]",
            chat.unread && "font-medium",
          )}
        >
          {chat.unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" /> : null}
          <span className="min-w-0 truncate">{chat.title}</span>
          {chat.pinned ? <Pin size={11} className="ml-auto shrink-0 text-[var(--muted)]" /> : null}
        </button>
      )}
      {!renaming ? (
        <div className="absolute right-1 top-1">
          <ChatMenu
            chat={chat}
            folders={folders}
            sharingEnabled={sharingEnabled}
            onShare={() => onShareChat(chat.id)}
            onDownload={() => onDownloadChat(chat.id)}
            onRename={() => {
              setTitle(chat.title);
              setRenaming(true);
            }}
            onUnread={() => onUnreadChat(chat.id, !chat.unread)}
            onPin={() => onPinChat(chat.id, !chat.pinned)}
            onClone={() => onCloneChat(chat.id)}
            onMove={(folderId) => onMoveChat(chat.id, folderId)}
            onArchive={() => onArchiveChat(chat.id, !chat.archived)}
            onDelete={() => onDelete(chat.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
