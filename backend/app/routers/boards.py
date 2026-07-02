"""Named collaborative boards — markdown canvases and whiteboards.

Each board maps to a Yjs collab document id of the form ``{kind}-{id}``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import boardstate, db
from ..collab import hub as collab_hub
from ..deps import current_user, require_admin
from ..ws import hub

router = APIRouter(prefix="/api/boards", tags=["boards"])


BOARD_KINDS = ("canvas", "whiteboard", "kanban", "room", "bingo")


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
    db.execute("DELETE FROM bingo_games WHERE board_id = ?", (board_id,))
    await hub.broadcast("board.delete", {"id": board_id})
    return {"ok": True}


# --- Board content (kanban cards/columns, live-document text) -------------
# These read and mutate the board's Yjs document server-side (pycrdt), so the
# same data the collaborative UI shows is available over REST. Additions are
# persisted and broadcast to anyone currently viewing the board.


class CardCreate(BaseModel):
    text: str = Field(min_length=1)
    col: str | None = None  # column id; defaults to the first column
    tags: str | None = None
    assignee: str | None = None
    due: str | None = None
    image: str | None = None
    link: str | None = None


class ColumnCreate(BaseModel):
    title: str = Field(min_length=1, max_length=60)


class AppendText(BaseModel):
    text: str = Field(min_length=1)


def _board_or_404(board_id: int) -> dict:
    row = db.query_one("SELECT * FROM boards WHERE id = ?", (board_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such board")
    return _serialize(row)


@router.get("/{board_id}/content")
async def board_content(board_id: int, user=Depends(current_user)):
    """Structured contents of a board: kanban → columns + cards; live document → text."""
    board = _board_or_404(board_id)
    if board["kind"] == "kanban":
        return boardstate.read_kanban(board["doc"])
    if board["kind"] == "canvas":
        return boardstate.read_canvas(board["doc"])
    raise HTTPException(
        status_code=400, detail="Content API supports kanban and live-document boards"
    )


@router.post("/{board_id}/cards")
async def create_card(board_id: int, req: CardCreate, user=Depends(current_user)):
    board = _board_or_404(board_id)
    if board["kind"] != "kanban":
        raise HTTPException(status_code=400, detail="Not a kanban board")
    card, update = boardstate.add_card(board["doc"], req.model_dump())
    await collab_hub.publish(board["doc"], update)
    return card


@router.post("/{board_id}/columns")
async def create_column(board_id: int, req: ColumnCreate, user=Depends(current_user)):
    board = _board_or_404(board_id)
    if board["kind"] != "kanban":
        raise HTTPException(status_code=400, detail="Not a kanban board")
    col, update = boardstate.add_column(board["doc"], req.title)
    await collab_hub.publish(board["doc"], update)
    return col


@router.post("/{board_id}/append")
async def append_document(board_id: int, req: AppendText, user=Depends(current_user)):
    board = _board_or_404(board_id)
    if board["kind"] != "canvas":
        raise HTTPException(status_code=400, detail="Not a live-document board")
    update, length = boardstate.append_text(board["doc"], req.text)
    await collab_hub.publish(board["doc"], update)
    return {"ok": True, "length": length}
