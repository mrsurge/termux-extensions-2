from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import subprocess
from pathlib import Path
from typing import Final


REPO_ROOT: Final = Path(__file__).resolve().parents[1]
REMOTE_DRIVER: Final = REPO_ROOT / "release" / "linux-wheel" / "remote-acceptance.py"


def main() -> int:
    args = _parse_args()
    wheel = Path(args.wheel).expanduser().resolve()
    if not wheel.is_file():
        raise SystemExit(f"Candidate wheel does not exist: {wheel}")
    digest = _sha256_file(wheel)
    remote_home = _ssh_output(args.host, "python3", "-c", "import pathlib; print(pathlib.Path.home())")
    remote_root = f"{remote_home}/.cache/te2-release-acceptance/{digest[:16]}"
    remote_wheel = f"{remote_root}/{wheel.name}"
    remote_driver = f"{remote_root}/remote-acceptance.py"
    _ssh(args.host, "mkdir", "-p", remote_root)
    _scp(wheel, args.host, remote_wheel)
    _scp(REMOTE_DRIVER, args.host, remote_driver)

    try:
        _ssh(
            args.host,
            "python3",
            remote_driver,
            "--wheel",
            remote_wheel,
            "--root",
            remote_root,
        )
    except subprocess.CalledProcessError:
        print(f"Remote acceptance state retained for inspection: {args.host}:{remote_root}")
        raise

    evidence = wheel.parent / "remote-acceptance"
    evidence.mkdir(parents=True, exist_ok=True)
    _scp_from(args.host, f"{remote_root}/acceptance-result.json", evidence)
    _scp_from(args.host, f"{remote_root}/framework.log", evidence)
    result = json.loads((evidence / "acceptance-result.json").read_text(encoding="utf-8"))
    result["candidateWheelSha256"] = digest
    (evidence / "acceptance-result.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if not args.keep_remote:
        _ssh(args.host, "rm", "-rf", remote_root)
    print(evidence)
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install and live-test one TE2 Linux wheel on a clean SSH target."
    )
    parser.add_argument("--host", required=True, help="SSH destination with key authentication")
    parser.add_argument("--wheel", required=True)
    parser.add_argument("--keep-remote", action="store_true")
    return parser.parse_args()


def _ssh(host: str, *remote_command: str) -> None:
    command = " ".join(shlex.quote(part) for part in remote_command)
    subprocess.run(
        ["ssh", "-o", "BatchMode=yes", host, command],
        check=True,
    )


def _ssh_output(host: str, *remote_command: str) -> str:
    command = " ".join(shlex.quote(part) for part in remote_command)
    return subprocess.run(
        ["ssh", "-o", "BatchMode=yes", host, command],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _scp(path: Path, host: str, destination: str) -> None:
    subprocess.run(
        ["scp", "-o", "BatchMode=yes", str(path), f"{host}:{destination}"],
        check=True,
    )


def _scp_from(host: str, source: str, destination: Path) -> None:
    subprocess.run(
        ["scp", "-o", "BatchMode=yes", f"{host}:{source}", str(destination)],
        check=True,
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
