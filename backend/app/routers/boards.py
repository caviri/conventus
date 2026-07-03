"""Named collaborative boards — markdown canvases and whiteboards.

Each board maps to a Yjs collab document id of the form ``{kind}-{id}``.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import boardstate, db
from ..collab import hub as collab_hub
from ..deps import current_user, require_admin
from ..games import GAME_TYPES
from ..ws import hub

router = APIRouter(prefix="/api/boards", tags=["boards"])


BOARD_KINDS = ("canvas", "whiteboard", "kanban", "room", "game", "map")


class BoardCreate(BaseModel):
    kind: str  # canvas | whiteboard | kanban | room | game
    name: str = Field(min_length=1, max_length=40)
    game_type: str = "bingo"  # for kind = game


class BoardUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def _serialize(row: dict) -> dict:
    board = {
        "id": row["id"],
        "kind": row["kind"],
        "name": row["name"],
        "doc": f"{row['kind']}-{row['id']}",
        "folder_id": row["folder_id"],
    }
    if row["kind"] == "game":
        game = db.query_one("SELECT game_type FROM games WHERE board_id = ?", (row["id"],))
        board["game_type"] = game["game_type"] if game else "bingo"
    return board


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
    if req.kind == "game" and req.game_type not in GAME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"game_type must be one of {', '.join(GAME_TYPES)}",
        )
    board_id = db.execute(
        "INSERT INTO boards(kind, name, created_at) VALUES (?, ?, ?)",
        (req.kind, req.name.strip(), db.now()),
    )
    if req.kind == "game":
        # The creator hosts: they publish the game once the room's draft is ready.
        db.execute(
            "INSERT INTO games(board_id, game_type, created_by, created_at) VALUES (?, ?, ?, ?)",
            (board_id, req.game_type, user["name"], db.now()),
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
    db.execute("DELETE FROM games WHERE board_id = ?", (board_id,))
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
    """Structured contents of a board: kanban → columns + cards; live document →
    text; map → annotation features."""
    board = _board_or_404(board_id)
    if board["kind"] == "kanban":
        return boardstate.read_kanban(board["doc"])
    if board["kind"] == "canvas":
        return boardstate.read_canvas(board["doc"])
    if board["kind"] == "map":
        return boardstate.read_map(board["doc"])
    raise HTTPException(
        status_code=400,
        detail="Content API supports kanban, live-document and map boards",
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


FEATURE_KINDS = ("pin", "path", "draw", "text", "image")


class FeatureCreate(BaseModel):
    kind: str  # pin | path | draw | text | image
    coords: list  # point kinds: [lng, lat]; line kinds: [[lng, lat], …]
    label: str = ""  # the content, for kind "text"
    color: str | None = None
    size: float | None = None  # text font px / image width px / stroke px
    url: str | None = None  # image source


@router.post("/{board_id}/features")
async def create_feature(board_id: int, req: FeatureCreate, user=Depends(current_user)):
    """Drop an annotation on a map board — live viewers see it immediately."""
    board = _board_or_404(board_id)
    if board["kind"] != "map":
        raise HTTPException(status_code=400, detail="Not a map board")
    if req.kind not in FEATURE_KINDS:
        raise HTTPException(
            status_code=400, detail=f"kind must be one of {', '.join(FEATURE_KINDS)}"
        )
    if req.kind == "image" and not req.url:
        raise HTTPException(status_code=400, detail="image features need a url")
    # Default to the author's member color so each user's marks are theirs.
    author = db.query_one("SELECT color FROM users WHERE name = ?", (user["name"],))
    feature = {
        "id": uuid.uuid4().hex,
        "kind": req.kind,
        "coords": req.coords,
        "label": req.label,
        "color": req.color or (author or {}).get("color") or "#e8b24a",
        "author": user["name"],
    }
    if req.size:
        feature["size"] = req.size
    if req.url:
        feature["url"] = req.url
    update = boardstate.add_map_feature(board["doc"], feature)
    await collab_hub.publish(board["doc"], update)
    return feature
