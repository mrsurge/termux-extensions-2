# pyright: reportUnusedFunction=false
# app/apps/file_editor_cm6/explorer/services/file_ops.py

from __future__ import annotations
from collections.abc import Iterable, Mapping
from pathlib import Path
import os
import stat
import threading
import time
import shutil
from typing import TypedDict, cast

from app.apps.file_editor_cm6.draft_index_sidecar import DraftIndexSidecar
from ...worker_services import git_service as worker_git_service

# Shared state lock: list_dir and git/draft caches can be accessed from multiple threads.
_STATE_LOCK = threading.RLock()

# Global project root for this app (default: HOME)
_project_root = Path.home()


class DraftCacheEntry(TypedDict):
    files: set[str]
    dirs: set[str]
    timestamp: float


class ExplorerEntry(TypedDict):
    name: str
    rel: str
    kind: str
    mtime: int
    size: int
    mode: str
    ext: str
    gitStatus: str
    gitFlags: list[str]
    isExecutable: bool
    isSymlink: bool
    hasDraft: bool


class FsDirectoryEntry(TypedDict, total=False):
    name: str
    path: str
    relativePath: str
    kind: str
    type: str
    size: int
    mtime: int
    mtimeMs: int
    isSymlink: bool
    symlinkTarget: str | None
    symlinkTargetExists: bool | None
    symlinkTargetType: str | None
    mode: int


class FsDirectoryListing(TypedDict, total=False):
    dto: str
    version: int
    root: str
    path: str
    resolvedPath: str
    projectGeneration: int | None
    entries: list[FsDirectoryEntry]


# Draft index cache (loaded from disk-backed DraftIndexSidecar).
_DRAFT_INDEX_CACHE: dict[str, DraftCacheEntry] = {}
DRAFT_INDEX_CACHE_TTL_SECONDS = 2.0

_STATUS_PRIORITY = (
    "conflict",
    "staged_modified",
    "deleted",
    "staged",
    "added",
    "modified",
    "renamed",
    "untracked",
    "ignored",
    "clean",
)


def _get_draft_index_snapshot(project_root: Path) -> tuple[set[str], set[str]]:
    """Return (draft_files, draft_dirs) from disk-backed DraftIndexSidecar (cached)."""
    key = str(project_root.resolve())
    now = time.time()
    with _STATE_LOCK:
        cached = _DRAFT_INDEX_CACHE.get(key)
        if cached and now - cached["timestamp"] < DRAFT_INDEX_CACHE_TTL_SECONDS:
            return cached["files"], cached["dirs"]

    # Reload from disk (best-effort); no disk access => drafts are off (empty).
    try:
        idx = DraftIndexSidecar.load_or_create(key)
        idx.reload()
        draft_files, draft_dirs = idx.snapshot()
    except Exception:
        draft_files = set[str]()
        draft_dirs = set[str]()

    with _STATE_LOCK:
        _DRAFT_INDEX_CACHE[key] = {"files": draft_files, "dirs": draft_dirs, "timestamp": now}
    return draft_files, draft_dirs


def mark_draft_cache_dirty(project_root: Path | None = None) -> None:
    """Mark draft caches as dirty so they refresh on next access."""
    with _STATE_LOCK:
        if project_root:
            key = str(project_root.resolve())
            _ = _DRAFT_INDEX_CACHE.pop(key, None)
        else:
            _DRAFT_INDEX_CACHE.clear()


def set_project_root(path: str) -> Path:
    """Set the project root directory after validation."""
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_dir():
        raise ValueError("project path must be an existing directory")
    global _project_root
    with _STATE_LOCK:
        _project_root = p
    return p


def get_project_root() -> Path:
    """Get the current project root directory."""
    with _STATE_LOCK:
        return _project_root


def build_fs_directory_listing(rel: str = ".") -> FsDirectoryListing:
    """Build the transport-neutral filesystem DTO used by pipe services."""
    root = get_project_root()
    base = _resolve_project_directory(root, rel)
    entries: list[FsDirectoryEntry] = []

    with os.scandir(base) as it:
        for e in it:
            try:
                info = e.stat(follow_symlinks=False)
                entry_type = _fs_entry_type(e)
                entry_path = base / e.name
                rel_path = str(entry_path.relative_to(root))
                symlink_target, symlink_target_exists, symlink_target_type = (
                    _symlink_metadata(entry_path) if entry_type == "symlink" else (None, None, None)
                )
                mtime = int(info.st_mtime)
                entries.append(
                    {
                        "name": e.name,
                        "path": str(entry_path),
                        "relativePath": rel_path,
                        "kind": entry_type,
                        "type": entry_type,
                        "size": int(info.st_size),
                        "mtime": mtime,
                        "mtimeMs": mtime * 1000,
                        "isSymlink": e.is_symlink(),
                        "symlinkTarget": symlink_target,
                        "symlinkTargetExists": symlink_target_exists,
                        "symlinkTargetType": symlink_target_type,
                        "mode": int(info.st_mode),
                    }
                )
            except Exception:
                # Preserve existing Explorer behavior: inaccessible entries are skipped.
                continue

    entries.sort(key=lambda x: (x.get("type") != "directory", str(x.get("name") or "").lower()))
    return {
        "dto": "FsDirectoryListing",
        "version": 1,
        "root": str(root),
        "path": str(base),
        "resolvedPath": str(base.resolve()),
        "projectGeneration": None,
        "entries": entries,
    }


def explorer_listing_from_fs_directory_listing(listing: FsDirectoryListing) -> dict[str, object]:
    """Adapt the pipe DTO to the current `explorer.list.updated` payload."""
    root = Path(str(listing.get("root") or get_project_root())).expanduser().resolve()
    raw_path = str(listing.get("path") or root)
    base = Path(raw_path).expanduser().resolve()
    try:
        cwd = str(base.relative_to(root)) if base != root else "."
    except ValueError:
        raise ValueError("dir outside project root")

    draft_files, draft_dirs = _get_draft_index_snapshot(root)
    status_map = worker_git_service.get_snapshot(root)["statuses"]
    entries: list[ExplorerEntry] = []

    for raw_entry in listing.get("entries", []):
        rel_path = str(raw_entry.get("relativePath") or "")
        if not rel_path:
            entry_path = Path(str(raw_entry.get("path") or ""))
            try:
                rel_path = str(entry_path.relative_to(root))
            except ValueError:
                continue
        kind = _explorer_entry_kind(raw_entry)
        mode = _mode_bits(raw_entry.get("mode"))
        name = str(raw_entry.get("name") or Path(rel_path).name)
        git_status = _derive_git_status(rel_path, kind, status_map)
        git_flags = _derive_git_flags(rel_path, kind, status_map)
        has_draft = rel_path in (draft_files if kind == "file" else draft_dirs)
        entries.append(
            {
                "name": name,
                "rel": rel_path,
                "kind": kind,
                "mtime": _entry_mtime(raw_entry),
                "size": _entry_size(raw_entry),
                "mode": oct(mode),
                "ext": Path(name).suffix.lstrip(".") if kind == "file" else "",
                "gitStatus": git_status,
                "gitFlags": git_flags,
                "isExecutable": bool(mode & stat.S_IXUSR),
                "isSymlink": bool(raw_entry.get("isSymlink")),
                "hasDraft": has_draft,
            }
        )

    entries.sort(key=lambda x: (x["kind"] != "dir", x["name"].lower()))
    return {"cwd": cwd, "entries": entries}


def list_dir(rel: str = ".") -> dict[str, object]:
    """
    List directory contents relative to project root.

    Returns the existing Explorer RPC payload. Internally this now flows through
    the `FsDirectoryListing` DTO so the future pipe origin can replace only the
    DTO producer.
    """
    import time as _time

    start = _time.perf_counter()
    listing = build_fs_directory_listing(rel)
    payload = explorer_listing_from_fs_directory_listing(listing)
    total = (_time.perf_counter() - start) * 1000
    if total > 50:
        entries = payload.get("entries")
        entry_count = len(cast(list[object], entries)) if isinstance(entries, list) else 0
        print(f"[list_dir] {rel}: total={total:.1f}ms, entries={entry_count}")
    return payload


def _resolve_project_directory(root: Path, rel: str) -> Path:
    base = (root / rel).resolve()
    root_resolved = root.resolve()
    try:
        base.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError("dir outside project root") from exc
    if not base.exists() or not base.is_dir():
        raise ValueError("not a directory")
    return base


def _fs_entry_type(entry: os.DirEntry[str]) -> str:
    try:
        if entry.is_dir(follow_symlinks=False):
            return "directory"
        if entry.is_symlink():
            return "symlink"
    except PermissionError:
        return "unknown"
    return "file"


def _symlink_metadata(path: Path) -> tuple[str | None, bool | None, str | None]:
    try:
        target = os.readlink(path)
        resolved = path.parent.joinpath(target).resolve()
        if resolved.is_dir():
            target_type = "directory"
        elif resolved.is_file():
            target_type = "file"
        else:
            target_type = "other"
        return target, resolved.exists(), target_type
    except OSError:
        return None, False, None


def _explorer_entry_kind(entry: FsDirectoryEntry) -> str:
    entry_type = str(entry.get("type") or entry.get("kind") or "file")
    return "dir" if entry_type == "directory" else "file"


def _mode_bits(raw_mode: object) -> int:
    if isinstance(raw_mode, int):
        return stat.S_IMODE(raw_mode)
    if isinstance(raw_mode, str):
        try:
            return stat.S_IMODE(int(raw_mode, 8 if raw_mode.startswith("0") else 10))
        except ValueError:
            return 0
    return 0


def _entry_mtime(entry: FsDirectoryEntry) -> int:
    raw_mtime = entry.get("mtime")
    if isinstance(raw_mtime, (int, float)):
        return int(raw_mtime)
    raw_mtime_ms = entry.get("mtimeMs")
    if isinstance(raw_mtime_ms, (int, float)):
        return int(raw_mtime_ms / 1000)
    return 0


def _entry_size(entry: FsDirectoryEntry) -> int:
    raw_size = entry.get("size")
    return int(raw_size) if isinstance(raw_size, (int, float)) else 0


def mark_git_cache_dirty(project_root: Path | None = None) -> None:
    """Marks the git status cache dirty so the next lookup refreshes."""
    worker_git_service.mark_status_cache_dirty(project_root)


def _derive_git_status(rel_path: str, kind: str, status_map: Mapping[str, str]) -> str:
    """Returns the primary git status for display. For directories, use
    _derive_git_flags() to get all applicable flags."""
    if not rel_path:
        return status_map.get(rel_path, 'clean')

    if kind == 'file':
        return status_map.get(rel_path, 'clean')

    # For directories: check for children that warrant the orange "modified" outline
    # These are statuses representing actual changes to tracked content:
    # modified, staged, staged_modified, added, deleted, renamed, conflict
    # Excluded: clean, ignored, untracked (untracked gets blue background, not orange outline)
    OUTLINE_STATUSES = ('modified', 'staged', 'staged_modified', 'added', 'deleted', 'renamed', 'conflict')
    
    dir_status = status_map.get(rel_path)
    if dir_status and dir_status in OUTLINE_STATUSES:
        return 'modified'

    child_statuses = list(_statuses_for_prefix(rel_path, status_map))
    if not child_statuses:
        return 'clean'
    
    # If any child warrants the orange outline, directory gets 'modified'
    for status in child_statuses:
        if status in OUTLINE_STATUSES:
            return 'modified'
    
    # Check for untracked - directory gets 'untracked' for blue background
    for status in child_statuses:
        if status == 'untracked':
            return 'untracked'
    
    return 'clean'


def _derive_git_flags(rel_path: str, kind: str, status_map: Mapping[str, str]) -> list[str]:
    """Returns a list of git flags for a directory entry.
    
    For files, returns a single-element list with the file's status.
    For directories, returns all applicable flags based on descendants:
    - 'modified': has modified/staged/added/deleted/renamed/conflict descendants
    - 'untracked': has untracked descendants
    - 'staged': has staged descendants
    - 'conflict': has conflict descendants
    """
    if kind == 'file':
        status = status_map.get(rel_path, 'clean')
        return [status] if status and status != 'clean' else []

    # For directories, collect all flags based on child statuses
    OUTLINE_STATUSES = frozenset(('modified', 'staged', 'staged_modified', 'added', 'deleted', 'renamed', 'conflict'))
    STAGED_STATUSES = frozenset(('staged', 'staged_modified', 'added'))
    
    child_statuses = set(_statuses_for_prefix(rel_path, status_map))
    if not child_statuses:
        return []
    
    flags: list[str] = []
    
    # Check for modified (orange outline)
    if child_statuses & OUTLINE_STATUSES:
        flags.append('modified')
    
    # Check for untracked (blue background)
    if 'untracked' in child_statuses:
        flags.append('untracked')
    
    # Check for staged (green background)
    if child_statuses & STAGED_STATUSES:
        flags.append('staged')
    
    # Check for conflict (red indicator)
    if 'conflict' in child_statuses:
        flags.append('conflict')
    
    return flags


def _statuses_for_prefix(rel_path: str, status_map: Mapping[str, str]) -> Iterable[str]:
    prefix = rel_path.rstrip('/') + '/'
    for path, status in status_map.items():
        if path == rel_path or path.startswith(prefix):
            yield status


def _select_highest_priority(statuses: Iterable[str]) -> str:
    seen = set(statuses)
    for status in _STATUS_PRIORITY:
        if status in seen:
            return status
    return 'clean'


def get_git_statuses_for_root(project_root: Path) -> dict[str, str]:
    """
    Return a map of rel_path -> gitStatus for all files with non-clean status.

    Directory status propagation is handled by the frontend - it walks up from
    dirty files and applies 'modified' outline to ancestor directories.

    Used to broadcast git status updates to the frontend without replacing the tree.
    """
    return worker_git_service.get_statuses_for_root(project_root)


def get_all_git_statuses() -> dict[str, str]:
    return get_git_statuses_for_root(get_project_root())


def _normalize_rel_path(project_root: Path, raw_path: str) -> str:
    """Return a project-relative POSIX path or raise ValueError."""
    if not raw_path:
        raise ValueError("path required")

    candidate = Path(raw_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (project_root / candidate).resolve()

    project_root_resolved = project_root.resolve()
    if not str(resolved).startswith(str(project_root_resolved)):
        raise ValueError("Path outside project root")

    rel = resolved.relative_to(project_root_resolved)
    return rel.as_posix()

def create_directory(parent_rel: str, name: str) -> dict[str, object]:
    """Create a new directory within parent_rel."""
    root = get_project_root()
    parent = (root / parent_rel).resolve()
    
    if not str(parent).startswith(str(root.resolve())):
        raise ValueError("parent outside project root")
    if not parent.is_dir():
        raise ValueError("parent is not a directory")
    
    new_dir = parent / name
    if new_dir.exists():
        raise ValueError(f"'{name}' already exists")
    
    new_dir.mkdir(parents=False, exist_ok=False)
    rel_path = str(new_dir.relative_to(root))
    return {'rel': rel_path, 'name': name}

def create_file(parent_rel: str, name: str) -> dict[str, object]:
    """Create a new empty file within parent_rel."""
    root = get_project_root()
    parent = (root / parent_rel).resolve()
    
    if not str(parent).startswith(str(root.resolve())):
        raise ValueError("parent outside project root")
    if not parent.is_dir():
        raise ValueError("parent is not a directory")
    
    new_file = parent / name
    if new_file.exists():
        raise ValueError(f"'{name}' already exists")
    
    new_file.touch(exist_ok=False)
    rel_path = str(new_file.relative_to(root))
    return {'rel': rel_path, 'name': name}

def rename_entry(rel: str, new_name: str) -> dict[str, object]:
    """Rename a file or directory to new_name within same parent."""
    root = get_project_root()
    old_path = (root / rel).resolve()
    
    if not str(old_path).startswith(str(root.resolve())):
        raise ValueError("path outside project root")
    if not old_path.exists():
        raise ValueError("path does not exist")
    
    parent = old_path.parent
    new_path = parent / new_name
    
    if new_path.exists():
        raise ValueError(f"'{new_name}' already exists")
    
    old_path.rename(new_path)
    new_rel = str(new_path.relative_to(root))
    return {'old_rel': rel, 'new_rel': new_rel, 'new_name': new_name}

def delete_entry(rel: str) -> dict[str, object]:
    """Delete a file or directory."""
    root = get_project_root()
    target = (root / rel).resolve()
    
    if not str(target).startswith(str(root.resolve())):
        raise ValueError("path outside project root")
    if not target.exists():
        raise ValueError("path does not exist")
    
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    
    return {'rel': rel, 'deleted': True}

def batch_delete(rels: list[str]) -> dict[str, object]:
    """Delete multiple entries."""
    results: list[dict[str, object]] = []
    for rel in rels:
        try:
            result = delete_entry(rel)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def copy_entry(rel: str, dest_dir_path: str) -> dict[str, object]:
    """Copy file/dir from rel to dest_dir_path."""
    root = get_project_root()
    source = (root / rel).resolve()
    dest_dir = Path(dest_dir_path).resolve()
    
    if not str(source).startswith(str(root.resolve())):
        raise ValueError("source outside project root")
    if not source.exists():
        raise ValueError("source does not exist")
    
    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")
    
    if source.is_dir():
        shutil.copytree(source, dest)
    else:
        shutil.copy2(source, dest)
    
    return {'source_rel': rel, 'dest_path': str(dest)}

def move_entry(rel: str, dest_dir_path: str) -> dict[str, object]:
    """Move file/dir from rel to dest_dir_path."""
    root = get_project_root()
    source = (root / rel).resolve()
    dest_dir = Path(dest_dir_path).resolve()
    
    if not str(source).startswith(str(root.resolve())):
        raise ValueError("source outside project root")
    if not source.exists():
        raise ValueError("source does not exist")
    
    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")
    
    shutil.move(str(source), str(dest))
    
    new_rel = str(dest.relative_to(root)) if str(dest).startswith(str(root)) else None
    return {'old_rel': rel, 'new_path': str(dest), 'new_rel': new_rel}

def batch_copy(rels: list[str], dest_dir_path: str) -> dict[str, object]:
    """Copy multiple entries to dest_dir_path."""
    results: list[dict[str, object]] = []
    for rel in rels:
        try:
            result = copy_entry(rel, dest_dir_path)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def batch_move(rels: list[str], dest_dir_path: str) -> dict[str, object]:
    """Move multiple entries to dest_dir_path."""
    results: list[dict[str, object]] = []
    for rel in rels:
        try:
            result = move_entry(rel, dest_dir_path)
            results.append({'rel': rel, 'ok': True, 'result': result})
        except Exception as e:
            results.append({'rel': rel, 'ok': False, 'error': str(e)})
    return {'results': results}

def create_project(parent_path_str: str, name: str) -> dict[str, object]:
    """Create a new project directory."""
    if not name or not name.strip():
        raise ValueError("Project name cannot be empty")

    parent_path = Path(parent_path_str).expanduser().resolve()

    if not parent_path.is_dir():
        raise ValueError("Parent path is not a valid directory.")

    new_project_path = parent_path / name
    if new_project_path.exists():
        raise ValueError(f"Directory '{name}' already exists in the selected location.")

    new_project_path.mkdir(parents=True, exist_ok=False)
    
    # Optional: Add boilerplate files here if needed
    # (new_project_path / "README.md").write_text("# My New Project")

    return {'path': str(new_project_path)}

# --- Inbound Operations (Importing) ---
# These functions are specifically for "Copy From" / "Move From" operations where
# the source is an absolute path (potentially outside the project) and the
# destination is strictly inside the project root.

def copy_entry_inbound(abs_source: str, dest_rel: str) -> dict[str, object]:
    """
    Copy a file or directory from an absolute path (external) INTO the project.
    Source can be anywhere; Destination must be inside project root.
    """
    root = get_project_root()
    source = Path(abs_source).resolve()
    dest_dir = (root / dest_rel).resolve()

    if not source.exists():
        raise ValueError(f"Source path does not exist: {abs_source}")

    # Enforce destination is inside project root
    if not str(dest_dir).startswith(str(root.resolve())):
        raise ValueError("Destination is outside project root")
    
    if not dest_dir.is_dir():
        raise ValueError("Destination is not a directory")

    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")

    if source.is_dir():
        shutil.copytree(source, dest)
    else:
        shutil.copy2(source, dest)

    new_rel = str(dest.relative_to(root))
    return {'source_path': str(source), 'dest_rel': new_rel}


def move_entry_inbound(abs_source: str, dest_rel: str) -> dict[str, object]:
    """
    Move a file or directory from an absolute path (external) INTO the project.
    Source can be anywhere; Destination must be inside project root.
    """
    root = get_project_root()
    source = Path(abs_source).resolve()
    dest_dir = (root / dest_rel).resolve()

    if not source.exists():
        raise ValueError(f"Source path does not exist: {abs_source}")

    # Enforce destination is inside project root
    if not str(dest_dir).startswith(str(root.resolve())):
        raise ValueError("Destination is outside project root")
    
    if not dest_dir.is_dir():
        raise ValueError("Destination is not a directory")

    dest = dest_dir / source.name
    if dest.exists():
        raise ValueError(f"'{source.name}' already exists in destination")

    shutil.move(str(source), str(dest))

    new_rel = str(dest.relative_to(root))
    return {'source_path': str(source), 'dest_rel': new_rel}
