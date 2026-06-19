"""Private 1:1 conversations between a user and the Assistant.

Each user can keep many threads (ChatGPT-style). Threads and their messages are
owner-scoped: only the owner can read, post to, rename, or delete them. Posting
a message stores it, then streams the Assistant's reply in the background.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import agent, db, messaging
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/conversations", tags=["agent"])


class ConversationCreate(BaseModel):
    title: str | None = None
    system_prompt: str | None = None


class ConversationUpdate(BaseModel):
    title: str | None = None
    system_prompt: str | None = None


class ConversationMessage(BaseModel):
    content: str = Field(min_length=1)


def _owned(conversation_id: int, me: str) -> dict:
    row = db.query_one("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    if not row or row["owner"] != me:
        raise HTTPException(status_code=404, detail="No such conversation")
    return row


def _serialize(row: dict) -> dict:
    last = db.query_one(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
        (row["id"],),
    )
    return {
        "id": row["id"],
        "title": row["title"],
        "system_prompt": row["system_prompt"],
        "updated_at": row["updated_at"],
        "last": messaging.serialize(last) if last else None,
    }


@router.get("")
async def list_conversations(user=Depends(current_user)):
    rows = db.query_all(
        "SELECT * FROM conversations WHERE owner = ? ORDER BY updated_at DESC, id DESC",
        (user["name"],),
    )
    return [_serialize(r) for r in rows]


@router.post("")
async def create_conversation(req: ConversationCreate, user=Depends(current_user)):
    now = db.now()
    conv_id = db.execute(
        "INSERT INTO conversations(owner, title, system_prompt, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            user["name"],
            (req.title or "New conversation").strip() or "New conversation",
            req.system_prompt or "",
            now,
            now,
        ),
    )
    row = db.query_one("SELECT * FROM conversations WHERE id = ?", (conv_id,))
    await hub.send_to_users([user["name"]], "conversation.update", {"id": conv_id})
    return _serialize(row)


@router.patch("/{conversation_id}")
async def update_conversation(
    conversation_id: int, req: ConversationUpdate, user=Depends(current_user)
):
    _owned(conversation_id, user["name"])
    fields: dict[str, object] = {}
    if req.title is not None:
        fields["title"] = req.title.strip() or "New conversation"
    if req.system_prompt is not None:
        fields["system_prompt"] = req.system_prompt
    if fields:
        fields["updated_at"] = db.now()
        assignments = ", ".join(f"{k} = ?" for k in fields)
        db.execute(
            f"UPDATE conversations SET {assignments} WHERE id = ?",
            (*fields.values(), conversation_id),
        )
    await hub.send_to_users([user["name"]], "conversation.update", {"id": conversation_id})
    return _serialize(db.query_one("SELECT * FROM conversations WHERE id = ?", (conversation_id,)))


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: int, user=Depends(current_user)):
    _owned(conversation_id, user["name"])
    db.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
    db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    await hub.send_to_users([user["name"]], "conversation.update", {"id": conversation_id})
    return {"ok": True}


@router.get("/{conversation_id}/messages")
async def conversation_messages(
    conversation_id: int, before: int | None = None, limit: int = 50, user=Depends(current_user)
):
    _owned(conversation_id, user["name"])
    limit = max(1, min(limit, 100))
    if before:
        rows = db.query_all(
            "SELECT * FROM messages WHERE conversation_id = ? AND id < ? "
            "ORDER BY id DESC LIMIT ?",
            (conversation_id, before, limit),
        )
    else:
        rows = db.query_all(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
            (conversation_id, limit),
        )
    rows.reverse()
    return messaging.serialize_many(rows)


@router.post("/{conversation_id}/messages")
async def post_conversation_message(
    conversation_id: int, req: ConversationMessage, user=Depends(current_user)
):
    _owned(conversation_id, user["name"])
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Empty message")
    message = await messaging.create_message(
        author=user["name"],
        content=req.content,
        conversation_id=conversation_id,
    )
    db.execute(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        (db.now(), conversation_id),
    )
    await hub.send_to_users([user["name"]], "conversation.update", {"id": conversation_id})
    # Stream the Assistant's reply in the background; the POST returns the user msg.
    messaging._spawn(agent.reply_in_conversation(conversation_id))
    return message


@router.post("/{conversation_id}/divider")
async def add_divider(conversation_id: int, user=Depends(current_user)):
    """Start a new conversation segment within the same thread — a separator that
    also resets the Assistant's context (it only reads messages after it)."""
    _owned(conversation_id, user["name"])
    msg = await messaging.create_message(
        author=user["name"],
        content="New conversation",
        kind="system",
        conversation_id=conversation_id,
    )
    db.execute(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        (db.now(), conversation_id),
    )
    return msg
