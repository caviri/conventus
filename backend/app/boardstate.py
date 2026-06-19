"""Server-side read/write access to board Yjs documents.

Kanban cards/columns and the live-document text live only in the collab update
log (``collab_updates``). We rebuild the document with **pycrdt** (wire-compatible
with the frontend's yjs), read structured content, and for additions compute a
*minimal* update which we persist and return so the caller can relay it to live
viewers through the collab hub.
"""
from __future__ import annotations

import uuid
from typing import Any, Callable

from pycrdt import Array, Doc, Map, Text

from . import db


def _uid() -> str:
    return uuid.uuid4().hex


def _load(doc_name: str) -> Doc:
    doc = Doc()
    rows = db.query_all(
        "SELECT data FROM collab_updates WHERE doc = ? ORDER BY id", (doc_name,)
    )
    for row in rows:
        data = row["data"]
        if data:
            doc.apply_update(bytes(data))
    return doc


def _mutate(doc_name: str, fn: Callable[[Doc], None]) -> bytes:
    """Apply ``fn`` to the board doc and persist the resulting incremental update.

    Returns the binary update so the router can broadcast it to live viewers.
    """
    doc = _load(doc_name)
    before = doc.get_state()
    with doc.transaction():
        fn(doc)
    update = doc.get_update(before)
    db.execute("INSERT INTO collab_updates(doc, data) VALUES (?, ?)", (doc_name, update))
    return update


# --- reads ---------------------------------------------------------------

def read_kanban(doc_name: str) -> dict[str, Any]:
    doc = _load(doc_name)
    cols = doc.get("columns", type=Array)
    cards = doc.get("cards", type=Array)
    return {
        "columns": [c.to_py() for c in cols],
        "cards": [c.to_py() for c in cards],
    }


def read_canvas(doc_name: str) -> dict[str, Any]:
    doc = _load(doc_name)
    text = str(doc.get("content", type=Text))
    return {"text": text}


# --- writes --------------------------------------------------------------

def add_card(doc_name: str, fields: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    """Append a kanban card. Targets the given column, else the first column,
    creating a "To do" column when the board has none."""
    card: dict[str, Any] = {"id": _uid()}
    for key in ("text", "col", "tags", "assignee", "due", "image", "link"):
        val = fields.get(key)
        if val not in (None, ""):
            card[key] = val

    def fn(doc: Doc) -> None:
        cols = doc.get("columns", type=Array)
        cards = doc.get("cards", type=Array)
        if not card.get("col"):
            if len(cols) == 0:
                col_id = _uid()
                cols.append(Map({"id": col_id, "title": "To do"}))
            else:
                col_id = cols[0].to_py()["id"]
            card["col"] = col_id
        cards.append(Map(dict(card)))

    update = _mutate(doc_name, fn)
    return card, update


def add_column(doc_name: str, title: str) -> tuple[dict[str, Any], bytes]:
    col = {"id": _uid(), "title": title.strip() or "New list"}

    def fn(doc: Doc) -> None:
        doc.get("columns", type=Array).append(Map(dict(col)))

    update = _mutate(doc_name, fn)
    return col, update


def append_text(doc_name: str, text: str) -> tuple[bytes, int]:
    """Append text to the live document, separating from existing content with a
    newline. Returns (update, new_length)."""
    new_len = 0

    def fn(doc: Doc) -> None:
        nonlocal new_len
        t = doc.get("content", type=Text)
        cur = str(t)
        prefix = "" if (not cur or cur.endswith("\n")) else "\n"
        t.insert(len(cur), prefix + text)
        new_len = len(str(t))

    update = _mutate(doc_name, fn)
    return update, new_len
