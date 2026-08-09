"""watchexec poll watcher — framework shell manager.

Manages a watchexec subprocess that stat-polls the project directory and
emits JSON file-change events on stdout.  Events are parsed and forwarded
into the same ``watcher:files`` pipeline used by the VS Code IPC watcher.
"""

import asyncio
import hashlib
import json
import logging
import shutil
from pathlib import Path
from typing import Optional, cast

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.pty import PipeState
from framework_shells.record import ShellRecord

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "watchexec.yaml#watchexec-poll"

log = logging.getLogger("watchexec_shell_manager")

JsonObject = dict[str, object]

_active_shell_id: Optional[str] = None
_pipe_state: Optional[PipeState] = None
_stdout_reader_task: Optional[asyncio.Task[None]] = None


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label(project_root: str) -> str:
    return f"watchexec:{APP_ID}:{_project_hash(project_root)}"


def is_watchexec_available() -> bool:
    """Check if watchexec binary is on PATH."""
    return shutil.which("watchexec") is not None


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def _stdout_reader_loop(proc: asyncio.subprocess.Process, project_root: str) -> None:
    """Read watchexec JSON events from stdout and forward as watcher:files."""
    import sys
    stdout = proc.stdout
    if stdout is None:
        return
    try:
        while True:
            line = await stdout.readline()
            if not line:
                break
            raw = line.decode("utf-8", errors="replace").strip()
            if not raw:
                continue
            # Fan out to stderr for observability
            print(f"[watchexec] {raw}", file=sys.stderr, flush=True)
            try:
                evt = _json_object(cast(object, json.loads(raw)))
            except json.JSONDecodeError:
                continue
            _forward_watchexec_event(evt, project_root)
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.warning("[watchexec] stdout reader error: %s", exc)


def _forward_watchexec_event(evt: JsonObject, project_root: str) -> None:
    """Parse a watchexec JSON event and publish it through the workspace event surface."""
    # watchexec --emit-events-to json-stdio format:
    # {"tags": [{"kind": "path", "absolute": "/abs/path", "filetype": "file"},
    #           {"kind": "fs", "simple": "create"|"modify"|"remove"|"rename"|...}], ...}
    tags_obj = evt.get("tags", [])
    tags = cast(list[object], tags_obj if isinstance(tags_obj, list) else [])
    if not tags:
        return

    path_abs: str | None = None
    fs_op: str | None = None
    for tag_obj in tags:
        if not isinstance(tag_obj, dict):
            continue
        tag = _json_object(cast(object, tag_obj))
        kind_obj = tag.get("kind", "")
        kind = kind_obj if isinstance(kind_obj, str) else ""
        if kind == "path":
            absolute_obj = tag.get("absolute", "")
            path_abs = absolute_obj if isinstance(absolute_obj, str) else None
        elif kind == "fs":
            simple_obj = tag.get("simple", "")
            fs_op = simple_obj if isinstance(simple_obj, str) else None

    if not path_abs:
        return

    # Convert abs path to relative
    proj = str(project_root).rstrip("/")
    rel: str = path_abs
    if proj and path_abs.startswith(proj):
        rel = path_abs[len(proj):].lstrip("/") or "."

    created: list[str] = []
    changed: list[str] = []
    deleted: list[str] = []
    if fs_op == "create":
        created.append(rel)
    elif fs_op == "remove":
        deleted.append(rel)
    else:
        changed.append(rel)

    if not (created or changed or deleted):
        return

    try:
        from .workspace_events import publish_file_change_event

        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(
                publish_file_change_event(
                    str(project_root),
                    created_abs=[path_abs] if created else [],
                    changed_abs=[path_abs] if changed else [],
                    deleted_abs=[path_abs] if deleted else [],
                )
            )
    except Exception as exc:
        log.debug("[watchexec] forward error: %s", exc)


async def ensure_watchexec_shell(
    project_root: str,
    poll_interval_ms: int = 1500,
) -> Optional[ShellRecord]:
    """Start the watchexec framework shell for the given project.

    Returns the ShellRecord on success, None if watchexec is unavailable.
    """
    global _active_shell_id, _pipe_state, _stdout_reader_task

    if not is_watchexec_available():
        log.warning("[watchexec] binary not found on PATH")
        return None

    mgr = await get_manager()
    orch = Orchestrator(mgr)
    label = _label(project_root)

    # Reuse if alive
    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            if _pipe_state is not None:
                return cached
            await mgr.terminate_shell(cached.id, force=True)
            await asyncio.sleep(0.5)
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        await mgr.terminate_shell(existing.id, force=True)
        await asyncio.sleep(0.5)

    project_root_abs = str(Path(project_root).resolve(strict=False))

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "PROJECT_ROOT": project_root_abs,
            "PROJECT_HASH": _project_hash(project_root_abs),
            "POLL_INTERVAL_MS": str(poll_interval_ms),
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:watchexec",
        wait_ready=False,
    )

    _active_shell_id = shell.id
    mgr_inst = await get_manager()
    ps = mgr_inst.get_pipe_state(shell.id)
    if ps is not None:
        _pipe_state = ps
        if _stdout_reader_task is None or _stdout_reader_task.done():
            _stdout_reader_task = asyncio.create_task(
                _stdout_reader_loop(ps.process, project_root_abs),
                name="watchexec_stdout_reader",
            )
        log.info("[watchexec] started for %s (poll=%dms)", project_root_abs, poll_interval_ms)
    return shell


async def stop_watchexec_shell() -> None:
    """Stop the running watchexec framework shell."""
    global _active_shell_id, _pipe_state, _stdout_reader_task

    if _stdout_reader_task and not _stdout_reader_task.done():
        _stdout_reader_task.cancel()
        try:
            await _stdout_reader_task
        except (asyncio.CancelledError, Exception):
            pass
    _stdout_reader_task = None
    _pipe_state = None

    if _active_shell_id:
        try:
            mgr = await get_manager()
            await mgr.terminate_shell(_active_shell_id, force=True)
        except Exception:
            pass
        _active_shell_id = None
    log.info("[watchexec] stopped")
