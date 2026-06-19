"""Room roster, presence, and per-user status."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import agent, db
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/members", tags=["members"])


class StatusUpdate(BaseModel):
    status: str = Field(default="", max_length=80)


class AvatarUpdate(BaseModel):
    avatar: str = Field(default="", max_length=300)


@router.get("")
async def list_members(user=Depends(current_user)):
    rows = db.query_all(
        "SELECT name, color, is_admin, reserved, status, avatar, last_seen "
        "FROM users ORDER BY name"
    )
    online = set(hub.online())
    members = [
        {
            "name": r["name"],
            "color": r["color"],
            "is_admin": bool(r["is_admin"]),
            "reserved": bool(r["reserved"]),
            "status": r["status"],
            "avatar": r["avatar"],
            "online": r["name"] in online,
            "last_seen": r["last_seen"],
            "is_agent": False,
        }
        for r in rows
    ]
    # Surface the Assistant in the roster (when enabled) as an always-present
    # member, so people can see it's here and start a conversation with it.
    cfg = agent.get_config()
    if agent.is_enabled(cfg):
        members.append(
            {
                "name": cfg["name"],
                "color": cfg["color"],
                "is_admin": False,
                "reserved": True,
                "status": "AI assistant",
                "avatar": cfg["avatar"],
                "online": True,
                "last_seen": db.now(),
                "is_agent": True,
            }
        )
    return members


@router.post("/avatar")
async def set_avatar(req: AvatarUpdate, user=Depends(current_user)):
    db.execute(
        "UPDATE users SET avatar = ? WHERE name = ?",
        (req.avatar.strip(), user["name"]),
    )
    await hub.broadcast("member.update", {"name": user["name"]})
    return {"ok": True, "avatar": req.avatar.strip()}


@router.post("/status")
async def set_status(req: StatusUpdate, user=Depends(current_user)):
    db.execute(
        "UPDATE users SET status = ? WHERE name = ?",
        (req.status.strip(), user["name"]),
    )
    await hub.broadcast("member.update", {"name": user["name"]})
    return {"ok": True, "status": req.status.strip()}
