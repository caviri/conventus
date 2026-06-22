"""Realtime call-room signaling — a WebRTC mesh relay.

Call media (continuous audio + video) flows **peer-to-peer** over WebRTC, so the
server never decodes, mixes or even sees it — exactly like the Yjs collab relay,
it just shuttles small control messages. Each participant opens a direct
RTCPeerConnection to every other participant (a full mesh, fine for small rooms),
and the browser keeps each peer's audio and video lip-synced for free.

This hub is the *signaling channel* those peers use to find each other and trade
SDP offers/answers + ICE candidates. Every socket gets a stable per-connection
**peer id** (`pid`) so signaling can be addressed to one specific peer rather
than broadcast.

Frames over the socket are all JSON text:
  • server → joining socket:  {"type":"welcome","self":pid,"peers":[{pid,name,muted,cam}…]}
  • server → others:          {"type":"peer-join","pid":…,"name":…}
  • server → all on leave:     {"type":"peer-leave","pid":…}
  • client → server:          {"type":"signal","to":pid,"data":{…}}      (SDP / ICE)
      → forwarded to that peer as {"type":"signal","from":pid,"data":{…}}
  • client → server:          {"type":"state","muted":bool,"cam":bool}   (mic/cam UI state)
      → broadcast to others as {"type":"state","pid":pid,"muted":…,"cam":…}
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from itertools import count

from fastapi import WebSocket, WebSocketDisconnect

from . import security

_ROOM_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


class Peer:
    __slots__ = ("pid", "name", "muted", "cam")

    def __init__(self, pid: str, name: str) -> None:
        self.pid = pid
        self.name = name
        self.muted = False
        self.cam = False

    def public(self) -> dict:
        return {"pid": self.pid, "name": self.name, "muted": self.muted, "cam": self.cam}


class VoiceHub:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[WebSocket, Peer]] = defaultdict(dict)
        self._ids = count(1)

    def participants(self, room: str) -> list[str]:
        """Distinct display names in a room (used elsewhere / for debugging)."""
        out: list[str] = []
        for peer in self.rooms[room].values():
            if peer.name not in out:
                out.append(peer.name)
        return out

    async def _send(self, socket: WebSocket, payload: dict) -> bool:
        try:
            await socket.send_text(json.dumps(payload))
            return True
        except Exception:
            return False

    async def _broadcast(self, room: str, payload: dict, *, exclude: WebSocket | None = None) -> None:
        message = json.dumps(payload)
        dead: list[WebSocket] = []
        for sock in list(self.rooms[room]):
            if sock is exclude:
                continue
            try:
                await sock.send_text(message)
            except Exception:
                dead.append(sock)
        for sock in dead:
            self.rooms[room].pop(sock, None)

    def _socket_for(self, room: str, pid: str) -> WebSocket | None:
        for sock, peer in self.rooms[room].items():
            if peer.pid == pid:
                return sock
        return None

    async def handle(self, room: str, socket: WebSocket, token: str) -> None:
        data = security.read_token(token)
        if not data or not _ROOM_RE.match(room):
            await socket.close(code=4401)
            return
        name = data["name"]
        await socket.accept()

        peer = Peer(pid=f"p{next(self._ids)}", name=name)
        existing = [p.public() for p in self.rooms[room].values()]
        self.rooms[room][socket] = peer

        # Tell the newcomer who's already here, then announce them to the room.
        await self._send(socket, {"type": "welcome", "self": peer.pid, "peers": existing})
        await self._broadcast(
            room, {"type": "peer-join", "pid": peer.pid, "name": peer.name}, exclude=socket
        )

        try:
            while True:
                msg = await socket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                text = msg.get("text")
                if not text:
                    continue  # signaling is JSON-only; ignore stray binary
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                kind = payload.get("type")

                if kind == "signal":
                    target = payload.get("to")
                    dest = self._socket_for(room, target) if isinstance(target, str) else None
                    if dest is not None:
                        await self._send(
                            dest,
                            {"type": "signal", "from": peer.pid, "data": payload.get("data")},
                        )
                elif kind == "state":
                    peer.muted = bool(payload.get("muted"))
                    peer.cam = bool(payload.get("cam"))
                    await self._broadcast(
                        room,
                        {"type": "state", "pid": peer.pid, "muted": peer.muted, "cam": peer.cam},
                        exclude=socket,
                    )
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            self.rooms[room].pop(socket, None)
            await self._broadcast(room, {"type": "peer-leave", "pid": peer.pid})


hub = VoiceHub()
