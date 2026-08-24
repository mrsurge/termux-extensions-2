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
