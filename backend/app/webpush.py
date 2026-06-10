"""Web Push notifications: VAPID key management, subscription storage, and
best-effort delivery to subscribed clients.

The VAPID keypair is generated once and persisted under DATA_DIR so push
subscriptions stay valid across restarts. Sending is done in a threadpool
(pywebpush is synchronous) and dead subscriptions are pruned automatically.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any, Optional

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush

from . import config, db

log = logging.getLogger("conventus.webpush")

_VAPID: dict[str, Any] = {}
VAPID_SUBJECT = "mailto:admin@conventus.local"


def _vapid() -> dict[str, Any]:
    if _VAPID:
        return _VAPID
    config.ensure_dirs()
    pem_path = config.DATA_DIR / "vapid_private.pem"
    v = Vapid01()
    if pem_path.exists():
        v = Vapid01.from_file(str(pem_path))
    else:
        v.generate_keys()
        v.save_key(str(pem_path))
    raw = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    public = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    _VAPID.update(pem_path=str(pem_path), public_key=public)
    return _VAPID


def public_key() -> str:
    return _vapid()["public_key"]


def store_subscription(author: str, subscription: dict) -> None:
    endpoint = subscription.get("endpoint")
    if not endpoint:
        return
    db.execute(
        "INSERT OR REPLACE INTO push_subscriptions(endpoint, author, data, created_at) "
        "VALUES (?, ?, ?, ?)",
        (endpoint, author, db.dumps(subscription), db.now()),
    )


def remove_subscription(endpoint: str) -> None:
    db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))


def _subscriptions_for(names: list[str]) -> list[dict]:
    if not names:
        return []
    marks = ",".join("?" * len(names))
    rows = db.query_all(
        f"SELECT data FROM push_subscriptions WHERE author IN ({marks})", names
    )
    return [db.loads(r["data"], None) for r in rows if r["data"]]


def _send_one(sub: dict, payload: str) -> None:
    try:
        webpush(
            subscription_info=sub,
            data=payload,
            vapid_private_key=_vapid()["pem_path"],
            vapid_claims={"sub": VAPID_SUBJECT},
            timeout=10,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):  # gone — prune it
            remove_subscription(sub.get("endpoint", ""))
        else:
            log.warning("web push failed: %s", exc)
    except Exception as exc:
        log.warning("web push error: %s", exc)


async def send_to_users(names: list[str], payload: dict) -> None:
    subs = _subscriptions_for(names)
    if not subs:
        return
    data = json.dumps(payload)
    await asyncio.gather(
        *[asyncio.to_thread(_send_one, sub, data) for sub in subs]
    )
