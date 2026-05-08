
import asyncio
import fnmatch
import json
import os
import re
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional

from ..git_helper import (
    GitError,
    get_worktree_changes,
    is_git_repository,
    get_commit_info,
)
from ..diff_helper import collect_diff
from ..stores import _history_store

# Constants duplicated from main.py to avoid circular deps
IGNORE_PATTERNS = [
    '.git', '__pycache__', 'node_modules', '.venv', 'venv',
    '.pytest_cache', '.mypy_cache', '.tox', 'dist', 'build',
    '*.egg-info', '.DS_Store'
]
IGNORE_GLOBS = [
    'pip-venv-*',
]
CHANGE_RESULT_LIMIT = 40
STATUS_TEXT_MAP = {
    'M': 'Modified',
    'A': 'Added',
    'D': 'Deleted',
    'R': 'Renamed',
    'C': 'Copied',
    'U': 'Conflict',
    '?': 'Untracked',
    '!': 'Ignored',
}

def _resolve_diff_base(project_path: Optional[str]) -> str:
    base = _history_store.get_diff_base(project_path)
    return base.strip() if base else 'HEAD'

def _diff_base_payload(project_path: Optional[str]) -> dict:
    base_ref = _resolve_diff_base(project_path)
    mode = 'none'
    commit_info = None
    
    if project_path:
        root_path = Path(project_path)
        if root_path.exists() and is_git_repository(root_path):
            mode = 'head' if base_ref == 'HEAD' else 'detached'
            try:
                commit = get_commit_info(root_path, base_ref)
            except GitError:
                commit = None
            if commit:
                commit_info = {
                    "hash": commit.hash,
                    "short": commit.short_hash,
                    "subject": commit.summary,
                    "author": commit.author,
                    "date": commit.date,
                }
        else:
            mode = 'none'

    return {
        "ref": base_ref,
        "mode": mode,
        "commit": commit_info,
    }

def _status_meta_from_code(code: str) -> tuple[str, str]:
    if not code:
        return '', STATUS_TEXT_MAP['?']
    if code in ('??', '!!'):
        key = '?' if code == '??' else '!'
        short = '?' if code == '??' else '!'
        return short, STATUS_TEXT_MAP[key]
    compact = code.replace(' ', '')
    primary = compact[0] if compact else '?'
    key = primary if primary in STATUS_TEXT_MAP else '?'
    return primary, STATUS_TEXT_MAP[key]

async def search_by_name(root: Path, query: str) -> dict:
    """Search files/folders by name."""
    query_lower = (query or '').lower().strip()
    max_results = 500

    def should_ignore_rel(rel: str) -> bool:
        # Fast path: ignore dot segments + known heavy dirs.
        parts = Path(rel).parts
        for part in parts:
            if not part:
                continue
            if part.startswith('.'):
                return True
            if part in IGNORE_PATTERNS:
                return True
            for pat in IGNORE_PATTERNS:
                if '*' in pat and fnmatch.fnmatch(part, pat):
                    return True
            for pat in IGNORE_GLOBS:
                if fnmatch.fnmatch(part, pat):
                    return True
        return False

    def matches_name(rel: str) -> bool:
        name = Path(rel).name.lower()
        return query_lower in name

    def pack_result(rel: str, is_dir: bool) -> dict:
        return {
            "path": str((root / rel).resolve()),
            "rel": rel,
            "type": "dir" if is_dir else "file",
            "name": Path(rel).name,
        }

    def run_filesystem_walk() -> dict:
        results: list[dict] = []
        count = 0

        def onerror(_err):
            # Ignore unreadable dirs/files; we don't want search to fail hard.
            return

        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False, onerror=onerror):
            if count >= max_results:
                break

            try:
                rel_dir = str(Path(dirpath).relative_to(root))
            except Exception:
                continue
            if rel_dir == '.':
                rel_dir = ''
            if rel_dir and should_ignore_rel(rel_dir):
                dirnames[:] = []
                continue

            # Prune ignored directories early.
            pruned = []
            for d in dirnames:
                rel = str(Path(rel_dir, d)) if rel_dir else d
                if should_ignore_rel(rel):
                    continue
                pruned.append(d)
            dirnames[:] = pruned

            # Match directories (from this level).
            for d in dirnames:
                if count >= max_results:
                    break
                rel = str(Path(rel_dir, d)) if rel_dir else d
                if matches_name(rel):
                    results.append(pack_result(rel, True))
                    count += 1

            # Match files.
            for f in filenames:
                if count >= max_results:
                    break
                rel = str(Path(rel_dir, f)) if rel_dir else f
                if should_ignore_rel(rel):
                    continue
                if matches_name(rel):
                    results.append(pack_result(rel, False))
                    count += 1

        return {"results": results, "count": count, "truncated": count >= max_results}

    async def run_git_ls_files() -> Optional[dict]:
        # If we're in a git repo, this is much faster and respects excludes.
        try:
            if not is_git_repository(root):
                return None
        except Exception:
            return None

        cmd = ['git', '-C', str(root), 'ls-files', '-co', '--exclude-standard', '-z']
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await proc.communicate()
        except Exception:
            return None
        if proc.returncode != 0:
            return None

        results: list[dict] = []
        count = 0
        seen_dirs: set[str] = set()

        # Files (and derived directories).
        for raw in stdout.split(b'\0'):
            if count >= max_results:
                break
            if not raw:
                continue
            rel = raw.decode('utf-8', errors='ignore').replace('\\', '/')
            rel = rel.strip('/')
            if not rel or should_ignore_rel(rel):
                continue

            # Derived directories first so searching for "app" finds "app/" even
            # if no file named "app" exists.
            p = Path(rel)
            parent = p.parent
            if parent and str(parent) not in ('.', ''):
                accum = []
                for part in parent.parts:
                    accum.append(part)
                    drel = str(Path(*accum))
                    if drel in seen_dirs or should_ignore_rel(drel):
                        continue
                    seen_dirs.add(drel)
                    if matches_name(drel):
                        results.append(pack_result(drel, True))
                        count += 1
                        if count >= max_results:
                            break

            if count >= max_results:
                break
            if matches_name(rel):
                results.append(pack_result(rel, False))
                count += 1

        return {"results": results, "count": count, "truncated": count >= max_results}

    # Avoid blocking the server event loop (Termux devices can be slow).
    git_res = await run_git_ls_files()
    if git_res is None:
        fs_res = await asyncio.to_thread(run_filesystem_walk)
        results = fs_res["results"]
        count = fs_res["count"]
        truncated = fs_res["truncated"]
    else:
        results = git_res["results"]
        count = git_res["count"]
        truncated = git_res["truncated"]
    
    return {
        "mode": "name",
        "query": query,
        "results": results,
        "truncated": truncated,
        "count": count
    }

def _parse_glob_patterns(raw: str) -> list[str]:
    patterns: list[str] = []
    for chunk in raw.replace('\n', ',').split(','):
        pattern = chunk.strip()
        if pattern:
            patterns.append(pattern)
    return patterns


def _build_content_options(params: dict) -> dict:
    return {
        "query": str(params.get("query", "")),
        "is_regex": bool(params.get("isRegex", False)),
        "is_case_sensitive": bool(params.get("isCaseSensitive", False)),
        "is_whole_words": bool(params.get("isWholeWords", False)),
        "include_patterns": _parse_glob_patterns(str(params.get("includePattern", ""))),
        "exclude_patterns": _parse_glob_patterns(str(params.get("excludePattern", ""))),
        "use_ignore_files": bool(params.get("useIgnoreFiles", True)),
    }


async def search_by_content(root: Path, params: dict) -> dict:
    """Search file contents using ripgrep or fallback."""
    options = _build_content_options(params)
    rg_path = shutil.which('rg')
    if rg_path:
        return await _search_with_ripgrep(root, options, rg_path)
    else:
        return await _search_with_python(root, options)

async def _search_with_ripgrep(root: Path, options: dict, rg_path: str) -> dict:
    query = options["query"]
    cmd = [
        rg_path,
        '--json',
        '--line-number',
        '--column',
        '--max-count', '5',
        '--max-filesize', '1M',
    ]
    if options["is_regex"]:
        cmd.append('--engine=auto')
    else:
        cmd.append('--fixed-strings')
    if options["is_case_sensitive"]:
        cmd.append('--case-sensitive')
    else:
        cmd.append('--ignore-case')
    if options["is_whole_words"]:
        cmd.append('--word-regexp')
    if not options["use_ignore_files"]:
        cmd.append('--no-ignore')
    for pattern in options["include_patterns"]:
        cmd.extend(['-g', pattern])
    for pattern in options["exclude_patterns"]:
        cmd.extend(['-g', f'!{pattern}'])
    cmd.extend(['--', query, str(root)])
    
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        if proc.returncode not in (0, 1):
            message = stderr.decode('utf-8', errors='ignore').strip() or 'Ripgrep search failed'
            raise RuntimeError(message)
        
        results_by_file = {}
        for line in stdout.decode('utf-8').splitlines():
            if not line.strip(): continue
            try:
                obj = json.loads(line)
                if obj.get('type') == 'match':
                    data = obj['data']
                    path_str = data['path']['text']
                    path = Path(path_str)
                    rel = str(path.relative_to(root))
                    
                    if rel not in results_by_file:
                        results_by_file[rel] = {
                            "path": path_str,
                            "rel": rel,
                            "matches": []
                        }
                    
                    line_num = data['line_number']
                    line_text = data['lines']['text'].rstrip('\n')
                    submatch = data['submatches'][0] if data['submatches'] else {}
                    col = submatch.get('start', 0)
                    match_text = submatch.get('match', {}).get('text', query)
                    
                    start = max(0, col - 75)
                    end = min(len(line_text), col + len(match_text) + 75)
                    snippet = line_text[start:end]
                    
                    results_by_file[rel]["matches"].append({
                        "line": line_num,
                        "column": col,
                        "text": line_text,
                        "snippet": snippet
                    })
            except (json.JSONDecodeError, KeyError):
                continue
        
        results = list(results_by_file.values())[:50]
        match_count = sum(len(r["matches"]) for r in results)
        
        return {
            "mode": "content",
            "query": query,
            "results": results,
            "truncated": len(results_by_file) > 50,
            "file_count": len(results),
            "match_count": match_count
        }
    except asyncio.TimeoutError:
        raise TimeoutError("Ripgrep search timed out")

def _match_literal(
    line_text: str,
    query: str,
    *,
    is_case_sensitive: bool,
    is_whole_words: bool,
) -> list[tuple[int, str]]:
    haystack = line_text if is_case_sensitive else line_text.lower()
    needle = query if is_case_sensitive else query.lower()
    matches: list[tuple[int, str]] = []
    start = 0
    while True:
        idx = haystack.find(needle, start)
        if idx < 0:
            break
        matched_text = line_text[idx:idx + len(query)]
        if is_whole_words:
            before = line_text[idx - 1] if idx > 0 else ''
            after_index = idx + len(query)
            after = line_text[after_index] if after_index < len(line_text) else ''
            if ((before.isalnum() or before == '_') or
                (after.isalnum() or after == '_')):
                start = idx + max(len(query), 1)
                continue
        matches.append((idx, matched_text))
        start = idx + max(len(query), 1)
    return matches


def _path_matches_patterns(rel: str, patterns: list[str]) -> bool:
    normalized = rel.replace('\\', '/')
    for pattern in patterns:
        if fnmatch.fnmatch(normalized, pattern):
            return True
        if fnmatch.fnmatch(Path(normalized).name, pattern):
            return True
    return False


async def _search_with_python(root: Path, options: dict) -> dict:
    query = options["query"]
    results_by_file = {}
    regex: re.Pattern[str] | None = None
    if options["is_regex"]:
        flags = 0 if options["is_case_sensitive"] else re.IGNORECASE
        try:
            regex = re.compile(query, flags)
        except re.error as exc:
            raise RuntimeError(f"Invalid regular expression: {exc}") from exc
    file_count = 0
    max_files = 50
    
    def is_binary(path: Path) -> bool:
        try:
            with path.open('rb') as f:
                return b'\x00' in f.read(8192)
        except:
            return True
    
    def should_ignore(path: Path) -> bool:
        if options["include_patterns"]:
            rel_text = str(path).replace('\\', '/')
            if not _path_matches_patterns(rel_text, options["include_patterns"]):
                return True
        if options["exclude_patterns"]:
            rel_text = str(path).replace('\\', '/')
            if _path_matches_patterns(rel_text, options["exclude_patterns"]):
                return True
        if not options["use_ignore_files"]:
            return False
        for part in path.parts:
            if part in IGNORE_PATTERNS or part.startswith('.'):
                return True
        return False
    
    for item in root.rglob('*'):
        if not item.is_file() or file_count >= max_files: break
        if should_ignore(item.relative_to(root)) or is_binary(item): continue
        
        try:
            content = item.read_text(encoding='utf-8', errors='ignore')
            lines = content.splitlines()
            matches = []
            
            for line_num, line_text in enumerate(lines, 1):
                if regex is not None:
                    found_matches = [
                        (match.start(), match.group(0) or query)
                        for match in regex.finditer(line_text)
                    ]
                else:
                    found_matches = _match_literal(
                        line_text,
                        query,
                        is_case_sensitive=options["is_case_sensitive"],
                        is_whole_words=options["is_whole_words"],
                    )
                if found_matches:
                    col, matched_text = found_matches[0]
                    start = max(0, col - 75)
                    end = min(len(line_text), col + len(matched_text) + 75)
                    matches.append({
                        "line": line_num,
                        "column": col,
                        "text": line_text,
                        "snippet": line_text[start:end]
                    })
                    if len(matches) >= 5: break
            
            if matches:
                rel = str(item.relative_to(root))
                results_by_file[rel] = {
                    "path": str(item),
                    "rel": rel,
                    "matches": matches
                }
                file_count += 1
        except Exception:
            continue
    
    results = list(results_by_file.values())
    match_count = sum(len(r["matches"]) for r in results)
    
    return {
        "mode": "content",
        "query": query,
        "results": results,
        "truncated": file_count >= max_files,
        "file_count": len(results),
        "match_count": match_count
    }

def search_by_changes(project_root: Path) -> dict:
    project_path = str(project_root) # _history_store keys are strings
    
    if not is_git_repository(project_root):
        return {
            "mode": "changes",
            "git": False,
            "base": _diff_base_payload(project_path),
            "changes": [],
            "truncated": False,
            "count": 0,
        }

    try:
        base_ref = _resolve_diff_base(project_path)
        entries = get_worktree_changes(project_root, base_ref)
    except GitError:
        # If git fails (e.g. bad ref), return empty
        return {
            "mode": "changes",
            "git": True,
            "base": _diff_base_payload(project_path),
            "changes": [],
            "truncated": False,
            "count": 0,
        }

    truncated = len(entries) > CHANGE_RESULT_LIMIT
    selected = entries[:CHANGE_RESULT_LIMIT]
    changes = []

    for entry in selected:
        rel_path = entry.path.replace('\\', '/')
        diff_payload = collect_diff(project_root, rel_path, base_ref=base_ref)
        status_short, status_text = _status_meta_from_code(entry.code)
        summary = diff_payload.get("summary", {"added": 0, "deleted": 0, "tracked": False})

        change = {
            "rel": rel_path,
            "path": str((project_root / rel_path).resolve()),
            "label": Path(rel_path).name,
            "status": status_short,
            "statusCode": entry.code,
            "statusText": status_text,
            "summary": summary,
            "hunks": diff_payload.get("hunks", []),
            "isTracked": summary.get("tracked", True),
        }
        if entry.original_path:
            change["renamedFrom"] = entry.original_path
        if "error" in diff_payload:
            change["error"] = diff_payload["error"]
        changes.append(change)

    base_info = _diff_base_payload(project_path)

    return {
        "mode": "changes",
        "git": True,
        "base": base_info,
        "changes": changes,
        "truncated": truncated,
        "count": len(changes),
        "total": len(entries),
    }
