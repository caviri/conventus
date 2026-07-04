"""Web Push subscription endpoints and per-user notification preferences."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db, webpush
from ..deps import current_user

router = APIRouter(prefix="/api/push", tags=["push"])


class Subscribe(BaseModel):
    subscription: dict


class Unsubscribe(BaseModel):
    endpoint: str


class NotifyPrefs(BaseModel):
    mentions: bool = True
    replies: bool = True
    dms: bool = True
    all_channel: bool = False


@router.get("/prefs")
async def get_prefs(user=Depends(current_user)):
    """What should push for me: mentions, replies, DMs, every channel message."""
    return webpush.prefs_for(user["name"])


@router.put("/prefs")
async def set_prefs(req: NotifyPrefs, user=Depends(current_user)):
    prefs = req.model_dump()
    db.execute(
        "UPDATE users SET notify_prefs = ? WHERE name = ?",
        (db.dumps(prefs), user["name"]),
    )
    return prefs


@router.get("/config")
async def push_config():
    """Unauthenticated: the VAPID public key the client subscribes with."""
    return {"publicKey": webpush.public_key()}


@router.post("/subscribe")
async def subscribe(req: Subscribe, user=Depends(current_user)):
    webpush.store_subscription(user["name"], req.subscription)
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(req: Unsubscribe, user=Depends(current_user)):
    webpush.remove_subscription(req.endpoint)
    return {"ok": True}
