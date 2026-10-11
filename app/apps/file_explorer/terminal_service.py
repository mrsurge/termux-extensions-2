"""Tab-owned Terminal brokers through Framework-Shells' live pipe API."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol, cast

from .tab_store import TabRecord, TabStore, text
from .directory_tracking import TrackingStatus
from .terminal_broker import BrokerSessions, PipeManager


class ShellRecord(Protocol):
    def to_payload(self) -> dict[str, object]: ...


class Manager(PipeManager, Protocol):
    async def load_shell_record(self, shell_id: str) -> ShellRecord | None: ...
    async def get_shell_capabilities(self, record: ShellRecord) -> dict[str, object]: ...
    async def find_shell_by_label(self, label: str, *, status: str) -> object | None: ...
    async def describe(self, record: object) -> dict[str, object]: ...
    async def remove_shell(self, shell_id: str, *, force: bool) -> object: ...


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
    from app.te2_paths import te2_app_data_home
    from framework_shells.orchestrator import Orchestrator
    from .node_runtime import ensure_terminal_node_runtime
    runtime = await asyncio.to_thread(ensure_terminal_node_runtime)
    terminal_root = Path(__file__).parent
    constructor = cast(Callable[[Manager], OrchestratorAPI], Orchestrator)
    try:
        record = await constructor(manager).start_from_ref(
            'terminal.yaml#terminal', base_dir=terminal_root / 'shellspec',
            ctx={'APP_ID': 'file_explorer', 'CWD': tab['path'], 'BROKER_ENTRY': str(terminal_root / 'terminal_stream_broker.mjs'),
                 'NODE_BIN': str(runtime.node_binary), 'NODE_PATH': runtime.executable_path,
                 'NODE_RUNTIME_ROOT': str(runtime.root), 'COLS': '80', 'ROWS': '24',
                 'LAUNCH_ID': tab['id']},
            label=label(tab['id']), wait_ready=False,
            subgroups_overrides=['file_explorer', 'tab:' + tab['id']],
            env_overrides={'TERM': 'xterm-256color',
                           'TERMINAL_STREAM_CONTROL_ROOT': str(te2_app_data_home('file_explorer') / 'terminal_control')},
        )
    except BaseException:
        raise
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
        self.brokers: BrokerSessions = BrokerSessions()

    async def _record(self, manager: Manager, tab: TabRecord, *, closing: bool = False) -> dict[str, object] | None:
        shell_id = tab['shellId']
        if shell_id is None:
            return None
        # Exact-record read verifies the manager's persisted signature/identity.
        # get_shell() adopts/scans the entire runtime; describe() collects stats.
        # Neither belongs on keystroke or output-wakeup paths.
        record = await manager.load_shell_record(shell_id)
        if record is None:
            return None
        data = record.to_payload()
        if data.get('id') != shell_id or data.get('label') != label(tab['id']):
            raise ValueError('Terminal does not belong to this tab')
        if data.get('status') == 'exited':
            return None
        if closing:
            # Explicit removal also works for a retained pre-broker PTY. Exact
            # signed identity/label still applies; this is not an I/O fallback.
            return data
        capabilities = await manager.get_shell_capabilities(record)
        if data.get('status') != 'running' or capabilities.get('backend') != 'pipe' or capabilities.get('stdin_write') is not True or capabilities.get('stdout_subscribe_bytes') is not True:
            raise RuntimeError('Terminal has no live broker pipe; close it and start a new terminal')
        return data

    async def reconcile(self, tab: TabRecord) -> TabRecord:
        if tab['shellId'] is None:
            return tab
        manager = await self.manager_factory()
        if await self._record(manager, tab) is not None:
            return tab
        await self.brokers.discard(tab['shellId'])
        return self.store.set_shell(tab['id'], tab['revision'], None)

    def directory_status(self, tab: TabRecord) -> TrackingStatus:
        if not tab['directoryLocked']: return {'state': 'unlocked', 'path': ''}
        session = self.brokers.sessions.get(tab['shellId'] or '')
        if session is None: return {'state': 'starting', 'path': ''}
        return {'state': text(session.status.get('state')), 'path': str(session.status.get('path') or '')}

    async def track_navigation(self, tab: TabRecord) -> TrackingStatus:
        if not tab['directoryLocked'] or not tab['shellId']:
            return self.directory_status(tab)
        manager = await self.manager_factory()
        if await self._record(manager, tab) is None:
            return {'state': 'unavailable', 'path': ''}
        session = await self.brokers.get(tab['shellId'], manager)
        _ = await session.request({'type': 'directory.request', 'path': tab['path']})
        return self.directory_status(tab)

    async def dispatch(self, tab: TabRecord, method: str, params: dict[str, object]) -> dict[str, object]:
        if method == 'terminal.status':
            return {'tab': await self.reconcile(tab)}
        if method == 'terminal.directoryLock':
            locked = params.get('locked')
            if not isinstance(locked, bool):
                raise ValueError('Expected boolean directory lock')
            # Cancel pending intent on either transition; re-lock only arms future
            # navigation. A failed persistence never replays a shell operation.
            if tab['shellId'] is not None and tab['directoryLocked'] != locked:
                manager = await self.manager_factory()
                if await self._record(manager, tab) is not None:
                    session = await self.brokers.get(tab['shellId'], manager)
                    await session.send({'type': 'directory.cancel'})
                    _ = await session.request({'type': 'ping'})
                    session.status = {'state': 'ready', 'path': ''}
            updated = self.store.set_directory_lock(tab['id'], tab['revision'], locked)
            return {'tab': updated, 'directoryTracking': self.directory_status(updated)}
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
                tracking_id = data.get('directoryTrackingId')
                updated = self.store.set_shell(tab['id'], tab['revision'], shell_id,
                                               tracking_id if isinstance(tracking_id, str) else None)
            except BaseException:
                if created:
                    _ = await manager.remove_shell(shell_id, force=True)
                raise
            return {'tab': updated}
        record = await self._record(manager, tab, closing=method == 'terminal.close')
        if method == 'terminal.close':
            if record is not None:
                _ = await manager.remove_shell(text(record.get('id')), force=True)
            if tab['shellId']:
                await self.brokers.discard(tab['shellId'])
            return {'tab': self.store.set_shell(tab['id'], tab['revision'], None)}
        if record is None:
            raise ValueError('Terminal is not active; explicitly start a new terminal')
        shell_id = text(record.get('id'))
        if method == 'terminal.input':
            input_text = params.get('data')
            if not isinstance(input_text, str) or len(input_text.encode()) > 65536:
                raise ValueError('Expected bounded terminal input')
            session = await self.brokers.get(shell_id, manager)
            await session.send({'type': 'input', 'data': input_text.encode('utf8')})
            return {'shellId': shell_id}
        if method in ('terminal.resize', 'terminal.checkpoint'):
            cols, rows = params.get('columns', 80), params.get('rows', 24)
            if not isinstance(cols, int) or isinstance(cols, bool) or not 1 <= cols <= 1000 or not isinstance(rows, int) or isinstance(rows, bool) or not 1 <= rows <= 500:
                raise ValueError('Invalid terminal dimensions')
            if method == 'terminal.resize':
                session = await self.brokers.get(shell_id, manager)
                await session.send({'type': 'resize', 'cols': cols, 'rows': rows})
                return {'shellId': shell_id}
            session = await self.brokers.get(shell_id, manager)
            checkpoint = await session.request({'type': 'attach', 'cols': cols, 'rows': rows})
            raw_path, offset = checkpoint.get('logPath'), checkpoint.get('outputOffset')
            if not isinstance(raw_path, str) or not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
                raise ValueError('Terminal uses an older broker; close it and start a new terminal')
            log_path = Path(raw_path).resolve(strict=True)
            root = (self.store.path.parent / 'terminal_control').resolve()
            if not log_path.is_relative_to(root) or log_path.name != 'output.raw':
                raise ValueError('Invalid terminal checkpoint location')
            projected = await session.projection.checkpoint(shell_id, log_path, offset, cols, rows)
            return {'shellId': shell_id, 'ansi': projected.ansi, 'pendingBytes': projected.pending_bytes,
                    'outputOffset': projected.output_offset, 'columns': cols, 'rows': rows,
                    'directoryTracking': self.directory_status(tab)}
        raise ValueError('Unsupported terminal method')
