"""OpenAI-compatible chat bots that live inside channels.

A bot is just a name plus an OpenAI-compatible endpoint (base_url + api_key +
model). When a human posts in a channel the bot watches, we assemble recent
context and ask the endpoint for a reply, then post it back as a bot message.
"""
from __future__ import annotations

import time
from typing import Any

from . import agent, db
from .ws import hub

CONTEXT_LIMIT = agent.CONTEXT_LIMIT

# Channel "awake" sessions for mention-triggered bots: an @mention wakes the bot
# in that channel; while awake it follows the whole conversation and replies to
# every message, the window extending with activity. After SESSION_TTL seconds of
# silence it sleeps and ignores non-mentions until woken again.
SESSION_TTL = 300  # 5 minutes
_awake: dict[tuple[int, int], float] = {}  # (bot_id, channel_id) -> awake-until epoch


def _bot_watches(bot: dict[str, Any], channel_id: int) -> bool:
    channels = db.loads(bot["channels"], [])
    return not channels or channel_id in channels


def _mentioned(text: str, name: str) -> bool:
    lowered = (text or "").lower()
    return f"@{name.lower()}" in lowered or name.lower() in lowered


async def maybe_reply(message: dict[str, Any]) -> None:
    channel_id = message["channel_id"]
    now = time.time()
    # If the triggering message lives in a thread, reply inside it (with the
    # thread as context) instead of the main timeline.
    root_id = _thread_root_id(message)
    bots = db.query_all("SELECT * FROM bots WHERE enabled = 1")
    for bot in bots:
        if not _bot_watches(bot, channel_id) or message["author"] == bot["name"]:
            continue
        if bot["trigger"] == "all":
            await _respond(bot, channel_id, root_id)
            continue
        # mention trigger: respond when addressed, or while an awake session lasts.
        key = (bot["id"], channel_id)
        if _mentioned(message["content"], bot["name"]):
            _awake[key] = now + SESSION_TTL
            await _respond(bot, channel_id, root_id)
        elif _awake.get(key, 0) > now:
            _awake[key] = now + SESSION_TTL
            await _respond(bot, channel_id, root_id)


def _thread_root_id(message: dict[str, Any]) -> int | None:
    """The top of the reply chain the message belongs to, or None if it's a
    top-level message (not in a thread)."""
    if not message.get("reply_to"):
        return None
    cur_id, cur_reply = message["id"], message["reply_to"]
    seen: set[int] = set()
    while cur_reply and cur_reply not in seen:
        seen.add(cur_id)
        parent = db.query_one(
            "SELECT id, reply_to FROM messages WHERE id = ?", (cur_reply,)
        )
        if not parent:
            break
        cur_id, cur_reply = parent["id"], parent["reply_to"]
    return cur_id


def _to_history(rows: list[dict[str, Any]], bot_name: str) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for row in rows:
        role = "assistant" if row["author"] == bot_name else "user"
        prefix = "" if role == "assistant" else f"{row['author']}: "
        history.append({"role": role, "content": f"{prefix}{row['content']}"})
    return history


def _history(channel_id: int, bot_name: str) -> list[dict[str, str]]:
    rows = db.query_all(
        "SELECT author, content, kind FROM messages "
        "WHERE channel_id = ? AND kind != 'system' AND content != '' "
        "ORDER BY id DESC LIMIT ?",
        (channel_id, CONTEXT_LIMIT),
    )
    rows.reverse()
    return _to_history(rows, bot_name)


def _thread_history(root_id: int, bot_name: str) -> list[dict[str, str]]:
    """The whole thread (root message + every reply, transitively) as context."""
    rows = db.query_all(
        "WITH RECURSIVE thread(id) AS ("
        "  SELECT id FROM messages WHERE id = ?"
        "  UNION"
        "  SELECT m.id FROM messages m JOIN thread t ON m.reply_to = t.id"
        ") "
        "SELECT author, content FROM messages "
        "WHERE id IN (SELECT id FROM thread) AND kind != 'system' AND content != '' "
        "ORDER BY id DESC LIMIT ?",
        (root_id, CONTEXT_LIMIT),
    )
    rows.reverse()
    return _to_history(rows, bot_name)


async def _respond(
    bot: dict[str, Any], channel_id: int, root_id: int | None = None
) -> None:
    messages: list[dict[str, str]] = []
    if bot["system_prompt"]:
        messages.append({"role": "system", "content": bot["system_prompt"]})
    if root_id is not None:
        messages.extend(_thread_history(root_id, bot["name"]))
    else:
        messages.extend(_history(channel_id, bot["name"]))

    # Show the bot as "typing" while it thinks.
    await hub.broadcast("typing", {"name": bot["name"], "channel_id": channel_id})

    def make_blank() -> int:
        # Attach to the thread root so the reply renders inside the thread.
        return db.execute(
            "INSERT INTO messages(channel_id, author, kind, content, reply_to, created_at) "
            "VALUES (?, ?, 'bot', '', ?, ?)",
            (channel_id, bot["name"], root_id, db.now()),
        )

    await agent.stream_reply(bot, messages, make_blank)
