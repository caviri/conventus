import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import BoardActions from "./BoardActions";
import type { BingoCell } from "../types";
import { Grid3x3, Play, RotateCcw, PartyPopper, Loader2 } from "lucide-react";

// Self-marked "event bingo": every player gets their own randomized card (built
// server-side) and clicks items as they spot them; first to a line wins.

const SIZE = 5;
const CELLS = SIZE * SIZE;
const CENTER = (CELLS - 1) / 2;

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

export default function Bingo({ id, title }: { id: number; title: string }) {
  const user = useStore((s) => s.user);
  const game = useStore((s) => s.bingoGames[id]);
  const refreshBingo = useStore((s) => s.refreshBingo);

  const [loading, setLoading] = useState(!game);
  const [error, setError] = useState<string | null>(null);

  // Host setup form.
  const [draft, setDraft] = useState("");
  const [freeSpace, setFreeSpace] = useState(true);
  const [saving, setSaving] = useState(false);

  // Live play state.
  const [card, setCard] = useState<BingoCell[] | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [claiming, setClaiming] = useState(false);

  // Load on mount and when switching between bingo boards.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    refreshBingo(id)
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, refreshBingo]);

  // Seed the setup form from the saved game once it loads.
  useEffect(() => {
    if (game && game.status === "setup") {
      setDraft(game.words.join("\n"));
      setFreeSpace(game.free_space);
    }
  }, [game?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch this player's card once the game is live; the free square starts marked.
  useEffect(() => {
    if (!game || game.status === "setup") {
      setCard(null);
      setMarked(new Set());
      return;
    }
    let alive = true;
    api
      .get<{ cells: BingoCell[] }>(`/api/bingo/${id}/card`)
      .then((c) => {
        if (!alive) return;
        setCard(c.cells);
        setMarked(new Set(c.cells.flatMap((cell, i) => (cell.free ? [i] : []))));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [game?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const wordCount = useMemo(
    () => new Set(draft.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)).size,
    [draft]
  );
  const needed = freeSpace ? CELLS - 1 : CELLS;
  const enoughWords = wordCount >= needed;

  const won = useMemo(() => hasLine(marked), [marked]);
  const alreadyWon = !!game?.winner;

  async function saveAndStart() {
    setSaving(true);
    setError(null);
    try {
      const words = draft.split("\n").map((w) => w.trim()).filter(Boolean);
      await api.put(`/api/bingo/${id}`, { words, free_space: freeSpace });
      await api.post(`/api/bingo/${id}/start`);
      await refreshBingo(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the game");
    } finally {
      setSaving(false);
    }
  }

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
      await api.post(`/api/bingo/${id}/win`, { marked: [...marked] });
      await refreshBingo(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't claim bingo");
    } finally {
      setClaiming(false);
    }
  }

  async function playAgain() {
    setError(null);
    await api.post(`/api/bingo/${id}/reset`);
    await refreshBingo(id);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Grid3x3 size={18} className="text-[var(--c-accent)]" />
        <div className="font-semibold">{title}</div>
        <BoardActions id={id} name={title} />
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading || !game ? (
          <div className="flex h-full items-center justify-center text-[var(--c-muted)]">
            <Loader2 className="mr-2 animate-spin" size={18} /> Loading…
          </div>
        ) : (
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

            {/* Setup */}
            {game.status === "setup" &&
              (game.is_host ? (
                <div className="card p-4">
                  <h2 className="font-display mb-1 text-xl font-semibold">Set up the game</h2>
                  <p className="mb-3 text-sm text-[var(--c-muted)]">
                    Add one word or phrase per line. Each player gets their own
                    randomized 5×5 card drawn from this list.
                  </p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={12}
                    placeholder={"Buzzword bingo!\nLet's circle back\nSynergy\nLow-hanging fruit\n…"}
                    className="w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 font-mono text-sm outline-none focus:border-[var(--c-accent)]"
                  />
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={freeSpace}
                      onChange={(e) => setFreeSpace(e.target.checked)}
                    />
                    FREE center square
                  </label>
                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className={`text-sm ${enoughWords ? "text-[var(--c-accent-2)]" : "text-[var(--c-muted)]"}`}
                    >
                      {wordCount} / {needed} words
                    </span>
                    <button
                      className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
                      disabled={!enoughWords || saving}
                      onClick={saveAndStart}
                    >
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                      Start game
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card p-8 text-center text-[var(--c-muted)]">
                  <Grid3x3 size={32} className="mx-auto mb-3 text-[var(--c-accent)]" />
                  Waiting for the host to start the game…
                </div>
              ))}

            {/* Playing */}
            {game.status !== "setup" && card && (
              <>
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
                      <RotateCcw size={15} />
                      {game.status === "done" ? "Play again" : "Reset game"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
