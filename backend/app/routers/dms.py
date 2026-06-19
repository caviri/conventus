"""Direct messages between two participants.

Even DMs are "public after the password" in spirit — there are no secrets in a
Conventus room — but they give people a one-to-one space. A DM is keyed by the
sorted pair of names so opening it twice always lands on the same thread.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, messaging
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/dms", tags=["dms"])


class DMOpen(BaseModel):
    with_user: str = Field(alias="with", min_length=1, max_length=32)

    model_config = {"populate_by_name": True}


class MessageCreate(BaseModel):
    content: str = ""
    attachments: list[str] = []
    reply_to: int | None = None


def _other(dm: dict, me: str) -> str:
    return dm["user_b"] if dm["user_a"] == me else dm["user_a"]


def _get_or_create(a: str, b: str) -> dict:
    user_a, user_b = sorted([a, b])
    dm = db.query_one(
        "SELECT * FROM dms WHERE user_a = ? AND user_b = ?", (user_a, user_b)
    )
    if dm:
        return dm
    dm_id = db.execute(
        "INSERT INTO dms(user_a, user_b, created_at) VALUES (?, ?, ?)",
        (user_a, user_b, db.now()),
    )
    return db.query_one("SELECT * FROM dms WHERE id = ?", (dm_id,))


@router.get("")
async def list_dms(user=Depends(current_user)):
    me = user["name"]
    rows = db.query_all(
        "SELECT * FROM dms WHERE user_a = ? OR user_b = ? ORDER BY id DESC",
        (me, me),
    )
    result = []
    for dm in rows:
        last = db.query_one(
            "SELECT * FROM messages WHERE dm_id = ? ORDER BY id DESC LIMIT 1",
            (dm["id"],),
        )
        result.append(
            {
                "id": dm["id"],
                "with": _other(dm, me),
                "online": hub.is_online(_other(dm, me)),
                "last": messaging.serialize(last) if last else None,
            }
        )
    return result


@router.post("")
async def open_dm(req: DMOpen, user=Depends(current_user)):
    me = user["name"]
    other = req.with_user.strip()
    if not db.query_one("SELECT 1 FROM users WHERE name = ?", (other,)):
        raise HTTPException(status_code=404, detail="No such user")
    dm = _get_or_create(me, other)
    payload = {"id": dm["id"], "with": other, "online": hub.is_online(other)}
    # A DM with yourself is a private "notes to self" space — nobody else to
    # notify. Otherwise let the other side know the thread exists so it shows up live.
    if other != me:
        await hub.send_to_users([other], "dm.open", {"id": dm["id"], "with": me})
    return payload


@router.get("/{dm_id}/messages")
async def dm_messages(
    dm_id: int, before: int | None = None, limit: int = 50, user=Depends(current_user)
):
    dm = db.query_one("SELECT * FROM dms WHERE id = ?", (dm_id,))
    if not dm or user["name"] not in (dm["user_a"], dm["user_b"]):
        raise HTTPException(status_code=404, detail="No such conversation")
    limit = max(1, min(limit, 100))
    if before:
        rows = db.query_all(
            "SELECT * FROM messages WHERE dm_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
            (dm_id, before, limit),
        )
    else:
        rows = db.query_all(
            "SELECT * FROM messages WHERE dm_id = ? ORDER BY id DESC LIMIT ?",
            (dm_id, limit),
        )
    rows.reverse()
    return messaging.serialize_many(rows)


@router.post("/{dm_id}/messages")
async def post_dm(dm_id: int, req: MessageCreate, user=Depends(current_user)):
    dm = db.query_one("SELECT * FROM dms WHERE id = ?", (dm_id,))
    if not dm or user["name"] not in (dm["user_a"], dm["user_b"]):
        raise HTTPException(status_code=404, detail="No such conversation")
    attachments = messaging.resolve_attachments(req.attachments)
    if not req.content.strip() and not attachments:
        raise HTTPException(status_code=400, detail="Empty message")
    return await messaging.create_message(
        author=user["name"],
        content=req.content,
        dm_id=dm_id,
        attachments=attachments,
        reply_to=req.reply_to,
    )
