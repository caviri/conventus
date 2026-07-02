import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { createCollab } from "../collab";
import { caretCoords } from "../caret";
import type { Board, BingoCell, GameState } from "../types";
import {
  Grid3x3,
  Megaphone,
  PartyPopper,
  RotateCcw,
  Loader2,
} from "lucide-react";

// Self-marked "event bingo". The word list is drafted together in the board's
// Yjs doc — everyone types into the same list, canvas-style — then the host
// publishes and each player gets their own deterministic shuffled 5×5 card.

const SIZE = 5;
const CELLS = SIZE * SIZE;

// All winning lines as index sets: 5 rows, 5 columns, 2 diagonals.
const LINES: number[][] = [
  ...Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => r * SIZE + c)),
  ...Array.from({ length: SIZE }, (_, c) => Array.from({ length: SIZE }, (_, r) => r * SIZE + c)),
  Array.from({ length: SIZE }, (_, i) => i * SIZE + i),
  Array.from({ length: SIZE }, (_, i) => i * SIZE + (SIZE - 1 - i)),
];

function hasLine(marked: Set<number>): boolean {
  return LINES.some((line) => line.every((i) => marked.has(i)));
}

// Scale the tile font down as the entry gets longer, so short words stay bold
// and full sentences ("Bob scratches his nose") still fit inside the square.
function fitClass(text: string): string {
  const n = text.length;
  if (n <= 10) return "text-sm sm:text-base";
  if (n <= 18) return "text-xs sm:text-sm";
  if (n <= 32) return "text-[10px] leading-snug sm:text-xs";
  return "text-[9px] leading-snug sm:text-[11px]";
}

// Minimal text-diff so concurrent edits don't clobber each other (same trick
// as the canvas): apply only the changed span to the shared Y.Text.
function diff(oldStr: string, newStr: string) {
  let start = 0;
  const min = Math.min(oldStr.length, newStr.length);
  while (start < min && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, remove: oldEnd - start, insert: newStr.slice(start, newEnd) };
}

function distinctWords(text: string): number {
  return new Set(
    text
      .split("\n")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

export default function BingoGame({ board, game }: { board: Board; game: GameState }) {
  return game.status === "setup" ? (
    <BingoSetup board={board} game={game} />
  ) : (
    <BingoPlay board={board} game={game} />
  );
}

// --- Setup: everyone drafts the word list together ------------------------

interface RemoteCursor {
  id: number;
  name: string;
  color: string;
  index: number;
}

function BingoSetup({ board, game }: { board: Board; game: GameState }) {
  const user = useStore((s) => s.user);
  const refreshGame = useStore((s) => s.refreshGame);
  const collab = useMemo(() => createCollab(board.doc), [board.doc]);
  const ytext = useMemo(() => collab.doc.getText("words"), [collab]);
  const yopts = useMemo(() => collab.doc.getMap("options"), [collab]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [freeSpace, setFreeSpace] = useState(() => yopts.get("free_space") !== false);
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function publishCursor() {
    const ta = taRef.current;
    if (ta) collab.awareness.setLocalStateField("cursor", { index: ta.selectionStart });
  }

  useEffect(() => {
    collab.awareness.setLocalStateField("user", {
      name: user?.name,
      color: user?.color,
    });

    const updateAwareness = () => {
      const others: { name: string; color: string }[] = [];
      const remote: RemoteCursor[] = [];
      collab.awareness.getStates().forEach((s: any, id: number) => {
        if (id === collab.doc.clientID || !s.user) return;
        others.push(s.user);
        if (s.cursor && typeof s.cursor.index === "number") {
          remote.push({ id, name: s.user.name, color: s.user.color, index: s.cursor.index });
        }
      });
      setPeers(others);
      setCursors(remote);
    };
    collab.awareness.on("change", updateAwareness);
    updateAwareness();

    const textObserver = (_event: unknown, tr: { origin: unknown }) => {
      if (tr.origin === "local") return;
      const ta = taRef.current;
      const next = ytext.toString();
      if (ta && document.activeElement === ta) {
        const pos = ta.selectionStart;
        setValue(next);
        requestAnimationFrame(() => {
          try {
            ta.selectionStart = ta.selectionEnd = Math.min(pos, next.length);
          } catch {
            /* ignore */
          }
        });
      } else {
        setValue(next);
      }
    };
    ytext.observe(textObserver);
    setValue(ytext.toString());

    const optsObserver = () => setFreeSpace(yopts.get("free_space") !== false);
    yopts.observe(optsObserver);
    optsObserver();

    return () => {
      ytext.unobserve(textObserver);
      yopts.unobserve(optsObserver);
      collab.awareness.off("change", updateAwareness);
      collab.destroy();
    };
  }, [collab, ytext, yopts, user]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const cur = ytext.toString();
    setValue(next);
    if (next !== cur) {
      const d = diff(cur, next);
      collab.doc.transact(() => {
        if (d.remove) ytext.delete(d.start, d.remove);
        if (d.insert) ytext.insert(d.start, d.insert);
      }, "local");
    }
    publishCursor();
  }

  function toggleFreeSpace(checked: boolean) {
    setFreeSpace(checked);
    collab.doc.transact(() => yopts.set("free_space", checked), "local");
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await api.post(`/api/games/${board.id}/publish`);
      await refreshGame(board.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open the game");
    } finally {
      setPublishing(false);
    }
  }

  const wordCount = distinctWords(value);
  const needed = freeSpace ? CELLS - 1 : CELLS;
  const ta = taRef.current;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-2xl">
        <div className="card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Draft the game together</h2>
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
          </div>
          <p className="mb-3 text-sm text-[var(--c-muted)]">
            One word or phrase per line — everyone can add to the list, live.
            When it's ready, {game.is_host ? "hit Open game" : "the host opens the game"} and
            each player gets their own shuffled 5×5 card.
          </p>

          <div className="relative">
            <textarea
              ref={taRef}
              value={value}
              onChange={onChange}
              onSelect={publishCursor}
              rows={12}
              spellCheck={false}
              placeholder={"Buzzword bingo!\nLet's circle back\nSynergy\nLow-hanging fruit\n…"}
              className="w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 font-mono text-sm outline-none focus:border-[var(--c-accent)]"
            />
            {/* Remote carets overlay */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {ta &&
                cursors.map((c) => {
                  const at = caretCoords(ta, Math.min(c.index, value.length));
                  const top = at.top - ta.scrollTop;
                  const left = at.left - ta.scrollLeft;
                  if (top < -20 || top > ta.clientHeight) return null;
                  return (
                    <div key={c.id} style={{ position: "absolute", left, top }}>
                      <div style={{ width: 2, height: at.height, background: c.color }} />
                      <div
                        className="absolute whitespace-nowrap rounded px-1 text-[10px] font-medium text-white"
                        style={{ background: c.color, top: -14, left: 0 }}
                      >
                        {c.name}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={freeSpace}
              onChange={(e) => toggleFreeSpace(e.target.checked)}
            />
            FREE center square
          </label>

          {error && (
            <div className="mt-3 rounded-[var(--radius)] border border-red-400/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <span
              className={`text-sm ${
                wordCount >= needed ? "text-[var(--c-accent-2)]" : "text-[var(--c-muted)]"
              }`}
            >
              {wordCount} / {needed} words
            </span>
            {game.is_host ? (
              <button
                className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
                disabled={wordCount < needed || publishing}
                onClick={publish}
              >
                {publishing ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Megaphone size={16} />
                )}
                Open game
              </button>
            ) : (
              <span className="text-sm italic text-[var(--c-muted)]">
                {game.created_by || "The host"} opens the game when the list is ready
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Play: everyone marks their own card; first valid line wins -----------

function BingoPlay({ board, game }: { board: Board; game: GameState }) {
  const user = useStore((s) => s.user);
  const refreshGame = useStore((s) => s.refreshGame);
  const [card, setCard] = useState<BingoCell[] | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch this player's card once per game round; the free square starts
  // marked. A reset unmounts this component, so a republished game refetches.
  useEffect(() => {
    let alive = true;
    api
      .get<{ cells: BingoCell[] }>(`/api/games/${board.id}/view`)
      .then((c) => {
        if (!alive) return;
        setCard(c.cells);
        setMarked(new Set(c.cells.flatMap((cell, i) => (cell.free ? [i] : []))));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [board.id]);

  const won = useMemo(() => hasLine(marked), [marked]);
  const alreadyWon = !!game.winner;

  function toggle(i: number) {
    if (!card || alreadyWon) return;
    if (card[i].free) return; // the free square stays marked
    setMarked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function callBingo() {
    setClaiming(true);
    setError(null);
    try {
      await api.post(`/api/games/${board.id}/win`, { data: { marked: [...marked] } });
      await refreshGame(board.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't claim bingo");
    } finally {
      setClaiming(false);
    }
  }

  async function playAgain() {
    setError(null);
    await api.post(`/api/games/${board.id}/reset`);
    await refreshGame(board.id);
  }

  if (!card) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--c-muted)]">
        <Loader2 className="mr-2 animate-spin" size={18} /> Dealing your card…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-2xl">
        {error && (
          <div className="card mb-4 border border-red-400/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {game.winner && (
          <div className="card mb-4 flex items-center gap-3 border border-[var(--c-accent)]/50 px-4 py-3">
            <PartyPopper size={22} className="text-[var(--c-accent)]" />
            <div className="font-display text-lg font-semibold">
              {game.winner === user?.name
                ? "🎉 Bingo! You won!"
                : `🎉 ${game.winner} got bingo!`}
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-2">
          {card.map((cell, i) => {
            const isMarked = marked.has(i);
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                disabled={cell.free || alreadyWon}
                className={`flex aspect-square items-center justify-center overflow-hidden hyphens-auto break-words rounded-[var(--radius)] border p-1.5 text-center font-medium leading-tight transition-colors ${fitClass(
                  cell.text
                )} ${
                  isMarked
                    ? "border-transparent bg-[var(--c-accent)] text-[var(--c-bg)]"
                    : "border-[var(--c-border)] bg-[var(--c-surface-2)] hover:bg-[var(--c-elevated)]"
                } ${cell.free ? "italic" : ""}`}
              >
                {cell.text}
              </button>
            );
          })}
        </div>

        {game.status === "live" && (
          <div className="mt-4 flex justify-center">
            <button
              className="btn btn-primary flex items-center gap-2 px-6 disabled:opacity-50"
              disabled={!won || claiming}
              onClick={callBingo}
            >
              {claiming ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <PartyPopper size={16} />
              )}
              {won ? "Bingo!" : "Complete a line to call bingo"}
            </button>
          </div>
        )}

        {game.is_host && (
          <div className="mt-4 flex justify-center">
            <button className="btn flex items-center gap-2" onClick={playAgain}>
              {game.status === "done" ? (
                <>
                  <RotateCcw size={15} /> Play again
                </>
              ) : (
                <>
                  <Grid3x3 size={15} /> Back to setup
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
