"""Web Push subscription endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import webpush
from ..deps import current_user

router = APIRouter(prefix="/api/push", tags=["push"])


class Subscribe(BaseModel):
    subscription: dict


class Unsubscribe(BaseModel):
    endpoint: str


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
