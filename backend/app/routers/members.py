"""Room roster, presence, and per-user status."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import db
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
    return [
        {
            "name": r["name"],
            "color": r["color"],
            "is_admin": bool(r["is_admin"]),
            "reserved": bool(r["reserved"]),
            "status": r["status"],
            "avatar": r["avatar"],
            "online": r["name"] in online,
            "last_seen": r["last_seen"],
        }
        for r in rows
    ]


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
