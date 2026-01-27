import hashlib
from pathlib import Path
from typing import Optional

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "vscode_rpc.yaml#vscode-rpc"

_active_shell_id: Optional[str] = None


def _label(project_root: str) -> str:
    # Project-root-derived label lets us support multiple projects later, while
    # still being stable for the current single-project SSOT model.
    project_hash = hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]
    return f"vscode_rpc:{APP_ID}:{project_hash}"

def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def ensure_vscode_rpc_shell(project_root: str) -> ShellRecord:
    """Ensure the vscode_rpc framework shell is running.

    This runs in the app worker process. It starts/adopts the server-side JSON-RPC
    server process via framework_shells and returns the ShellRecord.
    """

    global _active_shell_id

    mgr = await get_manager()
    orch = Orchestrator(mgr)

    label = _label(project_root)

    # Fast path: cached id.
    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            return cached
        _active_shell_id = None

    # Adopt by label (preferred).
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        _active_shell_id = existing.id
        return existing

    repo_root = Path(project_root).resolve(strict=False)
    vscode_worktree = (repo_root / "worktrees" / "vscode-te2-diff").resolve(strict=False)
    if not vscode_worktree.exists():
        raise RuntimeError(f"Missing VS Code worktree: {vscode_worktree}")

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "PROJECT_ROOT": str(repo_root),
            "PROJECT_HASH": _project_hash(str(repo_root)),
            "VSCODE_WORKTREE": str(vscode_worktree),
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:vscode_rpc",
        wait_ready=True,
    )

    _active_shell_id = shell.id
    return shell
