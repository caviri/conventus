"""WebSocket hub: tracks live connections and fans events out to everyone.

Every connection is tied to a user name (taken from their session token). The
manager also doubles as the room's presence source — who is currently online.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        # name -> set of sockets (a user may have several tabs open)
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, name: str, socket: WebSocket) -> None:
        await socket.accept()
        async with self._lock:
            self._sockets[name].add(socket)

    async def disconnect(self, name: str, socket: WebSocket) -> None:
        async with self._lock:
            self._sockets.get(name, set()).discard(socket)
            if not self._sockets.get(name):
                self._sockets.pop(name, None)

    def online(self) -> list[str]:
        return sorted(self._sockets.keys())

    def is_online(self, name: str) -> bool:
        return name in self._sockets

    async def broadcast(self, event: str, data: Any) -> None:
        payload = {"event": event, "data": data}
        await self._send_to(list(self._all_sockets()), payload)

    async def send_to_users(self, names: list[str], event: str, data: Any) -> None:
        payload = {"event": event, "data": data}
        targets: list[WebSocket] = []
        for name in names:
            targets.extend(self._sockets.get(name, set()))
        await self._send_to(targets, payload)

    def _all_sockets(self):
        for sockets in self._sockets.values():
            yield from sockets

    async def _send_to(self, sockets: list[WebSocket], payload: dict) -> None:
        dead: list[WebSocket] = []
        for sock in sockets:
            try:
                await sock.send_json(payload)
            except Exception:
                dead.append(sock)
        if dead:
            async with self._lock:
                for sock in dead:
                    for name, group in list(self._sockets.items()):
                        group.discard(sock)
                        if not group:
                            self._sockets.pop(name, None)


hub = Hub()
