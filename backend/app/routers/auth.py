"""Authentication: get into the room with the shared password, pick a name."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import config, db, security
from ..deps import current_user

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
    password: str
    name: str = Field(min_length=1, max_length=32)
    name_password: str | None = None
    admin_password: str | None = None


@router.post("/login")
async def login(req: LoginRequest):
    if not security.constant_time_equals(req.password, config.ROOM_PASSWORD):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong room password"
        )

    name = req.name.strip()
    if not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid name")

    is_admin = False
    if req.admin_password:
        if not security.constant_time_equals(req.admin_password, config.ADMIN_PASSWORD):
            raise HTTPException(status_code=401, detail="Wrong admin password")
        is_admin = True

    user = db.query_one("SELECT * FROM users WHERE name = ?", (name,))
    if user:
        # A reserved name requires its own password.
        if user["reserved"] and user["password_hash"]:
            if not security.verify_password(req.name_password or "", user["password_hash"]):
                raise HTTPException(
                    status_code=401, detail="This name is reserved — wrong password"
                )
        if is_admin:
            db.execute("UPDATE users SET is_admin = 1 WHERE name = ?", (name,))
        db.execute("UPDATE users SET last_seen = ? WHERE name = ?", (db.now(), name))
        is_admin = is_admin or bool(user["is_admin"])
        color = user["color"]
    else:
        # New name. If a password is supplied, the person reserves it for later.
        password_hash = (
            security.hash_password(req.name_password) if req.name_password else None
        )
        color = color_for(name)
        db.execute(
            "INSERT INTO users(name, password_hash, is_admin, color, reserved, "
            "created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                password_hash,
                1 if is_admin else 0,
                color,
                1 if password_hash else 0,
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


@router.get("/config")
async def public_config():
    """Unauthenticated: what the login screen needs to render."""
    return {"room_name": config.ROOM_NAME, "version": "0.1.0"}
