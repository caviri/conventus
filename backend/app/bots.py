"""OpenAI-compatible chat bots that live inside channels.

A bot is just a name plus an OpenAI-compatible endpoint (base_url + api_key +
model). When a human posts in a channel the bot watches, we assemble recent
context and ask the endpoint for a reply, then post it back as a bot message.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from . import db, messaging, previews
from .ws import hub

CONTEXT_LIMIT = 20
STREAM_FLUSH_CHARS = 24  # how many new chars before we push a live update


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

    base = bot["base_url"].rstrip("/")
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if bot["api_key"]:
        headers["Authorization"] = f"Bearer {bot['api_key']}"
    payload = {"model": bot["model"], "messages": messages, "stream": True}

    # Show the bot as "typing" while it thinks.
    await hub.broadcast("typing", {"name": bot["name"], "channel_id": channel_id})

    message_id: int | None = None
    text = ""
    flushed = 0

    async def ensure_message() -> int:
        nonlocal message_id
        if message_id is None:
            message_id = db.execute(
                "INSERT INTO messages(channel_id, author, kind, content, created_at) "
                "VALUES (?, ?, 'bot', '', ?)",
                (channel_id, bot["name"], db.now()),
            )
            msg = messaging.get_message(message_id)
            if msg:
                await messaging.broadcast_new(msg)
        return message_id

    async def flush() -> None:
        mid = await ensure_message()
        db.execute("UPDATE messages SET content = ? WHERE id = ?", (text, mid))
        msg = messaging.get_message(mid)
        if msg:
            await messaging.broadcast_update(msg)

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if delta:
                        text += delta
                        if len(text) - flushed >= STREAM_FLUSH_CHARS:
                            flushed = len(text)
                            await flush()
    except Exception as exc:
        text = (text + f"\n\n⚠️ _{bot['name']} error: {exc}_").strip() or (
            f"⚠️ _{bot['name']} couldn't respond: {exc}_"
        )

    if not text.strip():
        return

    # Final flush + link previews for whatever the bot produced.
    mid = await ensure_message()
    found = await previews.fetch_all(previews.extract_urls(text))
    db.execute(
        "UPDATE messages SET content = ?, previews = ? WHERE id = ?",
        (text, db.dumps(found), mid),
    )
    final = messaging.get_message(mid)
    if final:
        await messaging.broadcast_update(final)
