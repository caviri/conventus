import { useStore } from "../store";
import { api } from "../api";
import { Pencil, Trash2 } from "lucide-react";

// Rename / delete controls shown in a board's header. Anyone can rename;
// only admins can delete (which wipes the board's contents for everyone).
export default function BoardActions({ id, name }: { id: number; name: string }) {
  const user = useStore((s) => s.user);
  const channels = useStore((s) => s.channels);
  const setView = useStore((s) => s.setView);
  const refreshBoards = useStore((s) => s.refreshBoards);

  async function rename() {
    const next = window.prompt("Rename board", name)?.trim();
    if (!next || next === name) return;
    await api.patch(`/api/boards/${id}`, { name: next });
    await refreshBoards();
  }

  async function remove() {
    if (!window.confirm(`Delete “${name}”? This removes its contents for everyone.`))
      return;
    await api.del(`/api/boards/${id}`);
    await refreshBoards();
    if (channels[0]) setView({ type: "channel", id: channels[0].id });
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={rename}
        title="Rename board"
        className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
      >
        <Pencil size={13} />
      </button>
      {user?.is_admin && (
        <button
          onClick={remove}
          title="Delete board"
          className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-red-300"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
