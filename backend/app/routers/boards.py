"""Named collaborative boards — markdown canvases and whiteboards.

Each board maps to a Yjs collab document id of the form ``{kind}-{id}``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_user, require_admin
from ..ws import hub

router = APIRouter(prefix="/api/boards", tags=["boards"])


BOARD_KINDS = ("canvas", "whiteboard", "kanban")


class BoardCreate(BaseModel):
    kind: str  # canvas | whiteboard | kanban
    name: str = Field(min_length=1, max_length=40)


class BoardUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def _serialize(row: dict) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "name": row["name"],
        "doc": f"{row['kind']}-{row['id']}",
        "folder_id": row["folder_id"],
    }


@router.get("")
async def list_boards(user=Depends(current_user)):
    rows = db.query_all("SELECT * FROM boards ORDER BY id")
    return [_serialize(r) for r in rows]


@router.post("")
async def create_board(req: BoardCreate, user=Depends(current_user)):
    if req.kind not in BOARD_KINDS:
        raise HTTPException(
            status_code=400, detail=f"kind must be one of {', '.join(BOARD_KINDS)}"
        )
    board_id = db.execute(
        "INSERT INTO boards(kind, name, created_at) VALUES (?, ?, ?)",
        (req.kind, req.name.strip(), db.now()),
    )
    board = _serialize(db.query_one("SELECT * FROM boards WHERE id = ?", (board_id,)))
    await hub.broadcast("board.create", board)
    return board


@router.patch("/{board_id}")
async def rename_board(board_id: int, req: BoardUpdate, user=Depends(current_user)):
    row = db.query_one("SELECT * FROM boards WHERE id = ?", (board_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such board")
    db.execute("UPDATE boards SET name = ? WHERE id = ?", (req.name.strip(), board_id))
    board = _serialize(db.query_one("SELECT * FROM boards WHERE id = ?", (board_id,)))
    await hub.broadcast("board.update", board)
    return board


@router.delete("/{board_id}")
async def delete_board(board_id: int, user=Depends(require_admin)):
    row = db.query_one("SELECT * FROM boards WHERE id = ?", (board_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such board")
    db.execute("DELETE FROM boards WHERE id = ?", (board_id,))
    db.execute("DELETE FROM collab_updates WHERE doc = ?", (f"{row['kind']}-{board_id}",))
    await hub.broadcast("board.delete", {"id": board_id})
    return {"ok": True}
