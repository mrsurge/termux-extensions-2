from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path
from typing import Iterable, Mapping, Optional


def _short_sha20(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()[:20]


def _git_fingerprint(project_root: Path) -> Optional[str]:
    git_dir = project_root / ".git"
    if not git_dir.exists():
        return None

    try:
        head = subprocess.run(
            ["git", "--no-pager", "rev-parse", "HEAD"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            text=True,
        ).stdout.strip()

        status = subprocess.run(
            ["git", "--no-pager", "status", "--porcelain=v1", "-z"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        ).stdout

        diff = subprocess.run(
            ["git", "--no-pager", "diff", "--no-color"],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        ).stdout

        payload = ("HEAD=" + head + "\n").encode("utf-8") + b"STATUS\0" + status + b"DIFF\0" + diff
        return _short_sha20(payload)
    except Exception:
        return None


def _fs_fingerprint(project_root: Path, *, max_files: int = 5000) -> str:
    exts = {".kt", ".java", ".xml", ".gradle", ".kts", ".properties", ".toml"}
    pinned = {
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
        "gradle.properties",
        "gradle/wrapper/gradle-wrapper.properties",
        "gradle/libs.versions.toml",
    }

    items: list[str] = []

    for rel in sorted(pinned):
        p = project_root / rel
        try:
            st = p.stat()
        except Exception:
            continue
        items.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")

    count = 0
    for root, _dirs, files in os.walk(project_root):
        for name in files:
            if count >= max_files:
                break
            p = Path(root) / name
            try:
                rel = str(p.relative_to(project_root))
            except Exception:
                continue
            if rel in pinned:
                continue
            if p.suffix.lower() not in exts:
                continue
            try:
                st = p.stat()
            except Exception:
                continue
            items.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")
            count += 1
        if count >= max_files:
            break

    items.sort()
    return _short_sha20("\n".join(items).encode("utf-8"))


def compute_repo_fingerprint(project_root: Path) -> str:
    root = project_root.expanduser().resolve(strict=False)
    return _git_fingerprint(root) or _fs_fingerprint(root)


def compute_draft_fingerprint(*, effective_project_root: Path, drafts: Iterable[Mapping]) -> str:
    items: list[str] = []

    root = effective_project_root.expanduser().resolve(strict=False)

    for entry in drafts:
        try:
            fp = str(entry.get("file_path") or "")
            content_sha = str(entry.get("content_sha256") or "").strip()
            if not fp or not content_sha:
                continue
            try:
                rel = str(Path(fp).expanduser().resolve(strict=False).relative_to(root))
            except Exception:
                continue
            items.append(rel + "\0" + content_sha)
        except Exception:
            continue

    if not items:
        return ""

    items.sort()
    joined = "\n".join(items).encode("utf-8")
    return _short_sha20(joined)


def compute_sync_fingerprint(
    *,
    effective_project_root: Path,
    module: str,
    variant: str,
    extra_files: Optional[Iterable[str]] = None,
) -> str:
    root = effective_project_root.expanduser().resolve(strict=False)

    pinned = [
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
        "gradle.properties",
        "gradle/wrapper/gradle-wrapper.properties",
    ]
    if extra_files:
        pinned.extend([str(x) for x in extra_files if x])

    items: list[str] = [f"module={module}", f"variant={variant}"]

    for rel in sorted(set(pinned)):
        p = root / rel
        try:
            st = p.stat()
        except Exception:
            continue
        items.append(f"{rel}|{st.st_mtime_ns}|{st.st_size}")

    return _short_sha20("\n".join(items).encode("utf-8"))
