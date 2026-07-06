"""File uploads and the ephemeral "Drive" view.

Files live on disk under DATA_DIR/files with a uuid name; metadata lives in the
db. The Drive is simply a listing of everything uploaded to the room.
"""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config, db
from ..deps import current_user

router = APIRouter(prefix="/api/files", tags=["files"])

# Python's mimetypes table is incomplete (and platform-dependent on Windows),
# so pin the media types we care about for inline playback.
for _ext, _mime in {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".ogv": "video/ogg",
    ".mov": "video/quicktime",
    ".m4a": "audio/mp4",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
}.items():
    mimetypes.add_type(_mime, _ext)


def _path_for(file_id: str) -> Path:
    return config.FILES_DIR / file_id


def _serialize(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["original_name"],
        "mime": row["mime"],
        "size": row["size"],
        "uploaded_by": row["uploaded_by"],
        "created_at": row["created_at"],
        "url": f"/api/files/{row['id']}/raw",
    }


async def save_upload(
    file: UploadFile, user: dict, max_bytes: int | None = None, limit_label: str = ""
) -> dict:
    """Stream an upload to FILES_DIR and record its files row (shared with
    custom emoji uploads, which use a much smaller size cap)."""
    config.ensure_dirs()
    cap = max_bytes or config.MAX_UPLOAD_BYTES
    file_id = uuid.uuid4().hex
    dest = _path_for(file_id)
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > cap:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds {limit_label or f'{config.MAX_UPLOAD_MB} MB'} limit",
                )
            out.write(chunk)

    # Trust a specific client-provided type, but when it's missing or the
    # generic octet-stream fallback, infer from the filename extension so that
    # webm/gif/etc. still render inline.
    provided = (file.content_type or "").lower()
    guessed = mimetypes.guess_type(file.filename or "")[0]
    if not provided or provided == "application/octet-stream":
        mime = guessed or provided or "application/octet-stream"
    else:
        mime = provided
    db.execute(
        "INSERT INTO files(id, original_name, mime, size, uploaded_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (file_id, file.filename or "file", mime, size, user["name"], db.now()),
    )
    return db.query_one("SELECT * FROM files WHERE id = ?", (file_id,))


@router.post("")
async def upload(file: UploadFile = File(...), user=Depends(current_user)):
    return _serialize(await save_upload(file, user))


@router.get("")
async def list_files(user=Depends(current_user)):
    # Custom emoji images are backing assets, not Drive content.
    rows = db.query_all(
        "SELECT * FROM files "
        "WHERE id NOT IN (SELECT file_id FROM custom_emojis) "
        "ORDER BY created_at DESC"
    )
    return [_serialize(r) for r in rows]


@router.get("/{file_id}/raw")
async def raw(file_id: str, download: bool = False):
    row = db.query_one("SELECT * FROM files WHERE id = ?", (file_id,))
    path = _path_for(file_id)
    if not row or not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    disposition = "attachment" if download else "inline"
    return FileResponse(
        path,
        media_type=row["mime"],
        filename=row["original_name"],
        headers={
            "Content-Disposition": f'{disposition}; filename="{row["original_name"]}"'
        },
    )


@router.delete("/{file_id}")
async def delete_file(file_id: str, user=Depends(current_user)):
    row = db.query_one("SELECT * FROM files WHERE id = ?", (file_id,))
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    if row["uploaded_by"] != user["name"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    emoji = db.query_one("SELECT name FROM custom_emojis WHERE file_id = ?", (file_id,))
    if emoji:
        raise HTTPException(
            status_code=400,
            detail=f"File is in use by the custom emoji :{emoji['name']}: — delete that instead",
        )
    _path_for(file_id).unlink(missing_ok=True)
    db.execute("DELETE FROM files WHERE id = ?", (file_id,))
    return {"ok": True}
