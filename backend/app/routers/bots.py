"""Bot management (admin only).

Bots are OpenAI-compatible chat endpoints that participate in channels. The
api_key is write-only from the client's perspective: we never send it back.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_user, require_admin
from ..routers.auth import color_for
from ..ws import hub

router = APIRouter(prefix="/api/bots", tags=["bots"])


class BotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    base_url: str
    api_key: str = ""
    model: str = "gpt-4o-mini"
    model_type: str = "standard"  # standard | reasoning
    system_prompt: str = ""
    trigger: str = "mention"  # mention | all
    channels: list[int] = []
    color: str | None = None
    avatar: str = ""


class BotUpdate(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    model_type: str | None = None
    system_prompt: str | None = None
    trigger: str | None = None
    channels: list[int] | None = None
    color: str | None = None
    avatar: str | None = None
    enabled: bool | None = None


def _serialize(row: dict, *, reveal_key: bool = False) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "api_key": row["api_key"] if reveal_key else ("•••" if row["api_key"] else ""),
        "model": row["model"],
        "model_type": row["model_type"],
        "system_prompt": row["system_prompt"],
        "trigger": row["trigger"],
        "channels": db.loads(row["channels"], []),
        "color": row["color"],
        "avatar": row["avatar"],
        "enabled": bool(row["enabled"]),
        "is_assistant": bool(row["is_assistant"]),
    }


@router.get("")
async def list_bots(user=Depends(current_user)):
    # Assistant first, then alphabetical.
    rows = db.query_all("SELECT * FROM bots ORDER BY is_assistant DESC, name")
    return [_serialize(r) for r in rows]


@router.post("")
async def create_bot(req: BotCreate, user=Depends(require_admin)):
    if db.query_one("SELECT 1 FROM bots WHERE name = ?", (req.name,)):
        raise HTTPException(status_code=409, detail="Bot name taken")
    if req.trigger not in ("mention", "all"):
        raise HTTPException(status_code=400, detail="trigger must be 'mention' or 'all'")
    if req.model_type not in ("standard", "reasoning"):
        raise HTTPException(status_code=400, detail="model_type must be 'standard' or 'reasoning'")
    bot_id = db.execute(
        "INSERT INTO bots(name, base_url, api_key, model, model_type, system_prompt, "
        "trigger, channels, color, avatar, enabled, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        (
            req.name,
            req.base_url,
            req.api_key,
            req.model,
            req.model_type,
            req.system_prompt,
            req.trigger,
            db.dumps(req.channels),
            req.color or color_for(req.name),
            req.avatar,
            db.now(),
        ),
    )
    return _serialize(db.query_one("SELECT * FROM bots WHERE id = ?", (bot_id,)))


@router.patch("/{bot_id}")
async def update_bot(bot_id: int, req: BotUpdate, user=Depends(require_admin)):
    row = db.query_one("SELECT * FROM bots WHERE id = ?", (bot_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such bot")
    fields = {
        "base_url": req.base_url,
        "model": req.model,
        "system_prompt": req.system_prompt,
        "trigger": req.trigger,
        "color": req.color,
    }
    if req.model_type is not None:
        if req.model_type not in ("standard", "reasoning"):
            raise HTTPException(status_code=400, detail="model_type must be 'standard' or 'reasoning'")
        fields["model_type"] = req.model_type
    if req.avatar is not None:
        fields["avatar"] = req.avatar
    if req.api_key is not None and req.api_key != "•••":
        fields["api_key"] = req.api_key
    if req.channels is not None:
        fields["channels"] = db.dumps(req.channels)
    if req.enabled is not None:
        fields["enabled"] = 1 if req.enabled else 0

    sets = {k: v for k, v in fields.items() if v is not None}
    if sets:
        assignments = ", ".join(f"{k} = ?" for k in sets)
        db.execute(
            f"UPDATE bots SET {assignments} WHERE id = ?",
            (*sets.values(), bot_id),
        )
    updated = db.query_one("SELECT * FROM bots WHERE id = ?", (bot_id,))
    # The Assistant shows in the roster — nudge clients if it may have changed.
    if row["is_assistant"]:
        await hub.broadcast("member.update", {"name": updated["name"]})
    return _serialize(updated)


@router.post("/{bot_id}/assistant")
async def set_assistant(bot_id: int, user=Depends(require_admin)):
    """Make this bot THE room Assistant (the Gardener role) — it then powers
    private conversations, live-doc completion and kanban fill. Clears the flag
    on every other bot so there is always exactly one."""
    if not db.query_one("SELECT 1 FROM bots WHERE id = ?", (bot_id,)):
        raise HTTPException(status_code=404, detail="No such bot")
    db.execute("UPDATE bots SET is_assistant = 0 WHERE is_assistant = 1")
    db.execute("UPDATE bots SET is_assistant = 1 WHERE id = ?", (bot_id,))
    await hub.broadcast("member.update", {"name": ""})
    return [_serialize(r) for r in db.query_all(
        "SELECT * FROM bots ORDER BY is_assistant DESC, name"
    )]


@router.delete("/{bot_id}")
async def delete_bot(bot_id: int, user=Depends(require_admin)):
    row = db.query_one("SELECT is_assistant FROM bots WHERE id = ?", (bot_id,))
    if not row:
        raise HTTPException(status_code=404, detail="No such bot")
    db.execute("DELETE FROM bots WHERE id = ?", (bot_id,))
    if row["is_assistant"]:
        await hub.broadcast("member.update", {"name": ""})
    return {"ok": True}
