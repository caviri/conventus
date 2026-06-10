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

router = APIRouter(prefix="/api/bots", tags=["bots"])


class BotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    base_url: str
    api_key: str = ""
    model: str = "gpt-4o-mini"
    system_prompt: str = ""
    trigger: str = "mention"  # mention | all
    channels: list[int] = []
    color: str | None = None
    avatar: str = ""


class BotUpdate(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
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
        "system_prompt": row["system_prompt"],
        "trigger": row["trigger"],
        "channels": db.loads(row["channels"], []),
        "color": row["color"],
        "avatar": row["avatar"],
        "enabled": bool(row["enabled"]),
    }


@router.get("")
async def list_bots(user=Depends(current_user)):
    rows = db.query_all("SELECT * FROM bots ORDER BY name")
    return [_serialize(r) for r in rows]


@router.post("")
async def create_bot(req: BotCreate, user=Depends(require_admin)):
    if db.query_one("SELECT 1 FROM bots WHERE name = ?", (req.name,)):
        raise HTTPException(status_code=409, detail="Bot name taken")
    if req.trigger not in ("mention", "all"):
        raise HTTPException(status_code=400, detail="trigger must be 'mention' or 'all'")
    bot_id = db.execute(
        "INSERT INTO bots(name, base_url, api_key, model, system_prompt, trigger, "
        "channels, color, avatar, enabled, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        (
            req.name,
            req.base_url,
            req.api_key,
            req.model,
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
    return _serialize(db.query_one("SELECT * FROM bots WHERE id = ?", (bot_id,)))


@router.delete("/{bot_id}")
async def delete_bot(bot_id: int, user=Depends(require_admin)):
    if not db.query_one("SELECT 1 FROM bots WHERE id = ?", (bot_id,)):
        raise HTTPException(status_code=404, detail="No such bot")
    db.execute("DELETE FROM bots WHERE id = ?", (bot_id,))
    return {"ok": True}
