"""Conventus application entrypoint.

Serves the JSON API, the realtime WebSocket, and the built React SPA — all from
one process so the whole room fits in a single container.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# Ensure the web app manifest is served with the right content type.
mimetypes.add_type("application/manifest+json", ".webmanifest")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, security
from .collab import hub as collab_hub
from .voice import hub as voice_hub
from .routers import (
    admin,
    agent,
    auth,
    boards,
    bots,
    channels,
    conversations,
    dms,
    files,
    folders,
    members,
    messages,
    push,
    search,
)
from .ws import hub

API_DESCRIPTION = """
The **Conventus** REST API — everything the UI does, you can automate: post
messages, run bots, upload files, manage the room, and more.

### Authentication

Every endpoint except `GET /api/health`, `GET /api/auth/config`,
`POST /api/auth/login` and `GET /api/push/config` requires a **bearer token**.

1. `POST /api/auth/login` with a name and password returns a token. The same
   password field accepts the room password, the admin password, or a
   reserved-name password.
2. Send it on every request as `Authorization: Bearer <token>`.

The same token powers scripts, bots and scheduled posts. **Admin-only**
endpoints (bot management, name reservation, export/import, board/channel
deletion) require a token minted by logging in with the admin password.

### Realtime

Beyond REST, the server exposes a presence/message WebSocket at `/ws?token=…`
and a Yjs collaboration relay at `/collab/{doc}?token=…` (binary frames).

Interactive docs: **`/docs`** (Swagger UI) and **`/redoc`**. Raw schema:
`/openapi.json`.
"""

TAGS_METADATA = [
    {"name": "auth", "description": "Enter the room and mint a session token."},
    {"name": "channels", "description": "Public channels and their messages."},
    {"name": "dms", "description": "Direct messages between two participants."},
    {"name": "messages", "description": "Edit, delete, react, pin and reply to messages."},
    {"name": "search", "description": "Search messages across channels and your DMs."},
    {"name": "members", "description": "Roster, presence, status and avatars."},
    {"name": "boards", "description": "Collaborative canvases and whiteboards."},
    {"name": "files", "description": "File uploads and the ephemeral Drive."},
    {"name": "bots", "description": "OpenAI-compatible channel bots (admin)."},
    {"name": "agent", "description": "The room Assistant: config, private conversations, completion."},
    {"name": "push", "description": "Web Push subscription management."},
    {"name": "admin", "description": "Reserve names, manage members, export/import the room."},
]

app = FastAPI(
    title="Conventus API",
    version="1.0.0",
    summary="An ephemeral, self-hostable, Slack-like room — fully scriptable.",
    description=API_DESCRIPTION,
    openapi_tags=TAGS_METADATA,
    license_info={"name": "MIT"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(channels.router)
app.include_router(dms.router)
app.include_router(messages.router)
app.include_router(members.router)
app.include_router(search.router)
app.include_router(push.router)
app.include_router(boards.router)
app.include_router(folders.router)
app.include_router(files.router)
app.include_router(bots.router)
app.include_router(agent.router)
app.include_router(conversations.router)
app.include_router(admin.router)


@app.on_event("startup")
async def _startup() -> None:
    config.ensure_dirs()
    db.init()


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "room": config.ROOM_NAME}


async def _announce_presence() -> None:
    await hub.broadcast("presence", {"online": hub.online()})


@app.websocket("/ws")
async def websocket_endpoint(socket: WebSocket, token: str = "") -> None:
    data = security.read_token(token)
    if not data:
        await socket.close(code=4401)
        return
    name = data["name"]
    await hub.connect(name, socket)
    db.execute("UPDATE users SET last_seen = ? WHERE name = ?", (db.now(), name))
    await _announce_presence()
    try:
        while True:
            msg = await socket.receive_json()
            kind = msg.get("type")
            if kind == "typing":
                payload = {"name": name, **{k: msg.get(k) for k in ("channel_id", "dm_id")}}
                if msg.get("dm_id"):
                    other = msg.get("with")
                    if other:
                        await hub.send_to_users([other], "typing", payload)
                else:
                    await hub.broadcast("typing", payload)
            # any other inbound types are ignored for now
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.disconnect(name, socket)
        await _announce_presence()


@app.websocket("/collab/{doc}")
async def collab_endpoint(socket: WebSocket, doc: str, token: str = "") -> None:
    await collab_hub.handle(doc, socket, token)


@app.websocket("/voice/{room}")
async def voice_endpoint(socket: WebSocket, room: str, token: str = "") -> None:
    await voice_hub.handle(room, socket, token)


# --- Static SPA ----------------------------------------------------------

_STATIC = config.STATIC_DIR
_ASSETS = _STATIC / "assets"
if _ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    """Serve real static files when present, otherwise fall back to index.html
    so client-side routing works."""
    if full_path.startswith("api/") or full_path == "ws":
        return JSONResponse({"detail": "Not found"}, status_code=404)
    candidate = (_STATIC / full_path) if full_path else None
    if candidate and candidate.is_file():
        return FileResponse(candidate)
    index = _STATIC / "index.html"
    if index.is_file():
        return FileResponse(index)
    return JSONResponse(
        {"detail": "Frontend not built. Run the Vite build or use Docker."},
        status_code=503,
    )
