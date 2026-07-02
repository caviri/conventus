"""Per-game-type rules for game boards (kind = ``game``).

A game lives on a board and moves through ``setup → live → done``. During setup
the room drafts the game together in the board's Yjs doc (a ``words`` text plus
an ``options`` map); publishing freezes that draft into the game row's ``config``
and play begins. Each game type defines how to build its config from the draft,
what a player sees, and how to judge a win claim.

Adding a game type: subclass ``GameType``, implement the three hooks, and add an
instance to ``GAME_TYPES``. The frontend needs a matching component dispatched
from ``Game.tsx``.
"""
from __future__ import annotations

from typing import Any


class GameError(ValueError):
    """A rule violation, surfaced to the client as a 400."""


class GameType:
    name = ""

    def build_config(self, draft: dict[str, Any]) -> dict[str, Any]:
        """Validate and freeze the setup draft into the published config."""
        raise NotImplementedError

    def player_view(self, board_id: int, player: str, config: dict[str, Any]) -> dict[str, Any]:
        """What this player sees once the game is live (their hand/card/role)."""
        raise NotImplementedError

    def judge_win(self, board_id: int, player: str, config: dict[str, Any], data: dict[str, Any]) -> None:
        """Raise GameError unless the claim in ``data`` is a valid win."""
        raise NotImplementedError


# --- Bingo -----------------------------------------------------------------
# Self-marked "event bingo": everyone gets their own shuffled 5x5 card drawn
# from a shared word list and clicks items as they spot them; marking is on the
# honor system, but a claimed line must at least be a geometric line.

SIZE = 5
CELLS = SIZE * SIZE
CENTER = CELLS // 2  # index 12 — the FREE cell

# Winning index sets: 5 rows, 5 columns, 2 diagonals.
LINES: list[list[int]] = (
    [[r * SIZE + c for c in range(SIZE)] for r in range(SIZE)]
    + [[r * SIZE + c for r in range(SIZE)] for c in range(SIZE)]
    + [[i * SIZE + i for i in range(SIZE)]]
    + [[i * SIZE + (SIZE - 1 - i) for i in range(SIZE)]]
)


def _shuffled(words: list[str], board_id: int, name: str) -> list[str]:
    """Fisher-Yates shuffle seeded with FNV-1a(board_id:name) → mulberry32 PRNG.
    Deterministic, so cards survive a refresh and nothing per-player is stored."""
    state = 0x811C9DC5
    for ch in f"{board_id}:{name}".encode():
        state = ((state ^ ch) * 0x01000193) & 0xFFFFFFFF

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 0x100000000

    out = list(words)
    for i in range(len(out) - 1, 0, -1):
        j = int(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def _has_line(marked: set[int]) -> bool:
    return any(all(i in marked for i in line) for line in LINES)


class Bingo(GameType):
    name = "bingo"

    def build_config(self, draft: dict[str, Any]) -> dict[str, Any]:
        free_space = bool(draft.get("options", {}).get("free_space", True))
        # Trim, drop blanks, and dedupe case-insensitively while keeping order.
        seen: set[str] = set()
        words: list[str] = []
        for w in (line.strip() for line in draft.get("text", "").splitlines()):
            if w and w.lower() not in seen:
                seen.add(w.lower())
                words.append(w)
        need = CELLS - (1 if free_space else 0)
        if len(words) < need:
            raise GameError(f"Need at least {need} distinct words ({len(words)} so far)")
        return {"words": words, "free_space": free_space}

    def player_view(self, board_id: int, player: str, config: dict[str, Any]) -> dict[str, Any]:
        pool = iter(_shuffled(config["words"], board_id, player))
        cells = [
            {"text": "FREE", "free": True}
            if config.get("free_space") and i == CENTER
            else {"text": next(pool), "free": False}
            for i in range(CELLS)
        ]
        return {"cells": cells}

    def judge_win(self, board_id: int, player: str, config: dict[str, Any], data: dict[str, Any]) -> None:
        marked = {i for i in data.get("marked", []) if isinstance(i, int) and 0 <= i < CELLS}
        if config.get("free_space"):
            marked.add(CENTER)
        if not _has_line(marked):
            raise GameError("That's not a completed line yet")


GAME_TYPES: dict[str, GameType] = {g.name: g for g in [Bingo()]}
