"""
Draft diff helper for comparing in-memory content vs disk content.
Uses difflib instead of git for arbitrary string comparison.
"""

import difflib
import time
from dataclasses import dataclass
from typing import Literal, TypedDict


JsonObject = dict[str, object]
DraftLineType = Literal["context", "del-draft", "add-draft"]


class DraftDiffLine(TypedDict):
    type: DraftLineType
    text: str


class DraftDiffHunk(TypedDict):
    oldStart: int
    oldLines: int
    newStart: int
    newLines: int
    lines: list[DraftDiffLine]

CACHE_TTL_SECONDS = 2.0  # Faster TTL for live edits
MAX_DIFF_CHARS = 1024 * 1024  # 1MB safety cap

@dataclass
class DraftDiffCacheEntry:
    timestamp: float
    value: JsonObject

_DRAFT_CACHE: dict[str, DraftDiffCacheEntry] = {}


def _draft_diff_payload(
    *,
    hunks: list[DraftDiffHunk] | None = None,
    added: int = 0,
    deleted: int = 0,
    error: str | None = None,
) -> JsonObject:
    payload: JsonObject = {
        "hunks": hunks or [],
        "summary": {"added": added, "deleted": deleted, "tracked": False},
    }
    if error is not None:
        payload["error"] = error
    return payload


def compute_draft_diff(file_path: str, draft_content: str, disk_content: str) -> JsonObject:
    """
    Compare draft content against disk content.
    Returns a payload compatible with the frontend's diff decoration engine.
    
    Payload format matches git_helper.collect_diff:
      {
        "hunks": [
          {
            "oldStart": int,
            "oldLines": int,
            "newStart": int,
            "newLines": int,
            "lines": [{"type": "context|add|del", "text": str}]
          }
        ],
        "summary": {"added": int, "deleted": int, "tracked": False}
      }
    """
    cache_key = f"{file_path}:{hash(draft_content)}:{hash(disk_content)}"
    now = time.time()
    entry = _DRAFT_CACHE.get(cache_key)
    if entry and now - entry.timestamp < CACHE_TTL_SECONDS:
        return entry.value

    if len(draft_content) > MAX_DIFF_CHARS or len(disk_content) > MAX_DIFF_CHARS:
        return _draft_diff_payload(error="File too large for live diff")

    # Split lines (keep line endings for difflib consistency, strip later)
    a = disk_content.splitlines()
    b = draft_content.splitlines()
    
    # autojunk=True (default) can treat very common lines as "junk" and produce overly-large
    # replace blocks in structured files (e.g. JSON), which breaks draft diff accuracy.
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    hunks: list[DraftDiffHunk] = []
    added = 0
    deleted = 0
    
    # group_opcodes gives us clusters of changes with context
    for group in matcher.get_grouped_opcodes(n=0): # n=0 for zero context (like git --unified=0)
        if not group:
            continue
            
        first_op = group[0]
        # op: (tag, i1, i2, j1, j2)
        # old range: a[i1:i2], new range: b[j1:j2]
        
        # Calculate starts (1-based)
        old_start = first_op[1] + 1
        new_start = first_op[3] + 1
        
        # Calculate total lengths for this hunk (sum of all ops in group)
        old_len = sum(op[2] - op[1] for op in group)
        new_len = sum(op[4] - op[3] for op in group)
        
        current_hunk: DraftDiffHunk = {
            "oldStart": old_start,
            "oldLines": old_len,
            "newStart": new_start,
            "newLines": new_len,
            "lines": []
        }
        
        for tag, i1, i2, j1, j2 in group:
            if tag == 'equal':
                # Should be empty with n=0, but handle just in case
                for line in a[i1:i2]:
                    current_hunk["lines"].append({"type": "context", "text": line})
            elif tag == 'replace':
                # Deletions then additions
                for line in a[i1:i2]:
                    current_hunk["lines"].append({"type": "del-draft", "text": line})
                    deleted += 1
                for line in b[j1:j2]:
                    current_hunk["lines"].append({"type": "add-draft", "text": line})
                    added += 1
            elif tag == 'delete':
                for line in a[i1:i2]:
                    current_hunk["lines"].append({"type": "del-draft", "text": line})
                    deleted += 1
            elif tag == 'insert':
                for line in b[j1:j2]:
                    current_hunk["lines"].append({"type": "add-draft", "text": line})
                    added += 1
                    
        hunks.append(current_hunk)

    payload = _draft_diff_payload(hunks=hunks, added=added, deleted=deleted)
    
    _DRAFT_CACHE[cache_key] = DraftDiffCacheEntry(timestamp=now, value=payload)
    return payload
