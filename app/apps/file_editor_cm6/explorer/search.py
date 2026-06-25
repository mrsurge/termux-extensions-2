
import asyncio
import fnmatch
import json
import os
import re
import shutil
from importlib import import_module
from pathlib import Path
from typing import Literal, Protocol, TypedDict, cast

from ..stores import get_history_store
from ..worker_services import git_service as worker_git_service
from ..worker_services.git_service import GitChangeEntry
from .contracts.search_review import (
    JsonObject,
    SearchChange,
    SearchChangesBaseCommit,
    SearchChangesBaseInfo,
    SearchChangesResult,
    SearchContentMatch,
    SearchContentResult,
    SearchContentResultEntry,
    SearchNameResult,
    SearchNameResultEntry,
)


class SearchContentOptions(TypedDict):
    query: str
    is_regex: bool
    is_case_sensitive: bool
    is_whole_words: bool
    include_patterns: list[str]
    exclude_patterns: list[str]
    use_ignore_files: bool


class RipgrepText(TypedDict):
    text: str


class RipgrepSubmatch(TypedDict, total=False):
    start: int
    match: RipgrepText


class RipgrepMatchData(TypedDict):
    path: RipgrepText
    line_number: int
    lines: RipgrepText
    submatches: list[RipgrepSubmatch]


class RipgrepMatchEvent(TypedDict):
    type: Literal["match"]
    data: RipgrepMatchData


class SearchContentOptionsParams(TypedDict, total=False):
    query: object
    isRegex: object
    isCaseSensitive: object
    isWholeWords: object
    includePattern: object
    excludePattern: object
    useIgnoreFiles: object


class DiffPayload(TypedDict, total=False):
    summary: JsonObject
    hunks: list[JsonObject]
    error: str


class CollectDiffFn(Protocol):
    def __call__(self, project_root: Path, rel_path: str, *, base_ref: str) -> object: ...


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    result: list[JsonObject] = []
    for item in cast(list[object], value):
        if isinstance(item, dict):
            result.append(_json_object(cast(object, item)))
    return result


def _decode_json_object(raw: str) -> JsonObject:
    decoded = cast(object, json.loads(raw))
    return _json_object(decoded)


def _ripgrep_match_event(value: JsonObject) -> RipgrepMatchEvent | None:
    if value.get("type") != "match":
        return None
    data = _json_object(value.get("data"))
    path_obj = _json_object(data.get("path"))
    lines_obj = _json_object(data.get("lines"))
    path_text = path_obj.get("text")
    line_text = lines_obj.get("text")
    line_number = data.get("line_number")
    if not isinstance(path_text, str) or not isinstance(line_text, str) or not isinstance(line_number, int):
        return None

    submatches: list[RipgrepSubmatch] = []
    for item in _json_object_list(data.get("submatches")):
        submatch: RipgrepSubmatch = {}
        start = item.get("start")
        if isinstance(start, int):
            submatch["start"] = start
        match_obj = _json_object(item.get("match"))
        match_text = match_obj.get("text")
        if isinstance(match_text, str):
            submatch["match"] = {"text": match_text}
        submatches.append(submatch)

    return {
        "type": "match",
        "data": {
            "path": {"text": path_text},
            "line_number": line_number,
            "lines": {"text": line_text},
            "submatches": submatches,
        },
    }

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

def _resolve_diff_base(project_path: str | None) -> str:
    base = get_history_store().get_diff_base(project_path)
    return base.strip() if base else 'HEAD'

def _diff_base_payload(project_path: str | None) -> SearchChangesBaseInfo:
    base_ref = _resolve_diff_base(project_path)
    mode: Literal["none", "head", "detached"] = 'none'
    commit_info: SearchChangesBaseCommit | None = None
    
    if project_path:
        root_path = Path(project_path)
        if root_path.exists() and worker_git_service.is_git_repository(root_path):
            mode = 'head' if base_ref == 'HEAD' else 'detached'
            commit = worker_git_service.get_commit_info(root_path, base_ref)
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


def _change_entry_sort_key(entry: GitChangeEntry) -> tuple[int, str]:
    """Keep tracked changes visible before untracked files consume the result cap."""
    compact = entry.code.replace(" ", "")
    if "U" in compact:
        priority = 0
    elif compact in ("??", "?"):
        priority = 2
    elif compact in ("!!", "!"):
        priority = 3
    else:
        priority = 1
    return priority, entry.path.replace("\\", "/")

async def search_by_name(root: Path, query: str) -> SearchNameResult:
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

    def pack_result(rel: str, is_dir: bool) -> SearchNameResultEntry:
        return {
            "path": str((root / rel).resolve()),
            "rel": rel,
            "type": "dir" if is_dir else "file",
            "name": Path(rel).name,
        }

    def run_filesystem_walk() -> SearchNameResult:
        results: list[SearchNameResultEntry] = []
        count = 0

        def onerror(_err: OSError) -> None:
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
            pruned: list[str] = []
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

        return {
            "mode": "name",
            "query": query,
            "results": results,
            "count": count,
            "truncated": count >= max_results,
        }

    async def run_git_path_index() -> SearchNameResult | None:
        path_index = await asyncio.to_thread(
            worker_git_service.get_path_index,
            root,
            limit=50_000,
        )
        if not path_index["isRepository"]:
            return None

        results: list[SearchNameResultEntry] = []
        count = 0
        seen_dirs: set[str] = set()

        # Files (and derived directories).
        for rel in path_index["paths"]:
            if count >= max_results:
                break
            rel = rel.replace('\\', '/')
            rel = rel.strip('/')
            if not rel or should_ignore_rel(rel):
                continue

            # Derived directories first so searching for "app" finds "app/" even
            # if no file named "app" exists.
            p = Path(rel)
            parent = p.parent
            if parent and str(parent) not in ('.', ''):
                accum: list[str] = []
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

        return {
            "mode": "name",
            "query": query,
            "results": results,
            "count": count,
            "truncated": path_index["truncated"] or count >= max_results,
        }

    # Avoid blocking the server event loop (Termux devices can be slow).
    git_res = await run_git_path_index()
    if git_res is not None:
        return git_res
    return await asyncio.to_thread(run_filesystem_walk)

def _parse_glob_patterns(raw: str) -> list[str]:
    patterns: list[str] = []
    for chunk in raw.replace('\n', ',').split(','):
        pattern = chunk.strip()
        if pattern:
            patterns.append(pattern)
    return patterns


def _build_content_options(params: SearchContentOptionsParams) -> SearchContentOptions:
    return {
        "query": str(params.get("query", "")),
        "is_regex": bool(params.get("isRegex", False)),
        "is_case_sensitive": bool(params.get("isCaseSensitive", False)),
        "is_whole_words": bool(params.get("isWholeWords", False)),
        "include_patterns": _parse_glob_patterns(str(params.get("includePattern", ""))),
        "exclude_patterns": _parse_glob_patterns(str(params.get("excludePattern", ""))),
        "use_ignore_files": bool(params.get("useIgnoreFiles", True)),
    }


async def search_by_content(root: Path, params: SearchContentOptionsParams) -> SearchContentResult:
    """Search file contents using ripgrep or fallback."""
    options = _build_content_options(params)
    rg_path = shutil.which('rg')
    if rg_path:
        return await _search_with_ripgrep(root, options, rg_path)
    else:
        return await _search_with_python(root, options)

async def _search_with_ripgrep(root: Path, options: SearchContentOptions, rg_path: str) -> SearchContentResult:
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
        
        results_by_file: dict[str, SearchContentResultEntry] = {}
        for line in stdout.decode('utf-8').splitlines():
            if not line.strip(): continue
            try:
                obj = _ripgrep_match_event(_decode_json_object(line))
                if obj is None:
                    continue
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
                col = 0
                match_text = query
                if data['submatches']:
                    submatch = data['submatches'][0]
                    start_value = submatch.get('start')
                    if isinstance(start_value, int):
                        col = start_value
                    match_obj = submatch.get('match')
                    if match_obj is not None:
                        match_text = match_obj['text']

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


async def _search_with_python(root: Path, options: SearchContentOptions) -> SearchContentResult:
    query = options["query"]
    results_by_file: dict[str, SearchContentResultEntry] = {}
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
            matches: list[SearchContentMatch] = []
            
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

def _collect_diff(project_root: Path, rel_path: str, *, base_ref: str) -> DiffPayload:
    module = import_module("app.apps.file_editor_cm6.diff_helper")
    fn_obj = cast(object, module.__dict__.get("collect_diff"))
    if not callable(fn_obj):
        return {}
    collect = cast(CollectDiffFn, fn_obj)
    payload = collect(project_root, rel_path, base_ref=base_ref)
    raw = _json_object(payload)
    result: DiffPayload = {
        "summary": _json_object(raw.get("summary")),
        "hunks": _json_object_list(raw.get("hunks")),
    }
    error = raw.get("error")
    if error is not None:
        result["error"] = str(error)
    return result


def search_by_changes(project_root: Path) -> SearchChangesResult:
    project_path = str(project_root) # _history_store keys are strings
    
    if not worker_git_service.is_git_repository(project_root):
        return {
            "mode": "changes",
            "git": False,
            "base": _diff_base_payload(project_path),
            "changes": [],
            "truncated": False,
            "count": 0,
        }

    base_ref = _resolve_diff_base(project_path)
    entries = worker_git_service.get_worktree_changes(project_root, base_ref)

    truncated = len(entries) > CHANGE_RESULT_LIMIT
    selected = sorted(entries, key=_change_entry_sort_key)[:CHANGE_RESULT_LIMIT]
    changes: list[SearchChange] = []

    for entry in selected:
        rel_path = entry.path.replace('\\', '/')
        diff_payload = _collect_diff(project_root, rel_path, base_ref=base_ref)
        status_short, status_text = _status_meta_from_code(entry.code)
        summary = diff_payload.get("summary", {"added": 0, "deleted": 0, "tracked": False})

        change: SearchChange = {
            "rel": rel_path,
            "path": str((project_root / rel_path).resolve()),
            "label": Path(rel_path).name,
            "status": status_short,
            "statusCode": entry.code,
            "statusText": status_text,
            "summary": summary,
            "hunks": diff_payload.get("hunks", []),
            "isTracked": bool(summary.get("tracked", True)),
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
