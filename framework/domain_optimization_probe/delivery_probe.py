"""Original validated-RPC delivery wrapper versus direct typed arguments.

Extract the real adapter and ingress functions; synthetic namespace only. This
qualifies metadata delivery costs, not socket validation or application handlers.
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
APP = ROOT / 'app/apps/code_te2'


class Fixture(Protocol):
    def make_server(self) -> object: ...
    async def wrapped(self, server: object, namespace: str, sid: str, event: str, payload: bytes) -> object: ...
    async def direct(self, server: object, namespace: str, sid: str, event: str, payload: bytes) -> object: ...


def generate(destination: Path) -> None:
    tree = ast.parse((APP / 'native_socketio.py').read_text())
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'NativeSocketServer')
    method = next(node for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'deliver')
    direct_method = next(node for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'deliver_rpc')
    tree = ast.parse((APP / 'network_rpc_ingress.py').read_text())
    wrapped = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'deliver_rpc')
    wrapped.name = 'wrapped'
    wrapped.args.args[0].annotation = ast.Name(id='Server', ctx=ast.Load())
    direct = copy.deepcopy(wrapped)
    direct.name = 'direct'
    # Reconstruct the former map-based path explicitly; the direct path uses
    # today's actual ingress/adapter methods, not an inlined synthetic shortcut.
    wrapped.body[-1] = ast.parse('return await server.deliver({"namespace":namespace,"sid":sid,"event":event,"data":data})').body[0]
    server = ast.parse('''class Server:
    def __init__(self) -> None:
        self.namespace_handlers: dict[str, Handler] = {name: Handler() for name in ('/rpc/editor', '/rpc/explorer', '/ui_ipc')}
        self._sessions: dict[tuple[str, str], dict[str, object]] = {}
''').body[0]
    assert isinstance(server, ast.ClassDef)
    server.body.append(method)
    server.body.append(direct_method)
    preamble = ast.parse('''from __future__ import annotations
import msgspec
_decoder = msgspec.msgpack.Decoder(object)
class Handler:
    async def trigger_event(self, event: str, *args: object) -> object:
        return event, args
''')
    preamble.body.extend([server, wrapped, direct])
    preamble.body.extend(ast.parse('def make_server() -> Server:\n    return Server()\n').body)
    ast.fix_missing_locations(preamble)
    (destination / 'delivery_fixture.py').write_text(ast.unparse(preamble) + '\n')
    (destination / 'setup.py').write_text('from setuptools import setup\nfrom mypyc.build import mypycify\nsetup(name="delivery-probe", ext_modules=mypycify(["delivery_fixture.py"], opt_level="3"))\n')


async def run(compiled: bool) -> None:
    import msgspec
    module = importlib.import_module('delivery_fixture')
    assert str(module.__file__).endswith('.so') if compiled else str(module.__file__).endswith('.py')
    fixture = cast(Fixture, module)
    server = fixture.make_server()
    methods = [fixture.wrapped, fixture.direct]
    namespaces = ('/rpc/editor', '/rpc/explorer', '/ui_ipc')
    cases: list[object] = [None, 12, [], {'sid':'forged', 'namespace':'forged', 'event':'disconnect', 'params':{'text':'λ🙂', 'bytes':b'\0\xff'}}]
    for namespace in namespaces:
        for data in cases:
            wire = msgspec.msgpack.encode(data)
            left = await methods[0](server, namespace, 'owned', 'rpc', wire)
            right = await methods[1](server, namespace, 'owned', 'rpc', wire)
            assert left == right == ('rpc', ('owned', data))
    for namespace, sid, event, wire in [('/terminal','owned','rpc',b'\xc0'),('/ui_ipc','','rpc',b'\xc0'),('/ui_ipc','owned','disconnect',b'\xc0'),('/ui_ipc','owned','rpc',b'\xc1')]:
        errors: list[tuple[str,str]] = []
        for method in methods:
            try:
                await method(server,namespace,sid,event,wire)
            except Exception as error:
                errors.append((type(error).__name__,str(error)))
        assert len(errors) == 2 and errors[0] == errors[1]
    print(json.dumps({'kind':'delivery_parity','compiled':compiled,'cases':16,'parity':'pass'}))
    for namespace in namespaces:
        for label, data in [('small',cases[-1]),('wide',{'items':[{'uri':f'file:///{i}.rs','line':i} for i in range(256)]})]:
            wire = msgspec.msgpack.encode(data)
            iterations = 3000 if label == 'small' else 100
            times: list[list[float]] = [[],[]]
            for sample in range(9):
                for offset in range(2):
                    which = (sample+offset)%2
                    gc.collect()
                    before = time.perf_counter_ns()
                    for _ in range(iterations):
                        await methods[which](server,namespace,'owned','rpc',wire)
                    times[which].append((time.perf_counter_ns()-before)/iterations)
            print(json.dumps({'kind':'delivery_timing','compiled':compiled,'namespace':namespace,'fixture':label,
                'median_ns':[statistics.median(values) for values in times]}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('scratch',type=Path)
    parser.add_argument('--run',choices=['source','compiled'])
    args = parser.parse_args()
    if args.run:
        sys.path.insert(0,str(args.scratch.resolve()))
        asyncio.run(run(args.run == 'compiled'))
    else:
        args.scratch.mkdir(parents=True,exist_ok=False)
        generate(args.scratch)
        subprocess.run([sys.executable,__file__,str(args.scratch),'--run','source'],check=True)
        subprocess.run([sys.executable,'setup.py','build_ext','--inplace'],cwd=args.scratch,check=True)
        subprocess.run([sys.executable,__file__,str(args.scratch),'--run','compiled'],check=True)


if __name__ == '__main__':
    main()
