"""Complete lane parsing with baseline/native intermediate/reused schema.

Production modules are read as source only. Schema/error islands remain Python;
only editor contracts (and the candidate metadata) compile, matching today's
selected graph rather than compiling every lane just for a favorable benchmark.
"""
from __future__ import annotations

import argparse
import ast
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
VARIANTS = ("baseline", "native", "reuse")
LANES = {
    "editor": ("monaco_editor/editor_rpc_contract.py", "coerce_jsonrpc_request_envelope", "coerce_jsonrpc_notification_envelope", "id", "editor.mirror.publish", "editor.scrollState.publish"),
    "explorer": ("explorer/transport/rpc_contract.py", "parse_explorer_rpc_request", "", "request_id", "explorer.search.run", "explorer.search.run"),
    "host": ("ui_ipc/rpc_contract.py", "parse_ui_ipc_rpc_request", "parse_ui_ipc_rpc_notification", "request_id", "ui.host.bootSnapshot.get", "ui.editor.ready"),
    "sidebar": ("ui_ipc/sidebar_rpc_contract.py", "parse_sidebar_ipc_rpc_request", "parse_sidebar_ipc_rpc_notification", "request_id", "sidebar.cwd.get", "sidebar.presence"),
}


class Lane(Protocol):
    def parse_request(self, payload: object) -> dict[str, object] | None: ...
    def parse_notification(self, payload: object) -> dict[str, object]: ...


class Common(Protocol):
    def coerce_jsonrpc_envelope(self, payload: object) -> object: ...


class Imports(ast.NodeTransformer):
    def __init__(self, common: str) -> None:
        self.common = common

    def visit_ImportFrom(self, node: ast.ImportFrom) -> ast.AST:
        if node.module is not None and node.module.endswith("socketio_jsonrpc"):
            node.module, node.level = self.common, 0
        return node


def generate(destination: Path) -> None:
    source = ast.parse((APP / "socketio_jsonrpc.py").read_text())
    # Always reconstruct the pre-N2b baseline, even after production adopts
    # reuse. Otherwise rerunning this probe would compare reuse with itself.
    schema = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "_IncomingJsonRpcEnvelope")
    schema.body = [node for node in schema.body if not isinstance(node, ast.FunctionDef) or node.name not in {"request_id", "has_id"}]
    function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "coerce_jsonrpc_envelope")
    function.returns = ast.Name(id="JsonRpcEnvelope", ctx=ast.Load())
    # Validation ends at the method-required guard, independent of the final
    # implementation's choice of conditional expression or explicit if/return.
    guard = next(index for index, node in enumerate(function.body) if isinstance(node, ast.If) and ast.unparse(node.test) == "not method")
    function.body = function.body[:guard + 1] + ast.parse("return JsonRpcEnvelope(method=method, params=incoming.params, request_id=request_id, has_id=request_id is not msgspec.UNSET)").body
    # The exact frozen dataclass relocation was qualified first and failed to
    # import under installed mypyc 2.3/CPython 3.14 (KeyError: object). Compare
    # ordinary native public-read-only fields, not a runtime annotation hack.
    # This candidate is not a dataclass/equality/introspection compatibility
    # promise; only admitted parsing/attribute behavior is tested here.
    (destination / "common_metadata.py").write_text('''from __future__ import annotations
class JsonRpcEnvelope:
    def __init__(self, method: str, params: object, request_id: object, has_id: bool) -> None:
        self._method = method
        self._params = params
        self._request_id = request_id
        self._has_id = has_id
    @property
    def method(self) -> str:
        return self._method
    @property
    def params(self) -> object:
        return self._params
    @property
    def request_id(self) -> object:
        return self._request_id
    @property
    def has_id(self) -> bool:
        return self._has_id
''')
    compiled = ["common_metadata"]
    for variant in VARIANTS:
        tree = copy.deepcopy(source)
        if variant == "native":
            tree.body = [node if not isinstance(node, ast.ClassDef) or node.name != "JsonRpcEnvelope" else
                         ast.parse("from common_metadata import JsonRpcEnvelope as JsonRpcEnvelope").body[0] for node in tree.body]
        elif variant == "reuse":
            # Reuse the validated/frozen schema object. Only unusual surrounding
            # method whitespace requires a replacement; payloads stay opaque.
            # Keep the existing private wire schema AND legacy public dataclass
            # constructor. Only the coercer's returned internal concrete type
            # changes; consumer attribute/error behavior is the measured API.
            schema = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "_IncomingJsonRpcEnvelope")
            properties = ast.parse('''class Properties:
    @property
    def request_id(self) -> object:
        return self.id
    @property
    def has_id(self) -> bool:
        return self.id is not msgspec.UNSET
''').body[0]
            assert isinstance(properties, ast.ClassDef)
            schema.body.extend(properties.body)
            function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "coerce_jsonrpc_envelope")
            function.returns = ast.Name(id="_IncomingJsonRpcEnvelope", ctx=ast.Load())
            function.body[-1] = ast.parse("return incoming if method == incoming.method else msgspec.structs.replace(incoming, method=method)").body[0]
        ast.fix_missing_locations(tree)
        common_name = f"common_{variant}"
        (destination / f"{common_name}.py").write_text(ast.unparse(tree) + "\n")
        for lane, (relative, request, notification, _, _, _) in LANES.items():
            contract = Imports(common_name).visit(ast.parse((APP / relative).read_text()))
            # Stable test entrypoints only; original validators and wire/error
            # projection functions remain untouched in these controlled copies.
            suffix = f"\nparse_request = {request}\n"
            if notification:
                suffix += f"parse_notification = {notification}\n"
            else:
                suffix += "def parse_notification(payload: object) -> dict[str, object]:\n    raise AssertionError('Explorer has one parse path')\n"
            ast.fix_missing_locations(contract)
            name = f"lane_{lane}_{variant}"
            (destination / f"{name}.py").write_text(ast.unparse(contract) + suffix)
            if lane == "editor":
                compiled.append(name)
    (destination / "setup.py").write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="common-rpc-probe", ext_modules=mypycify(' + repr([f"{name}.py" for name in compiled]) + ', opt_level="3"))\n')


def process(lane: Lane, payload: object) -> dict[str, object]:
    value = lane.parse_request(payload)
    return value if value is not None else lane.parse_notification(payload)


def outcome(lane: Lane, payload: object) -> tuple[object, ...]:
    try:
        return "result", process(lane, payload)
    except Exception as error:
        code: object = getattr(error, "code", None)
        message: object = getattr(error, "message", None)
        request_id: object = getattr(error, "request_id", None)
        data: object = getattr(error, "data", None)
        return "error", type(error).__name__, code, message, request_id, data


def load(name: str, compiled: bool) -> Lane:
    module = importlib.import_module(name)
    expected = ".so" if compiled and name.startswith("lane_editor_") else ".py"
    assert str(module.__file__).endswith(expected), (name,module.__file__)
    return cast(Lane, module)


def fixtures(method: str, notification: str) -> list[object]:
    valid: dict[str, object] = {"jsonrpc":"2.0","id":"r1","method":method,"params":{"x":1}}
    values: list[object] = [valid, None, True, 1, [], {}, dict(valid,id=None), dict(valid,id=True), dict(valid,id=False),
        dict(valid,id=0),dict(valid,id=-1),dict(valid,id=2**64-1),dict(valid,id=""),dict(valid,id=[]),dict(valid,id={}),
        dict(valid,params=None),dict(valid,params=[]),dict(valid,params=True),dict(valid,params=1),
        dict(valid,params={1:"ignored","x":"kept"}),dict(valid,jsonrpc="1.0"),dict(valid,jsonrpc=2),
        dict(valid,method=""),dict(valid,method=" \t "),dict(valid,method=f" \t{method}\n"),dict(valid,method=1),
        dict(valid,method="unknown"),{"jsonrpc":"2.0","method":notification,"params":{}},
        {"jsonrpc":"2.0","method":notification,"params":{},"has_id":True},
        {"jsonrpc":"2.0","method":notification,"params":{},"request_id":"forged"},
        dict(valid,params={"bytes":b"\0\xff","text":"λ🙂","nested":[None,True,3,{"x":2}]}),
        {key:value for key,value in valid.items() if key != "id"},
        {key:value for key,value in valid.items() if key != "jsonrpc"},
        {key:value for key,value in valid.items() if key != "method"}]
    return values


def run(compiled: bool) -> None:
    import msgspec
    native = importlib.import_module("common_metadata")
    assert str(native.__file__).endswith(".so" if compiled else ".py")
    for name, (_, _, _, _, method, notification) in LANES.items():
        lanes = [load(f"lane_{name}_{variant}",compiled) for variant in VARIANTS]
        cases = fixtures(method,notification)
        for payload in cases:
            expected = outcome(lanes[0],payload)
            for lane in lanes[1:]:
                assert outcome(lane,payload) == expected, (name,payload,expected,outcome(lane,payload))
        # Common metadata remains frozen; request IDs distinguish absence from
        # explicit null, and whitespace normalization never mutates input.
        for variant in VARIANTS:
            common = cast(Common, importlib.import_module(f"common_{variant}"))
            payload = {"jsonrpc":"2.0","method":f" {method} ","params":{}}
            envelope = common.coerce_jsonrpc_envelope(payload)
            assert getattr(envelope,"method") == method and getattr(envelope,"has_id") is False
            assert payload["method"] == f" {method} "
            try:
                setattr(envelope,"method","changed")
            except (AttributeError,TypeError):
                pass
            else:
                raise AssertionError("metadata unexpectedly mutable")
            explicit = common.coerce_jsonrpc_envelope(dict(payload,id=None))
            assert getattr(explicit,"has_id") is True and getattr(explicit,"request_id") is None
        print(json.dumps({"kind":"common_parity","compiled":compiled,"lane":name,"cases":len(cases),"parity":"pass"}))
        for fixture, payload in [("small",cases[0]), ("notification",{"jsonrpc":"2.0","method":notification,"params":{}}),
             ("wide",{"jsonrpc":"2.0","id":"r1","method":method,"params":{"items":[{"uri":f"file:///{i}.rs","line":i} for i in range(256)]}})]:
            wire = msgspec.msgpack.encode(payload)
            for decode in [False,True]:
                times: list[list[float]] = [[],[],[]]
                count = 3000 if fixture != "wide" else 100
                for sample in range(9):
                    for offset in range(3):
                        which = (sample+offset)%3
                        gc.collect()
                        before = time.perf_counter_ns()
                        for _ in range(count):
                            data: object = msgspec.msgpack.decode(wire) if decode else payload
                            process(lanes[which],data)
                        times[which].append((time.perf_counter_ns()-before)/count)
                print(json.dumps({"kind":"common_timing","compiled":compiled,"lane":name,"fixture":fixture,"include_decode":decode,
                    "variants":VARIANTS,"median_ns":[statistics.median(values) for values in times]}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch",type=Path)
    parser.add_argument("--run",choices=["source","compiled"])
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0,str(args.scratch.resolve()))
        run(args.run == "compiled")
    else:
        args.scratch.mkdir(parents=True,exist_ok=False)
        generate(args.scratch)
        subprocess.run([sys.executable,__file__,str(args.scratch),"--run","source"],check=True)
        subprocess.run([sys.executable,"setup.py","build_ext","--inplace"],cwd=args.scratch,check=True)
        subprocess.run([sys.executable,__file__,str(args.scratch),"--run","compiled"],check=True)


if __name__ == "__main__":
    main()
