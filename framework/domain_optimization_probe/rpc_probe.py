"""Compare parsed RPC records using real lane parsers; never import TE2 owners.

Generate controlled source in a new scratch directory. Runtime-inspected schemas
and error classes stay interpreted; parse/projection functions and native records
are compiled together for the second run. Production source is not rewritten.
"""
from __future__ import annotations

import argparse
import ast
import builtins
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
from typing import Protocol, cast

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app/apps/code_te2"
LANES = {
    "editor": ("monaco_editor/editor_rpc_contract.py", "coerce_jsonrpc_request_envelope", "JsonRpcRequestEnvelope", "id", "editor.mirror.publish"),
    "explorer": ("explorer/transport/rpc_contract.py", "parse_explorer_rpc_request", "ParsedExplorerRpcRequest", "request_id", "explorer.search.run"),
    "host": ("ui_ipc/rpc_contract.py", "parse_ui_ipc_rpc_request", "ParsedUiIpcRpcRequest", "request_id", "ui.host.bootSnapshot.get"),
}


class Projection(Protocol):
    __file__: str
    def project(self, payload: object, reads: int) -> tuple[object, ...]: ...
    def project_wire(self, payload: bytes, reads: int) -> tuple[object, ...]: ...


class Imports(ast.NodeTransformer):
    def visit_ImportFrom(self, node: ast.ImportFrom) -> ast.AST:
        if node.module is not None and node.module.endswith("socketio_jsonrpc"):
            node.module = "rpc_common"
            node.level = 0
        if node.module != "__future__":
            for alias in node.names:
                alias.asname = alias.asname or alias.name
        return node


class RecordReturn(ast.NodeTransformer):
    def __init__(self, name: str) -> None:
        self.name = name

    def visit_Return(self, node: ast.Return) -> ast.AST:
        if isinstance(node.value, ast.Dict):
            keywords: list[ast.keyword] = []
            for key, value in zip(node.value.keys, node.value.values):
                assert isinstance(key, ast.Constant) and isinstance(key.value, str)
                keywords.append(ast.keyword(arg=key.value, value=value))
            node.value = ast.Call(func=ast.Name(id=self.name, ctx=ast.Load()), args=[], keywords=keywords)
        return node


def generate(destination: Path) -> list[str]:
    (destination / "rpc_common.py").write_text((APP / "socketio_jsonrpc.py").read_text())
    modules = ["rpc_records"]
    record_definitions = ['from __future__ import annotations',
        'from typing import Literal', 'from support_editor import EditorRpcMethod',
        'from support_host import UiIpcRpcMethod']
    for lane, (relative, parse_name, record_name, id_field, _) in LANES.items():
        tree = Imports().visit(ast.parse((APP / relative).read_text()))
        ast.fix_missing_locations(tree)
        (destination / f"support_{lane}.py").write_text(ast.unparse(tree) + "\n")
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == parse_name)
        locals_ = {node.id for node in ast.walk(function) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)}
        locals_.update(arg.arg for arg in function.args.args)
        locals_.update(node.name for node in ast.walk(function) if isinstance(node, ast.ExceptHandler) and node.name)
        names = sorted({node.id for node in ast.walk(function) if isinstance(node, ast.Name)
                        and isinstance(node.ctx, ast.Load)} - locals_ - set(dir(builtins)) - {record_name})
        id_type = 'str | int' if lane == 'editor' else ('str | None' if lane == 'explorer' else 'str | int')
        method_type = 'EditorRpcMethod' if lane == 'editor' else ('UiIpcRpcMethod' if lane == 'host' else 'str')
        fields = ([('jsonrpc', 'Literal["2.0"]')] if lane == 'editor' else []) + [(id_field, id_type), ('method', method_type), ('params', 'dict[str, object]')]
        record_definitions.append(f'class {record_name}:\n    def __init__(self, *, ' + ', '.join(f'{name}: {kind}' for name, kind in fields) + ') -> None:\n' + '\n'.join(f'        self.{name} = {name}' for name, _ in fields))
        for native in [False, True]:
            name = f'rpc_{lane}_{"native" if native else "dict"}'
            modules.append(name)
            selected = copy.deepcopy(function)
            if native:
                selected = RecordReturn(record_name).visit(selected)
            ast.fix_missing_locations(selected)
            def access(field: str) -> str:
                return f'request.{field}' if native else f'request["{field}"]'
            code = 'from __future__ import annotations\nimport msgspec\n'
            code += f'from support_{lane} import ' + ', '.join(names) + '\n'
            code += f'from {"rpc_records" if native else "support_" + lane} import {record_name}\n'
            code += ast.unparse(selected) + '\n'
            code += f'''def project(payload: object, reads: int) -> tuple[object, ...]:
    request = {parse_name}(payload)
    if request is None:
        return ()
    result: tuple[object, ...] = ()
    for _ in range(reads):
        result = ({access(id_field)}, {access('method')}, {access('params')})
    return result
def project_wire(payload: bytes, reads: int) -> tuple[object, ...]:
    decoded: object = msgspec.msgpack.decode(payload)
    return project(decoded, reads)
'''
            (destination / f'{name}.py').write_text(code)
    (destination / 'rpc_records.py').write_text('\n\n'.join(record_definitions) + '\n')
    (destination / 'setup.py').write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="rpc-record-probe", ext_modules=mypycify(' + repr([f'{name}.py' for name in modules]) + ', opt_level="3"))\n')
    return modules


def load(name: str, compiled: bool) -> Projection:
    if compiled:
        module = importlib.import_module(name)
        assert str(module.__file__).endswith('.so')
    else:
        spec = importlib.util.spec_from_file_location(name, Path(sys.path[0]) / f'{name}.py')
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return cast(Projection, module)


def outcome(module: Projection, payload: object) -> tuple[object, ...]:
    try:
        return ('result', *module.project(payload, 1))
    except Exception as error:
        code: object = getattr(error, 'code', None)
        message: object = getattr(error, 'message', None)
        request_id: object = getattr(error, 'request_id', None)
        return ('error', type(error).__name__, code, message, request_id)


def run(compiled: bool) -> None:
    import msgspec
    for lane, (_, _, _, _, method) in LANES.items():
        modules = [load(f'rpc_{lane}_{kind}', compiled) for kind in ('dict', 'native')]
        valid: dict[str, object] = {'jsonrpc':'2.0', 'id':'r1', 'method':method, 'params':{'path':'/project/a.py', 'version':5}}
        fixtures: list[object] = [valid, None, [], {}, dict(valid, id=None), dict(valid, id=True), dict(valid, id=0),
            dict(valid, id=2**63), dict(valid, id=''), dict(valid, params=None), dict(valid, params=[]),
            dict(valid, jsonrpc='1.0'), dict(valid, method=''), dict(valid, method='unknown'),
            {key:value for key,value in valid.items() if key != 'id'}, dict(valid, params={1:'nonstring', 'x':True})]
        for payload in fixtures:
            assert outcome(modules[0], payload) == outcome(modules[1], payload), (lane, payload)
        # Preserve opaque nested/binary extension values; no payload flattening.
        wide = dict(valid, params={'items':[{'uri':f'file:///{i}.rs', 'values':[i,True,None]} for i in range(256)], 'bytes':b'\0\xff'*512})
        assert outcome(modules[0], wide) == outcome(modules[1], wide)
        print(json.dumps({'kind':'rpc_parity','lane':lane,'compiled':compiled,'cases':len(fixtures)+1,'parity':'pass'}))
        for fixture, payload in [('small',valid), ('wide',wide)]:
            wire = msgspec.msgpack.encode(payload)
            for reads in [1,8]:
                for include_decode in [False,True]:
                    times: list[list[float]] = [[],[]]
                    iterations = 3000 if fixture == 'small' else 100
                    for sample in range(9):
                        for offset in range(2):
                            which = (sample+offset)%2
                            gc.collect()
                            before = time.perf_counter_ns()
                            for _ in range(iterations):
                                if include_decode:
                                    modules[which].project_wire(wire, reads)
                                else:
                                    modules[which].project(payload, reads)
                            times[which].append((time.perf_counter_ns()-before)/iterations)
                    print(json.dumps({'kind':'rpc_timing','lane':lane,'compiled':compiled,'fixture':fixture,
                        'reads':reads,'include_decode':include_decode,'median_ns':[statistics.median(values) for values in times]}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('scratch',type=Path)
    parser.add_argument('--run',choices=['source','compiled'])
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0,str(args.scratch.resolve()))
        run(args.run == 'compiled')
    else:
        args.scratch.mkdir(parents=True,exist_ok=False)
        generate(args.scratch)
        subprocess.run([sys.executable,__file__,str(args.scratch),'--run','source'],check=True)
        subprocess.run([sys.executable,'setup.py','build_ext','--inplace'],cwd=args.scratch,check=True)
        subprocess.run([sys.executable,__file__,str(args.scratch),'--run','compiled'],check=True)


if __name__ == '__main__':
    main()
