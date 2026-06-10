"""Public channels and their messages."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, messaging
from ..deps import current_user, require_admin
from ..ws import hub

router = APIRouter(prefix="/api/channels", tags=["channels"])


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    topic: str = ""


class ChannelUpdate(BaseModel):
    topic: str | None = None
    name: str | None = None


class MessageCreate(BaseModel):
    content: str = ""
    attachments: list[str] = []
    reply_to: int | None = None


def _serialize_channel(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "topic": row["topic"],
        "is_default": bool(row["is_default"]),
        "folder_id": row["folder_id"],
    }


@router.get("")
async def list_channels(user=Depends(current_user)):
    rows = db.query_all("SELECT * FROM channels ORDER BY is_default DESC, name")
    return [_serialize_channel(r) for r in rows]


@router.post("")
async def create_channel(req: ChannelCreate, user=Depends(require_admin)):
    name = req.name.strip().lstrip("#").replace(" ", "-").lower()
    if db.query_one("SELECT 1 FROM channels WHERE name = ?", (name,)):
        raise HTTPException(status_code=409, detail="Channel already exists")
    channel_id = db.execute(
        "INSERT INTO channels(name, topic, created_by, created_at) VALUES (?, ?, ?, ?)",
        (name, req.topic, user["name"], db.now()),
    )
    row = db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,))
    channel = _serialize_channel(row)
    await hub.broadcast("channel.create", channel)
    return channel


@router.patch("/{channel_id}")
async def update_channel(channel_id: int, req: ChannelUpdate, user=Depends(require_admin)):
    row = db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such channel")
    topic = req.topic if req.topic is not None else row["topic"]
    name = (req.name.strip().lstrip("#").replace(" ", "-").lower()
            if req.name else row["name"])
    db.execute(
        "UPDATE channels SET topic = ?, name = ? WHERE id = ?",
        (topic, name, channel_id),
    )
    updated = _serialize_channel(db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,)))
    await hub.broadcast("channel.update", updated)
    return updated


@router.delete("/{channel_id}")
async def delete_channel(channel_id: int, user=Depends(require_admin)):
    row = db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such channel")
    if row["is_default"]:
        raise HTTPException(status_code=400, detail="Cannot delete the default channel")
    db.execute("DELETE FROM messages WHERE channel_id = ?", (channel_id,))
    db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
    await hub.broadcast("channel.delete", {"id": channel_id})
    return {"ok": True}


@router.get("/{channel_id}/messages")
async def get_messages(
    channel_id: int, before: int | None = None, limit: int = 50, user=Depends(current_user)
):
    limit = max(1, min(limit, 100))
    if before:
        rows = db.query_all(
            "SELECT * FROM messages WHERE channel_id = ? AND id < ? "
            "ORDER BY id DESC LIMIT ?",
            (channel_id, before, limit),
        )
    else:
        rows = db.query_all(
            "SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?",
            (channel_id, limit),
        )
    rows.reverse()
    return messaging.serialize_many(rows)


@router.get("/{channel_id}/pins")
async def get_pins(channel_id: int, user=Depends(current_user)):
    rows = db.query_all(
        "SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 ORDER BY id DESC",
        (channel_id,),
    )
    return messaging.serialize_many(rows)


@router.post("/{channel_id}/messages")
async def post_message(channel_id: int, req: MessageCreate, user=Depends(current_user)):
    if not db.query_one("SELECT 1 FROM channels WHERE id = ?", (channel_id,)):
        raise HTTPException(status_code=404, detail="No such channel")
    attachments = messaging.resolve_attachments(req.attachments)
    if not req.content.strip() and not attachments:
        raise HTTPException(status_code=400, detail="Empty message")
    return await messaging.create_message(
        author=user["name"],
        content=req.content,
        channel_id=channel_id,
        attachments=attachments,
        reply_to=req.reply_to,
    )
