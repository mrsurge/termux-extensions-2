"""Tab-owned PTYs through the existing Framework-Shells Python worker API."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from app.libs.terminal_runtime.screen_projection import TerminalScreenProjectionRegistry
from .terminal_log_io import open_log
from .tab_store import TabRecord, TabStore, object_map, text


class Manager(Protocol):
    async def get_shell(self, shell_id: str) -> object | None: ...
    async def find_shell_by_label(self, label: str, *, status: str) -> object | None: ...
    async def describe(self, record: object) -> dict[str, object]: ...
    async def remove_shell(self, shell_id: str, *, force: bool) -> object: ...
    async def write_to_pty(self, shell_id: str, data: str) -> None: ...
    async def resize_pty(self, shell_id: str, cols: int, rows: int) -> None: ...


class OrchestratorAPI(Protocol):
    async def start_from_ref(self, ref: str, *, base_dir: Path,
                             ctx: Mapping[str, object], label: str, wait_ready: bool,
                             subgroups_overrides: list[str], env_overrides: dict[str, str]) -> object: ...


class SpawnRecord(Protocol):
    id: str


ManagerFactory = Callable[[], Awaitable[Manager]]
Launcher = Callable[[Manager, TabRecord], Awaitable[dict[str, object]]]


async def get_manager() -> Manager:
    # PTY/runtime dependencies must not gate directory listing or worker startup.
    from framework_shells import get_manager as factory
    typed = cast(ManagerFactory, factory)
    return await typed()


def label(tab_id: str) -> str:
    return 'file-explorer-terminal:' + tab_id


async def launch(manager: Manager, tab: TabRecord) -> dict[str, object]:
    from framework_shells.orchestrator import Orchestrator
    constructor = cast(Callable[[Manager], OrchestratorAPI], Orchestrator)
    record = await constructor(manager).start_from_ref(
        'terminal.yaml#terminal', base_dir=Path(__file__).parent / 'shellspec',
        ctx={'CWD': tab['path'], 'SHELL_CMD': 'bash -l -i'},
        label=label(tab['id']), wait_ready=False,
        subgroups_overrides=['file_explorer', 'tab:' + tab['id']],
        env_overrides={'TERM': 'xterm-256color'},
    )
    try:
        return await manager.describe(record)
    except BaseException:
        # The launch has succeeded even if metadata projection subsequently
        # fails. Do not leave an unassociated child behind.
        _ = await manager.remove_shell(cast(SpawnRecord, record).id, force=True)
        raise


class TerminalService:
    """Caller serializes with the tab mutation lock; disconnect never closes PTYs."""
    def __init__(self, store: TabStore, *, manager_factory: ManagerFactory = get_manager,
                 launcher: Launcher = launch) -> None:
        self.store: TabStore = store
        self.manager_factory: ManagerFactory = manager_factory
        self.launcher: Launcher = launcher
        self.projections: TerminalScreenProjectionRegistry = TerminalScreenProjectionRegistry(
            capacity=32, log_opener=open_log)

    async def _record(self, manager: Manager, tab: TabRecord) -> dict[str, object] | None:
        shell_id = tab['shellId']
        if shell_id is None:
            return None
        record = await manager.get_shell(shell_id)
        if record is None:
            return None
        data = await manager.describe(record)
        if data.get('id') != shell_id or data.get('label') != label(tab['id']):
            raise ValueError('Terminal does not belong to this tab')
        if data.get('status') == 'exited':
            return None
        capabilities = object_map(data.get('capabilities', {}))
        if data.get('status') != 'running' or capabilities.get('stdin_write') is not True or capabilities.get('resize') is not True:
            raise RuntimeError('Terminal is running but this worker has no live PTY control')
        return data

    async def reconcile(self, tab: TabRecord) -> TabRecord:
        if tab['shellId'] is None:
            return tab
        manager = await self.manager_factory()
        if await self._record(manager, tab) is not None:
            return tab
        await self.projections.discard(tab['shellId'])
        return self.store.set_shell(tab['id'], tab['revision'], None)

    async def dispatch(self, tab: TabRecord, method: str, params: dict[str, object]) -> dict[str, object]:
        if method == 'terminal.status':
            return {'tab': await self.reconcile(tab)}
        manager = await self.manager_factory()
        if method == 'terminal.start':
            tab = await self.reconcile(tab)
            if tab['shellId'] is not None:
                return {'tab': tab}
            existing = await manager.find_shell_by_label(label(tab['id']), status='running')
            created = existing is None
            if existing is None:
                # Finish a launched operation on cancellation so its exact child can
                # be cleaned up; never automatically replay an uncertain launch.
                task: asyncio.Future[dict[str, object]] = asyncio.ensure_future(self.launcher(manager, tab))
                try:
                    data = await asyncio.shield(task)
                except asyncio.CancelledError:
                    data = await task
                    _ = await manager.remove_shell(text(data.get('id')), force=True)
                    raise
            else:
                data = await manager.describe(existing)
            shell_id = text(data.get('id'))
            try:
                candidate: TabRecord = {**tab, 'shellId': shell_id}
                if await self._record(manager, candidate) is None:
                    raise RuntimeError('Launched terminal exited before association')
                updated = self.store.set_shell(tab['id'], tab['revision'], shell_id)
            except BaseException:
                if created:
                    _ = await manager.remove_shell(shell_id, force=True)
                raise
            return {'tab': updated}
        record = await self._record(manager, tab)
        if method == 'terminal.close':
            if record is not None:
                _ = await manager.remove_shell(text(record.get('id')), force=True)
            if tab['shellId']:
                await self.projections.discard(tab['shellId'])
            return {'tab': self.store.set_shell(tab['id'], tab['revision'], None)}
        if record is None:
            raise ValueError('Terminal is not active; explicitly start a new terminal')
        shell_id = text(record.get('id'))
        if method == 'terminal.input':
            input_text = params.get('data')
            if not isinstance(input_text, str) or len(input_text.encode()) > 65536:
                raise ValueError('Expected bounded terminal input')
            await manager.write_to_pty(shell_id, input_text)
            return {'shellId': shell_id}
        if method in ('terminal.resize', 'terminal.checkpoint'):
            cols, rows = params.get('columns', 80), params.get('rows', 24)
            if not isinstance(cols, int) or isinstance(cols, bool) or not 1 <= cols <= 1000 or not isinstance(rows, int) or isinstance(rows, bool) or not 1 <= rows <= 500:
                raise ValueError('Invalid terminal dimensions')
            if method == 'terminal.resize':
                await manager.resize_pty(shell_id, cols, rows)
                _ = await self.projections.resize(shell_id, cols, rows)
                return {'shellId': shell_id}
            checkpoint = await self.projections.checkpoint(shell_id, Path(text(record.get('stdout_log'))), columns=cols, lines=rows)
            return {'shellId': shell_id, 'ansi': checkpoint.ansi, 'pendingBytes': checkpoint.pending_bytes,
                    'outputOffset': checkpoint.output_offset, 'columns': checkpoint.columns, 'rows': checkpoint.lines}
        raise ValueError('Unsupported terminal method')
