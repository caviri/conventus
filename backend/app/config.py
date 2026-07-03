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

# Used to sign session tokens and to encrypt stored bot API keys. If you don't
# pin it, sessions reset on restart — which is usually fine for an ephemeral
# room, but set it for stability (and to enable at-rest key encryption).
SECRET_KEY_SET: bool = bool(os.environ.get("SECRET_KEY", "").strip())
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

# Optional: point the room Assistant at an endpoint from the environment. When
# both AGENT_ENDPOINT and AGENT_TOKEN are set, the Assistant is enabled on startup
# with that endpoint + token (handy for reproducible deploys). The model, type and
# name are normally set by an admin in Settings → Assistant; the AGENT_MODEL /
# AGENT_MODEL_TYPE / AGENT_NAME vars are optional overrides that only apply when
# explicitly set and never overwrite an admin's Settings choices on restart.
AGENT_ENDPOINT: str = _env("AGENT_ENDPOINT", "")
AGENT_TOKEN: str = _env("AGENT_TOKEN", "")
AGENT_MODEL: str = _env("AGENT_MODEL", "")
AGENT_MODEL_TYPE: str = _env("AGENT_MODEL_TYPE", "")  # standard | reasoning
AGENT_NAME: str = _env("AGENT_NAME", "")

# WebRTC ICE servers for call rooms. Call media is peer-to-peer; the server only
# relays signaling (backend/app/voice.py). STUN lets peers discover their public
# address and works across most home/office NATs. Users behind symmetric NAT or
# strict firewalls also need a TURN relay — set TURN_URLS (+ credentials) to one.
#   STUN_URLS  — comma-separated stun: URLs (default: Google's public STUN)
#   TURN_URLS  — comma-separated turn:/turns: URLs (empty = no TURN)
#   TURN_USERNAME / TURN_PASSWORD — credentials for the TURN server
# Base-map style for map boards (a MapLibre style JSON URL). The default is
# OpenFreeMap's free, keyless vector style — like the STUN default, it's the
# one external service the feature leans on out of the box; point it at your
# own tile server to stay fully self-contained. Users can also override it
# per-browser in Settings.
MAP_STYLE_URL: str = _env("MAP_STYLE_URL", "https://tiles.openfreemap.org/styles/liberty")

STUN_URLS: str = _env("STUN_URLS", "stun:stun.l.google.com:19302")
TURN_URLS: str = _env("TURN_URLS", "")
TURN_USERNAME: str = _env("TURN_USERNAME", "")
TURN_PASSWORD: str = _env("TURN_PASSWORD", "")


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def ice_servers() -> list[dict]:
    """RTCIceServer entries handed to the browser when joining a call room."""
    servers: list[dict] = []
    stun = _split(STUN_URLS)
    if stun:
        servers.append({"urls": stun})
    turn = _split(TURN_URLS)
    if turn:
        entry: dict = {"urls": turn}
        if TURN_USERNAME:
            entry["username"] = TURN_USERNAME
        if TURN_PASSWORD:
            entry["credential"] = TURN_PASSWORD
        servers.append(entry)
    return servers


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
