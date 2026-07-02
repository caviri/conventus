"""Bingo games — self-marked "event bingo" played on a board of kind ``bingo``.

A host fills a board with a word list and presses Start; every player then gets
their own randomized 5x5 card and clicks items as they spot them. The first to
complete any line (row, column, or diagonal) wins.

Cards are generated deterministically from ``(board_id, name)``, so they survive
a refresh and the server can regenerate one to validate a win — nothing
per-player is stored.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/bingo", tags=["bingo"])

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


# --- Deterministic per-player card generation -----------------------------

def _shuffled(words: list[str], board_id: int, name: str) -> list[str]:
    """Fisher-Yates shuffle seeded with FNV-1a(board_id:name) → mulberry32 PRNG."""
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


def _card(board_id: int, name: str, words: list[str], free_space: bool) -> list[dict]:
    """This player's 5x5 card as 25 ``{text, free}`` cells."""
    pool = iter(_shuffled(words, board_id, name))
    return [
        {"text": "FREE", "free": True}
        if free_space and i == CENTER
        else {"text": next(pool), "free": False}
        for i in range(CELLS)
    ]


def _has_line(marked: set[int]) -> bool:
    return any(all(i in marked for i in line) for line in LINES)


def _min_words(free_space: bool) -> int:
    return CELLS - (1 if free_space else 0)


# --- Game state -----------------------------------------------------------

def _board_or_404(board_id: int) -> dict:
    row = db.query_one("SELECT * FROM boards WHERE id = ? AND kind = 'bingo'", (board_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such bingo game")
    return row


def _game(board_id: int, owner: str) -> dict:
    """The game row, lazily created — the first viewer (the board's creator) becomes host."""
    row = db.query_one("SELECT * FROM bingo_games WHERE board_id = ?", (board_id,))
    if not row:
        db.execute("INSERT INTO bingo_games(board_id, created_by) VALUES (?, ?)", (board_id, owner))
        row = db.query_one("SELECT * FROM bingo_games WHERE board_id = ?", (board_id,))
    return row


def _is_host(row: dict, user: dict) -> bool:
    return row["created_by"] == user["name"] or bool(user.get("is_admin"))


def _public(row: dict) -> dict:
    """Shared game state — the shape both broadcast and returned to clients."""
    return {
        "board_id": row["board_id"],
        "words": db.loads(row["words"], []),
        "free_space": bool(row["free_space"]),
        "status": row["status"],
        "winner": row["winner"],
        "created_by": row["created_by"],
    }


def _response(row: dict, user: dict) -> dict:
    return {**_public(row), "is_host": _is_host(row, user)}


async def _publish(board_id: int, user: dict) -> dict:
    """Re-read the game, broadcast it to everyone, and return it to the caller."""
    row = db.query_one("SELECT * FROM bingo_games WHERE board_id = ?", (board_id,))
    await hub.broadcast("bingo.update", _public(row))
    return _response(row, user)


class BingoConfig(BaseModel):
    words: list[str] = Field(default_factory=list)
    free_space: bool = True


class BingoWin(BaseModel):
    marked: list[int] = Field(default_factory=list)


@router.get("/{board_id}")
async def get_game(board_id: int, user=Depends(current_user)):
    _board_or_404(board_id)
    return _response(_game(board_id, user["name"]), user)


@router.put("/{board_id}")
async def configure(board_id: int, req: BingoConfig, user=Depends(current_user)):
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if not _is_host(row, user):
        raise HTTPException(status_code=403, detail="Only the host can do that")
    if row["status"] != "setup":
        raise HTTPException(status_code=400, detail="Game already started — reset it first")
    # Trim, drop blanks, and dedupe case-insensitively while keeping order.
    seen: set[str] = set()
    words: list[str] = []
    for w in (w.strip() for w in req.words):
        if w and w.lower() not in seen:
            seen.add(w.lower())
            words.append(w)
    need = _min_words(req.free_space)
    if len(words) < need:
        raise HTTPException(status_code=400, detail=f"Need at least {need} distinct words ({len(words)} given)")
    db.execute(
        "UPDATE bingo_games SET words = ?, free_space = ? WHERE board_id = ?",
        (db.dumps(words), 1 if req.free_space else 0, board_id),
    )
    return await _publish(board_id, user)


@router.post("/{board_id}/start")
async def start(board_id: int, user=Depends(current_user)):
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if not _is_host(row, user):
        raise HTTPException(status_code=403, detail="Only the host can do that")
    if len(db.loads(row["words"], [])) < _min_words(bool(row["free_space"])):
        raise HTTPException(status_code=400, detail="Add a word list before starting")
    db.execute(
        "UPDATE bingo_games SET status = 'live', winner = NULL, started_at = ? WHERE board_id = ?",
        (db.now(), board_id),
    )
    return await _publish(board_id, user)


@router.get("/{board_id}/card")
async def get_card(board_id: int, user=Depends(current_user)):
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if row["status"] == "setup":
        raise HTTPException(status_code=400, detail="Game hasn't started yet")
    return {"cells": _card(board_id, user["name"], db.loads(row["words"], []), bool(row["free_space"]))}


@router.post("/{board_id}/win")
async def claim_win(board_id: int, req: BingoWin, user=Depends(current_user)):
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if row["status"] != "live":
        raise HTTPException(status_code=400, detail="Game is not live")
    # Regenerate the caller's card and confirm the marked set really is a line.
    marked = set(req.marked)
    if bool(row["free_space"]):
        marked.add(CENTER)
    if not _has_line(marked):
        raise HTTPException(status_code=400, detail="That's not a completed line yet")
    if row["winner"]:
        return _response(row, user)  # someone already won — don't overwrite
    db.execute("UPDATE bingo_games SET status = 'done', winner = ? WHERE board_id = ?", (user["name"], board_id))
    return await _publish(board_id, user)


@router.post("/{board_id}/reset")
async def reset(board_id: int, user=Depends(current_user)):
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if not _is_host(row, user):
        raise HTTPException(status_code=403, detail="Only the host can do that")
    db.execute(
        "UPDATE bingo_games SET status = 'setup', winner = NULL, started_at = NULL WHERE board_id = ?",
        (board_id,),
    )
    return await _publish(board_id, user)
