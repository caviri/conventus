import { useState } from "react";
import { useStore, viewKey } from "../store";
import { api } from "../api";
import { getTheme, toggleTheme } from "../theme";
import type { View, BoardKind, Channel, Board, Folder } from "../types";
import {
  Hash,
  Plus,
  HardDrive,
  Settings as SettingsIcon,
  Shield,
  LogOut,
  Sun,
  Moon,
  FileText,
  Pencil,
  Columns3,
  Search,
  Trash2,
  Folder as FolderIcon,
  FolderPlus,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

const BOARD_KIND = {
  canvas: { label: "live document", icon: FileText },
  whiteboard: { label: "whiteboard", icon: Pencil },
  kanban: { label: "kanban", icon: Columns3 },
} as const;

function boardIcon(kind: BoardKind, size = 16) {
  const Icon = BOARD_KIND[kind].icon;
  return <Icon size={size} className="shrink-0" />;
}

const COLLAPSE_KEY = "conventus.folders.collapsed";

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

type DragItem = { kind: "channel" | "board"; id: number };

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const {
    user,
    roomName,
    channels,
    dms,
    members,
    view,
    unread,
    setView,
    openDm,
    logout,
    refreshChannels,
    setSearchOpen,
    boards,
    folders,
    refreshBoards,
    refreshFolders,
    moveToFolder,
  } = useStore();

  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newChannel, setNewChannel] = useState("");
  const [theme, setThemeState] = useState(getTheme());
  const [dragOver, setDragOver] = useState<number | "root" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });

  const go = (v: View) => {
    setView(v);
    onNavigate();
  };

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function createBoard(kind: BoardKind) {
    setMenuOpen(false);
    const name = window.prompt(`Name for the new ${BOARD_KIND[kind].label}`)?.trim();
    if (!name) return;
    const b = await api.post<{ id: number }>("/api/boards", { kind, name });
    await refreshBoards();
    go({ type: kind, id: b.id });
  }

  async function createFolder() {
    setMenuOpen(false);
    const name = window.prompt("Name for the new folder")?.trim();
    if (!name) return;
    await api.post("/api/folders", { name });
    await refreshFolders();
  }

  async function renameFolder(f: Folder) {
    const name = window.prompt("Rename folder", f.name)?.trim();
    if (!name || name === f.name) return;
    await api.patch(`/api/folders/${f.id}`, { name });
    await refreshFolders();
  }

  async function deleteFolder(f: Folder) {
    if (!window.confirm(`Delete folder “${f.name}”? Its items move back out — nothing is lost.`))
      return;
    await api.del(`/api/folders/${f.id}`);
    await Promise.all([refreshFolders(), refreshChannels(), refreshBoards()]);
  }

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    await api.post("/api/channels", { name: newChannel.trim() });
    setNewChannel("");
    setCreating(false);
    await refreshChannels();
  }

  // --- Drag and drop -------------------------------------------------------
  function startDrag(e: React.DragEvent, item: DragItem) {
    e.dataTransfer.setData("application/json", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  }
  function readDrag(e: React.DragEvent): DragItem | null {
    try {
      return JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return null;
    }
  }
  async function dropOn(e: React.DragEvent, folderId: number | null) {
    e.preventDefault();
    setDragOver(null);
    const item = readDrag(e);
    if (item) await moveToFolder(item.kind, item.id, folderId);
  }

  const active = viewKey(view);
  const others = members.filter((m) => m.name !== user?.name);
  const me = members.find((m) => m.name === user?.name);

  // --- Row renderers (draggable) ------------------------------------------
  const channelRow = (c: Channel) => {
    const k = `channel:${c.id}`;
    return (
      <button
        key={c.id}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "channel", id: c.id })}
        onClick={() => go({ type: "channel", id: c.id })}
        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
          active === k
            ? "bg-[var(--c-accent-soft)] text-[var(--c-text)]"
            : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
        }`}
      >
        <Hash size={16} className="shrink-0" />
        <span className="truncate">{c.name}</span>
        {unread[k] > 0 && active !== k && (
          <span className="ml-auto rounded-full bg-[var(--c-accent)] px-1.5 text-xs text-white">
            {unread[k]}
          </span>
        )}
      </button>
    );
  };

  const boardRow = (b: Board) => {
    const k = `${b.kind}:${b.id}`;
    return (
      <button
        key={`b${b.id}`}
        draggable
        onDragStart={(e) => startDrag(e, { kind: "board", id: b.id })}
        onClick={() => go({ type: b.kind, id: b.id })}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
          active === k
            ? "bg-[var(--c-accent-soft)] text-[var(--c-text)]"
            : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
        }`}
      >
        {boardIcon(b.kind)}
        <span className="truncate">{b.name}</span>
      </button>
    );
  };

  const ungroupedChannels = channels.filter((c) => c.folder_id == null);
  const ungroupedBoards = boards.filter((b) => b.folder_id == null);

  return (
    <aside className="surface flex h-full w-72 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--c-border)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="font-display truncate text-lg font-semibold">{roomName}</div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            onClick={() => setSearchOpen(true)}
            title="Search messages (Ctrl/⌘+K)"
          >
            <Search size={16} />
          </button>
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            onClick={() => setThemeState(toggleTheme())}
            title={theme === "light" ? "Switch to dark" : "Switch to light"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {/* Channels header + create menu (also a drop target to ungroup) */}
        <div
          className={`relative mb-1 flex items-center justify-between rounded-lg px-2 py-0.5 ${
            dragOver === "root" ? "ring-1 ring-[var(--c-accent)]" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver("root");
          }}
          onDragLeave={() => setDragOver((d) => (d === "root" ? null : d))}
          onDrop={(e) => dropOn(e, null)}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
            Channels
          </span>
          <button
            className="text-[var(--c-muted)] hover:text-[var(--c-text)]"
            onClick={() => setMenuOpen((v) => !v)}
            title="Create…"
          >
            <Plus size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="card absolute right-1 top-7 z-20 w-44 overflow-hidden p-1 text-sm shadow-2xl fade-in">
                {user?.is_admin && (
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                    onClick={() => {
                      setMenuOpen(false);
                      setCreating(true);
                    }}
                  >
                    <Hash size={15} /> New channel
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={() => createBoard("canvas")}
                >
                  <FileText size={15} /> New live document
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={() => createBoard("whiteboard")}
                >
                  <Pencil size={15} /> New whiteboard
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={() => createBoard("kanban")}
                >
                  <Columns3 size={15} /> New kanban
                </button>
                <div className="my-1 border-t border-[var(--c-border)]" />
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={createFolder}
                >
                  <FolderPlus size={15} /> New folder
                </button>
              </div>
            </>
          )}
        </div>
        {creating && (
          <form onSubmit={createChannel} className="px-2 py-1">
            <input
              autoFocus
              className="input"
              placeholder="channel-name"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              onBlur={() => !newChannel && setCreating(false)}
            />
          </form>
        )}

        {/* Folders — collapsible groups holding channels and boards */}
        {folders.map((f) => {
          const isCollapsed = collapsed.has(f.id);
          const fChannels = channels.filter((c) => c.folder_id === f.id);
          const fBoards = boards.filter((b) => b.folder_id === f.id);
          const count = fChannels.length + fBoards.length;
          return (
            <div
              key={f.id}
              className={`mb-0.5 rounded-lg ${
                dragOver === f.id ? "ring-1 ring-[var(--c-accent)]" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(f.id);
              }}
              onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
              onDrop={(e) => dropOn(e, f.id)}
            >
              <div className="group flex items-center gap-1 px-2 py-1">
                <button
                  onClick={() => toggleCollapse(f.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)] hover:text-[var(--c-text)]"
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <FolderIcon size={12} className="shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-[10px] opacity-70">{count || ""}</span>
                </button>
                <button
                  onClick={() => renameFolder(f)}
                  className="text-[var(--c-muted)] opacity-0 transition hover:text-[var(--c-text)] group-hover:opacity-100"
                  title="Rename folder"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => deleteFolder(f)}
                  className="text-[var(--c-muted)] opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                  title="Delete folder"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {!isCollapsed && (
                <div className="ml-2 border-l border-[var(--c-border)] pl-1">
                  {fChannels.map(channelRow)}
                  {fBoards.map(boardRow)}
                  {count === 0 && (
                    <div className="px-2 py-1 text-xs italic text-[var(--c-muted)] opacity-70">
                      Drag items here
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped channels */}
        {ungroupedChannels.map(channelRow)}

        {/* Ungrouped boards */}
        {ungroupedBoards.length > 0 && (
          <div className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
            Boards
          </div>
        )}
        {ungroupedBoards.map(boardRow)}

        {/* DMs */}
        {dms.length > 0 && (
          <div className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
            Direct messages
          </div>
        )}
        {dms.map((d) => {
          const k = `dm:${d.id}`;
          return (
            <button
              key={d.id}
              onClick={() => go({ type: "dm", id: d.id })}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                active === k
                  ? "bg-[var(--c-accent-soft)]"
                  : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
              }`}
            >
              <Dot color={d.online ? "#34d399" : "#475569"} />
              <span className="truncate">{d.with}</span>
              {unread[k] > 0 && active !== k && (
                <span className="ml-auto rounded-full bg-[var(--c-accent)] px-1.5 text-xs text-white">
                  {unread[k]}
                </span>
              )}
            </button>
          );
        })}

        {/* Members */}
        <div className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
          Members — {members.filter((m) => m.online).length} online
        </div>
        {others.map((m) => (
          <button
            key={m.name}
            onClick={() => {
              openDm(m.name);
              onNavigate();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)]"
          >
            <Dot color={m.online ? "#34d399" : "#475569"} />
            <span
              className="max-w-[7rem] shrink-0 truncate"
              style={{ color: m.online ? "var(--c-text)" : undefined }}
            >
              {m.name}
            </span>
            {m.is_admin && <Shield size={12} className="shrink-0 text-amber-400" />}
            {m.status && (
              <span className="truncate text-xs opacity-70" title={m.status}>
                {m.status}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Footer nav */}
      <div className="border-t border-[var(--c-border)] p-2">
        <NavBtn
          icon={<HardDrive size={16} />}
          label="Files"
          active={view.type === "drive"}
          onClick={() => go({ type: "drive" })}
        />
        <NavBtn
          icon={<SettingsIcon size={16} />}
          label="Settings"
          active={view.type === "settings"}
          onClick={() => go({ type: "settings" })}
        />
        {user?.is_admin && (
          <NavBtn
            icon={<Shield size={16} />}
            label="Admin"
            active={view.type === "admin"}
            onClick={() => go({ type: "admin" })}
          />
        )}
        <button
          onClick={() => go({ type: "settings" })}
          className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--c-elevated)]"
        >
          <Dot color={user?.color || "#6366f1"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-sm font-medium">{user?.name}</span>
              {user?.is_admin && <Shield size={12} className="text-amber-400" />}
            </div>
            <div className="truncate text-xs text-[var(--c-muted)]">
              {me?.status || "Set a status…"}
            </div>
          </div>
          <span
            className="text-[var(--c-muted)] hover:text-red-300"
            onClick={(e) => {
              e.stopPropagation();
              logout();
            }}
            title="Log out"
          >
            <LogOut size={16} />
          </span>
        </button>
      </div>
    </aside>
  );
}

function NavBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
        active
          ? "bg-[var(--c-accent-soft)] text-[var(--c-text)]"
          : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
