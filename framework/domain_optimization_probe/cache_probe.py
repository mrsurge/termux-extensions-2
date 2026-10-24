"""N4 source/native cache comparisons without importing production owners."""
from __future__ import annotations

import argparse
import ast
from collections.abc import Callable
import copy
import gc
import importlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
import tracemalloc
from typing import Protocol, cast

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app/apps/code_te2"


class Diff(Protocol):
    def collect_diff(self, project_root: Path, rel_path: str, base_ref: str | None = None) -> dict[str, object]: ...
    def invalidate_diff_cache(self, project_root: Path | None = None, rel_path: str | None = None) -> None: ...


class Status(Protocol):
    def _probe_seed(self, root: Path, statuses: dict[str, str]) -> None: ...
    def get_cached_statuses(self, project_root: Path) -> dict[str, str]: ...
    def mark_status_cache_dirty(self, project_root: Path | None = None) -> None: ...


class Draft(Protocol):
    def _get_draft_index_snapshot(self, root: Path) -> tuple[set[str], set[str]]: ...
    def mark_draft_cache_dirty(self, project_root: Path | None = None) -> None: ...
    def _probe_reads(self) -> int: ...


class Clock(Protocol):
    now: float


class Source(Protocol):
    calls: int
    def fixture(self, hunks: int, lines: int) -> None: ...


def functions(path: Path, names: set[str]) -> list[ast.stmt]:
    source = ast.parse(path.read_text())
    selected: list[ast.stmt] = [node for node in source.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    assert {node.name for node in selected if isinstance(node, (ast.FunctionDef, ast.ClassDef))} == names
    return selected


def write(destination: Path, name: str, tree: ast.Module) -> None:
    ast.fix_missing_locations(tree)
    (destination / (name + ".py")).write_text(ast.unparse(tree) + "\n")


def generate(destination: Path) -> None:
    (destination / "cache_clock.py").write_text("class Clock:\n    now: float = 100.0\n    def time(self) -> float:\n        return self.now\nclock = Clock()\n")
    (destination / "cache_source.py").write_text('''from pathlib import Path
from typing import TypedDict
class Line(TypedDict):
    type: str
    text: str
class Hunk(TypedDict):
    oldStart: int
    oldLines: int
    newStart: int
    newLines: int
    lines: list[Line]
class Summary(TypedDict):
    added: int
    deleted: int
    tracked: bool
class Payload(TypedDict, total=False):
    hunks: list[Hunk]
    summary: Summary
    error: str
calls = 0
payload: Payload = {}
def fixture(hunks: int, lines: int) -> None:
    global payload, calls
    calls = 0
    payload = {"hunks": [{"oldStart": i * lines + 1, "oldLines": lines,
        "newStart": i * lines + 1, "newLines": lines,
        "lines": [{"type": "add", "text": "λ🙂 source text " * 4} for _ in range(lines)]}
        for i in range(hunks)], "summary": {"added": hunks * lines, "deleted": 0, "tracked": True}}
def get_diff_hunks(project_root: Path, rel: str, base: str) -> Payload:
    global calls
    calls += 1
    return payload
''')
    diff_source = ast.parse((APP / "diff_helper.py").read_text())
    for optimized in (False, True):
        tree = copy.deepcopy(diff_source)
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == "worker_services":
                node.module, node.level = "", 0
                # Replace only this provider with a typed fixture, never real I/O.
        tree.body = [ast.parse("import cache_source as worker_git_service").body[0]
                     if isinstance(node, ast.ImportFrom) and node.module == "" else node for node in tree.body]
        tree.body = [ast.parse("from cache_clock import clock as time").body[0]
                     if isinstance(node, ast.Import) and any(alias.name == "time" for alias in node.names) else node for node in tree.body]
        record = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "DiffCacheEntry")
        record.body = [node for node in record.body if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name) or node.target.id != "size"]
        if not optimized:
            record.body.extend(ast.parse("size: int").body)
        collect = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "collect_diff")
        cache = collect.body[-2]
        assert isinstance(cache, ast.Assign)
        # Reconstruct the old unused stringify baseline even after source adopts
        # removal; same actual function/key/TTL/invalidation on both sides.
        cache.value = ast.parse("DiffCacheEntry(timestamp=now, value=payload" + ("" if optimized else ", size=len(str(payload))") + ")", mode="eval").body
        write(destination, "diff_fast" if optimized else "diff_old", tree)

    git_functions = functions(APP / "worker_services/git_service.py", {"GitSnapshotCacheEntry", "_snapshot_cache_key", "mark_status_cache_dirty", "get_cached_snapshot", "get_cached_statuses"})
    preamble = '''from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import threading
from typing import TypedDict
# Minimal fixture schema: this comparison does not decode/replace real DTOs.
class GitSnapshot(TypedDict):
    statuses: dict[str, str]
_SNAPSHOT_CACHE_LOCK = threading.RLock()
_SNAPSHOT_CACHE: dict[str, GitSnapshotCacheEntry] = {}
def _probe_seed(root: Path, statuses: dict[str, str]) -> None:
    _SNAPSHOT_CACHE[_snapshot_cache_key(root)] = GitSnapshotCacheEntry({"statuses": statuses}, False)
'''
    for optimized in (False, True):
        tree = ast.Module(body=ast.parse(preamble).body + copy.deepcopy(git_functions), type_ignores=[])
        getter = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "get_cached_statuses")
        getter.body[-1] = ast.parse('return dict(snapshot["statuses"])' if optimized else 'return {path: status for path, status in snapshot["statuses"].items()}').body[0]
        write(destination, "statuses_copy" if optimized else "statuses_loop", tree)

    draft_functions = functions(APP / "explorer/services/file_ops.py", {"DraftCacheEntry", "_get_draft_index_snapshot", "mark_draft_cache_dirty"})
    draft_preamble = '''from __future__ import annotations
from pathlib import Path
from typing import TypedDict
import threading
from cache_clock import clock as time
_STATE_LOCK = threading.RLock()
_DRAFT_INDEX_CACHE: dict[str, DraftCacheEntry] = {}
DRAFT_INDEX_CACHE_TTL_SECONDS = 2.0
_reads = 0
class DraftIndexSidecar:
    @staticmethod
    def load_or_create(key: str) -> DraftIndexSidecar:
        return DraftIndexSidecar()
    def reload(self) -> None:
        global _reads
        _reads += 1
    def snapshot(self) -> tuple[set[str], set[str]]:
        return {"a.py", "lib/b.py"}, {"lib"}
def _probe_reads() -> int:
    return _reads
'''
    for native in (False, True):
        tree = ast.Module(body=ast.parse(draft_preamble).body + copy.deepcopy(draft_functions), type_ignores=[])
        if native:
            tree.body = [ast.parse('''class DraftCacheEntry:
    def __init__(self, files: set[str], dirs: set[str], timestamp: float) -> None:
        self.files = files
        self.dirs = dirs
        self.timestamp = timestamp
''').body[0] if isinstance(node, ast.ClassDef) and node.name == "DraftCacheEntry" else node for node in tree.body]
            tree = cast(ast.Module, DraftAttributes().visit(tree))
        write(destination, "draft_native" if native else "draft_dict", tree)
    names = ("diff_old", "diff_fast", "statuses_loop", "statuses_copy", "draft_dict", "draft_native")
    (destination / "setup.py").write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="cache-probe", ext_modules=mypycify(' + repr([name + ".py" for name in names]) + ', opt_level="3"))\n')


class DraftAttributes(ast.NodeTransformer):
    def visit_Subscript(self, node: ast.Subscript) -> ast.AST:
        self.generic_visit(node)
        if isinstance(node.value, ast.Name) and node.value.id == "cached" and isinstance(node.slice, ast.Constant) and node.slice.value in {"timestamp", "files", "dirs"}:
            return ast.copy_location(ast.Attribute(value=node.value, attr=str(node.slice.value), ctx=node.ctx), node)
        return node

    def visit_Assign(self, node: ast.Assign) -> ast.AST:
        self.generic_visit(node)
        if isinstance(node.value, ast.Dict) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Subscript) and isinstance(node.targets[0].value, ast.Name) and node.targets[0].value.id == "_DRAFT_INDEX_CACHE":
            node.value = ast.parse("DraftCacheEntry(files=draft_files, dirs=draft_dirs, timestamp=now)", mode="eval").body
        return node


def load(name: str, compiled: bool) -> object:
    module = importlib.import_module(name)
    assert str(module.__file__).endswith(".so" if compiled else ".py"), module.__file__
    return module


def measure(actions: list[Callable[[], object]], count: int) -> list[float]:
    samples: list[list[float]] = [[] for _ in actions]
    for sample in range(7):
        for offset in range(len(actions)):
            which = (sample + offset) % len(actions)
            gc.collect()
            before = time.perf_counter_ns()
            for _ in range(count):
                actions[which]()
            samples[which].append((time.perf_counter_ns() - before) / count)
    return [statistics.median(values) for values in samples]


def run(compiled: bool, check_only: bool) -> None:
    source = cast(Source, importlib.import_module("cache_source"))
    clock = cast(Clock, getattr(importlib.import_module("cache_clock"), "clock"))
    root = Path.cwd() / "fixture"
    diffs = [cast(Diff, load(name, compiled)) for name in ("diff_old", "diff_fast")]
    source.fixture(2, 3)
    outcomes = []
    for module in diffs:
        clock.now = 100
        module.invalidate_diff_cache()
        before = source.calls
        result = module.collect_diff(root, "a.py", " HEAD ")
        assert result is module.collect_diff(root, "a.py", "HEAD")
        assert source.calls == before + 1
        clock.now = 105
        assert module.collect_diff(root, "a.py", "HEAD") == result
        assert source.calls == before + 2
        module.collect_diff(root, "a.py", "abc")
        module.invalidate_diff_cache(root, "a.py")
        module.collect_diff(root, "a.py", "abc")
        assert source.calls == before + 4
        outcomes.append(result)
    assert outcomes[0] == outcomes[1]
    statuses = [cast(Status, load(name, compiled)) for name in ("statuses_loop", "statuses_copy")]
    drafts = [cast(Draft, load(name, compiled)) for name in ("draft_dict", "draft_native")]
    for status in statuses:
        original = {"a.py": "modified", "lib/b.py": "staged"}
        status._probe_seed(root, original)
        result_map = status.get_cached_statuses(root)
        assert result_map == original and result_map is not original
        result_map.clear()
        assert status.get_cached_statuses(root) == original
        status.mark_status_cache_dirty(root)
        assert status.get_cached_statuses(root) == {}
    for draft in drafts:
        clock.now = 100
        a = draft._get_draft_index_snapshot(root)
        assert a == ({"a.py", "lib/b.py"}, {"lib"})
        b = draft._get_draft_index_snapshot(root)
        assert a[0] is b[0] and a[1] is b[1] and draft._probe_reads() == 1
        clock.now = 102
        draft._get_draft_index_snapshot(root)
        assert draft._probe_reads() == 2
        draft.mark_draft_cache_dirty(root)
        draft._get_draft_index_snapshot(root)
        assert draft._probe_reads() == 3
    print(json.dumps({"kind": "cache_parity", "compiled": compiled, "result": "pass"}), flush=True)
    if check_only:
        return
    for hunks, lines in ((2, 3), (200, 20)):
        source.fixture(hunks, lines)
        def miss_action(module: Diff) -> Callable[[], object]:
            def action() -> object:
                module.invalidate_diff_cache()
                return module.collect_diff(root, "a.py")
            return action
        actions = [miss_action(module) for module in diffs]
        medians = measure(actions, 100 if hunks == 2 else 10)
        peaks = []
        for action in actions:
            gc.collect()
            tracemalloc.start()
            action()
            peaks.append(tracemalloc.get_traced_memory()[1])
            tracemalloc.stop()
        print(json.dumps({"kind": "diff_miss", "compiled": compiled, "hunks": hunks, "lines": lines, "median_ns": medians, "peak_bytes": peaks}), flush=True)
    for paths in (20, 6000):
        data = {str(index) + ".py": "modified" for index in range(paths)}
        for status in statuses:
            status._probe_seed(root, data)
        def status_action(status: Status) -> Callable[[], object]:
            def action() -> object:
                return status.get_cached_statuses(root)
            return action
        print(json.dumps({"kind": "status_hit", "compiled": compiled, "paths": paths,
            "median_ns": measure([status_action(status) for status in statuses], 500)}), flush=True)
    clock.now = 200
    for draft in drafts:
        draft._get_draft_index_snapshot(root)
    def draft_action(draft: Draft) -> Callable[[], object]:
        def action() -> object:
            return draft._get_draft_index_snapshot(root)
        return action
    print(json.dumps({"kind": "draft_hit", "compiled": compiled,
        "median_ns": measure([draft_action(draft) for draft in drafts], 1000)}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch", type=Path)
    parser.add_argument("--run", choices=("source", "compiled"))
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0, str(args.scratch.resolve()))
        run(args.run == "compiled", args.check_only)
        return
    args.scratch.mkdir(parents=True, exist_ok=False)
    generate(args.scratch)
    extra = ["--check-only"] if args.check_only else []
    subprocess.run([sys.executable, "-B", __file__, str(args.scratch), "--run", "source", *extra], check=True)
    subprocess.run([sys.executable, "setup.py", "build_ext", "--inplace"], cwd=args.scratch, check=True)
    subprocess.run([sys.executable, "-B", __file__, str(args.scratch), "--run", "compiled", *extra], check=True)


if __name__ == "__main__":
    main()
