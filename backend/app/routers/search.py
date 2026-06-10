"""Full-text-ish message search across channels and the user's DMs."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db, messaging
from ..deps import current_user

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
async def search(q: str = "", limit: int = 40, user=Depends(current_user)):
    term = q.strip()
    if not term:
        return []
    limit = max(1, min(limit, 100))
    me = user["name"]
    like = f"%{term}%"
    rows = db.query_all(
        "SELECT * FROM messages WHERE content LIKE ? AND kind != 'system' AND ("
        "  channel_id IS NOT NULL OR "
        "  dm_id IN (SELECT id FROM dms WHERE user_a = ? OR user_b = ?)"
        ") ORDER BY id DESC LIMIT ?",
        (like, me, me, limit),
    )
    results = messaging.serialize_many(rows)

    channels = {c["id"]: c["name"] for c in db.query_all("SELECT id, name FROM channels")}
    for r in results:
        if r["channel_id"]:
            r["location"] = {
                "type": "channel",
                "id": r["channel_id"],
                "name": channels.get(r["channel_id"], "channel"),
            }
        else:
            dm = db.query_one(
                "SELECT user_a, user_b FROM dms WHERE id = ?", (r["dm_id"],)
            )
            other = dm["user_b"] if dm and dm["user_a"] == me else (dm["user_a"] if dm else "?")
            r["location"] = {"type": "dm", "id": r["dm_id"], "with": other}
    return results
