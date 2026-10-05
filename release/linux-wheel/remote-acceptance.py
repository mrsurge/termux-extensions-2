from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import cast


def _probe_wba_runtime(venv: Path, source: Path, root: Path) -> dict[str, object]:
    """Import the actual installed Node graph, without a shared framework/upstream."""
    node = venv / 'bin/node'
    code = '''
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const app=path.join(process.argv[1],'app/apps/code_te2');
const require=createRequire(path.join(app,'probe.cjs'));
const socketio=require(path.join(app,'vendor/node_socketio/node_modules/socket.io/dist/index.js'));
if(typeof socketio.Server !== 'function') throw new Error('Socket.IO Server export missing');
await import(pathToFileURL(path.join(app,'workbench_protocol_proxy/node_workbench_adapter/dist/server/server.mjs')));
process.stdout.write('\\nTE2_WBA_IMPORT='+JSON.stringify({node:process.version,socketio:true,wbaEntry:true})+'\\n',
    () => process.exit(0));
'''
    environment = {'PATH': str(venv / 'bin') + os.pathsep + os.defpath,
                   'HOME': str(root / 'native-import-probe'),
                   'TE2_ADAPTER_HOST': '127.0.0.1', 'TE2_ADAPTER_PORT': '0',
                   'TE2_CODE_SERVER_HTTP': 'http://127.0.0.1:1',
                   'TE2_EXTENSION_STORAGE_PATH': str(root / 'native-import-probe/extensions'),
                   'TE2_WEBVIEW_RECONSTRUCTION_STORAGE_PATH': str(root / 'native-import-probe/webviews')}
    result = subprocess.run([str(node), '--input-type=module', '-e', code, str(source)],
                            cwd=root, env=environment, capture_output=True, timeout=30)
    marker = b'TE2_WBA_IMPORT='
    if result.returncode != 0 or marker not in result.stdout:
        raise RuntimeError('Installed WBA import failed: ' + result.stderr.decode(errors='replace')[-8000:])
    value: object = json.loads(result.stdout.split(marker)[-1].splitlines()[0])
    if not isinstance(value, dict) or value.get('socketio') is not True or value.get('wbaEntry') is not True:
        raise RuntimeError('Installed WBA import returned an invalid result')
    return cast(dict[str, object], value)


def main() -> int:
    args = _parse_args()
    root = Path(args.root).expanduser().resolve()
    wheel = Path(args.wheel).expanduser().resolve()
    venv = root / "venv"
    log_path = root / "framework.log"
    shutil.rmtree(venv, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)

    subprocess.run([args.python, "-m", "venv", str(venv)], check=True)
    python = venv / "bin" / "python"
    te2 = venv / "bin" / "te2"
    subprocess.run(
        [str(python), "-m", "pip", "install", "--no-cache-dir", str(wheel)],
        check=True,
    )

    selected = _print_server_command(te2)
    expected_parent = venv / "lib"
    if expected_parent not in selected.parents:
        raise RuntimeError(f"bootstrap selected a server outside the candidate venv: {selected}")
    if selected.name != "te2-server" or not selected.is_file():
        raise RuntimeError(f"bootstrap selected an invalid packaged server: {selected}")

    # Resolve with the host Python, then verify imports with the private one.
    # Do not test native extensions through the host's ABI/site-packages.
    native = subprocess.run([str(python), '-I', '-c',
        'import json; from importlib.metadata import version; '
        'from app.release_runtime.code_te2 import packaged_runtime; '
        'r=packaged_runtime(version("te2")); '
        'print(json.dumps({"executable":str(r.executable),"domain":str(r.domain),'
        '"python":str(r.python_executable),"home":str(r.python_home),"source":str(r.source_root)}))'],
        check=True, capture_output=True, text=True)
    native_paths = json.loads(native.stdout)
    for value in native_paths.values():
        if expected_parent not in Path(value).parents:
            raise RuntimeError(f'private native path escapes candidate venv: {value}')
    probe_code = '''
import importlib,json,sys
from pathlib import Path
source,domain,home=map(Path,sys.argv[1:])
sys.path[:]=[str(source),str(home/'lib/python3.14'),
             str(home/'lib/python3.14/lib-dynload'),str(home/'lib/python3.14/site-packages')]
from app.apps.code_te2.mypyc_overlay import install
count=install(str(source),str(domain))
from app.release_runtime.code_te2 import compiled_module_names
for name in sorted(compiled_module_names(json.loads((domain/'manifest.json').read_text()))):
    importlib.import_module(name)
print(json.dumps({'python':sys.version,'compiledModules':count}))
'''
    probe_environment = dict(os.environ)
    for name in ('CONFIG', 'DATA', 'CACHE', 'RUNTIME'):
        probe_environment[f'TE2_{name}_HOME'] = str(root / 'native-import-probe' / name.lower())
    probe = subprocess.run([native_paths['python'], '-I', '-S', '-B', '-X',
        'pycache_prefix=' + str(Path(native_paths['home']) / '.disabled-bytecode-cache'),
        '-c', probe_code,
        native_paths['source'], native_paths['domain'], native_paths['home']],
        env=probe_environment, check=True, capture_output=True, text=True, timeout=90)
    print(probe.stdout)
    wba_probe = _probe_wba_runtime(venv, Path(native_paths['source']), root)
    print(json.dumps(wba_probe, sort_keys=True))

    if args.install_only:
        result = {
            "mode": "install-only",
            "packagedServer": str(selected),
            "nativeRuntime": native_paths,
            "nativeImportProbe": probe.stdout,
            "wbaImportProbe": wba_probe,
            "schemaVersion": 1,
            "te2": str(te2),
            "venv": str(venv),
            "wheel": wheel.name,
        }
        (root / "acceptance-result.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(result, sort_keys=True))
        return 0

    selected.write_bytes(b"intentional acceptance corruption\n")
    selected.chmod(0o755)
    corrupt = subprocess.run(
        [str(te2), "--print-command"],
        check=False,
        capture_output=True,
        text=True,
    )
    combined = corrupt.stdout + corrupt.stderr
    if corrupt.returncode == 0 or "digest mismatch" not in combined:
        raise RuntimeError(
            "corrupt packaged server did not produce the required digest failure: "
            f"returncode={corrupt.returncode}, output={combined!r}"
        )
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--force-reinstall",
            "--no-cache-dir",
            "--no-deps",
            str(wheel),
        ],
        check=True,
    )
    selected = _print_server_command(te2)

    port = _free_loopback_port()
    environment = os.environ.copy()
    environment.update(
        {
            "TE2_CACHE_HOME": str(root / "state" / "cache"),
            "TE2_CONFIG_HOME": str(root / "state" / "config"),
            "TE2_DATA_HOME": str(root / "state" / "data"),
            "TE2_RUNTIME_HOME": str(root / "state" / "runtime"),
        }
    )
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(te2), "--host", "127.0.0.1", "--port", str(port)],
            cwd=root,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            text=True,
        )
        try:
            health = _wait_for_json(f"http://127.0.0.1:{port}/api/health", process)
            apps = _read_json(f"http://127.0.0.1:{port}/api/apps")
        finally:
            _stop_framework(process)

    if health.get("status") != "ok" or health.get("app") != "te2":
        raise RuntimeError(f"unexpected framework health response: {health}")
    if not apps.get("ok") or not isinstance(apps.get("data"), list):
        raise RuntimeError(f"unexpected app discovery response: {apps}")
    app_ids = sorted(
        str(item.get("id") or item.get("app_id") or item.get("appId"))
        for item in apps["data"]
        if isinstance(item, dict)
    )
    if "code_te2" not in app_ids:
        raise RuntimeError(f"packaged app discovery omitted code_te2: {app_ids}")

    result = {
        "appCount": len(apps["data"]),
        "nativeRuntime": native_paths,
        "nativeImportProbe": probe.stdout,
        "wbaImportProbe": wba_probe,
        "appIds": app_ids,
        "frameworkVersion": health.get("version"),
        "health": "ok",
        "packagedServer": str(selected),
        "schemaVersion": 1,
        "wheel": wheel.name,
    }
    (root / "acceptance-result.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, sort_keys=True))
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--python", default="python3")
    parser.add_argument("--install-only", action="store_true")
    return parser.parse_args()


def _print_server_command(te2: Path) -> Path:
    result = subprocess.run(
        [str(te2), "--print-command"],
        check=True,
        capture_output=True,
        text=True,
    )
    command = result.stdout.strip()
    if not command or "\n" in command:
        raise RuntimeError(f"unexpected te2 --print-command output: {result.stdout!r}")
    return Path(command).resolve()


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _wait_for_json(url: str, process: subprocess.Popen[str]) -> dict[str, object]:
    deadline = time.monotonic() + 90
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"framework exited before readiness with {process.returncode}")
        try:
            return _read_json(url)
        except Exception as exc:
            last_error = exc
            time.sleep(0.2)
    raise RuntimeError(f"framework did not become healthy: {last_error}")


def _read_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=2) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise RuntimeError(f"response from {url} is not a JSON object")
    return value


def _stop_framework(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
