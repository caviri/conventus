"""Realtime voice-room relay — push-to-talk walkie-talkie.

The browser captures the mic and Opus-compresses it (low bitrate = walkie crunch);
the server is a *dumb relay* — it tracks who's in each room and rebroadcasts each
audio clip (and small JSON control messages) to the other participants. Nothing is
decoded, mixed or transcoded here, exactly like the Yjs collab relay.

Frames over the socket:
  • binary → an Opus/WebM audio clip. Relayed to peers prefixed with a 1-byte
    sender-name length + the sender name (UTF-8) so receivers can label/queue it.
  • text   → JSON control, currently {"type":"talk","on":bool}; relayed with the
    sender's name attached. The server also emits
    {"type":"presence","participants":[…]} on join/leave.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect

from . import security

_ROOM_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


class VoiceHub:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[WebSocket, str]] = defaultdict(dict)

    def participants(self, room: str) -> list[str]:
        out: list[str] = []
        for name in self.rooms[room].values():
            if name not in out:
                out.append(name)
        return out

    async def _send_text(self, room: str, message: str, *, exclude: WebSocket | None = None) -> None:
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

    async def _send_bytes(self, room: str, data: bytes, *, exclude: WebSocket) -> None:
        dead: list[WebSocket] = []
        for sock in list(self.rooms[room]):
            if sock is exclude:
                continue
            try:
                await sock.send_bytes(data)
            except Exception:
                dead.append(sock)
        for sock in dead:
            self.rooms[room].pop(sock, None)

    async def _presence(self, room: str) -> None:
        await self._send_text(
            room, json.dumps({"type": "presence", "participants": self.participants(room)})
        )

    async def handle(self, room: str, socket: WebSocket, token: str) -> None:
        data = security.read_token(token)
        if not data or not _ROOM_RE.match(room):
            await socket.close(code=4401)
            return
        name = data["name"]
        await socket.accept()
        self.rooms[room][socket] = name
        await self._presence(room)
        try:
            while True:
                msg = await socket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                audio = msg.get("bytes")
                text = msg.get("text")
                if audio:
                    nb = name.encode("utf-8")[:255]
                    await self._send_bytes(
                        room, bytes([len(nb)]) + nb + audio, exclude=socket
                    )
                elif text:
                    try:
                        payload = json.loads(text)
                    except json.JSONDecodeError:
                        continue
                    if payload.get("type") == "talk":
                        await self._send_text(
                            room,
                            json.dumps(
                                {"type": "talk", "name": name, "on": bool(payload.get("on"))}
                            ),
                            exclude=socket,
                        )
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            self.rooms[room].pop(socket, None)
            await self._presence(room)


hub = VoiceHub()
