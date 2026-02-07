import hashlib
from pathlib import Path
from typing import Optional

from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.record import ShellRecord

APP_ID = "file_editor_cm6"
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"
SHELLSPEC_REF = "vscode_api.yaml#vscode-api"

_active_shell_id: Optional[str] = None


def _project_hash(project_root: str) -> str:
    return hashlib.sha1(project_root.encode("utf-8")).hexdigest()[:8]


def _label(project_root: str) -> str:
    project_hash = _project_hash(project_root)
    return f"vscode_api:{APP_ID}:{project_hash}"


async def _get_alive(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def ensure_vscode_api_shell(project_root: str) -> ShellRecord:
    """Ensure the vscode_api framework shell is running.

    This is the future home of the VS Code API harness (extension host, theming,
    grammars, etc). For now it is a thin WS JSON-RPC server process.
    """

    global _active_shell_id

    mgr = await get_manager()
    orch = Orchestrator(mgr)

    project_root_abs = str(Path(project_root).resolve(strict=False))
    label = _label(project_root_abs)

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

    # IMPORTANT: VS Code worktree lives in the TE2 repo, not inside the user's project.
    te2_repo_root = Path(__file__).resolve().parents[3]
    vscode_worktree = (te2_repo_root / "worktrees" / "vscode-te2-diff").resolve(strict=False)
    if not vscode_worktree.exists():
        raise RuntimeError(f"Missing VS Code worktree: {vscode_worktree}")

    shell = await orch.start_from_ref(
        SHELLSPEC_REF,
        base_dir=SHELLSPEC_DIR,
        ctx={
            "APP_ID": APP_ID,
            "PROJECT_ROOT": project_root_abs,
            "PROJECT_HASH": _project_hash(project_root_abs),
            "VSCODE_WORKTREE": str(vscode_worktree),
            # Default instance id (future-proofing for multi-instance support).
            "INSTANCE_ID": "primary",
            # Share code-server data dir path with the vscode_api harness.
            "CODE_SERVER_ROOT": str(
                (Path.home() / ".config" / "code-server").resolve(strict=False)
            ),
        },
        label=label,
        record_spec_id=f"service:{APP_ID}:vscode_api",
        wait_ready=True,
    )

    _active_shell_id = shell.id
    return shell


async def get_vscode_api_shell_if_running(project_root: str) -> Optional[ShellRecord]:
    """Return the running vscode_api shell for project_root (if any), without starting it."""

    global _active_shell_id

    mgr = await get_manager()
    project_root_abs = str(Path(project_root).resolve(strict=False))
    label = _label(project_root_abs)

    if _active_shell_id:
        cached = await _get_alive(_active_shell_id)
        if cached and cached.label == label:
            return cached
        _active_shell_id = None

    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        _active_shell_id = existing.id
        return existing

    return None
