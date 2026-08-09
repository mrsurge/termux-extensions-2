# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
import json as _json
import re
import shutil
import time
from importlib import import_module
from pathlib import Path
from typing import Awaitable, Protocol, cast

from app.te2_paths import ensure_runtime_home

from .code_te2_paths import code_te2_paths

JsonObject = dict[str, object]


class ShellRecord(Protocol):
    id: str
    label: str
    pid: int | None
    status: str
    env_overrides: object | None
    command: object | None


class ShellManager(Protocol):
    def get_shell(self, shell_id: str) -> Awaitable[ShellRecord | None]: ...

    def get_shell_capabilities(self, record: ShellRecord) -> Awaitable[JsonObject]: ...

    def subscribe_output_bytes(self, shell_id: str) -> Awaitable[asyncio.Queue[bytes]]: ...

    def unsubscribe_output_bytes(
        self, shell_id: str, queue: asyncio.Queue[bytes]
    ) -> Awaitable[None]: ...

    def terminate_shell(self, shell_id: str, *, force: bool = False) -> Awaitable[None]: ...

    def find_shell_by_label(
        self, label: str, *, status: str | None = None
    ) -> Awaitable[ShellRecord | None]: ...


class OrchestratorInstance(Protocol):
    def start_from_ref(
        self,
        ref: str,
        *,
        base_dir: Path,
        ctx: JsonObject,
        label: str,
        record_spec_id: str,
        wait_ready: bool,
    ) -> Awaitable[ShellRecord]: ...


class OrchestratorFactory(Protocol):
    def __call__(self, manager: ShellManager) -> OrchestratorInstance: ...


class ManagerGetter(Protocol):
    def __call__(self) -> Awaitable[ShellManager]: ...

APP_ID = "code_te2"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "code_server.yaml#code-server"

_active_shell_id: str | None = None
_ready_event: asyncio.Event | None = None
_spawn_lock = asyncio.Lock()


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    raw = cast(list[object], value)
    result: list[JsonObject] = []
    for item in raw:
        if isinstance(item, dict):
            result.append(_json_object(cast(object, item)))
    return result


def _read_json_object(path: Path) -> JsonObject:
    try:
        decoded = cast(object, _json.loads(path.read_text("utf-8")))
        return _json_object(decoded)
    except Exception:
        return {}


def _read_json_object_list(path: Path) -> list[JsonObject]:
    try:
        decoded = cast(object, _json.loads(path.read_text("utf-8")))
        return _json_object_list(decoded)
    except Exception:
        return []


def _framework_get_manager() -> ManagerGetter:
    module = import_module("framework_shells")
    value = cast(object, module.__dict__["get_manager"])
    return cast(ManagerGetter, value)


def _orchestrator_factory() -> OrchestratorFactory:
    module = import_module("framework_shells.orchestrator")
    value = cast(object, module.__dict__["Orchestrator"])
    return cast(OrchestratorFactory, value)


async def _get_manager() -> ShellManager:
    return await _framework_get_manager()()


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"code_server:{APP_ID}:global"


# ── Bridge extension install ──────────────────────────────────────────

_BRIDGE_EXT_ID = "te2-extension-api-bridge"
_BRIDGE_EXT_SRC = Path(__file__).parent / "vendor" / _BRIDGE_EXT_ID
_CODE_TE2_PATHS = code_te2_paths()
_CODE_SERVER_DATA_DIR = _CODE_TE2_PATHS.code_server_data_dir
_CODE_SERVER_SOCKET_PATH = _CODE_TE2_PATHS.code_server_socket_path
_CODE_SERVER_PROBE_OUTPUT_PATH = _CODE_TE2_PATHS.code_server_probe_output_path
_EXTENSIONS_DIR = _CODE_TE2_PATHS.code_server_extensions_dir
_USER_SETTINGS_PATH = _CODE_TE2_PATHS.code_server_user_settings_path


# ── VS Code watcher settings sync ────────────────────────────────────

def sync_vscode_watcher_settings(watcher_mode: str) -> None:
    """Sync files.watcherExclude in code-server User/settings.json.

    When our custom watcher (watchexec) is active, disable VS Code's
    built-in file watcher by setting ``"files.watcherExclude": {"**": true}``.
    When using VS Code's IPC watcher, remove the key so it works normally.
    Must be called BEFORE code-server launches so it reads the setting on boot.
    """
    settings: JsonObject = {}
    _USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)

    if _USER_SETTINGS_PATH.exists():
        settings = _read_json_object(_USER_SETTINGS_PATH)

    if watcher_mode in ("watchexec", "none"):
        settings["files.watcherExclude"] = {"**": True}
    else:
        # IPC mode: let VS Code's native watcher run, but always exclude
        # git lock files — the upstream git poller creates transient
        # index.lock files that cascade into watcher/change event storms.
        settings["files.watcherExclude"] = {
            "**/.git/index.lock": True,
            "**/.git/index.lock+": True,
            "**/.git/*.lock": True,
        }

    _USER_SETTINGS_PATH.write_text(
        _json.dumps(settings, indent=4) + "\n", encoding="utf-8"
    )
    print(f"[code_server] watcher settings synced: mode={watcher_mode}", flush=True)


def ensure_bridge_extension_installed() -> bool:
    """Copy the vendored bridge extension to code-server's extensions dir if needed.

    Compares package.json version to decide whether to update.
    Also ensures the extension is registered in extensions.json so code-server loads it.
    Returns True if installed/updated, False if already current. # and a comment for good measure
    """
    dest = _EXTENSIONS_DIR / _BRIDGE_EXT_ID
    src_pkg = _BRIDGE_EXT_SRC / "package.json"

    if not src_pkg.exists():
        print(f"[code_server] bridge extension source missing: {src_pkg}", flush=True)
        return False

    src_manifest = _read_json_object(src_pkg)
    src_version = str(src_manifest.get("version", "0"))

    dest_pkg = dest / "package.json"
    needs_copy = True
    if dest_pkg.exists():
        try:
            dest_version = str(_read_json_object(dest_pkg).get("version", ""))
            if dest_version == src_version:
                needs_copy = False
        except Exception:
            pass  # corrupt — reinstall

    if needs_copy:
        if dest.exists():
            shutil.rmtree(dest)
        _EXTENSIONS_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copytree(str(_BRIDGE_EXT_SRC), str(dest))
        print(f"[code_server] bridge extension installed: {_BRIDGE_EXT_ID} v{src_version}", flush=True)

    # Ensure extension is registered in extensions.json
    ext_json_path = _EXTENSIONS_DIR / "extensions.json"
    entries = _read_json_object_list(ext_json_path) if ext_json_path.exists() else []

    publisher = str(src_manifest.get("publisher", "te2"))
    ext_id = f"{publisher}.{src_manifest.get('name', _BRIDGE_EXT_ID)}"
    already_registered = any(
        _json_object(e.get("identifier", {})).get("id", "") == ext_id for e in entries
    )

    if not already_registered:
        entries.append({
            "identifier": {"id": ext_id},
            "version": src_version,
            "location": {
                "$mid": 1,
                "path": str(dest),
                "scheme": "file",
            },
            "relativeLocation": _BRIDGE_EXT_ID,
            "metadata": {
                "installedTimestamp": int(time.time() * 1000),
                "source": "vsix",
                "isPreReleaseVersion": False,
                "hasPreReleaseVersion": False,
            },
        })
        ext_json_path.write_text(_json.dumps(entries))
        print(f"[code_server] bridge extension registered in extensions.json: {ext_id}", flush=True)
        return True

    return needs_copy


def _expected_socket_path() -> str:
    return str(_CODE_SERVER_SOCKET_PATH)


def code_server_connection_target(record: ShellRecord) -> tuple[str, str | None]:
    """Return the code-server HTTP base and optional UDS path for the WBA."""
    env = _json_object(record.env_overrides)
    socket_path = str(env.get("TE_CODE_SERVER_SOCKET") or "").strip()
    command = record.command
    if isinstance(command, list):
        command_text = " ".join(str(part) for part in cast(list[object], command))
    elif isinstance(command, tuple):
        command_text = " ".join(str(part) for part in cast(tuple[object, ...], command))
    else:
        command_text = str(command or "")
    if not socket_path and "--socket" in command_text:
        socket_path = _expected_socket_path()
    if socket_path:
        return "http://localhost", socket_path

    # The active code-server shellspec is UDS-only. Missing socket metadata is
    # a framework-shell handoff bug, not permission to fall back to TCP.
    return "http://localhost", _expected_socket_path()


def _matches_expected_target(record: ShellRecord, code_server_bin: str) -> bool:
    _, socket_path = code_server_connection_target(record)
    env = _json_object(record.env_overrides)
    recorded_bin = str(env.get("TE_CODE_SERVER_BIN") or "").strip()
    if not recorded_bin:
        return False
    return (
        socket_path == _expected_socket_path()
        and Path(recorded_bin).resolve(strict=False) == Path(code_server_bin).resolve(strict=False)
    )


async def _get_alive(shell_id: str) -> ShellRecord | None:
    mgr = await _get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def _has_live_pipe(record: ShellRecord) -> bool:
    mgr = await _get_manager()
    try:
        caps = _json_object(await mgr.get_shell_capabilities(record))
    except Exception:
        return False
    return caps.get("backend") == "pipe" and bool(caps.get("stdout_subscribe_bytes"))


async def _wait_for_code_server_readiness(shell_id: str, timeout_s: float = 60.0) -> None:
    mgr = await _get_manager()
    queue = await mgr.subscribe_output_bytes(shell_id)
    ready_re = re.compile(rb"HTTP server listening")
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    buf: bytes = b""

    try:
        while loop.time() < deadline:
            remaining = deadline - loop.time()
            try:
                chunk: bytes = await asyncio.wait_for(
                    queue.get(), timeout=min(5.0, remaining)
                )
            except asyncio.TimeoutError:
                continue

            if not chunk:
                continue

            buf += chunk
            while b"\n" in buf:
                split = buf.split(b"\n", 1)
                line_bytes: bytes = split[0]
                buf = split[1]
                if line_bytes.endswith(b"\r"):
                    line_bytes = line_bytes[:-1]
                line = line_bytes.decode("utf-8", errors="replace")
                print(f"[code_server] stdout: {line}", flush=True)
                if ready_re.search(line_bytes):
                    print("[code_server] readiness detected via subscribed output", flush=True)
                    return

        print(f"[code_server] WARNING: readiness timeout ({timeout_s}s), continuing anyway", flush=True)
    finally:
        try:
            await mgr.unsubscribe_output_bytes(shell_id, queue)
        except Exception:
            pass


async def terminate_code_server_shell() -> bool:
    """Kill the active code-server shell and reset state.

    Returns True if a shell was terminated, False if nothing was running.
    """
    global _active_shell_id, _ready_event

    if not _active_shell_id:
        return False

    try:
        mgr = await _get_manager()
        await mgr.terminate_shell(_active_shell_id, force=True)
        print(f"[code_server] terminated shell {_active_shell_id}", flush=True)
    except Exception as exc:
        print(f"[code_server] terminate error: {exc}", flush=True)

    _active_shell_id = None
    _ready_event = None
    return True


async def ensure_code_server_shell(project_root: str) -> ShellRecord:
    """Ensure code-server is running as a framework shell.

    Concurrent callers are serialised by _spawn_lock. The _ready_event
    lets later callers skip straight through once the first spawn completes.
    """

    global _active_shell_id, _ready_event

    from .code_server_bootstrap import ensure_code_server_installation

    installation = await asyncio.to_thread(ensure_code_server_installation)
    code_server_bin = str(installation.executable)

    # Fast path: if a previous spawn already completed, check cached shell
    if _ready_event is not None and _ready_event.is_set() and _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and _matches_expected_target(cached, code_server_bin):
            if await _has_live_pipe(cached):
                return cached

    # If another coroutine is spawning, wait for it then retry
    if _ready_event is not None and not _ready_event.is_set():
        print("[code_server] waiting for concurrent spawn to finish", flush=True)
        await _ready_event.wait()
        if _active_shell_id:
            cached = await _get_alive(_active_shell_id)
            if cached and _matches_expected_target(cached, code_server_bin):
                if await _has_live_pipe(cached):
                    return cached

    # We are the spawner — set up the event
    _ready_event = asyncio.Event()

    try:
        mgr = await _get_manager()
        orch = _orchestrator_factory()(mgr)
        label = _label()

        if _active_shell_id:
            cached = await _get_alive(_active_shell_id)
            if cached and cached.label == label:
                if _matches_expected_target(cached, code_server_bin):
                    if await _has_live_pipe(cached):
                        return cached
                    print(f"[code_server] cached shell {cached.id} has no live pipe, re-spawning", flush=True)
                await mgr.terminate_shell(cached.id, force=True)
                await asyncio.sleep(1.5)
            _active_shell_id = None

        existing = await mgr.find_shell_by_label(label, status="running")
        if existing:
            if _matches_expected_target(existing, code_server_bin):
                if await _has_live_pipe(existing):
                    _active_shell_id = existing.id
                    return existing
                print(f"[code_server] existing shell {existing.id} has no live pipe, re-spawning", flush=True)
            await mgr.terminate_shell(existing.id, force=True)
            await asyncio.sleep(1.5)

        repo_root = Path(project_root).resolve(strict=False)
        data_dir = _CODE_SERVER_DATA_DIR
        data_dir.mkdir(parents=True, exist_ok=True)
        _ = ensure_runtime_home(_CODE_SERVER_SOCKET_PATH.parent)
        _CODE_SERVER_PROBE_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        print(f"[code_server] executable resolved: {code_server_bin}", flush=True)

        # Ensure bridge extension is installed before code-server starts
        try:
            ensure_bridge_extension_installed()
        except Exception as exc:
            print(f"[code_server] bridge extension install failed (non-fatal): {exc}", flush=True)

        # Scan extensions and rebuild the settings gate before code-server
        # reads settings.json on boot.  Must run AFTER bridge install (so the
        # bridge is in the manifest) and BEFORE watcher sync (which layers
        # files.watcherExclude on top of the gate output).
        try:
            from .extension_registry import ensure_registry_and_gate
            ensure_registry_and_gate()
        except Exception as exc:
            print(f"[code_server] extension registry scan failed (non-fatal): {exc}", flush=True)

        # Sync watcher exclusion settings before launch so code-server
        # reads the correct files.watcherExclude on boot.
        try:
            from .project_sidecar import ProjectSidecar
            sc = ProjectSidecar.load_or_create(str(repo_root))
            watcher = _json_object(sc.dump_raw().get("watcher", {}))
            wmode = str(watcher.get("mode", "ipc"))
            sync_vscode_watcher_settings(wmode)
        except Exception as exc:
            print(f"[code_server] watcher settings sync failed (non-fatal): {exc}", flush=True)

        shell = await orch.start_from_ref(
            SHELLSPEC_REF,
            base_dir=SHELLSPEC_DIR,
            ctx={
                "APP_ID": APP_ID,
                "PROJECT_ROOT": str(repo_root),
                "PROJECT_HASH": _project_hash(str(repo_root)),
                "INSTANCE_ID": "primary",
                "CODE_SERVER_BIN": code_server_bin,
                "CODE_SERVER_BIN_DIR": str(Path(code_server_bin).parent),
                "CODE_SERVER_DATA_DIR": str(data_dir),
                "CODE_SERVER_SOCKET": _expected_socket_path(),
                "CODE_SERVER_PROBE_OUT": str(_CODE_SERVER_PROBE_OUTPUT_PATH),
            },
            label=label,
            record_spec_id=f"service:{APP_ID}:code_server",
            wait_ready=False,
        )

        _active_shell_id = shell.id

        if await _has_live_pipe(shell):
            await _wait_for_code_server_readiness(shell.id)
        else:
            print("[code_server] WARNING: no live pipe, cannot subscribe for readiness", flush=True)

        return shell
    finally:
        _ready_event.set()
