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
from typing import cast

from .native_shells import get_manager, Orchestrator, OutputReader, ShellRecord

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "watchexec.yaml#watchexec-poll"

log = logging.getLogger("watchexec_shell_manager")

JsonObject = dict[str, object]

_active_shell_id: str | None = None
_output_reader: OutputReader | None = None
_stdout_reader_task: asyncio.Task[None] | None = None
_lifecycle_lock = asyncio.Lock()
_MAX_EVENT_BYTES = 65536


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


async def _get_alive(shell_id: str) -> ShellRecord | None:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def _stdout_reader_loop(reader: OutputReader, project_root: str) -> None:
    """Read watchexec JSON events from stdout and forward as watcher:files."""
    pending = bytearray()
    try:
        while True:
            chunks = (await reader.get()).split(b"\n")
            for index, chunk in enumerate(chunks):
                if len(pending) + len(chunk) > _MAX_EVENT_BYTES:
                    raise ValueError("watchexec event exceeds line limit")
                pending.extend(chunk)
                if index < len(chunks) - 1:
                    _consume_watchexec_line(bytes(pending), project_root)
                    pending.clear()
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.warning("[watchexec] stdout reader error: %s", exc)
    finally:
        await reader.close()


def _consume_watchexec_line(line: bytes, project_root: str) -> None:
    import sys
    raw = line.decode("utf-8", errors="replace").strip()
    if not raw:
        return
    print(f"[watchexec] {raw}", file=sys.stderr, flush=True)
    try:
        evt = _json_object(cast(object, json.loads(raw)))
    except json.JSONDecodeError:
        return
    _forward_watchexec_event(evt, project_root)


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
            _ = loop.create_task(
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
) -> ShellRecord | None:
    async with _lifecycle_lock:
        return await _ensure_watchexec_shell(project_root, poll_interval_ms)


async def _ensure_watchexec_shell(
    project_root: str, poll_interval_ms: int,
) -> ShellRecord | None:
    """Start the watchexec framework shell for the given project.

    Returns the ShellRecord on success, None if watchexec is unavailable.
    """
    global _active_shell_id, _output_reader, _stdout_reader_task

    if not is_watchexec_available():
        log.warning("[watchexec] binary not found on PATH")
        return None

    mgr = await get_manager()
    orch = Orchestrator(mgr)
    project_root_abs = str(Path(project_root).resolve(strict=False))
    label = _label(project_root_abs)

    # Reuse if alive
    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            if (_output_reader is not None and not _output_reader.closed
                    and _stdout_reader_task is not None and not _stdout_reader_task.done()):
                return cached
        await _stop_watchexec_shell()

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        await mgr.terminate_shell(existing.id, force=True)
        await asyncio.sleep(0.5)

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
    try:
        _output_reader = await mgr.subscribe_output_bytes(shell.id)
        _stdout_reader_task = asyncio.create_task(
            _stdout_reader_loop(_output_reader, project_root_abs),
            name="watchexec_stdout_reader",
        )
    except BaseException:
        await _stop_watchexec_shell()
        raise
    log.info("[watchexec] started for %s (poll=%dms)", project_root_abs, poll_interval_ms)
    return shell


async def stop_watchexec_shell() -> None:
    async with _lifecycle_lock:
        await _stop_watchexec_shell()


async def _stop_watchexec_shell() -> None:
    """Stop the running watchexec framework shell."""
    global _active_shell_id, _output_reader, _stdout_reader_task

    if _stdout_reader_task and not _stdout_reader_task.done():
        _ = _stdout_reader_task.cancel()
        try:
            await _stdout_reader_task
        except (asyncio.CancelledError, Exception):
            pass
    _stdout_reader_task = None
    if _output_reader is not None:
        await _output_reader.close()
        _output_reader = None

    if _active_shell_id:
        try:
            mgr = await get_manager()
            await mgr.terminate_shell(_active_shell_id, force=True)
        except Exception:
            pass
        _active_shell_id = None
    log.info("[watchexec] stopped")
