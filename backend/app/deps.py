"""Shared FastAPI dependencies for authentication."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, Header, HTTPException, status

from . import db, security


def _decode(authorization: Optional[str]) -> Optional[dict[str, Any]]:
    if not authorization:
        return None
    token = authorization
    if authorization.lower().startswith("bearer "):
        token = authorization[7:]
    return security.read_token(token.strip())


def current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    data = _decode(authorization)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    # NB: we deliberately do *not* write last_seen here. Doing so on every
    # authenticated request turns reads into writes and serializes them through
    # the db lock. Presence is tracked in-memory by the WebSocket hub, and
    # last_seen is refreshed on connect and on message send instead.
    return data


def require_admin(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin only"
        )
    return user
