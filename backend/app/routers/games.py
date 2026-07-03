"""Game boards — collaborative setup, then publish and play.

A board of kind ``game`` carries one game (``games`` table). Its lifecycle:

- **setup** — the room drafts the game together in the board's Yjs doc
  (everyone can edit; the UI shows live cursors). ``GET/PUT /setup`` mirror the
  draft over REST for bots and scripts.
- **live** — the host publishes: the draft is validated, frozen into ``config``,
  and every player gets their view (their bingo card). A system message
  announces the game in the default channel.
- **done** — a win claim is validated by the game type; the first valid claim
  wins and is announced to the room. The host can reset back to setup.

The host is the board's creator (or any admin).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import boardstate, db, messaging
from ..collab import hub as collab_hub
from ..deps import current_user
from ..games import GAME_TYPES, GameError
from ..ws import hub

router = APIRouter(prefix="/api/games", tags=["games"])


def _board_or_404(board_id: int) -> dict:
    row = db.query_one("SELECT * FROM boards WHERE id = ? AND kind = 'game'", (board_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such game")
    return row


def _game(board_id: int, fallback_host: str) -> dict:
    """The game row. Normally created with the board; the lazy fallback covers
    boards from imports or the brief bingo-kind era."""
    row = db.query_one("SELECT * FROM games WHERE board_id = ?", (board_id,))
    if not row:
        db.execute(
            "INSERT INTO games(board_id, created_by, created_at) VALUES (?, ?, ?)",
            (board_id, fallback_host, db.now()),
        )
        row = db.query_one("SELECT * FROM games WHERE board_id = ?", (board_id,))
    return row


def _game_type(row: dict):
    game_type = GAME_TYPES.get(row["game_type"])
    if not game_type:
        raise HTTPException(status_code=400, detail=f"Unknown game type {row['game_type']!r}")
    return game_type


def _is_host(row: dict, user: dict) -> bool:
    return row["created_by"] == user["name"] or bool(user.get("is_admin"))


def _public(row: dict) -> dict:
    """Shared game state — the shape both broadcast and returned to clients.
    During setup the draft lives in the collab doc, so config stays empty."""
    return {
        "board_id": row["board_id"],
        "game_type": row["game_type"],
        "status": row["status"],
        "winner": row["winner"],
        "created_by": row["created_by"],
        "config": db.loads(row["config"], {}) if row["status"] != "setup" else None,
    }


def _response(row: dict, user: dict) -> dict:
    return {**_public(row), "is_host": _is_host(row, user)}


async def _publish_state(board_id: int, user: dict) -> dict:
    """Re-read the game, broadcast it to everyone, and return it to the caller."""
    row = db.query_one("SELECT * FROM games WHERE board_id = ?", (board_id,))
    await hub.broadcast("game.update", _public(row))
    return _response(row, user)


_announce = messaging.announce  # game events land in the main channel too


class SetupUpdate(BaseModel):
    text: str | None = None
    options: dict[str, Any] | None = None


class WinClaim(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


@router.get("/{board_id}")
async def get_game(board_id: int, user=Depends(current_user)):
    _board_or_404(board_id)
    return _response(_game(board_id, user["name"]), user)


@router.get("/{board_id}/setup")
async def get_setup(board_id: int, user=Depends(current_user)):
    """The collaborative setup draft (the same data live editors see via Yjs)."""
    board = _board_or_404(board_id)
    _game(board_id, user["name"])
    return boardstate.read_game_setup(f"{board['kind']}-{board_id}")


@router.put("/{board_id}/setup")
async def update_setup(board_id: int, req: SetupUpdate, user=Depends(current_user)):
    """Write the setup draft over REST — anyone can edit, it's collaborative.
    The change lands in the Yjs doc, so live editors see it instantly."""
    board = _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if row["status"] != "setup":
        raise HTTPException(status_code=400, detail="Game already published — reset it first")
    doc = f"{board['kind']}-{board_id}"
    update = boardstate.write_game_setup(doc, req.text, req.options)
    await collab_hub.publish(doc, update)
    return boardstate.read_game_setup(doc)


@router.post("/{board_id}/publish")
async def publish(board_id: int, user=Depends(current_user)):
    """Freeze the draft into the game config and open play (host only)."""
    board = _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if not _is_host(row, user):
        raise HTTPException(status_code=403, detail="Only the host can do that")
    draft = boardstate.read_game_setup(f"{board['kind']}-{board_id}")
    try:
        config = _game_type(row).build_config(draft)
    except GameError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.execute(
        "UPDATE games SET config = ?, status = 'live', winner = NULL, started_at = ? "
        "WHERE board_id = ?",
        (db.dumps(config), db.now(), board_id),
    )
    await _announce(
        user["name"],
        f"🎲 **{board['name']}** is open — a game of {row['game_type']} is on!",
    )
    return await _publish_state(board_id, user)


@router.get("/{board_id}/view")
async def player_view(board_id: int, user=Depends(current_user)):
    """This player's private view of the live game (their bingo card)."""
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if row["status"] == "setup":
        raise HTTPException(status_code=400, detail="Game hasn't been published yet")
    config = db.loads(row["config"], {})
    return _game_type(row).player_view(board_id, user["name"], config)


@router.post("/{board_id}/win")
async def claim_win(board_id: int, req: WinClaim, user=Depends(current_user)):
    board = _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if row["status"] != "live":
        raise HTTPException(status_code=400, detail="Game is not live")
    try:
        _game_type(row).judge_win(board_id, user["name"], db.loads(row["config"], {}), req.data)
    except GameError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if row["winner"]:
        return _response(row, user)  # someone already won — don't overwrite
    db.execute(
        "UPDATE games SET status = 'done', winner = ? WHERE board_id = ?",
        (user["name"], board_id),
    )
    await _announce(user["name"], f"🎉 **{user['name']}** won **{board['name']}**!")
    return await _publish_state(board_id, user)


@router.post("/{board_id}/reset")
async def reset(board_id: int, user=Depends(current_user)):
    """Back to setup (host only). The draft is still in the doc, ready to tweak."""
    _board_or_404(board_id)
    row = _game(board_id, user["name"])
    if not _is_host(row, user):
        raise HTTPException(status_code=403, detail="Only the host can do that")
    db.execute(
        "UPDATE games SET status = 'setup', config = '{}', winner = NULL, started_at = NULL "
        "WHERE board_id = ?",
        (board_id,),
    )
    return await _publish_state(board_id, user)
