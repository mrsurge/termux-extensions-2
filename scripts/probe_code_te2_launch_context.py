"""Isolated mypyc stress probe for the actual intelligence launch dictionaries.

No framework, code-server, extension installation, or live runtime is touched.
Run using the same Python/compiler toolchain as the domain artifact.
"""
from __future__ import annotations

import argparse
import ast
from pathlib import Path
import subprocess
import sys


PREFIX = '''import asyncio
import os
from pathlib import Path

APP_ID = "code_te2"
WORKBENCH_ADAPTER_FIXED_PORT = 12345
repo_root = Path("/fixture/repo")
project_root_abs = Path("/fixture/project")
adapter_entry = Path("/fixture/server.mjs")
node_binary = Path("/fixture/node")
code_server_http = "http://127.0.0.1:1"
code_server_socket_path = "/fixture/server.sock"
remote_authority = "localhost"
code_server_bin = "/fixture/code-server"
data_dir = Path("/fixture/data")
_CODE_SERVER_PROBE_OUTPUT_PATH = Path("/fixture/probe")

class Paths:
    def __init__(self) -> None:
        self.code_server_extensions_manifest_path: Path = Path("/fixture/extensions.json")
        self.code_server_user_settings_path: Path = Path("/fixture/settings.json")
        self.code_server_extension_storage_dir: Path = Path("/fixture/storage")
        self.code_server_webview_reconstruction_dir: Path = Path("/fixture/reconstruction")

paths = Paths()

def _project_hash(value: str) -> str:
    return str(hash(value))

def _expected_socket_path() -> str:
    return "/fixture/server.sock"

def node_compile_cache(service: str) -> str:
    return "/fixture/cache/" + service
'''


def launch_expression(source: Path) -> ast.expr:
    tree = ast.parse(source.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "start_from_ref":
            for keyword in node.keywords:
                if keyword.arg == "ctx" and isinstance(keyword.value, ast.Dict):
                    return keyword.value
    raise RuntimeError(f"launch context not found: {source}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=10000)
    parser.add_argument("--embedded-await", action="store_true", help="Recreate the crashing pre-fix expression for a negative control")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = PREFIX
    for name, filename, service in (
        ("adapter", "workbench_adapter_shell_manager.py", "workbench-adapter"),
        ("server", "code_server_shell_manager.py", "code-server"),
    ):
        expr = launch_expression(args.source / "app/apps/code_te2" / filename)
        if args.embedded_await:
            assert isinstance(expr, ast.Dict)
            for index, key in enumerate(expr.keys):
                if isinstance(key, ast.Constant) and key.value == "NODE_COMPILE_CACHE":
                    expr.values[index] = ast.parse(
                        f'await asyncio.to_thread(node_compile_cache, "{service}")', mode="eval"
                    ).body
        source += f'\nasync def {name}() -> dict[str, str]:\n'
        if not any(isinstance(node, ast.Await) for node in ast.walk(expr)):
            source += f'    compile_cache_path = await asyncio.to_thread(node_compile_cache, "{service}")\n'
        source += f'    return {ast.unparse(expr)}\n'
    (output / "launch_probe.py").write_text(source)
    with (output / "build.log").open("w") as log:
        subprocess.run([sys.executable, "-c", '''from setuptools import setup
from mypyc.build import mypycify
setup(name="launch-probe", ext_modules=mypycify(["launch_probe.py"], opt_level="3", multi_file=True), script_args=["build_ext", "--inplace"])
'''], cwd=output, stdout=log, stderr=subprocess.STDOUT, check=True)
    with (output / "stress.log").open("w") as log:
        subprocess.run([sys.executable, "-X", "faulthandler", "-c", '''import asyncio, gc, launch_probe
async def run():
    for i in range(int(__import__("sys").argv[1])):
        for fn in (launch_probe.adapter, launch_probe.server):
            row = await fn()
            assert row["APP_ID"] == "code_te2"
            assert row["NODE_COMPILE_CACHE"].startswith("/fixture/cache/")
        if i % 100 == 0:
            gc.collect()
asyncio.run(run())
print("compiled launch contexts passed")
''', str(args.iterations)], cwd=output, stdout=log, stderr=subprocess.STDOUT, check=True)
    print(f"Compiled launch contexts passed ({args.iterations} iterations each); evidence: {output}")


if __name__ == "__main__":
    main()
