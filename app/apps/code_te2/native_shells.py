"""Typed application adapter for worker-owned Ferrous shell management.

No framework-server calls or Python FWS fallback. The drawer shell retains its
existing manager until its own migration slice.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast


class NativeShellBridge(Protocol):
    def shell_get(self, shell_id: str) -> object: ...
    def shell_find(self, label: str) -> object: ...
    def shell_list(self) -> object: ...
    def shell_spawn(self, path: str, entry: str, ctx: dict[str, str], label: str, spec_id: str, wait_ready: bool) -> object: ...
    def shell_live(self, shell_id: str) -> bool: ...
    def shell_terminate(self, shell_id: str) -> None: ...
    def shell_write(self, shell_id: str, data: bytes) -> None: ...
    def shell_subscribe(self, shell_id: str) -> int: ...
    def shell_unsubscribe(self, token: int) -> None: ...
    def shell_release(self, token: int) -> None: ...
    def shell_read(self, token: int) -> bytes: ...


@dataclass
class ShellRecord:
    id: str
    label: str
    pid: int | None
    status: str
    env_overrides: object
    command: object


def _record(value: object) -> ShellRecord | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise TypeError("native shell record must be a map")
    row = cast(dict[str, object], value)
    shell_id, label, status, pid = row.get("id"), row.get("label"), row.get("status"), row.get("pid")
    if not isinstance(shell_id, str) or not isinstance(label, str) or not isinstance(status, str) or not isinstance(pid, int):
        raise TypeError("invalid native shell identity")
    return ShellRecord(shell_id, label, pid, status, row.get("env_overrides"), row.get("command"))


class OutputReader:
    def __init__(self, bridge: NativeShellBridge, token: int) -> None:
        self.bridge: NativeShellBridge = bridge
        self.token: int = token
        self.pending: asyncio.Task[bytes] | None = None
        self.closed: bool = False
        self.closing: asyncio.Task[None] | None = None

    async def get(self) -> bytes:
        if self.closed:
            raise RuntimeError("native output reader closed")
        if self.pending is None:
            self.pending = asyncio.create_task(asyncio.to_thread(self.bridge.shell_read, self.token))
        task = self.pending
        try:
            result = await asyncio.shield(task)
        except asyncio.CancelledError:
            # wait_for timeouts must not leave multiple native reads competing.
            raise
        except BaseException:
            self.pending = None
            raise
        else:
            self.pending = None
            return result

    async def close(self) -> None:
        if self.closing is None:
            self.closing = asyncio.create_task(self._close())
        await asyncio.shield(self.closing)

    async def _close(self) -> None:
        self.closed = True
        self.bridge.shell_unsubscribe(self.token)
        if self.pending is not None:
            _ = await asyncio.gather(self.pending, return_exceptions=True)
            self.pending = None
        await asyncio.to_thread(self.bridge.shell_release, self.token)


class ShellManager:
    def __init__(self, bridge: NativeShellBridge) -> None:
        self.bridge: NativeShellBridge = bridge

    async def get_shell(self, shell_id: str) -> ShellRecord | None:
        return _record(await asyncio.to_thread(self.bridge.shell_get, shell_id))

    async def list_shells(self) -> list[ShellRecord]:
        value = await asyncio.to_thread(self.bridge.shell_list)
        if not isinstance(value, list):
            raise TypeError("native shell list must be an array")
        records: list[ShellRecord] = []
        for item in cast(list[object], value):
            record = _record(item)
            if record is None:
                raise TypeError("native shell list contains null")
            records.append(record)
        return records

    async def find_shell_by_label(self, label: str, *, status: str | None = None) -> ShellRecord | None:
        if status not in (None, "running"):
            raise ValueError("intelligence lookup supports running shells only")
        return _record(await asyncio.to_thread(self.bridge.shell_find, label))

    async def get_shell_capabilities(self, record: ShellRecord) -> dict[str, object]:
        live = await asyncio.to_thread(self.bridge.shell_live, record.id)
        return {"backend": "pipe", "stdin_write": live, "stdout_subscribe_bytes": live}

    async def terminate_shell(self, shell_id: str, *, force: bool = False) -> None:
        del force
        await asyncio.to_thread(self.bridge.shell_terminate, shell_id)

    async def write_bytes(self, shell_id: str, data: bytes) -> None:
        await asyncio.to_thread(self.bridge.shell_write, shell_id, data)

    async def subscribe_output_bytes(self, shell_id: str) -> OutputReader:
        allocation = asyncio.create_task(asyncio.to_thread(self.bridge.shell_subscribe, shell_id))
        try:
            token = await asyncio.shield(allocation)
        except asyncio.CancelledError:
            token = await allocation
            await OutputReader(self.bridge, token).close()
            raise
        return OutputReader(self.bridge, token)

    async def unsubscribe_output_bytes(self, shell_id: str, queue: OutputReader) -> None:
        del shell_id
        await queue.close()


_manager: ShellManager | None = None


def configure_native(bridge: NativeShellBridge) -> None:
    global _manager
    if _manager is not None:
        raise RuntimeError("native intelligence manager already configured")
    _manager = ShellManager(bridge)


async def get_manager() -> ShellManager:
    if _manager is None:
        raise RuntimeError("native intelligence manager not configured")
    return _manager


class Orchestrator:
    def __init__(self, manager: ShellManager) -> None:
        self.manager: ShellManager = manager

    async def start_from_ref(self, ref: str, *, base_dir: Path, ctx: dict[str, object],
                             label: str, record_spec_id: str, wait_ready: bool) -> ShellRecord:
        filename, entry = ref.split("#", 1)
        if any(not isinstance(value, str) for value in ctx.values()):
            raise TypeError("native shellspec context values must be strings")
        spawn = asyncio.create_task(asyncio.to_thread(self.manager.bridge.shell_spawn,
            str(base_dir / filename), entry, cast(dict[str, str], ctx), label, record_spec_id, wait_ready))
        try:
            record = _record(await asyncio.shield(spawn))
        except asyncio.CancelledError:
            # Native spawn cannot be cancelled halfway through process creation.
            # Reap that exact child instead of abandoning an unreported process.
            record = _record(await spawn)
            if record is not None:
                await self.manager.terminate_shell(record.id)
            raise
        if record is None:
            raise RuntimeError("native spawn returned no shell")
        return record
