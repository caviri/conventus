"""Realtime collaboration relay for Yjs documents (markdown canvas, whiteboard).

We don't reimplement the Yjs CRDT server-side; we relay binary updates between
clients and persist the update log so a document survives restarts and late
joiners can catch up. Each frame is a 1-byte type prefix followed by the
payload:

    0x00  document update    (persisted + relayed)
    0x01  awareness update   (relayed only — presence/cursors)
    0x02  snapshot           (client → server: full merged state, replaces log)
    0x03  request snapshot   (server → client: please send a snapshot)

Yjs on the client merges the update log deterministically, so an append-only
log is sufficient. To keep that log (and the catch-up time for late joiners)
bounded, once it grows past a threshold the server asks a connected client for
a full snapshot and collapses the log to that single update.
"""
from __future__ import annotations

import re
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect

from . import db, security

DOC_UPDATE = 0
AWARENESS = 1
SNAPSHOT = 2
REQUEST_SNAPSHOT = 3

# Collapse the per-doc update log once it exceeds this many rows.
COMPACT_THRESHOLD = 200

_DOC_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


class CollabHub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self.counts: dict[str, int] = {}
        self.pending: set[str] = set()

    def _count(self, doc: str) -> int:
        if doc not in self.counts:
            row = db.query_one(
                "SELECT COUNT(*) AS n FROM collab_updates WHERE doc = ?", (doc,)
            )
            self.counts[doc] = row["n"] if row else 0
        return self.counts[doc]

    async def _relay(self, doc: str, sender: WebSocket, message: bytes) -> None:
        dead: list[WebSocket] = []
        for sock in list(self.rooms[doc]):
            if sock is sender:
                continue
            try:
                await sock.send_bytes(message)
            except Exception:
                dead.append(sock)
        for sock in dead:
            self.rooms[doc].discard(sock)

    async def handle(self, doc: str, socket: WebSocket, token: str) -> None:
        data = security.read_token(token)
        if not data or not _DOC_RE.match(doc):
            await socket.close(code=4401)
            return

        await socket.accept()
        self.rooms[doc].add(socket)
        try:
            # Bring the new client up to date with the stored update log.
            for row in db.query_all(
                "SELECT data FROM collab_updates WHERE doc = ? ORDER BY id", (doc,)
            ):
                await socket.send_bytes(bytes([DOC_UPDATE]) + row["data"])

            while True:
                message = await socket.receive_bytes()
                if not message:
                    continue
                kind, payload = message[0], message[1:]

                if kind == SNAPSHOT and payload:
                    # Collapse the whole log to this single merged state.
                    db.execute("DELETE FROM collab_updates WHERE doc = ?", (doc,))
                    db.execute(
                        "INSERT INTO collab_updates(doc, data) VALUES (?, ?)",
                        (doc, payload),
                    )
                    self.counts[doc] = 1
                    self.pending.discard(doc)
                    continue  # snapshot is not relayed; peers already have it

                if kind == DOC_UPDATE and payload:
                    db.execute(
                        "INSERT INTO collab_updates(doc, data) VALUES (?, ?)",
                        (doc, payload),
                    )
                    self.counts[doc] = self._count(doc) + 1
                    if self.counts[doc] > COMPACT_THRESHOLD and doc not in self.pending:
                        # Ask the sender (which has the latest state) to snapshot.
                        self.pending.add(doc)
                        try:
                            await socket.send_bytes(bytes([REQUEST_SNAPSHOT]))
                        except Exception:
                            self.pending.discard(doc)

                await self._relay(doc, socket, message)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            self.rooms[doc].discard(socket)


hub = CollabHub()
