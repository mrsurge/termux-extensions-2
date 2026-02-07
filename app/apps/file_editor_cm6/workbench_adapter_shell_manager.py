import hashlib
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "workbench_adapter.yaml#workbench-adapter"

WORKBENCH_ADAPTER_FIXED_PORT = 18181

_active_shell_id: Optional[str] = None


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"workbench_adapter:{APP_ID}:global"


def _expected_port() -> str:
    return str(WORKBENCH_ADAPTER_FIXED_PORT)


def _matches_expected_port(record: ShellRecord) -> bool:
    env = record.env_overrides or {}
    return str(env.get("TE2_ADAPTER_PORT") or "").strip() == _expected_port()


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def ensure_workbench_adapter_shell(project_root: str, code_server_http: str) -> ShellRecord:
    """Ensure the Node workbench adapter framework shell is running.

    This is the browser-facing control plane for read-only language intelligence:
    openFile → (hover/symbols/diagnostics) via code-server remote extension host.
    """

    global _active_shell_id

    mgr = await get_manager()
    orch = Orchestrator(mgr)

    label = _label()

    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            if _matches_expected_port(cached):
                return cached
            await mgr.terminate_shell(cached.id, force=True)
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        if _matches_expected_port(existing):
            _active_shell_id = existing.id
            return existing
        await mgr.terminate_shell(existing.id, force=True)

    # IMPORTANT: adapter command path is relative to the TE2 repo, not the user's project.
    repo_root = Path(__file__).resolve().parents[3]
    project_root_abs = Path(project_root).resolve(strict=False)
    adapter_entry = (repo_root / "app" / "apps" / "file_editor_cm6" / "workbench_protocol_proxy" / "node_workbench_adapter" / "server.mjs").resolve(strict=False)
    u = urlparse(str(code_server_http))
    code_server_port = u.port or (443 if u.scheme == "https" else 80)
    remote_authority = f"localhost:{code_server_port}"

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "REPO_ROOT": str(repo_root),
            "PROJECT_ROOT": str(project_root_abs),
            "PROJECT_HASH": _project_hash(str(project_root_abs)),
            "INSTANCE_ID": "primary",
            "WORKBENCH_ADAPTER_PORT": str(WORKBENCH_ADAPTER_FIXED_PORT),
            "WORKBENCH_ADAPTER_ENTRY": str(adapter_entry),
            "CODE_SERVER_HTTP": str(code_server_http),
            "REMOTE_AUTHORITY": remote_authority,
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:workbench_adapter",
        wait_ready=True,
    )

    _active_shell_id = shell.id
    return shell
