"""OpenAI-compatible chat bots that live inside channels.

A bot is just a name plus an OpenAI-compatible endpoint (base_url + api_key +
model). When a human posts in a channel the bot watches, we assemble recent
context and ask the endpoint for a reply, then post it back as a bot message.
"""
from __future__ import annotations

from typing import Any

from . import agent, db
from .ws import hub

CONTEXT_LIMIT = agent.CONTEXT_LIMIT


def _bot_watches(bot: dict[str, Any], channel_id: int) -> bool:
    channels = db.loads(bot["channels"], [])
    return not channels or channel_id in channels


def _mentioned(text: str, name: str) -> bool:
    lowered = (text or "").lower()
    return f"@{name.lower()}" in lowered or name.lower() in lowered


async def maybe_reply(message: dict[str, Any]) -> None:
    channel_id = message["channel_id"]
    bots = db.query_all("SELECT * FROM bots WHERE enabled = 1")
    for bot in bots:
        if not _bot_watches(bot, channel_id):
            continue
        if bot["trigger"] == "mention" and not _mentioned(
            message["content"], bot["name"]
        ):
            continue
        await _respond(bot, channel_id)


def _history(channel_id: int, bot_name: str) -> list[dict[str, str]]:
    rows = db.query_all(
        "SELECT author, content, kind FROM messages "
        "WHERE channel_id = ? AND kind != 'system' AND content != '' "
        "ORDER BY id DESC LIMIT ?",
        (channel_id, CONTEXT_LIMIT),
    )
    rows.reverse()
    history: list[dict[str, str]] = []
    for row in rows:
        role = "assistant" if row["author"] == bot_name else "user"
        prefix = "" if role == "assistant" else f"{row['author']}: "
        history.append({"role": role, "content": f"{prefix}{row['content']}"})
    return history


async def _respond(bot: dict[str, Any], channel_id: int) -> None:
    messages: list[dict[str, str]] = []
    if bot["system_prompt"]:
        messages.append({"role": "system", "content": bot["system_prompt"]})
    messages.extend(_history(channel_id, bot["name"]))

    # Show the bot as "typing" while it thinks.
    await hub.broadcast("typing", {"name": bot["name"], "channel_id": channel_id})

    def make_blank() -> int:
        return db.execute(
            "INSERT INTO messages(channel_id, author, kind, content, created_at) "
            "VALUES (?, ?, 'bot', '', ?)",
            (channel_id, bot["name"], db.now()),
        )

    await agent.stream_reply(bot, messages, make_blank)
