import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { useStore } from "../store";
import { api } from "../api";
import { createCollab } from "../collab";
import BoardActions from "./BoardActions";
import {
  Columns3,
  Table2,
  List as ListIcon,
  Plus,
  Trash2,
  X,
  ImagePlus,
  Tag,
  Calendar,
  Link2,
  Loader2,
  Maximize2,
} from "lucide-react";

function uid() {
  return (
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

type ViewMode = "board" | "table" | "list";

interface Col {
  id: string;
  title: string;
  y: Y.Map<any>;
}
interface Card {
  id: string;
  col: string;
  text: string;
  image?: string;
  tags?: string;
  assignee?: string;
  due?: string;
  link?: string;
  y: Y.Map<any>;
}

function tagList(tags?: string): string[] {
  return (tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// Relative urgency for a due date, used to colour the badge.
function dueMeta(due?: string): { label: string; cls: string } | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  let cls = "text-[var(--c-muted)]";
  if (days < 0) cls = "text-red-400";
  else if (days <= 2) cls = "text-amber-400";
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, cls };
}

export default function Kanban({
  id,
  name,
  title,
}: {
  id: number;
  name: string;
  title: string;
}) {
  const user = useStore((s) => s.user);
  const members = useStore((s) => s.members);
  const collab = useMemo(() => createCollab(name), [name]);
  const columns = useMemo(() => collab.doc.getArray<Y.Map<any>>("columns"), [collab]);
  const cards = useMemo(() => collab.doc.getArray<Y.Map<any>>("cards"), [collab]);
  const [, tick] = useState(0);
  const [view, setView] = useState<ViewMode>("board");
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const memberColor = (n?: string) =>
    members.find((m) => m.name === n)?.color || "#64748b";

  useEffect(() => {
    collab.awareness.setLocalStateField("user", {
      name: user?.name,
      color: user?.color,
    });
    const updatePeers = () =>
      setPeers(
        Array.from(collab.awareness.getStates().entries())
          .filter(([cid]) => cid !== collab.doc.clientID)
          .map(([, s]: any) => s.user)
          .filter(Boolean)
      );
    collab.awareness.on("change", updatePeers);
    updatePeers();
    const rerender = () => tick((t) => t + 1);
    columns.observeDeep(rerender);
    cards.observeDeep(rerender);
    rerender();
    return () => {
      columns.unobserveDeep(rerender);
      cards.unobserveDeep(rerender);
      collab.awareness.off("change", updatePeers);
      collab.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab, columns, cards, user]);

  const colList: Col[] = columns
    .toArray()
    .map((c) => ({ id: c.get("id"), title: c.get("title"), y: c }));
  const cardList: Card[] = cards.toArray().map((c) => ({
    id: c.get("id"),
    col: c.get("col"),
    text: c.get("text"),
    image: c.get("image"),
    tags: c.get("tags"),
    assignee: c.get("assignee"),
    due: c.get("due"),
    link: c.get("link"),
    y: c,
  }));
  const cardsOf = (colId: string) => cardList.filter((c) => c.col === colId);

  function addColumn(t: string) {
    const m = new Y.Map();
    m.set("id", uid());
    m.set("title", t.trim() || "New list");
    columns.push([m]);
  }
  function deleteColumn(col: Col) {
    if (!confirm(`Delete list “${col.title}” and its cards?`)) return;
    collab.doc.transact(() => {
      for (let i = cards.length - 1; i >= 0; i--) {
        if (cards.get(i).get("col") === col.id) cards.delete(i, 1);
      }
      const idx = colList.findIndex((c) => c.id === col.id);
      if (idx >= 0) columns.delete(idx, 1);
    });
  }
  function addCard(colId: string, text: string) {
    if (!text.trim()) return;
    const m = new Y.Map();
    m.set("id", uid());
    m.set("col", colId);
    m.set("text", text.trim());
    cards.push([m]);
  }
  function setCardField(cardId: string, key: string, value: string) {
    for (let i = 0; i < cards.length; i++) {
      if (cards.get(i).get("id") === cardId) {
        cards.get(i).set(key, value);
        return;
      }
    }
  }
  function deleteCard(cardId: string) {
    for (let i = 0; i < cards.length; i++) {
      if (cards.get(i).get("id") === cardId) {
        cards.delete(i, 1);
        if (openCard === cardId) setOpenCard(null);
        return;
      }
    }
  }

  const openCardObj = openCard ? cardList.find((c) => c.id === openCard) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Columns3 size={18} className="text-[var(--c-muted)]" />
        <div className="font-display text-lg font-semibold">{title}</div>
        <BoardActions id={id} name={title} />

        <div className="ml-auto flex items-center gap-1 rounded-lg bg-[var(--c-elevated)] p-0.5">
          {([
            ["board", Columns3],
            ["table", Table2],
            ["list", ListIcon],
          ] as const).map(([v, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs capitalize transition ${
                view === v ? "bg-[var(--c-surface-2)] text-[var(--c-text)]" : "text-[var(--c-muted)]"
              }`}
            >
              <Icon size={13} /> {v}
            </button>
          ))}
        </div>
        <div className="flex -space-x-2">
          {peers.map((p, i) => (
            <span
              key={i}
              title={p.name}
              className="grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--c-surface)] text-xs font-semibold text-white"
              style={{ background: p.color }}
            >
              {p.name?.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      </header>

      {view === "board" && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {colList.map((col) => (
            <div
              key={col.id}
              className="flex max-h-full w-72 shrink-0 flex-col rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId.current && setCardField(dragId.current, "col", col.id)}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  className="flex-1 bg-transparent text-sm font-semibold outline-none"
                  value={col.title}
                  onChange={(e) => col.y.set("title", e.target.value)}
                />
                <span className="text-xs text-[var(--c-muted)]">{cardsOf(col.id).length}</span>
                <button
                  className="text-[var(--c-muted)] hover:text-red-300"
                  onClick={() => deleteColumn(col)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {cardsOf(col.id).map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => (dragId.current = card.id)}
                    className="group card cursor-grab p-2 text-sm active:cursor-grabbing"
                  >
                    {card.image && (
                      <img
                        src={card.image}
                        alt=""
                        className="mb-2 max-h-32 w-full rounded-lg object-cover"
                      />
                    )}
                    <div className="flex items-start gap-1">
                      <textarea
                        className="min-h-[1.2em] w-full resize-none bg-transparent outline-none"
                        rows={1}
                        value={card.text}
                        onChange={(e) => {
                          setCardField(card.id, "text", e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = e.target.scrollHeight + "px";
                        }}
                      />
                      <button
                        className="text-[var(--c-muted)] opacity-0 transition hover:text-[var(--c-text)] group-hover:opacity-100"
                        title="Card details"
                        onClick={() => setOpenCard(card.id)}
                      >
                        <Maximize2 size={13} />
                      </button>
                      <button
                        className="text-[var(--c-muted)] opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                        onClick={() => deleteCard(card.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <CardMeta card={card} memberColor={memberColor} />
                  </div>
                ))}
                <AddCard onAdd={(t) => addCard(col.id, t)} />
              </div>
            </div>
          ))}
          <AddColumn onAdd={addColumn} />
        </div>
      )}

      {view === "table" && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--c-muted)]">
                <th className="border-b border-[var(--c-border)] p-2">Pic</th>
                <th className="border-b border-[var(--c-border)] p-2">Card</th>
                <th className="border-b border-[var(--c-border)] p-2">Keywords</th>
                <th className="border-b border-[var(--c-border)] p-2">Assignee</th>
                <th className="border-b border-[var(--c-border)] p-2">Due</th>
                <th className="border-b border-[var(--c-border)] p-2">Link</th>
                <th className="border-b border-[var(--c-border)] p-2">List</th>
                <th className="border-b border-[var(--c-border)] p-2"></th>
              </tr>
            </thead>
            <tbody>
              {cardList.map((card) => (
                <tr key={card.id} className="align-middle hover:bg-[var(--c-hover)]">
                  <td className="border-b border-[var(--c-border)] p-2">
                    <button
                      className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-[var(--c-elevated)] text-[var(--c-muted)]"
                      title="Add or change image"
                      onClick={() => setOpenCard(card.id)}
                    >
                      {card.image ? (
                        <img src={card.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus size={15} />
                      )}
                    </button>
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <input
                      className="w-full min-w-[10rem] bg-transparent outline-none"
                      value={card.text}
                      onChange={(e) => setCardField(card.id, "text", e.target.value)}
                    />
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <input
                      className="w-full min-w-[8rem] bg-transparent outline-none"
                      placeholder="tag, tag"
                      value={card.tags || ""}
                      onChange={(e) => setCardField(card.id, "tags", e.target.value)}
                    />
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <select
                      className="input !py-1"
                      value={card.assignee || ""}
                      onChange={(e) => setCardField(card.id, "assignee", e.target.value)}
                    >
                      <option value="">—</option>
                      {members.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <input
                      type="date"
                      className="input !py-1"
                      value={card.due || ""}
                      onChange={(e) => setCardField(card.id, "due", e.target.value)}
                    />
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <input
                      className="w-full min-w-[8rem] bg-transparent outline-none"
                      placeholder="https://…"
                      value={card.link || ""}
                      onChange={(e) => setCardField(card.id, "link", e.target.value)}
                    />
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2">
                    <select
                      className="input !py-1"
                      value={card.col}
                      onChange={(e) => setCardField(card.id, "col", e.target.value)}
                    >
                      {colList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-[var(--c-border)] p-2 text-right">
                    <button
                      className="text-[var(--c-muted)] hover:text-red-300"
                      onClick={() => deleteCard(card.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cardList.length === 0 && (
            <p className="p-4 text-sm text-[var(--c-muted)]">
              No cards yet — switch to Board view to add lists and cards.
            </p>
          )}
        </div>
      )}

      {view === "list" && (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {colList.map((col) => (
            <div key={col.id}>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                {col.title}
                <span className="text-xs text-[var(--c-muted)]">
                  {cardsOf(col.id).length}
                </span>
              </div>
              <div className="space-y-1">
                {cardsOf(col.id).map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] px-3 py-1.5 text-sm"
                  >
                    {card.image && (
                      <img
                        src={card.image}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                    )}
                    <button
                      className="flex-1 truncate text-left"
                      onClick={() => setOpenCard(card.id)}
                    >
                      {card.text || <em className="text-[var(--c-muted)]">empty</em>}
                    </button>
                    <CardMeta card={card} memberColor={memberColor} />
                    <button
                      className="text-[var(--c-muted)] hover:text-red-300"
                      onClick={() => deleteCard(card.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {cardsOf(col.id).length === 0 && (
                  <div className="text-xs text-[var(--c-muted)]">No cards.</div>
                )}
              </div>
            </div>
          ))}
          {colList.length === 0 && (
            <p className="text-sm text-[var(--c-muted)]">No lists yet.</p>
          )}
        </div>
      )}

      {openCardObj && (
        <CardModal
          card={openCardObj}
          colList={colList}
          members={members}
          memberColor={memberColor}
          setField={(k, v) => setCardField(openCardObj.id, k, v)}
          onDelete={() => deleteCard(openCardObj.id)}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}

// Compact meta strip shown on board cards and list rows.
function CardMeta({
  card,
  memberColor,
}: {
  card: Card;
  memberColor: (n?: string) => string;
}) {
  const tags = tagList(card.tags);
  const due = dueMeta(card.due);
  if (!tags.length && !card.assignee && !due && !card.link) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full bg-[var(--c-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-accent)]"
        >
          {t}
        </span>
      ))}
      {card.link && (
        <a
          href={card.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--c-muted)] hover:text-[var(--c-accent)]"
          title={card.link}
        >
          <Link2 size={13} />
        </a>
      )}
      {due && (
        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${due.cls}`}>
          <Calendar size={11} /> {due.label}
        </span>
      )}
      {card.assignee && (
        <span
          title={card.assignee}
          className="ml-auto grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: memberColor(card.assignee) }}
        >
          {card.assignee.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function CardModal({
  card,
  colList,
  members,
  memberColor,
  setField,
  onDelete,
  onClose,
}: {
  card: Card;
  colList: Col[];
  members: { name: string; color: string }[];
  memberColor: (n?: string) => string;
  setField: (key: string, value: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    setBusy(true);
    try {
      const up = await api.upload(file);
      setField("image", up.url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-[var(--c-border)] px-4 py-3">
          <Columns3 size={16} className="text-[var(--c-muted)]" />
          <span className="text-sm font-semibold">Card details</span>
          <button className="btn ml-auto !p-2" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <textarea
            className="input min-h-[3em] resize-none text-sm"
            placeholder="Card text"
            value={card.text}
            onChange={(e) => setField("text", e.target.value)}
          />

          {/* Picture */}
          <div>
            <Label icon={<ImagePlus size={13} />}>Picture</Label>
            {card.image ? (
              <div className="relative">
                <img
                  src={card.image}
                  alt=""
                  className="max-h-56 w-full rounded-lg object-cover"
                />
                <button
                  className="btn absolute right-2 top-2 !p-1.5"
                  onClick={() => setField("image", "")}
                  title="Remove image"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button
                className="btn w-full justify-center text-xs"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                Upload an image
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {/* Keywords */}
          <div>
            <Label icon={<Tag size={13} />}>Keywords</Label>
            <input
              className="input text-sm"
              placeholder="design, urgent, backend"
              value={card.tags || ""}
              onChange={(e) => setField("tags", e.target.value)}
            />
            {tagList(card.tags).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tagList(card.tags).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--c-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--c-accent)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Assignee */}
            <div>
              <Label icon={<span className="text-[11px]">@</span>}>Assignee</Label>
              <div className="flex items-center gap-2">
                {card.assignee && (
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: memberColor(card.assignee) }}
                  >
                    {card.assignee.charAt(0).toUpperCase()}
                  </span>
                )}
                <select
                  className="input !py-1.5 text-sm"
                  value={card.assignee || ""}
                  onChange={(e) => setField("assignee", e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Due date */}
            <div>
              <Label icon={<Calendar size={13} />}>Due date</Label>
              <input
                type="date"
                className="input !py-1.5 text-sm"
                value={card.due || ""}
                onChange={(e) => setField("due", e.target.value)}
              />
            </div>
          </div>

          {/* Link */}
          <div>
            <Label icon={<Link2 size={13} />}>Link</Label>
            <input
              className="input text-sm"
              placeholder="https://…"
              value={card.link || ""}
              onChange={(e) => setField("link", e.target.value)}
            />
            {card.link && (
              <a
                href={card.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--c-accent)] hover:underline"
              >
                <Link2 size={12} /> Open link
              </a>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--c-border)] px-4 py-3">
          <button
            className="btn text-xs text-red-300 hover:bg-red-500/10"
            onClick={() => {
              if (confirm("Delete this card?")) onDelete();
            }}
          >
            <Trash2 size={14} /> Delete card
          </button>
          <button className="btn btn-primary text-xs" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Label({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
      {icon}
      {children}
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
        onClick={() => setOpen(true)}
      >
        <Plus size={13} /> Add a card
      </button>
    );
  return (
    <textarea
      autoFocus
      className="input min-h-[2.2em] resize-none text-sm"
      placeholder="Card text — Enter to add"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onAdd(text);
          setText("");
        }
        if (e.key === "Escape") setOpen(false);
      }}
      onBlur={() => {
        if (text.trim()) onAdd(text);
        setText("");
        setOpen(false);
      }}
    />
  );
}

function AddColumn({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="w-64 shrink-0">
      <div className="flex gap-1">
        <input
          className="input text-sm"
          placeholder="+ Add a list"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAdd(title);
              setTitle("");
            }
          }}
        />
        {title.trim() && (
          <button
            className="btn btn-primary !px-3"
            onClick={() => {
              onAdd(title);
              setTitle("");
            }}
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}
