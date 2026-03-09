from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class AppRegistryEvent:
    type: str
    payload: dict[str, Any]


class AppRegistryEventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[AppRegistryEvent]] = set()

    def subscribe(self) -> asyncio.Queue[AppRegistryEvent]:
        q: asyncio.Queue[AppRegistryEvent] = asyncio.Queue(maxsize=8)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[AppRegistryEvent]) -> None:
        self._subscribers.discard(q)

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        event = AppRegistryEvent(type=event_type, payload=dict(payload or {}))
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    _ = q.get_nowait()
                except Exception:
                    pass
                try:
                    q.put_nowait(event)
                except Exception:
                    self._subscribers.discard(q)
            except Exception:
                self._subscribers.discard(q)


app_registry_events = AppRegistryEventBus()
