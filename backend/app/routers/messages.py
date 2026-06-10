"""Editing, deleting, and reacting to individual messages.

These work uniformly across channels and DMs since a message id is global.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, messaging, previews
from ..deps import current_user

router = APIRouter(prefix="/api/messages", tags=["messages"])


class EditRequest(BaseModel):
    content: str = Field(min_length=1)


class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


def _load(message_id: int) -> dict:
    row = db.query_one("SELECT * FROM messages WHERE id = ?", (message_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such message")
    return row


@router.patch("/{message_id}")
async def edit_message(message_id: int, req: EditRequest, user=Depends(current_user)):
    row = _load(message_id)
    if row["author"] != user["name"]:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    if row["kind"] == "system":
        raise HTTPException(status_code=400, detail="Cannot edit system messages")

    # Re-resolve link previews for the new content.
    found = await previews.fetch_all(previews.extract_urls(req.content))
    db.execute(
        "UPDATE messages SET content = ?, previews = ?, edited_at = ? WHERE id = ?",
        (req.content, db.dumps(found), db.now(), message_id),
    )
    updated = messaging.get_message(message_id)
    assert updated is not None
    await messaging.broadcast_update(updated)
    return updated


@router.delete("/{message_id}")
async def delete_message(message_id: int, user=Depends(current_user)):
    row = _load(message_id)
    if row["author"] != user["name"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    db.execute("DELETE FROM reactions WHERE message_id = ?", (message_id,))
    db.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    await messaging.broadcast_delete(row)
    return {"ok": True}


@router.post("/{message_id}/pin")
async def toggle_pin(message_id: int, user=Depends(current_user)):
    row = _load(message_id)
    if row["kind"] == "system":
        raise HTTPException(status_code=400, detail="Cannot pin system messages")
    new_state = 0 if row["pinned"] else 1
    db.execute("UPDATE messages SET pinned = ? WHERE id = ?", (new_state, message_id))
    updated = messaging.get_message(message_id)
    assert updated is not None
    await messaging.broadcast_update(updated)
    return updated


@router.post("/{message_id}/reactions")
async def toggle_reaction(message_id: int, req: ReactionRequest, user=Depends(current_user)):
    _load(message_id)
    existing = db.query_one(
        "SELECT 1 FROM reactions WHERE message_id = ? AND author = ? AND emoji = ?",
        (message_id, user["name"], req.emoji),
    )
    if existing:
        db.execute(
            "DELETE FROM reactions WHERE message_id = ? AND author = ? AND emoji = ?",
            (message_id, user["name"], req.emoji),
        )
    else:
        db.execute(
            "INSERT INTO reactions(message_id, author, emoji, created_at) "
            "VALUES (?, ?, ?, ?)",
            (message_id, user["name"], req.emoji, db.now()),
        )
    updated = messaging.get_message(message_id)
    assert updated is not None
    await messaging.broadcast_update(updated)
    return updated
