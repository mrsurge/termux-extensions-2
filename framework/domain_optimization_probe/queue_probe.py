"""Generate isolated variants from production AST, compile, compare semantics/cost.

Generated code is confined to the explicit scratch directory; production imports,
selector updates, sockets and runtime transitions are deliberately absent.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
from collections import deque
import copy
import gc
import importlib
import importlib.util
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time
import tracemalloc
from typing import Protocol, cast

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "app/apps/code_te2/workbench_adapter_shell_manager.py"
FUNCTIONS = {"_json_object", "_te2_push_event", "_queue_push", "_drain_pushes", "_clear_pending_pushes"}
FIELDS = {"obj", "diagnostics_owner", "items_by_uri", "event_count", "payload_bytes", "queued_ns"}


class QueueModule(Protocol):
    __file__: str
    outputs: list[tuple[dict[str, object], int, int]]
    gate: asyncio.Event | None
    _push_drain_task: asyncio.Task[None] | None
    _pending_pushes: deque[object]

    def _queue_push(self, obj: dict[str, object], *, payload_bytes: int) -> None: ...
    async def _clear_pending_pushes(self) -> None: ...


PREAMBLE = '''from __future__ import annotations
import asyncio
import time
from collections import deque
from typing import TypedDict, cast
JsonObject = dict[str, object]
_push_drain_task: asyncio.Task[None] | None = None
outputs: list[tuple[JsonObject, int, int]] = []
gate: asyncio.Event | None = None
def diagnostics_latency_metrics_enabled() -> bool:
    return False
async def wait_for_application() -> None:
    if gate is not None:
        await gate.wait()
async def _handle_push_event(obj: JsonObject, *, queued_ns: int | None = None,
    payload_bytes: int = 0, backlog_at_schedule: int = 0,
    coalesced_events: int = 1, coalesced_items: int = 0) -> None:
    outputs.append((obj, payload_bytes, coalesced_events))
'''
NATIVE_CLASS = '''class PendingPush:
    def __init__(self, obj: JsonObject, diagnostics_owner: str | None,
        items_by_uri: dict[str, JsonObject], event_count: int,
        payload_bytes: int, queued_ns: int | None) -> None:
        self.obj = obj
        self.diagnostics_owner = diagnostics_owner
        self.items_by_uri = items_by_uri
        self.event_count = event_count
        self.payload_bytes = payload_bytes
        self.queued_ns = queued_ns
'''
DICT_CLASS = '''class PendingPush(TypedDict):
    obj: JsonObject
    diagnostics_owner: str | None
    items_by_uri: dict[str, JsonObject]
    event_count: int
    payload_bytes: int
    queued_ns: int | None
'''


class Attributes(ast.NodeTransformer):
    def visit_Subscript(self, node: ast.Subscript) -> ast.AST:
        self.generic_visit(node)
        batch = isinstance(node.value, ast.Name) and node.value.id == "batch"
        tail = isinstance(node.value, ast.Subscript) and isinstance(node.value.value, ast.Name) and node.value.value.id == "_pending_pushes"
        if (batch or tail) and isinstance(node.slice, ast.Constant) and node.slice.value in FIELDS:
            return ast.copy_location(ast.Attribute(value=node.value, attr=node.slice.value, ctx=node.ctx), node)
        return node


class Subscripts(ast.NodeTransformer):
    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        self.generic_visit(node)
        batch = isinstance(node.value, ast.Name) and node.value.id == "batch"
        tail = isinstance(node.value, ast.Subscript) and isinstance(node.value.value, ast.Name) and node.value.value.id == "_pending_pushes"
        if (batch or tail) and node.attr in FIELDS:
            return ast.copy_location(ast.Subscript(value=node.value, slice=ast.Constant(value=node.attr), ctx=node.ctx), node)
        return node


def generate(destination: Path) -> None:
    tree = ast.parse(SOURCE.read_text())
    chosen = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in FUNCTIONS]
    assert {node.name for node in chosen} == FUNCTIONS
    record = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "PendingPush")
    source_is_native = not any(isinstance(base, ast.Name) and base.id == "TypedDict" for base in record.bases)
    for name, native in [("queue_dict", False), ("queue_native", True)]:
        module = ast.Module(body=[*ast.parse(PREAMBLE).body,
            *(copy.deepcopy([record]) if source_is_native == native else ast.parse(NATIVE_CLASS if native else DICT_CLASS).body),
            *ast.parse("_pending_pushes: deque[PendingPush] = deque()").body,
            *copy.deepcopy(chosen)], type_ignores=[])
        if native:
            module = Attributes().visit(module)
        else:
            module = Subscripts().visit(module)
        ast.fix_missing_locations(module)
        (destination / f"{name}.py").write_text(ast.unparse(module) + "\n")
    (destination / "setup.py").write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="queue-probe", ext_modules=mypycify(["queue_dict.py", "queue_native.py"], opt_level="3"))\n')


def fixture(index: int, distinct: bool) -> dict[str, object]:
    if index % 97 == 0:
        return {"event": "te2.event", "params": {"type": "diagnostics/clear", "owner": "test"}}
    return {"event": "te2.event", "params": {"type": "diagnostics/update", "owner": f"owner{index // 31 % 2}",
        "items": [{"uri": f"file:///{index if distinct else index % 8}.py", "markers": [{"message": str(index), "severity": 8}]}]}}


async def exercise(module: QueueModule, data: list[dict[str, object]]) -> None:
    module.outputs.clear()
    for item in data:
        module._queue_push(item, payload_bytes=100)
    task = module._push_drain_task
    if task is not None:
        await task


async def run(compiled: bool) -> None:
    modules: list[QueueModule] = []
    for name in ("queue_dict", "queue_native"):
        if compiled:
            loaded = importlib.import_module(name)
        else:
            spec = importlib.util.spec_from_file_location(name, Path(sys.path[0]) / f"{name}.py")
            assert spec is not None and spec.loader is not None
            loaded = importlib.util.module_from_spec(spec)
            sys.modules[name] = loaded
            spec.loader.exec_module(loaded)
        # Exact controlled generated modules, not arbitrary runtime ingress.
        modules.append(cast(QueueModule, loaded))
    for module in modules:
        suffix = str(module.__file__)
        assert suffix.endswith(".so") if compiled else suffix.endswith(".py")
    for distinct in [False, True]:
        data = [fixture(index, distinct) for index in range(6000)]
        await exercise(modules[0], data)
        expected = json.dumps(modules[0].outputs, sort_keys=True)
        await exercise(modules[1], data)
        assert json.dumps(modules[1].outputs, sort_keys=True) == expected
        timings: list[list[float]] = [[], []]
        for sample in range(11):
            for offset in range(2):
                which = (sample + offset) % 2
                gc.collect()
                before = time.perf_counter_ns()
                await exercise(modules[which], data)
                timings[which].append((time.perf_counter_ns() - before) / 1e6)
                assert json.dumps(modules[which].outputs, sort_keys=True) == expected
        peaks: list[int] = []
        for module in modules:
            module.outputs.clear()
            gc.collect()
            tracemalloc.start()
            await exercise(module, data)
            peaks.append(tracemalloc.get_traced_memory()[1])
            tracemalloc.stop()
        print(json.dumps({"kind": "queue", "compiled": compiled, "distinct_uris": distinct,
            "events": len(data), "samples": 11, "parity": "pass",
            "median_ms": [statistics.median(values) for values in timings], "tracemalloc_peak_bytes": peaks}))
    for module in modules:
        module.outputs.clear()
        module.gate = asyncio.Event()
        module._queue_push(fixture(1, False), payload_bytes=100)
        await asyncio.sleep(0)
        await module._clear_pending_pushes()
        assert not module._pending_pushes and not module.outputs and module._push_drain_task is None
        module.gate = None
        await exercise(module, [fixture(2, False)])
        assert len(module.outputs) == 1
    print(json.dumps({"kind": "queue_lifecycle", "compiled": compiled, "gate_cancel_clear_reuse": "pass"}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch", type=Path)
    parser.add_argument("--run", choices=["source", "compiled"])
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0, str(args.scratch.resolve()))
        asyncio.run(run(args.run == "compiled"))
    else:
        args.scratch.mkdir(parents=True, exist_ok=False)
        generate(args.scratch)
        subprocess.run([sys.executable, __file__, str(args.scratch), "--run", "source"], check=True)
        subprocess.run([sys.executable, "setup.py", "build_ext", "--inplace"], cwd=args.scratch, check=True)
        subprocess.run([sys.executable, __file__, str(args.scratch), "--run", "compiled"], check=True)


if __name__ == "__main__":
    main()
