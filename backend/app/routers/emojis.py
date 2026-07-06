"""Custom emoji (Slack-mojis): upload a small image, name it :like_this:, and
the whole room can react with it and use it inline in messages.

The image bytes live as an ordinary files row (Drive listings filter them out),
so export/import and disk cleanup follow the existing file machinery.
"""
from __future__ import annotations

import re
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import db
from ..deps import current_user
from ..ws import hub
from .files import _path_for, save_upload

router = APIRouter(prefix="/api/emojis", tags=["emojis"])

NAME_RE = re.compile(r"^[a-z0-9_+\-]{1,32}$")

# Emoji render tiny and repeat across the room — keep the payload honest.
MAX_EMOJI_BYTES = 512 * 1024

ALLOWED_MIMES = {"image/png", "image/gif", "image/webp", "image/jpeg"}


def _serialize(row: dict) -> dict:
    return {
        "name": row["name"],
        "url": f"/api/files/{row['file_id']}/raw",
        "uploaded_by": row["uploaded_by"],
        "created_at": row["created_at"],
    }


@router.get("")
async def list_emojis(user=Depends(current_user)):
    rows = db.query_all("SELECT * FROM custom_emojis ORDER BY name")
    return [_serialize(r) for r in rows]


@router.post("")
async def create_emoji(
    name: str = Form(...), file: UploadFile = File(...), user=Depends(current_user)
):
    name = name.strip().lower().strip(":")
    if not NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Emoji names are 1-32 chars of a-z, 0-9, _, - or +",
        )
    if db.query_one("SELECT 1 FROM custom_emojis WHERE name = ?", (name,)):
        raise HTTPException(status_code=400, detail=f":{name}: already exists")
    if (file.content_type or "").lower() not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=400, detail="Emoji must be a PNG, GIF, WebP or JPEG image"
        )
    row = await save_upload(file, user, max_bytes=MAX_EMOJI_BYTES, limit_label="512 KB")
    try:
        db.execute(
            "INSERT INTO custom_emojis(name, file_id, uploaded_by, created_at) "
            "VALUES (?, ?, ?, ?)",
            (name, row["id"], user["name"], db.now()),
        )
    except sqlite3.IntegrityError:
        # Lost a race to another uploader claiming this name: drop the file we
        # just saved so it doesn't linger on disk and leak into the Drive.
        _path_for(row["id"]).unlink(missing_ok=True)
        db.execute("DELETE FROM files WHERE id = ?", (row["id"],))
        raise HTTPException(status_code=400, detail=f":{name}: already exists")
    emoji = db.query_one("SELECT * FROM custom_emojis WHERE name = ?", (name,))
    await hub.broadcast("emoji.update", {"action": "add", "name": name})
    return _serialize(emoji)


@router.delete("/{name}")
async def delete_emoji(name: str, user=Depends(current_user)):
    row = db.query_one("SELECT * FROM custom_emojis WHERE name = ?", (name,))
    if not row:
        raise HTTPException(status_code=404, detail="No such emoji")
    if row["uploaded_by"] != user["name"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    db.execute("DELETE FROM custom_emojis WHERE name = ?", (name,))
    _path_for(row["file_id"]).unlink(missing_ok=True)
    db.execute("DELETE FROM files WHERE id = ?", (row["file_id"],))
    await hub.broadcast("emoji.update", {"action": "delete", "name": name})
    return {"ok": True}
