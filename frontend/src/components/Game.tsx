import { useEffect, useState } from "react";
import { useStore } from "../store";
import BoardActions from "./BoardActions";
import BingoGame from "./BingoGame";
import type { Board } from "../types";
import { Dices, Loader2 } from "lucide-react";

// A game board: the room drafts the setup together, the host publishes, everyone
// plays. This shell loads the shared game state and dispatches to the component
// for the board's game type; new games plug in here.

const STATUS_LABEL = {
  setup: "setting up",
  live: "live",
  done: "finished",
} as const;

export default function Game({ board }: { board: Board }) {
  const game = useStore((s) => s.games[board.id]);
  const refreshGame = useStore((s) => s.refreshGame);
  const [loading, setLoading] = useState(!game);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    refreshGame(board.id)
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [board.id, refreshGame]);

  return (
    <div className="flex h-full flex-col">
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Dices size={18} className="text-[var(--c-accent)]" />
        <div className="font-semibold">{board.name}</div>
        {game && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              game.status === "live"
                ? "bg-[var(--c-accent)] text-[var(--c-bg)]"
                : "bg-[var(--c-elevated)] text-[var(--c-muted)]"
            }`}
          >
            {STATUS_LABEL[game.status]}
          </span>
        )}
        <BoardActions id={board.id} name={board.name} />
      </header>

      {loading || !game ? (
        <div className="flex flex-1 items-center justify-center text-[var(--c-muted)]">
          {error ? (
            error
          ) : (
            <>
              <Loader2 className="mr-2 animate-spin" size={18} /> Loading…
            </>
          )}
        </div>
      ) : game.game_type === "bingo" ? (
        <BingoGame board={board} game={game} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[var(--c-muted)]">
          Unknown game type “{game.game_type}” — update the app?
        </div>
      )}
    </div>
  );
}
