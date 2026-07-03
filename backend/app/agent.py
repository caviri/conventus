"""The room's single configurable Assistant.

One OpenAI-compatible endpoint (stored in the ``agent`` table) powers four
surfaces: private conversations, an inline reply when @mentioned in a channel,
live-document text completion, and structured kanban card fill.

The streaming reply loop (``stream_reply``) is shared with channel bots — see
``bots.py``, which calls into here. This module never imports ``bots`` so the
dependency stays one-directional.
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Callable, Optional

import httpx

from . import db, messaging, previews, security
from .ws import hub

CONTEXT_LIMIT = 20
STREAM_FLUSH_CHARS = 24  # how many new chars before we push a live update

# Reasoning models (e.g. gpt-oss) spend tokens on an internal trace before the
# answer; give them ample budget so they don't get cut off with empty content.
REASONING_MAX_TOKENS = 4096


def reasoning_budget(config: dict[str, Any]) -> Optional[int]:
    """max_tokens to request for this config, or None for the server default."""
    return REASONING_MAX_TOKENS if config.get("model_type") == "reasoning" else None


# --- config --------------------------------------------------------------

def get_assistant() -> dict[str, Any]:
    """The bot flagged as the room Assistant (the Gardener), or {} if none."""
    return db.query_one("SELECT * FROM bots WHERE is_assistant = 1") or {}


# Backwards-compatible alias — the Assistant config is now an is_assistant bot.
get_config = get_assistant


def is_enabled(config: Optional[dict[str, Any]] = None) -> bool:
    cfg = config if config is not None else get_assistant()
    return bool(cfg.get("enabled")) and bool(cfg.get("base_url"))


def _endpoint(base_url: str) -> str:
    base = (base_url or "").rstrip("/")
    return base if base.endswith("/chat/completions") else f"{base}/chat/completions"


def _mentioned(text: str, name: str) -> bool:
    lowered = (text or "").lower()
    return f"@{name.lower()}" in lowered or name.lower() in lowered


# --- raw model calls -----------------------------------------------------

async def stream_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: Optional[int] = None,
) -> AsyncIterator[str]:
    """Yield content deltas from an OpenAI-compatible /chat/completions stream."""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
    if max_tokens:
        payload["max_tokens"] = max_tokens
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST", _endpoint(base_url), headers=headers, json=payload
        ) as resp:
            if resp.status_code >= 400:
                # Surface the API's actual reason (e.g. "key not allowed to access
                # model X") instead of a bare "403 for url …".
                body = (await resp.aread()).decode("utf-8", "replace").strip()
                raise RuntimeError(f"HTTP {resp.status_code}: {body[:400]}")
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
                    yield delta


async def complete(
    messages: list[dict[str, str]],
    *,
    json_mode: bool = False,
    config: Optional[dict[str, Any]] = None,
) -> str:
    """Non-streaming completion → the full assistant message text."""
    cfg = config if config is not None else get_config()
    headers = {"Content-Type": "application/json"}
    api_key = security.resolve_secret(cfg.get("api_key"))
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "stream": False,
    }
    budget = reasoning_budget(cfg)
    if budget:
        payload["max_tokens"] = budget
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(_endpoint(cfg["base_url"]), headers=headers, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
    return data["choices"][0]["message"]["content"] or ""


# --- streaming reply (shared with bots) ----------------------------------

async def stream_reply(
    config: dict[str, Any],
    messages: list[dict[str, str]],
    make_blank: Callable[[], int],
) -> None:
    """Stream a reply from ``config`` into a freshly-created message row.

    ``make_blank`` inserts the empty ``kind='bot'`` row (with whatever
    channel_id/conversation_id is appropriate) and returns its id. We create it
    lazily on the first delta, flush updates as text accumulates, and attach
    link previews at the end. Errors are surfaced inline in the message.
    """
    text = ""
    flushed = 0
    message_id: int | None = None

    async def ensure() -> int:
        nonlocal message_id
        if message_id is None:
            message_id = make_blank()
            msg = messaging.get_message(message_id)
            if msg:
                await messaging.broadcast_new(msg)
        return message_id

    async def flush() -> None:
        mid = await ensure()
        db.execute("UPDATE messages SET content = ? WHERE id = ?", (text, mid))
        msg = messaging.get_message(mid)
        if msg:
            await messaging.broadcast_update(msg)

    name = config.get("name", "Assistant")
    try:
        async for delta in stream_chat(
            config["base_url"],
            security.resolve_secret(config.get("api_key")),
            config["model"],
            messages,
            max_tokens=reasoning_budget(config),
        ):
            text += delta
            if len(text) - flushed >= STREAM_FLUSH_CHARS:
                flushed = len(text)
                await flush()
    except Exception as exc:  # noqa: BLE001 — surface the failure to the user
        text = (text + f"\n\n⚠️ _{name} error: {exc}_").strip() or (
            f"⚠️ _{name} couldn't respond: {exc}_"
        )

    if not text.strip():
        return

    mid = await ensure()
    found = await previews.fetch_all(previews.extract_urls(text))
    db.execute(
        "UPDATE messages SET content = ?, previews = ? WHERE id = ?",
        (text, db.dumps(found), mid),
    )
    final = messaging.get_message(mid)
    if final:
        await messaging.broadcast_update(final)


# --- history helpers -----------------------------------------------------

def _to_messages(rows: list[dict[str, Any]], agent_name: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        role = "assistant" if row["author"] == agent_name else "user"
        prefix = "" if role == "assistant" else f"{row['author']}: "
        out.append({"role": role, "content": f"{prefix}{row['content']}"})
    return out


def _conversation_history(conversation_id: int, agent_name: str) -> list[dict[str, str]]:
    # Context resets at the most recent "new conversation" divider (a system
    # message), so each new segment starts the Assistant fresh.
    div = db.query_one(
        "SELECT MAX(id) AS m FROM messages WHERE conversation_id = ? AND kind = 'system'",
        (conversation_id,),
    )
    after = (div and div["m"]) or 0
    rows = db.query_all(
        "SELECT author, content FROM messages "
        "WHERE conversation_id = ? AND id > ? AND kind != 'system' AND content != '' "
        "ORDER BY id DESC LIMIT ?",
        (conversation_id, after, CONTEXT_LIMIT),
    )
    rows.reverse()
    return _to_messages(rows, agent_name)


# --- triggers ------------------------------------------------------------
# Channel replies (including the Assistant's @mention + awake sessions) are
# handled uniformly for every bot in ``bots.maybe_reply``.


async def reply_in_conversation(conversation_id: int) -> None:
    """Stream the Assistant's reply into a private conversation thread."""
    convo = db.query_one("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    if not convo:
        return
    cfg = get_assistant()
    name = cfg.get("name", "Assistant")

    if not is_enabled(cfg):
        # Don't leave the user hanging — drop a helpful note in the thread.
        mid = db.execute(
            "INSERT INTO messages(conversation_id, author, kind, content, created_at) "
            "VALUES (?, ?, 'bot', ?, ?)",
            (
                conversation_id,
                name,
                "⚠️ The Assistant isn't configured yet. An admin can set it up in "
                "**Settings → Assistant**.",
                db.now(),
            ),
        )
        msg = messaging.get_message(mid)
        if msg:
            await messaging.broadcast_new(msg)
        return

    await hub.send_to_users(
        [convo["owner"]], "typing", {"name": name, "conversation_id": conversation_id}
    )
    system = convo["system_prompt"] or cfg["system_prompt"]
    msgs: list[dict[str, str]] = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(_conversation_history(conversation_id, name))

    def make_blank() -> int:
        return db.execute(
            "INSERT INTO messages(conversation_id, author, kind, content, created_at) "
            "VALUES (?, ?, 'bot', '', ?)",
            (conversation_id, name, db.now()),
        )

    await stream_reply(cfg, msgs, make_blank)
