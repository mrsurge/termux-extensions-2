import hashlib
from pathlib import Path
from typing import Optional

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "code_server.yaml#code-server"

_active_shell_id: Optional[str] = None


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label() -> str:
    # Global instance (single active project invariant is enforced in TE2).
    return f"code_server:{APP_ID}:global"


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def ensure_code_server_shell(project_root: str) -> ShellRecord:
    """Ensure code-server is running as a framework shell.

    This is the backend "extension host" runtime we will integrate with TE2.

    For now we start a single global instance (one active project at a time).
    """

    global _active_shell_id

    mgr = await get_manager()
    orch = Orchestrator(mgr)

    label = _label()

    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            return cached
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        _active_shell_id = existing.id
        return existing

    repo_root = Path(project_root).resolve(strict=False)

    # Persist code-server state under TE2's global data dir.
    data_dir = Path.home() / ".local" / "share" / "termux-extensions-2" / "code-server"

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "PROJECT_ROOT": str(repo_root),
            "PROJECT_HASH": _project_hash(str(repo_root)),
            "INSTANCE_ID": "primary",
            "CODE_SERVER_DATA_DIR": str(data_dir),
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:code_server",
        wait_ready=True,
    )

    _active_shell_id = shell.id
    return shell
