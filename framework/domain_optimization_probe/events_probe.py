"""Isolated N3 event-header and diagnostics allocation qualification.

No production imports, selectors, sockets or lifecycle transitions. Generated
copies retain production functions; synthetic fan-out consumers are explicit.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import copy
import gc
import importlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
from typing import Protocol, cast

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app/apps/code_te2"
DIAG_NAMES = ("diag_dict", "diag_native", "diag_reuse", "diag_combined", "diag_copy", "diag_native_copy")
FIELDS = {"type", "project_root", "project_generation", "emitted_at_ms", "source", "correlation_id", "payload"}
DIAG_FUNCTIONS = {"_json_object", "_json_object_list", "_marker_list", "_int_value",
    "_abs_path_from_vscode_uri", "_normalize_project_path", "_is_under_project",
    "_prune_cache_to_project", "_process_diagnostics_update"}


class Bus(Protocol):
    __file__: str
    _metrics_enabled: bool
    _stopped: bool
    _probe_seen: list[tuple[object, ...]]
    _metrics_published_by_type: dict[str, int]
    _metrics_delivered_by_type: dict[str, int]
    _metrics_handler_errors_by_type: dict[str, int]

    def _probe_event(self, generation: int | None = 1) -> object: ...
    def _probe_setup(self, fanout: int) -> None: ...
    def _probe_fields(self, event: object) -> tuple[object, ...]: ...
    def _probe_payload_isolation(self) -> bool: ...
    async def _deliver(self, event: object) -> None: ...
    async def publish(self, event: object) -> None: ...
    def set_worker_event_loop(self, loop: asyncio.AbstractEventLoop) -> None: ...
    async def stop_worker_event_loop(self) -> None: ...


class Diagnostics(Protocol):
    __file__: str
    _diag_cache: dict[tuple[str, str], object]
    DIAG_CACHE_MAX: int

    def _process_diagnostics_update(self, params: dict[str, object], *, project_root: str) -> tuple[list[object], int]: ...
    def _probe_aggregate(self, proj: str) -> tuple[dict[str, dict[str, int]], dict[str, list[object]]]: ...
    def _probe_cache(self) -> list[tuple[object, ...]]: ...
    def _probe_clear(self, owner: str) -> None: ...
    def _prune_cache_to_project(self, project_root: str) -> int: ...


class EventAttributes(ast.NodeTransformer):
    def visit_Subscript(self, node: ast.Subscript) -> ast.AST:
        self.generic_visit(node)
        if isinstance(node.value, ast.Name) and node.value.id == "event" and isinstance(node.slice, ast.Constant) and node.slice.value in FIELDS:
            return ast.copy_location(ast.Attribute(value=node.value, attr=str(node.slice.value), ctx=node.ctx), node)
        return node


class DiagAttributes(ast.NodeTransformer):
    def visit_Call(self, node: ast.Call) -> ast.AST:
        self.generic_visit(node)
        if isinstance(node.func, ast.Attribute) and node.func.attr == "get" and isinstance(node.func.value, ast.Name) and node.func.value.id == "entry" and node.args and isinstance(node.args[0], ast.Constant):
            field = node.args[0].value
            if field in {"markers", "ts_ms", "owner", "path"}:
                return ast.copy_location(ast.Attribute(value=node.func.value, attr=str(field), ctx=ast.Load()), node)
        return node


def parsed(source: str) -> list[ast.stmt]:
    return ast.parse(source).body


def write_module(destination: Path, name: str, module: ast.Module) -> None:
    ast.fix_missing_locations(module)
    (destination / f"{name}.py").write_text(ast.unparse(module) + "\n")


BUS_EXTRA = '''
_probe_seen: list[tuple[object, ...]] = []
async def _probe_sink(event: WorkerEvent) -> None:
    generation = event["project_generation"]
    if generation is not None and current_project_generation(event["project_root"]) != generation:
        record_stale_drop("probe", event["type"])
        return
    _probe_seen.append((event["type"], event["project_root"], generation,
        event["source"], event["correlation_id"], event_payload_object(event, "detail"),
        event_payload_list(event, "paths")))
def _probe_setup(fanout: int) -> None:
    global _current_project_root, _project_generation
    _current_project_root, _project_generation = "/workspace", 1
    _probe_seen.clear()
    _handlers.clear()
    # Synthetic equivalent consumers, not a claim that production subscribes
    # this same callback repeatedly (subscribe normally deduplicates it).
    _handlers["DiagnosticsDetailChanged"] = [_probe_sink] * fanout
def _probe_event(generation: int | None = 1) -> WorkerEvent:
    return build_event("DiagnosticsDetailChanged", project_root="/workspace",
        project_generation=generation, source="probe", correlation_id="correlation",
        payload={"detail": {"path": [{"severity": 8, "message": "λ🙂"}]},
                 "paths": ["/workspace/a.py", 42]})
def _probe_fields(event: WorkerEvent) -> tuple[object, ...]:
    return (event["type"], event["project_root"], event["project_generation"],
        event["source"], event["correlation_id"], event["payload"],
        isinstance(event["emitted_at_ms"], int))
def _probe_payload_isolation() -> bool:
    nested: JsonObject = {"value": 1}
    payload: JsonObject = {"nested": nested}
    event = build_event("DiagnosticsDetailChanged", source="probe", payload=payload)
    payload["later"] = 2
    return event["payload"] is not payload and "later" not in event["payload"] and event["payload"]["nested"] is nested
'''


def generate_bus(destination: Path) -> None:
    source = ast.parse((APP / "worker_services/event_bus.py").read_text())
    record = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "WorkerEvent")
    fields = [node for node in record.body if isinstance(node, ast.AnnAssign)]
    assert {node.target.id for node in fields if isinstance(node.target, ast.Name)} == FIELDS
    native_class = parsed('''class WorkerEvent:
    def __init__(self, type: EventType, project_root: str | None,
        project_generation: int | None, emitted_at_ms: int, source: str,
        correlation_id: str | None, payload: JsonObject) -> None:
        self.type = type
        self.project_root = project_root
        self.project_generation = project_generation
        self.emitted_at_ms = emitted_at_ms
        self.source = source
        self.correlation_id = correlation_id
        self.payload = payload
''')[0]
    for native in (False, True):
        module = copy.deepcopy(source)
        module.body.extend(parsed(BUS_EXTRA))
        if native:
            module.body = [copy.deepcopy(native_class) if isinstance(node, ast.ClassDef) and node.name == "WorkerEvent" else node for node in module.body]
            build = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "build_event")
            result = build.body[-1]
            assert isinstance(result, ast.Return) and isinstance(result.value, ast.Dict)
            keys = result.value.keys
            assert all(isinstance(key, ast.Constant) and isinstance(key.value, str) for key in keys)
            result.value = ast.Call(func=ast.Name(id="WorkerEvent", ctx=ast.Load()), args=[],
                keywords=[ast.keyword(arg=str(cast(ast.Constant, key).value), value=value) for key, value in zip(keys, result.value.values)])
            module = cast(ast.Module, EventAttributes().visit(module))
        write_module(destination, "events_native" if native else "events_dict", module)


def generate_diagnostics(destination: Path) -> None:
    source = ast.parse((APP / "diagnostics_bridge.py").read_text())
    functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in DIAG_FUNCTIONS]
    assert {node.name for node in functions} == DIAG_FUNCTIONS
    emit = next(node for node in source.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "_emit_diagnostics_debounced")
    start = next(i for i, node in enumerate(emit.body) if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "summary_rel")
    end = next(i for i, node in enumerate(emit.body) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "build_ms" for target in node.targets))
    aggregate = parsed("def _probe_aggregate(proj: str) -> tuple[dict[str, dict[str, int]], dict[str, list[object]]]:\n    pass")[0]
    assert isinstance(aggregate, ast.FunctionDef)
    aggregate.body = copy.deepcopy(emit.body[start:end]) + parsed("return summary_rel, detail_abs")
    # Reconstruct the pre-N3 aggregation baseline after safe-copy adoption;
    # repeated runs must not quietly compare the new copy policy with itself.
    aggregate_loop = next(node for node in aggregate.body if isinstance(node, ast.For))
    marker_assignment = aggregate_loop.body[0]
    assert isinstance(marker_assignment, ast.Assign)
    assert isinstance(marker_assignment.targets[0], ast.Name) and marker_assignment.targets[0].id == "markers"
    marker_assignment.value = ast.parse('_marker_list(entry.get("markers", []))', mode="eval").body
    process = next(node for node in functions if node.name == "_process_diagnostics_update")
    timestamp = next(node for node in process.body if isinstance(node, ast.FunctionDef) and node.name == "timestamp")
    timestamp.body = parsed('return _int_value(_diag_cache[key].get("ts_ms"))')
    clear = next(node for node in source.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "handle_wba_diagnostics_update")
    clear_branch = next(node for node in clear.body if isinstance(node, ast.If) and ast.unparse(node.test) == "ev.get('type') == 'diagnostics/clear'")
    clear_loop = next(node for node in clear_branch.body if isinstance(node, ast.For))
    clear_helper = parsed("def _probe_clear(owner: str) -> None:\n    pass")[0]
    assert isinstance(clear_helper, ast.FunctionDef)
    clear_helper.body = [copy.deepcopy(clear_loop)]
    preamble = '''from __future__ import annotations
import time
from pathlib import Path
from typing import cast
from urllib.parse import urlparse
JsonObject = dict[str, object]
Marker = JsonObject
DiagEntry = JsonObject
DiagCacheKey = tuple[str, str]
DIAG_CACHE_MAX = 500
_diag_cache: dict[DiagCacheKey, DiagEntry] = {}
'''
    record = '''class DiagEntry:
    def __init__(self, type: str, ts_ms: int, owner: str, path: str, markers: list[Marker]) -> None:
        self.type = type
        self.ts_ms = ts_ms
        self.owner = owner
        self.path = path
        self.markers = markers
'''
    snapshot = '''def _probe_cache() -> list[tuple[object, ...]]:
    return [(path, owner, entry.get("path"), entry.get("owner"), entry.get("markers"))
        for (path, owner), entry in _diag_cache.items()]
'''
    for name in DIAG_NAMES:
        native = name in {"diag_native", "diag_combined", "diag_native_copy"}
        reuse = name in {"diag_reuse", "diag_combined"}
        shallow_copy = name in {"diag_copy", "diag_native_copy"}
        module = ast.Module(body=parsed(preamble) + copy.deepcopy(functions) + [copy.deepcopy(aggregate), copy.deepcopy(clear_helper)] + parsed(snapshot), type_ignores=[])
        if native:
            module.body = [copy.deepcopy(parsed(record)[0]) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "DiagEntry" for target in node.targets) else node for node in module.body]
            process = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "_process_diagnostics_update")
            loop = next(node for node in process.body if isinstance(node, ast.For))
            entry = next(node for node in loop.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "entry")
            entry.value = ast.parse('DiagEntry(type="diagnostics/update", ts_ms=ts_ms, owner=owner, path=abs_path, markers=markers)', mode="eval").body
            timestamp = next(node for node in process.body if isinstance(node, ast.FunctionDef) and node.name == "timestamp")
            timestamp.body = parsed("return _diag_cache[key].ts_ms")
            module = cast(ast.Module, DiagAttributes().visit(module))
        if reuse or shallow_copy:
            target = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "_probe_aggregate")
            loop = next(node for node in target.body if isinstance(node, ast.For))
            assignment = loop.body[0]
            assert isinstance(assignment, ast.Assign) and isinstance(assignment.value, ast.Call) and isinstance(assignment.value.func, ast.Name) and assignment.value.func.id == "_marker_list"
            # Internal cache is constructed by the unchanged marker validator;
            # this probe-only cast is not an unknown-ingress validation bypass.
            markers = assignment.value.args[0] if native else ast.Call(
                func=ast.Name(id="cast", ctx=ast.Load()),
                args=[ast.parse("list[Marker]", mode="eval").body, assignment.value.args[0]], keywords=[])
            if shallow_copy:
                # Preserve the old detached outer marker maps and shared nested
                # values, without revalidating already-normalized cache data.
                comprehension = ast.parse("[marker.copy() for marker in trusted_markers]", mode="eval").body
                assert isinstance(comprehension, ast.ListComp)
                comprehension.generators[0].iter = markers
                assignment.value = comprehension
            else:
                assignment.value = markers
        write_module(destination, name, module)


def generate(destination: Path) -> None:
    generate_bus(destination)
    generate_diagnostics(destination)
    names = ["events_dict", "events_native", *DIAG_NAMES]
    (destination / "setup.py").write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="events-probe", ext_modules=mypycify(' + repr([name + ".py" for name in names]) + ', opt_level="3"))\n')


def load(name: str, compiled: bool) -> object:
    module = importlib.import_module(name)
    assert str(module.__file__).endswith(".so" if compiled else ".py"), module.__file__
    return module


def diag_fixture(files: int, markers: int) -> dict[str, object]:
    return {"owner": "one", "items": [{"uri": f"file:///workspace/{index}.py",
        "markers": [{"severity": 8 if row % 2 else 4, "message": f"λ🙂{row}", "extra": {"nested": [1, 2]}} for row in range(markers)]} for index in range(files)]}


async def bus_parity(module: Bus) -> list[tuple[object, ...]]:
    module._metrics_enabled = False
    module._probe_setup(4)
    assert module._probe_payload_isolation()
    event = module._probe_event()
    await module._deliver(event)
    assert len(module._probe_seen) == 4
    result = list(module._probe_seen)
    await module._deliver(module._probe_event(99))
    assert module._probe_seen == result
    fields = module._probe_fields(event)
    assert fields[:5] == ("DiagnosticsDetailChanged", "/workspace", 1, "probe", "correlation") and fields[-1] is True
    module._metrics_enabled = True
    module.set_worker_event_loop(asyncio.get_running_loop())
    await module.publish(event)
    await module.stop_worker_event_loop()
    assert len(module._probe_seen) == 8
    assert module._metrics_published_by_type == {"DiagnosticsDetailChanged": 1}
    assert module._metrics_delivered_by_type == {"DiagnosticsDetailChanged": 1}
    assert not module._metrics_handler_errors_by_type
    await module.publish(event)
    assert len(module._probe_seen) == 8
    module._metrics_enabled = False
    return result


def diag_parity(module: Diagnostics) -> tuple[object, ...]:
    module._diag_cache.clear()
    data = diag_fixture(3, 4)
    original = json.dumps(data, sort_keys=True)
    entries, ignored = module._process_diagnostics_update(data, project_root="/workspace")
    assert len(entries) == 3 and ignored == 0 and json.dumps(data, sort_keys=True) == original
    expected = module._probe_aggregate("/workspace")
    cached_markers = cast(list[dict[str, object]], module._probe_cache()[0][4])
    projected_marker = cast(dict[str, object], expected[1]["/workspace/0.py"][0])
    # Existing copies intentionally retain nested-object identity. Safer copying
    # must not silently introduce deep-copy semantics either.
    assert projected_marker["extra"] is cached_markers[0]["extra"]
    # Replacing one resource does not evict a second owner's other resources.
    module._process_diagnostics_update({"owner": "two", "items": [{"uri": "file:///workspace/0.py", "markers": [{"severity": 8, "message": "other"}]}]}, project_root="/workspace")
    module._probe_clear("one")
    assert set(module._diag_cache) == {("/workspace/0.py", "two")}
    result = module._probe_aggregate("/workspace")
    module._process_diagnostics_update({"owner": "two", "items": [{"uri": "file:///workspace/0.py", "markers": []}, {"uri": "file:///elsewhere/a.py", "markers": []}, {"uri": "", "markers": []}]}, project_root="/workspace")
    assert module._probe_aggregate("/workspace") == ({}, {})
    assert module._prune_cache_to_project("/different") == 1
    # Same-time LRU tie order/500-entry budget and malformed marker filtering.
    module._process_diagnostics_update(diag_fixture(505, 1), project_root="/workspace")
    assert len(module._diag_cache) == 500 and ("/workspace/0.py", "one") not in module._diag_cache
    cache = module._probe_cache()
    module._diag_cache.clear()
    malformed: dict[str, object] = {"items": [None, 1, {"uri": "file:///workspace/x.py", "markers": [None, 1, {"severity": "8", 2: "key"}]}]}
    module._process_diagnostics_update(malformed, project_root="/workspace")
    edges = copy.deepcopy(module._probe_aggregate("/workspace"))
    # Original aggregation copies marker maps but shares nested values; reuse
    # changes that outer alias contract. Surface it, do not call it full parity.
    first = module._probe_aggregate("/workspace")[1]["/workspace/x.py"][0]
    assert isinstance(first, dict)
    cast(dict[str, object], first)["message"] = "consumer mutation"
    aliases = "message" in cast(dict[str, object], module._probe_aggregate("/workspace")[1]["/workspace/x.py"][0])
    return expected, result, cache, edges, aliases


async def run(compiled: bool, check_only: bool) -> None:
    buses = [cast(Bus, load(name, compiled)) for name in ("events_dict", "events_native")]
    assert await bus_parity(buses[0]) == await bus_parity(buses[1])
    print(json.dumps({"kind": "event_parity", "compiled": compiled, "result": "pass", "consumers": "synthetic; production delivery/helpers"}), flush=True)
    diagnostics = [cast(Diagnostics, load(name, compiled)) for name in DIAG_NAMES]
    outcomes = [diag_parity(module) for module in diagnostics]
    assert all(outcome[:4] == outcomes[0][:4] for outcome in outcomes)
    assert [outcome[4] for outcome in outcomes] == [False, False, True, True, False, False]
    print(json.dumps({"kind": "diagnostics_parity", "compiled": compiled, "outputs": "pass", "copy_removal_alias_change": True}), flush=True)
    if check_only:
        return
    for fanout in (1, 4, 12):
        for construct in (False, True):
            samples: list[list[float]] = [[], []]
            for sample in range(7):
                for offset in range(2):
                    which = (sample + offset) % 2
                    module = buses[which]
                    module._probe_setup(fanout)
                    event = module._probe_event()
                    gc.collect()
                    before = time.perf_counter_ns()
                    for _ in range(1000):
                        await module._deliver(module._probe_event() if construct else event)
                    samples[which].append((time.perf_counter_ns() - before) / 1000)
            print(json.dumps({"kind": "event_timing", "compiled": compiled, "fanout": fanout, "include_build": construct, "median_ns": [statistics.median(values) for values in samples]}), flush=True)
    for files, markers in ((20, 5), (200, 20)):
        samples_diag: list[list[float]] = [[] for _ in diagnostics]
        for diagnostic_module in diagnostics:
            diagnostic_module._diag_cache.clear()
            diagnostic_module._process_diagnostics_update(diag_fixture(files, markers), project_root="/workspace")
        for sample in range(7):
            for offset in range(len(diagnostics)):
                which = (sample + offset) % len(diagnostics)
                gc.collect()
                before = time.perf_counter_ns()
                for _ in range(50):
                    diagnostics[which]._probe_aggregate("/workspace")
                samples_diag[which].append((time.perf_counter_ns() - before) / 50)
        print(json.dumps({"kind": "diagnostics_timing", "compiled": compiled, "files": files, "markers_per_file": markers, "variants": DIAG_NAMES, "median_ns": [statistics.median(values) for values in samples_diag]}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch", type=Path)
    parser.add_argument("--run", choices=("source", "compiled"))
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0, str(args.scratch.resolve()))
        asyncio.run(run(args.run == "compiled", args.check_only))
        return
    args.scratch.mkdir(parents=True, exist_ok=False)
    generate(args.scratch)
    extra = ["--check-only"] if args.check_only else []
    subprocess.run([sys.executable, "-B", __file__, str(args.scratch), "--run", "source", *extra], check=True)
    subprocess.run([sys.executable, "setup.py", "build_ext", "--inplace"], cwd=args.scratch, check=True)
    subprocess.run([sys.executable, "-B", __file__, str(args.scratch), "--run", "compiled", *extra], check=True)


if __name__ == "__main__":
    main()
