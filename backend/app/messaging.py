"""Message creation, serialization, and post-processing.

This is the heart of the room. Both the REST routers and the automation API go
through ``create_message`` so that link previews, bot replies and broadcasts
happen consistently no matter where a message originates.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

from . import db, previews
from .ws import hub

log = logging.getLogger("conventus.messaging")

MENTION_RE = re.compile(r"@([\w.\-]+)")

# Keep strong references to background tasks so they aren't garbage-collected
# mid-flight, and surface any exception instead of swallowing it.
_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)

    def _done(t: asyncio.Task) -> None:
        _background.discard(t)
        if not t.cancelled() and t.exception():
            log.exception("background task failed", exc_info=t.exception())

    task.add_done_callback(_done)


def author_color(name: str, kind: str) -> str:
    if kind == "bot":
        bot = db.query_one("SELECT color FROM bots WHERE name = ?", (name,))
        if bot:
            return bot["color"]
    user = db.query_one("SELECT color FROM users WHERE name = ?", (name,))
    return user["color"] if user else "#94a3b8"


def author_avatar(name: str, kind: str) -> Optional[str]:
    if kind == "bot":
        bot = db.query_one("SELECT avatar FROM bots WHERE name = ?", (name,))
        if bot:
            return bot["avatar"] or None
    user = db.query_one("SELECT avatar FROM users WHERE name = ?", (name,))
    return (user["avatar"] or None) if user else None


def reactions_for(message_id: int) -> list[dict[str, Any]]:
    rows = db.query_all(
        "SELECT emoji, author FROM reactions WHERE message_id = ? ORDER BY created_at",
        (message_id,),
    )
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row["emoji"], []).append(row["author"])
    return [
        {"emoji": emoji, "count": len(users), "users": users}
        for emoji, users in grouped.items()
    ]


def reply_preview(reply_to: Any) -> Optional[dict[str, Any]]:
    if not reply_to:
        return None
    parent = db.query_one(
        "SELECT id, author, content, kind FROM messages WHERE id = ?", (reply_to,)
    )
    if not parent:
        return None
    snippet = (parent["content"] or "").strip().replace("\n", " ")
    return {
        "id": parent["id"],
        "author": parent["author"],
        "kind": parent["kind"],
        "content": snippet[:120] + ("…" if len(snippet) > 120 else ""),
    }


def serialize(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "dm_id": row["dm_id"],
        "conversation_id": row["conversation_id"],
        "author": row["author"],
        "kind": row["kind"],
        "content": row["content"],
        "attachments": db.loads(row["attachments"], []),
        "previews": db.loads(row["previews"], []),
        "reactions": reactions_for(row["id"]),
        "reply_to": row["reply_to"],
        "reply_preview": reply_preview(row["reply_to"]),
        "pinned": bool(row["pinned"]),
        "created_at": row["created_at"],
        "edited_at": row["edited_at"],
        "color": author_color(row["author"], row["kind"]),
        "avatar": author_avatar(row["author"], row["kind"]),
    }


def resolve_attachments(file_ids: list[str]) -> list[dict[str, Any]]:
    """Turn uploaded file ids into self-contained attachment snapshots."""
    attachments: list[dict[str, Any]] = []
    for file_id in file_ids:
        row = db.query_one("SELECT * FROM files WHERE id = ?", (file_id,))
        if not row:
            continue
        attachments.append(
            {
                "id": row["id"],
                "name": row["original_name"],
                "mime": row["mime"],
                "size": row["size"],
                "url": f"/api/files/{row['id']}/raw",
            }
        )
    return attachments


def serialize_many(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Serialize a batch of messages with O(1) queries instead of O(n).

    The per-message ``serialize`` issues a few lookups each (author color,
    reactions, bot avatar); for a 50-message page that is hundreds of queries.
    Here we prefetch reactions and author metadata in one pass.
    """
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))

    grouped: dict[int, dict[str, list[str]]] = {}
    for rr in db.query_all(
        f"SELECT message_id, emoji, author FROM reactions "
        f"WHERE message_id IN ({marks}) ORDER BY created_at",
        ids,
    ):
        grouped.setdefault(rr["message_id"], {}).setdefault(rr["emoji"], []).append(
            rr["author"]
        )

    users = {u["name"]: u for u in db.query_all("SELECT name, color, avatar FROM users")}
    bots = {b["name"]: b for b in db.query_all("SELECT name, color, avatar FROM bots")}

    # Batch-load parents for quote-replies.
    parent_ids = [r["reply_to"] for r in rows if r["reply_to"]]
    parents: dict[int, dict[str, Any]] = {}
    if parent_ids:
        pmarks = ",".join("?" * len(parent_ids))
        for p in db.query_all(
            f"SELECT id, author, content, kind FROM messages WHERE id IN ({pmarks})",
            parent_ids,
        ):
            snippet = (p["content"] or "").strip().replace("\n", " ")
            parents[p["id"]] = {
                "id": p["id"],
                "author": p["author"],
                "kind": p["kind"],
                "content": snippet[:120] + ("…" if len(snippet) > 120 else ""),
            }

    out: list[dict[str, Any]] = []
    for r in rows:
        if r["kind"] == "bot" and r["author"] in bots:
            color = bots[r["author"]]["color"]
            avatar = bots[r["author"]]["avatar"] or None
        else:
            u = users.get(r["author"])
            color = u["color"] if u else "#94a3b8"
            avatar = (u["avatar"] or None) if u else None
        reactions = [
            {"emoji": e, "count": len(users), "users": users}
            for e, users in grouped.get(r["id"], {}).items()
        ]
        out.append(
            {
                "id": r["id"],
                "channel_id": r["channel_id"],
                "dm_id": r["dm_id"],
                "conversation_id": r["conversation_id"],
                "author": r["author"],
                "kind": r["kind"],
                "content": r["content"],
                "attachments": db.loads(r["attachments"], []),
                "previews": db.loads(r["previews"], []),
                "reactions": reactions,
                "reply_to": r["reply_to"],
                "reply_preview": parents.get(r["reply_to"]) if r["reply_to"] else None,
                "pinned": bool(r["pinned"]),
                "created_at": r["created_at"],
                "edited_at": r["edited_at"],
                "color": color,
                "avatar": avatar,
            }
        )
    return out


def get_message(message_id: int) -> Optional[dict[str, Any]]:
    row = db.query_one("SELECT * FROM messages WHERE id = ?", (message_id,))
    return serialize(row) if row else None


def dm_members(dm_id: int) -> list[str]:
    row = db.query_one("SELECT user_a, user_b FROM dms WHERE id = ?", (dm_id,))
    return [row["user_a"], row["user_b"]] if row else []


def conversation_owner(conversation_id: int) -> list[str]:
    row = db.query_one("SELECT owner FROM conversations WHERE id = ?", (conversation_id,))
    return [row["owner"]] if row else []


async def _broadcast_message(message: dict[str, Any], event: str) -> None:
    if message.get("conversation_id"):
        await hub.send_to_users(conversation_owner(message["conversation_id"]), event, message)
    elif message["dm_id"]:
        await hub.send_to_users(dm_members(message["dm_id"]), event, message)
    else:
        await hub.broadcast(event, message)


async def broadcast_new(message: dict[str, Any]) -> None:
    await _broadcast_message(message, "message")


async def broadcast_update(message: dict[str, Any]) -> None:
    await _broadcast_message(message, "message.update")


async def broadcast_delete(row: dict[str, Any]) -> None:
    payload = {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "dm_id": row["dm_id"],
        "conversation_id": row["conversation_id"],
    }
    if row["conversation_id"]:
        await hub.send_to_users(
            conversation_owner(row["conversation_id"]), "message.delete", payload
        )
    elif row["dm_id"]:
        await hub.send_to_users(dm_members(row["dm_id"]), "message.delete", payload)
    else:
        await hub.broadcast("message.delete", payload)


async def create_message(
    *,
    author: str,
    content: str = "",
    kind: str = "text",
    channel_id: Optional[int] = None,
    dm_id: Optional[int] = None,
    conversation_id: Optional[int] = None,
    attachments: Optional[list[dict]] = None,
    reply_to: Optional[int] = None,
) -> dict[str, Any]:
    attachments = attachments or []
    message_id = db.execute(
        "INSERT INTO messages(channel_id, dm_id, conversation_id, author, kind, content, "
        "attachments, previews, reply_to, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)",
        (
            channel_id,
            dm_id,
            conversation_id,
            author,
            kind,
            content,
            db.dumps(attachments),
            reply_to,
            db.now(),
        ),
    )
    # Keep the author's presence timestamp fresh (no-op for bots).
    db.execute("UPDATE users SET last_seen = ? WHERE name = ?", (db.now(), author))

    message = get_message(message_id)
    assert message is not None
    await _broadcast_message(message, "message")

    # Fire-and-forget post processing: link previews, then bots.
    _spawn(_post_process(message))
    return message


async def announce(author: str, content: str) -> None:
    """Drop a system announcement in the room's main channel — new channels,
    boards, game results and the like land where everyone will see them."""
    channel = db.query_one("SELECT id FROM channels ORDER BY is_default DESC, id LIMIT 1")
    if channel:
        await create_message(
            author=author, content=content, kind="system", channel_id=channel["id"]
        )


async def notify_people(message: dict[str, Any]) -> None:
    """Notify whoever this message concerns — @mentions in channels, replies to
    your message, and direct messages. Each person is pinged once, with the
    most specific reason winning (mention > reply > dm), over the in-app WS
    event (mentions only) and Web Push (all reasons)."""
    author = message["author"]
    content = (message["content"] or "").strip()
    excerpt = content[:140] + ("…" if len(content) > 140 else "")

    targets: dict[str, str] = {}  # name -> dm | reply | mention

    # A DM notifies the other participant.
    if message["dm_id"]:
        for name in dm_members(message["dm_id"]):
            if name != author:
                targets[name] = "dm"

    # A quote-reply notifies the parent message's author.
    if message.get("reply_to") and message["channel_id"]:
        parent = db.query_one(
            "SELECT author, kind FROM messages WHERE id = ?", (message["reply_to"],)
        )
        if parent and parent["author"] != author and parent["kind"] != "bot":
            targets[parent["author"]] = "reply"

    # @handles — channel messages only: a DM excerpt must never reach someone
    # outside that DM.
    if message["channel_id"]:
        names = {n.lower() for n in MENTION_RE.findall(content)}
        if names:
            for r in db.query_all("SELECT name FROM users"):
                if r["name"].lower() in names and r["name"] != author:
                    targets[r["name"]] = "mention"

    if not targets:
        return

    channel = (
        db.query_one("SELECT name FROM channels WHERE id = ?", (message["channel_id"],))
        if message["channel_id"]
        else None
    )
    where = channel["name"] if channel else None
    url = (
        f"/?msg={message['channel_id']}-{message['id']}"
        if message["channel_id"]
        else (f"/?dm={message['dm_id']}" if message["dm_id"] else "/")
    )

    # In-app toast (existing behavior) — mentions only.
    mentioned = [n for n, why in targets.items() if why == "mention"]
    if mentioned:
        context: dict[str, Any] = {
            "author": author,
            "message_id": message["id"],
            "excerpt": excerpt,
        }
        if message["channel_id"]:
            context["channel_id"] = message["channel_id"]
            context["channel_name"] = where or "channel"
        else:
            context["dm_id"] = message["dm_id"]
        await hub.send_to_users(mentioned, "mention", context)

    # Web Push for everyone concerned, worded by reason.
    from . import webpush

    titles = {
        "mention": f"{author} mentioned you" + (f" in #{where}" if where else ""),
        "reply": f"{author} replied to you" + (f" in #{where}" if where else ""),
        "dm": f"{author} messaged you",
    }
    for name, why in targets.items():
        await webpush.send_to_users(
            [name],
            {
                "title": titles[why],
                "body": excerpt,
                "url": url,
                # Unique per message so a DM ping never replaces an unseen mention.
                "tag": f"conventus-{message['id']}",
            },
        )


async def _post_process(message: dict[str, Any]) -> None:
    # Private agent threads must not ping other room members; system
    # announcements shouldn't push either.
    if not message.get("conversation_id") and message["kind"] != "system":
        await notify_people(message)

    urls = previews.extract_urls(message["content"])
    if urls:
        found = await previews.fetch_all(urls)
        if found:
            db.execute(
                "UPDATE messages SET previews = ? WHERE id = ?",
                (db.dumps(found), message["id"]),
            )
            updated = get_message(message["id"])
            if updated:
                await _broadcast_message(updated, "message.update")

    # Avoid bots replying to bots (no infinite loops). Channel-only triggers.
    # The Assistant is just an is_assistant bot, so this single call covers it.
    if message["kind"] != "bot" and message["channel_id"]:
        from . import bots  # lazy import to dodge a cycle

        await bots.maybe_reply(message)
