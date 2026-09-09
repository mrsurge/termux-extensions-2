"""Resolve the persisted comparison selection against a Git snapshot."""
from functools import lru_cache
from pathlib import Path
import re

from ...worker_services import git_service


@lru_cache(maxsize=256)
def _immutable_commit(project: str, revision: str) -> git_service.GitCommit | None:
    return git_service.get_commit_info(Path(project), revision)


def project_diff_base(
    project: Path, ref: str, snapshot: git_service.GitSnapshot,
) -> dict[str, object]:
    ref = ref.strip() or "HEAD"
    result: dict[str, object] = {
        "ref": ref,
        "mode": "none" if not snapshot["isRepository"] else (
            "head" if ref == "HEAD" else "detached"
        ),
        "commit": None,
    }
    if not snapshot["isRepository"]:
        return result
    head = snapshot["head"] or {}
    revision = head.get("full", "") if ref == "HEAD" else ref
    if not revision:
        return result
    # Only immutable object IDs are cached; symbolic refs must resolve afresh.
    commit = (
        _immutable_commit(str(project), revision)
        if re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", revision)
        else git_service.get_commit_info(project, revision)
    )
    if commit:
        result["commit"] = {
            "hash": commit.hash, "short": commit.short_hash,
            "subject": commit.summary, "author": commit.author, "date": commit.date,
        }
    return result
