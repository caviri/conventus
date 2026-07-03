"""Authentication: get into the room with the shared password, pick a name."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import config, db, security
from ..deps import current_user
from ..ws import hub

router = APIRouter(prefix="/api/auth", tags=["auth"])

NAME_RE = re.compile(r"^[A-Za-z0-9 _.\-]{1,32}$")

# Warm, earthy solarpunk · Ghibli palette for member and bot avatars.
_PALETTE = [
    "#e8b24a",  # lantern gold
    "#5a9367",  # leaf green
    "#c97b4a",  # terracotta
    "#6fb98a",  # sage mint
    "#a8763e",  # bark / clay
    "#7a9e3a",  # moss
    "#d98a5b",  # apricot
    "#4f8a8b",  # pond teal
    "#b5563f",  # rust
    "#8a9b5a",  # olive
]


def color_for(name: str) -> str:
    return _PALETTE[sum(map(ord, name)) % len(_PALETTE)]


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=32)


@router.post("/login")
async def login(req: LoginRequest):
    name = req.name.strip()
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid name")

    room_ok = security.constant_time_equals(req.password, config.ROOM_PASSWORD)
    is_admin = security.constant_time_equals(req.password, config.ADMIN_PASSWORD)

    user = db.query_one("SELECT * FROM users WHERE name = ?", (name,))
    reserved_ok = bool(
        user
        and user["reserved"]
        and user["password_hash"]
        and security.verify_password(req.password, user["password_hash"])
    )

    if not (room_ok or is_admin or reserved_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password"
        )

    if user:
        # A reserved name requires its own password.
        if user["reserved"] and user["password_hash"]:
            if not (reserved_ok or is_admin):
                raise HTTPException(
                    status_code=401, detail="This name is reserved — wrong password"
                )
        if is_admin:
            db.execute("UPDATE users SET is_admin = 1 WHERE name = ?", (name,))
        db.execute("UPDATE users SET last_seen = ? WHERE name = ?", (db.now(), name))
        is_admin = is_admin or bool(user["is_admin"])
        color = user["color"]
    else:
        color = color_for(name)
        db.execute(
            "INSERT INTO users(name, password_hash, is_admin, color, reserved, "
            "created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                None,
                1 if is_admin else 0,
                color,
                0,
                db.now(),
                db.now(),
            ),
        )

    token = security.make_token(name, is_admin)
    return {
        "token": token,
        "user": {"name": name, "is_admin": is_admin, "color": color},
    }


@router.get("/me")
async def me(user=Depends(current_user)):
    row = db.query_one("SELECT * FROM users WHERE name = ?", (user["name"],))
    if not row:
        raise HTTPException(status_code=401, detail="Unknown user")
    return {
        "name": row["name"],
        "is_admin": bool(row["is_admin"]) or bool(user.get("is_admin")),
        "color": row["color"],
    }


class ProtectRequest(BaseModel):
    password: str = Field(default="", max_length=128)


@router.post("/protect")
async def protect_name(req: ProtectRequest, user=Depends(current_user)):
    """Protect (or unprotect) your own name with a personal password.

    With a non-empty password the name becomes reserved: logging in with it
    requires that password (the room password alone no longer works). An empty
    password removes the protection.
    """
    row = db.query_one("SELECT * FROM users WHERE name = ?", (user["name"],))
    if not row:
        raise HTTPException(status_code=401, detail="Unknown user")

    if req.password:
        db.execute(
            "UPDATE users SET password_hash = ?, reserved = 1 WHERE name = ?",
            (security.hash_password(req.password), user["name"]),
        )
        reserved = True
    else:
        db.execute(
            "UPDATE users SET password_hash = NULL, reserved = 0 WHERE name = ?",
            (user["name"],),
        )
        reserved = False

    await hub.broadcast("member.update", {"name": user["name"]})
    return {"ok": True, "reserved": reserved}


@router.get("/config")
async def public_config():
    """Unauthenticated: what the login screen needs to render."""
    return {
        "room_name": config.ROOM_NAME,
        "version": "0.1.0",
        "ice_servers": config.ice_servers(),
        "map_style_url": config.MAP_STYLE_URL,
    }
