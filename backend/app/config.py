"""Runtime configuration, all driven by environment variables.

Conventus is meant to be spun up in seconds and torn down just as fast, so
every knob has a sensible default. The only things you really want to override
in a real deployment are ROOM_PASSWORD, ADMIN_PASSWORD and SECRET_KEY.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path


def _env(key: str, default: str) -> str:
    value = os.environ.get(key, "").strip()
    return value if value else default


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, "").strip() or default)
    except ValueError:
        return default


# The single shared password that lets a person into the room.
ROOM_PASSWORD: str = _env("ROOM_PASSWORD", "conventus")

# The password that unlocks the admin panel (reserving names, managing bots,
# exporting/importing the room).
ADMIN_PASSWORD: str = _env("ADMIN_PASSWORD", "admin")

# Used to sign session tokens. If you don't pin it, sessions reset on restart —
# which is usually fine for an ephemeral room, but set it for stability.
SECRET_KEY: str = _env("SECRET_KEY", secrets.token_hex(32))

# Where the SQLite db and uploaded files live. On Hugging Face Spaces with
# persistent storage this is typically /data.
DATA_DIR: Path = Path(_env("DATA_DIR", "./data")).resolve()
DB_PATH: Path = DATA_DIR / "conventus.db"
FILES_DIR: Path = DATA_DIR / "files"

# Directory holding the built React SPA (filled in by the Docker build).
STATIC_DIR: Path = Path(_env("STATIC_DIR", "./static")).resolve()

MAX_UPLOAD_MB: int = _env_int("MAX_UPLOAD_MB", 100)
MAX_UPLOAD_BYTES: int = MAX_UPLOAD_MB * 1024 * 1024

# Session lifetime in seconds (default 7 days).
SESSION_MAX_AGE: int = _env_int("SESSION_MAX_AGE", 7 * 24 * 3600)

PORT: int = _env_int("PORT", 7860)

# A friendly, public name shown in the UI header.
ROOM_NAME: str = _env("ROOM_NAME", "Conventus")


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
