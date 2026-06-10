"""Sidebar folders that group channels and boards.

Folders are shared room state (everyone sees the same organization). Any
member can create folders and move items in and out of them — organizing the
room is a collaborative act, like tidying a shared whiteboard.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/folders", tags=["folders"])

# Item kind -> table it lives in. Whitelisted so the table name is never
# interpolated from raw user input.
ITEM_TABLES = {"channel": "channels", "board": "boards"}


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    position: int | None = None


class MoveItem(BaseModel):
    kind: str  # channel | board
    id: int
    folder_id: int | None = None


def _serialize(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "position": row["position"]}


@router.get("")
async def list_folders(user=Depends(current_user)):
    rows = db.query_all("SELECT * FROM folders ORDER BY position, id")
    return [_serialize(r) for r in rows]


@router.post("")
async def create_folder(req: FolderCreate, user=Depends(current_user)):
    pos = db.query_one("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM folders")["p"]
    folder_id = db.execute(
        "INSERT INTO folders(name, position, created_at) VALUES (?, ?, ?)",
        (req.name.strip(), pos, db.now()),
    )
    folder = _serialize(db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,)))
    await hub.broadcast("folder.create", folder)
    return folder


@router.patch("/{folder_id}")
async def update_folder(folder_id: int, req: FolderUpdate, user=Depends(current_user)):
    row = db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such folder")
    name = req.name.strip() if req.name else row["name"]
    position = req.position if req.position is not None else row["position"]
    db.execute(
        "UPDATE folders SET name = ?, position = ? WHERE id = ?",
        (name, position, folder_id),
    )
    folder = _serialize(db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,)))
    await hub.broadcast("folder.update", folder)
    return folder


@router.delete("/{folder_id}")
async def delete_folder(folder_id: int, user=Depends(current_user)):
    if not db.query_one("SELECT 1 FROM folders WHERE id = ?", (folder_id,)):
        raise HTTPException(status_code=404, detail="No such folder")
    # Ungroup its items so nothing disappears, then drop the folder.
    db.execute("UPDATE channels SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    db.execute("UPDATE boards SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    await hub.broadcast("folder.delete", {"id": folder_id})
    return {"ok": True}


@router.post("/move")
async def move_item(req: MoveItem, user=Depends(current_user)):
    table = ITEM_TABLES.get(req.kind)
    if not table:
        raise HTTPException(status_code=400, detail="kind must be 'channel' or 'board'")
    if not db.query_one(f"SELECT 1 FROM {table} WHERE id = ?", (req.id,)):
        raise HTTPException(status_code=404, detail=f"No such {req.kind}")
    if req.folder_id is not None and not db.query_one(
        "SELECT 1 FROM folders WHERE id = ?", (req.folder_id,)
    ):
        raise HTTPException(status_code=404, detail="No such folder")
    db.execute(f"UPDATE {table} SET folder_id = ? WHERE id = ?", (req.folder_id, req.id))
    await hub.broadcast(
        "folder.move", {"kind": req.kind, "id": req.id, "folder_id": req.folder_id}
    )
    return {"ok": True}
