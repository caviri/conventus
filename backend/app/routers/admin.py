"""Admin powers: reserve names, manage members, export/import the whole room.

Export bundles the room (all tables + every uploaded file) into a single zip so
you can snapshot an ephemeral room, tear it down, and rehydrate it later.
"""
from __future__ import annotations

import io
import json
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import config, db, security
from ..deps import require_admin
from ..routers.auth import color_for
from ..ws import hub

router = APIRouter(prefix="/api/admin", tags=["admin"])

TABLES = [
    "users", "folders", "channels", "boards", "games", "dms",
    "messages", "reactions", "files", "bots",
]


class ReserveName(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1)
    is_admin: bool = False


@router.post("/reserve")
async def reserve_name(req: ReserveName, user=Depends(require_admin)):
    name = req.name.strip()
    existing = db.query_one("SELECT * FROM users WHERE name = ?", (name,))
    password_hash = security.hash_password(req.password)
    if existing:
        db.execute(
            "UPDATE users SET password_hash = ?, reserved = 1, is_admin = ? WHERE name = ?",
            (password_hash, 1 if req.is_admin else existing["is_admin"], name),
        )
    else:
        db.execute(
            "INSERT INTO users(name, password_hash, is_admin, color, reserved, "
            "created_at, last_seen) VALUES (?, ?, ?, ?, 1, ?, 0)",
            (name, password_hash, 1 if req.is_admin else 0, color_for(name), db.now()),
        )
    return {"ok": True, "name": name}


@router.delete("/members/{name}")
async def remove_member(name: str, user=Depends(require_admin)):
    if not db.query_one("SELECT 1 FROM users WHERE name = ?", (name,)):
        raise HTTPException(status_code=404, detail="No such user")
    db.execute("DELETE FROM users WHERE name = ?", (name,))
    await hub.broadcast("member.remove", {"name": name})
    return {"ok": True}


@router.post("/export")
async def export_room(include_secrets: bool = False, user=Depends(require_admin)):
    """Bundle the room into a zip. Bot API keys are stripped by default — pass
    ``?include_secrets=true`` for a full backup whose zip then contains usable
    plaintext credentials (guard it accordingly). ``env:`` references are kept
    either way; they're pointers, not secrets."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        dump = {table: db.query_all(f"SELECT * FROM {table}") for table in TABLES}
        for bot in dump["bots"]:
            key = bot.get("api_key") or ""
            if key.startswith(security.ENV_PREFIX):
                continue  # a pointer to an env var — safe and useful to keep
            # Decrypt for portability (a new deploy has a different SECRET_KEY).
            bot["api_key"] = security.resolve_secret(key) if include_secrets else ""
        zf.writestr("conventus.json", json.dumps(dump, ensure_ascii=False, indent=2))
        for f in dump["files"]:
            path = config.FILES_DIR / f["id"]
            if path.exists():
                zf.write(path, f"files/{f['id']}")
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="conventus-export.zip"'},
    )


@router.post("/import")
async def import_room(file: UploadFile = File(...), user=Depends(require_admin)):
    raw = await file.read()
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            dump = json.loads(zf.read("conventus.json"))
            # Exports strip bot keys by default; keep the keys this room
            # already has for same-named bots instead of blanking them.
            prior_keys = {
                b["name"]: b["api_key"]
                for b in db.query_all("SELECT name, api_key FROM bots")
                if b["api_key"]
            }
            for bot in dump.get("bots", []):
                key = bot.get("api_key") or ""
                if not key:
                    bot["api_key"] = prior_keys.get(bot.get("name"), "")
                else:
                    bot["api_key"] = security.seal_secret(key)
            # Wipe current room.
            for table in TABLES:
                db.execute(f"DELETE FROM {table}")
            for table in TABLES:
                for row in dump.get(table, []):
                    cols = ", ".join(row.keys())
                    placeholders = ", ".join("?" for _ in row)
                    db.execute(
                        f"INSERT INTO {table}({cols}) VALUES ({placeholders})",
                        tuple(row.values()),
                    )
            # Restore files.
            config.ensure_dirs()
            for name in zf.namelist():
                if name.startswith("files/") and not name.endswith("/"):
                    file_id = name.split("/", 1)[1]
                    (config.FILES_DIR / file_id).write_bytes(zf.read(name))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid export file: {exc}")

    await hub.broadcast("room.reload", {})
    return {"ok": True}


# Everything wiped by a factory reset — the room tables plus private threads,
# the Assistant/agent config, board CRDT contents and push subscriptions.
RESET_TABLES = TABLES + ["conversations", "agent", "collab_updates", "push_subscriptions"]


@router.post("/reset")
async def factory_reset(user=Depends(require_admin)):
    """Erase the entire room and re-seed a fresh install: deletes all messages,
    channels, boards (and their contents), members, bots, files and the Assistant
    config, then recreates the defaults (general channel, the three boards, a
    disabled Gardener). Destructive and irreversible."""
    for table in RESET_TABLES:
        db.execute(f"DELETE FROM {table}")
    # Drop uploaded files from disk.
    config.ensure_dirs()
    for f in config.FILES_DIR.glob("*"):
        try:
            if f.is_file():
                f.unlink()
        except OSError:
            pass
    # Re-seed defaults (default channel, the three boards incl. kanban, Gardener).
    db.init()
    await hub.broadcast("room.reload", {})
    return {"ok": True}
