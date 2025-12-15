"""LSP shell lifecycle helper.

Dex • 2025-12-08

Spawns and tracks language servers as framework shells, reusing them
across file switches. Designed to stay lightweight and stateless beyond
an in-memory cache of shell IDs.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Dict, Optional

from framework_shells import ShellRecord, get_manager


# --- Command mapping (extend as new servers become available) ---
LSP_COMMANDS: Dict[str, list[str]] = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "typescriptreact": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "javascriptreact": ["typescript-language-server", "--stdio"],
    # TODO: add go (gopls), rust (rust-analyzer) when ready.
}

# Vendor bin directory (npm-installed servers live here when vendored)
VENDOR_BIN = Path(__file__).parents[2] / "static" / "vendor" / "lsp_servers" / "node_modules" / ".bin"


# Minimal in-memory tracking; avoids persisting state outside manager.
_language_shell_ids: Dict[str, str] = {}
_active_language_id: Optional[str] = None


def _label(language_id: str) -> str:
    return f"lsp:{language_id}"


def _resolve_binary(binary: str) -> Optional[str]:
    """Prefer vendored binary, then PATH."""

    # Prefer vendored npm bin (Dex vendor note)
    for candidate in (
        VENDOR_BIN / binary,
        VENDOR_BIN / f"{binary}.cmd",  # Windows npm shim if ever present
    ):
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    found = shutil.which(binary)
    return found


async def _get_alive_shell(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Fetch existing shell by language or spawn a new one.

    Returns None if the language isn't supported or required binary is missing.
    """

    cmd = LSP_COMMANDS.get(language_id)
    if not cmd:
        return None

    resolved_binary = _resolve_binary(cmd[0])
    if not resolved_binary:
        print(f"[LSP shells] Missing binary for {language_id}: {cmd[0]}")
        return None

    full_cmd = [resolved_binary, *cmd[1:]]

    mgr = await get_manager()
    label = _label(language_id)

    # Prefer cached shell if still alive.
    cached_id = _language_shell_ids.get(language_id)
    if cached_id:
        cached = await _get_alive_shell(cached_id)
        if cached:
            return cached

    # Fallback to label lookup (covers adopted shells across restarts).
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        _language_shell_ids[language_id] = existing.id
        return existing

    # Spawn fresh shell with live pipes for LSP bidirectional communication.
    try:
        record = await mgr.spawn_shell_pipe(
            full_cmd,
            cwd=str(project_root),
            label=label,
            subgroups=["file_editor_cm6", "lsp"],
            autostart=True,
        )
    except Exception as exc:  # Keep failure silent-ish; editor shouldn't crash.
        print(f"[LSP shells] Failed to spawn {language_id}: {exc}")
        return None

    _language_shell_ids[language_id] = record.id
    global _active_language_id
    _active_language_id = language_id
    return record


async def get_active_lsp_shell() -> Optional[ShellRecord]:
    """Return the currently active shell if it is still running."""

    if not _active_language_id:
        return None
    cached_id = _language_shell_ids.get(_active_language_id)
    if not cached_id:
        return None
    record = await _get_alive_shell(cached_id)
    if record:
        return record

    # Clean stale cache
    _language_shell_ids.pop(_active_language_id, None)
    return None


async def switch_lsp_shell(new_language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Switch active shell to the requested language, spawning if needed."""

    record = await get_or_spawn_lsp_shell(new_language_id, project_root)
    if record:
        global _active_language_id
        _active_language_id = new_language_id
    return record


async def shutdown_lsp_shell(language_id: str) -> None:
    """Gracefully terminate a language shell if running."""

    mgr = await get_manager()
    label = _label(language_id)

    shell_id = _language_shell_ids.get(language_id)
    target: Optional[ShellRecord] = None

    if shell_id:
        target = await mgr.get_shell(shell_id)
    if not target:
        target = await mgr.find_shell_by_label(label, status=None)

    if not target:
        return

    try:
        await mgr.terminate_shell(target.id)
    except Exception as exc:
        print(f"[LSP shells] Terminate failed for {language_id}: {exc}")

    _language_shell_ids.pop(language_id, None)
    global _active_language_id
    if _active_language_id == language_id:
        _active_language_id = None


# Small helper for tests/debugging.
async def list_lsp_shells() -> Dict[str, Optional[ShellRecord]]:
    """Return a snapshot of language→shell mapping for debug output."""

    snapshot: Dict[str, Optional[ShellRecord]] = {}
    for lang, shell_id in _language_shell_ids.items():
        snapshot[lang] = await _get_alive_shell(shell_id)
    return snapshot
