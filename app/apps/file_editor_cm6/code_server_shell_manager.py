import asyncio
import hashlib
import re
from pathlib import Path
from typing import Optional

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord
from framework_shells.pty import PipeState

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "code_server.yaml#code-server"
CODE_SERVER_FIXED_PORT = 18180

_active_shell_id: Optional[str] = None
_ready_event: Optional[asyncio.Event] = None
_spawn_lock = asyncio.Lock()


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"code_server:{APP_ID}:global"


def _expected_port() -> str:
    return str(CODE_SERVER_FIXED_PORT)


def _matches_expected_port(record: ShellRecord) -> bool:
    env = record.env_overrides or {}
    return str(env.get("TE_CODE_SERVER_PORT") or "").strip() == _expected_port()


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def ensure_code_server_shell(project_root: str) -> ShellRecord:
    """Ensure code-server is running as a framework shell.

    Concurrent callers are serialised by _spawn_lock. The _ready_event
    lets later callers skip straight through once the first spawn completes.
    """

    global _active_shell_id, _ready_event

    # Fast path: if a previous spawn already completed, check cached shell
    if _ready_event is not None and _ready_event.is_set() and _active_shell_id:
        mgr = await get_manager()
        cached = await _get_alive(_active_shell_id)
        if cached and _matches_expected_port(cached):
            ps = mgr.get_pipe_state(cached.id)
            if ps and ps.process and ps.process.stdout:
                return cached

    # If another coroutine is spawning, wait for it then retry
    if _ready_event is not None and not _ready_event.is_set():
        print("[code_server] waiting for concurrent spawn to finish", flush=True)
        await _ready_event.wait()
        if _active_shell_id:
            mgr = await get_manager()
            cached = await _get_alive(_active_shell_id)
            if cached and _matches_expected_port(cached):
                return cached

    # We are the spawner — set up the event
    _ready_event = asyncio.Event()

    try:
        mgr = await get_manager()
        orch = Orchestrator(mgr)
        label = _label()

        if _active_shell_id:
            cached = await _get_alive(_active_shell_id)
            if cached and cached.label == label:
                if _matches_expected_port(cached):
                    ps = mgr.get_pipe_state(cached.id)
                    if ps and ps.process and ps.process.stdout:
                        return cached
                    print(f"[code_server] cached shell {cached.id} has no pipe state, re-spawning", flush=True)
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)
            _active_shell_id = None

        existing = await mgr.find_shell_by_label(label, status="running")
        if existing:
            if _matches_expected_port(existing):
                ps = mgr.get_pipe_state(existing.id)
                if ps and ps.process and ps.process.stdout:
                    _active_shell_id = existing.id
                    return existing
                print(f"[code_server] existing shell {existing.id} has no pipe state, re-spawning", flush=True)
            await mgr.terminate_shell(existing.id, force=True)
            await asyncio.sleep(1.5)

        repo_root = Path(project_root).resolve(strict=False)
        data_dir = Path.home() / ".config" / "code-server"

        shell = await orch.start_from_ref(
            SHELLSPEC_REF,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "PROJECT_ROOT": str(repo_root),
                "PROJECT_HASH": _project_hash(str(repo_root)),
                "INSTANCE_ID": "primary",
                "CODE_SERVER_DATA_DIR": str(data_dir),
                "CODE_SERVER_PORT": str(CODE_SERVER_FIXED_PORT),
            },
            label=label,
            record_spec_id=f"service:{APP_ID}:code_server",
            wait_ready=False,
        )

        _active_shell_id = shell.id

        # Readiness: read pipe stdout for "HTTP server listening" line.
        pipe_state: Optional[PipeState] = mgr.get_pipe_state(shell.id)
        print(f"[code_server] pipe_state={pipe_state is not None}, has_stdout={pipe_state and pipe_state.process and pipe_state.process.stdout is not None}", flush=True)
        if pipe_state and pipe_state.process and pipe_state.process.stdout:
            ready_re = re.compile(r"HTTP server listening")
            deadline = asyncio.get_event_loop().time() + 60
            while asyncio.get_event_loop().time() < deadline:
                try:
                    line_bytes = await asyncio.wait_for(
                        pipe_state.process.stdout.readline(), timeout=5.0
                    )
                except asyncio.TimeoutError:
                    continue
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip()
                print(f"[code_server] stdout: {line}", flush=True)
                if ready_re.search(line):
                    print("[code_server] readiness detected via pipe stdout", flush=True)
                    break
            else:
                print("[code_server] WARNING: readiness timeout (60s), continuing anyway", flush=True)
        else:
            print("[code_server] WARNING: no pipe state, cannot read stdout for readiness", flush=True)

        return shell
    finally:
        _ready_event.set()
