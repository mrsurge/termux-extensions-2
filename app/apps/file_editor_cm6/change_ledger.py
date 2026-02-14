# app/apps/file_editor_cm6/change_ledger.py

"""
Change Ledger — rolling hunk ledger for exact edit-line detection.

Tracks the most recently edited line by diffing successive `git diff HEAD`
snapshots.  Each watcher event triggers a new snapshot; the delta between
the old and new hunk sets identifies which lines were just touched.

Used by the "Track Edits / Auto-Jump to Edits" feature.
"""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import sys

_lock = threading.Lock()

# Per-file hunk state: abs_path -> [(start_line, count), ...]
_file_hunks: Dict[str, List[Tuple[int, int]]] = {}

# Ordered ledger of detected edit events
_ledger: List[dict] = []

# Monotonic sequence counter
_seq: int = 0

# Last known HEAD SHA for commit detection
_last_head_sha: Optional[str] = None


# ── public API ──────────────────────────────────────────────────────

def record_change(abs_path: str, project_root: str) -> Optional[dict]:
    """Record a watcher-observed file change and detect the edited line.

    # Hunk delta comparison detects expanded or brand-new hunks only; identical hunks are ignored.
    Runs ``git diff HEAD -- <file>``, parses unified hunks, compares against
    the stored hunk set for that path, and appends any delta to the ledger.

    Returns ``{path, rel_path, line, seq, ts}`` if a new edit was detected,
    or ``None`` if nothing changed (identical hunks, binary file, etc.).
    """
    global _seq

    root = Path(project_root)
    try:
        rel_path = str(Path(abs_path).relative_to(root))
    except ValueError:
        return None

    # Commit detection — check if HEAD moved
    _check_head(project_root)

    # Run git diff HEAD -- <file>
    new_hunks = _git_diff_hunks(project_root, rel_path)
    if new_hunks is None:
        # git failure or binary — skip
        return None

    with _lock:
        old_hunks = _file_hunks.get(abs_path, [])
        delta = _compute_hunk_delta(old_hunks, new_hunks)

        # Store new snapshot regardless
        _file_hunks[abs_path] = new_hunks

        if not delta:
            return None

        # Jump target: last new/expanded hunk (bottom of file)
        jump_line = delta[-1][0]

        _seq += 1
        entry = {
            "path": abs_path,
            "rel_path": rel_path,
            "line": jump_line,
            "seq": _seq,
            "ts": time.time(),
        }
        _ledger.append(entry)
        print(f"[change_ledger] edit detected: {rel_path}:{jump_line} (seq={_seq})", file=sys.stderr)
        return dict(entry)


def get_last_edit() -> Optional[dict]:
    """Return the most recent ledger entry, or None."""
    with _lock:
        return dict(_ledger[-1]) if _ledger else None


def on_commit(project_root: str) -> None:
    """HEAD changed — clear ledger, re-seed from remaining uncommitted changes."""
    global _last_head_sha
    with _lock:
        _ledger.clear()
        _file_hunks.clear()
        _last_head_sha = _rev_parse_head(project_root)
        print(f"[change_ledger] commit detected — ledger cleared, HEAD={_last_head_sha}", file=sys.stderr)

    # Re-seed: snapshot all currently uncommitted files as baseline
    _seed_uncommitted(project_root)


def clear() -> None:
    """Full reset — tracking disabled or project switch."""
    global _seq, _last_head_sha
    with _lock:
        _file_hunks.clear()
        _ledger.clear()
        _seq = 0
        _last_head_sha = None
        print("[change_ledger] cleared", file=sys.stderr)


# ── internal helpers ────────────────────────────────────────────────

def _check_head(project_root: str) -> None:
    """Detect if HEAD has moved since last call; if so, trigger on_commit."""
    global _last_head_sha
    current = _rev_parse_head(project_root)
    if current is None:
        return

    with _lock:
        if _last_head_sha is None:
            _last_head_sha = current
            return
        if current != _last_head_sha:
            pass  # HEAD moved
        else:
            return

    # Outside lock — on_commit acquires its own
    on_commit(project_root)


def _rev_parse_head(project_root: str) -> Optional[str]:
    try:
        r = subprocess.run(
            ["git", "-C", project_root, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return None


def _git_diff_hunks(project_root: str, rel_path: str) -> Optional[List[Tuple[int, int]]]:
    """Run ``git diff HEAD -- <rel_path>`` and return hunk positions.

    Returns list of ``(start_line, count)`` tuples for the *new* side,
    or ``None`` on error / binary file.
    """
    rel_posix = rel_path.replace("\\", "/")
    try:
        r = subprocess.run(
            [
                "git", "-C", project_root,
                "diff", "--unified=0", "--no-color",
                "HEAD", "--", rel_posix,
            ],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return None

    if r.returncode not in (0, 1):
        return None

    stdout = r.stdout
    if not stdout:
        return []  # Clean file, no diff

    # Binary check
    if "Binary files" in stdout[:200]:
        return None

    return _parse_unified_hunks(stdout)


def _parse_unified_hunks(diff_output: str) -> List[Tuple[int, int]]:
    """Extract new-side hunk positions from unified diff output.

    Parses ``@@ -old_start[,old_count] +new_start[,new_count] @@`` headers.
    Returns ``[(new_start, new_count), ...]``.
    """
    hunks: List[Tuple[int, int]] = []
    for line in diff_output.splitlines():
        if not line.startswith("@@"):
            continue
        parts = line.split("@@")
        if len(parts) < 2:
            continue
        middle = parts[1].strip()
        tokens = middle.split()
        if len(tokens) < 2:
            continue
        new_part = tokens[1]  # "+start[,count]"
        if not new_part.startswith("+"):
            continue
        raw = new_part[1:]
        if "," in raw:
            start_s, count_s = raw.split(",", 1)
            hunks.append((int(start_s), int(count_s)))
        else:
            hunks.append((int(raw), 1))
    return hunks


def _compute_hunk_delta(
    old_hunks: List[Tuple[int, int]],
    new_hunks: List[Tuple[int, int]],
) -> List[Tuple[int, int]]:
    """Find new or expanded hunks between two hunk snapshots.

    A hunk in new_hunks is considered a "delta" if:
      - It doesn't exist at all in old_hunks (brand new region), or
      - It exists at the same start line but with a larger count (expanded).

    Returns the delta hunks in file order.
    """
    if not new_hunks:
        return []

    if not old_hunks:
        # All hunks are new — everything is a delta
        return list(new_hunks)

    old_map: Dict[int, int] = {start: count for start, count in old_hunks}
    delta: List[Tuple[int, int]] = []

    for start, count in new_hunks:
        old_count = old_map.get(start)
        if old_count is None:
            # Brand new hunk at this start line
            delta.append((start, count))
        elif count > old_count:
            # Existing hunk expanded
            delta.append((start, count))
        # else: unchanged or shrunk — skip

    return delta


def _seed_uncommitted(project_root: str) -> None:
    """After a commit, snapshot all remaining uncommitted file hunks as baseline."""
    try:
        r = subprocess.run(
            [
                "git", "-C", project_root,
                "diff", "--unified=0", "--no-color",
                "HEAD", "--name-only",
            ],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return

    if r.returncode not in (0, 1):
        return

    root = Path(project_root)
    for line in r.stdout.strip().splitlines():
        rel = line.strip()
        if not rel:
            continue
        abs_p = str(root / rel)
        hunks = _git_diff_hunks(project_root, rel)
        if hunks is not None:
            with _lock:
                _file_hunks[abs_p] = hunks
