from __future__ import annotations

import argparse
import hashlib
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Final


REPO_ROOT: Final = Path(__file__).resolve().parents[1]
BUILDER_ROOT: Final = REPO_ROOT / "release" / "linux-wheel"
PLATFORM_TAG: Final = "manylinux_2_28_x86_64"
MINIMUM_GLIBC: Final = "2.28"
MINIMUM_FREE_BYTES: Final = 2 * 1024 * 1024 * 1024


def main() -> int:
    args = _parse_args()
    source_commit = _git_output("rev-parse", "--verify", f"{args.source_ref}^{{commit}}")
    source_date_epoch = _git_output("show", "-s", "--format=%ct", source_commit)
    output = (
        Path(args.output).expanduser().resolve()
        if args.output
        else REPO_ROOT / ".release" / "linux-wheel" / source_commit[:12]
    )
    _require_empty_output(output)
    _check_free_space(output.parent)
    if not args.build_host and shutil.which(args.container_engine) is None:
        raise SystemExit(f"Container engine is unavailable: {args.container_engine}")

    scratch_parent = _scratch_parent()
    scratch_parent.mkdir(parents=True, exist_ok=True)
    image = _builder_image_name()

    with tempfile.TemporaryDirectory(prefix="te2-linux-wheel-", dir=scratch_parent) as raw_tmp:
        scratch = Path(raw_tmp)
        source = scratch / "source"
        work = scratch / "work"
        source_archive = scratch / "source.tar.gz"
        _create_source_archive(source_commit, source_archive)
        output.mkdir(parents=True)
        if args.build_host:
            _run_remote_build(
                host=args.build_host,
                engine=args.container_engine,
                image=image,
                source_archive=source_archive,
                output=output,
                commit=source_commit,
                release_tag=args.release_tag,
                source_date_epoch=source_date_epoch,
            )
        else:
            cache = REPO_ROOT / ".release" / "cache" / "linux-wheel"
            cargo_home = cache / "cargo-home"
            cargo_target = cache / "cargo-target"
            cargo_home.mkdir(parents=True, exist_ok=True)
            cargo_target.mkdir(parents=True, exist_ok=True)
            source.mkdir()
            work.mkdir()
            (work / "home").mkdir()
            _extract_source_archive(source_archive, source)
            _build_image(args.container_engine, image)
            command = _container_run_command(
                engine=args.container_engine,
                image=image,
                source=source,
                work=work,
                output=output,
                cargo_home=cargo_home,
                cargo_target=cargo_target,
                commit=source_commit,
                release_tag=args.release_tag,
                source_date_epoch=source_date_epoch,
            )
            subprocess.run(command, cwd=REPO_ROOT, check=True)

    print(output)
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build TE2's audited x86_64 manylinux wheel from one exact Git commit."
    )
    parser.add_argument("--source-ref", required=True, help="Exact source commit or tag to archive")
    parser.add_argument("--release-tag", required=True, help="Immutable release identity to embed")
    parser.add_argument("--output", help="Fresh artifact output directory")
    parser.add_argument("--container-engine", default="docker")
    parser.add_argument(
        "--build-host",
        help="Optional key-authenticated SSH host on which to run the pinned container",
    )
    return parser.parse_args()


def _git_output(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _create_source_archive(commit: str, archive: Path) -> None:
    subprocess.run(
        ["git", "archive", "--format=tar.gz", f"--output={archive}", commit],
        cwd=REPO_ROOT,
        check=True,
    )


def _extract_source_archive(archive: Path, destination: Path) -> None:
    subprocess.run(
        [
            "tar",
            "--extract",
            "--gzip",
            "--file",
            str(archive),
            "--directory",
            str(destination),
        ],
        check=True,
    )


def _builder_image_name() -> str:
    digest = hashlib.sha256()
    for path in sorted(BUILDER_ROOT.iterdir()):
        if path.is_file():
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
    return f"te2-linux-wheel:{digest.hexdigest()[:16]}"


def _build_image(engine: str, image: str) -> None:
    subprocess.run(
        [engine, "build", "--tag", image, str(BUILDER_ROOT)],
        cwd=REPO_ROOT,
        check=True,
    )


def _container_run_command(
    *,
    engine: str,
    image: str,
    source: Path,
    work: Path,
    output: Path,
    cargo_home: Path,
    cargo_target: Path,
    commit: str,
    release_tag: str,
    source_date_epoch: str,
    keep_id: bool = False,
    uid: int | None = None,
    gid: int | None = None,
) -> list[str]:
    selected_uid = os.getuid() if uid is None else uid
    selected_gid = os.getgid() if gid is None else gid
    command = [engine, "run", "--rm"]
    if keep_id:
        command.extend(["--userns=keep-id"])
    command.extend(
        [
            "--user",
            f"{selected_uid}:{selected_gid}",
            "--volume",
            f"{source}:/input:ro",
            "--volume",
            f"{work}:/work",
            "--volume",
            f"{output}:/output",
            "--volume",
            f"{cargo_home}:/work/cargo-home",
            "--volume",
            f"{cargo_target}:/work/cargo-target",
            "--env",
            f"SOURCE_DATE_EPOCH={source_date_epoch}",
            "--env",
            f"TE2_RELEASE_BUILDER_IMAGE={image}",
            "--env",
            f"TE2_RELEASE_COMMIT={commit}",
            "--env",
            f"TE2_RELEASE_MINIMUM_GLIBC={MINIMUM_GLIBC}",
            "--env",
            f"TE2_RELEASE_PLATFORM_TAG={PLATFORM_TAG}",
            "--env",
            f"TE2_RELEASE_TAG={release_tag}",
            image,
        ]
    )
    return command


def _run_remote_build(
    *,
    host: str,
    engine: str,
    image: str,
    source_archive: Path,
    output: Path,
    commit: str,
    release_tag: str,
    source_date_epoch: str,
) -> None:
    remote_home = _ssh_output(
        host,
        "python3",
        "-c",
        "import pathlib; print(pathlib.Path.home())",
    )
    remote_root = f"{remote_home}/.cache/te2-release-build/{commit[:16]}"
    remote_context = f"{remote_root}/context"
    remote_source = f"{remote_root}/source"
    remote_work = f"{remote_root}/work"
    remote_output = f"{remote_root}/output"
    remote_cargo_home = f"{remote_home}/.cache/te2-release-build/cargo-home"
    remote_cargo_target = f"{remote_home}/.cache/te2-release-build/cargo-target"
    _ssh(host, "rm", "-rf", remote_root)
    _ssh(
        host,
        "mkdir",
        "-p",
        remote_context,
        remote_source,
        remote_work,
        remote_output,
        remote_cargo_home,
        remote_cargo_target,
    )
    for path in BUILDER_ROOT.iterdir():
        if path.is_file():
            _scp(path, host, f"{remote_context}/{path.name}")
    _scp(source_archive, host, f"{remote_root}/source.tar.gz")
    _ssh(
        host,
        "tar",
        "--extract",
        "--gzip",
        "--file",
        f"{remote_root}/source.tar.gz",
        "--directory",
        remote_source,
    )
    _ssh(host, engine, "build", "--tag", image, remote_context)
    remote_uid = int(_ssh_output(host, "id", "-u"))
    remote_gid = int(_ssh_output(host, "id", "-g"))
    remote_command = _container_run_command(
        engine=engine,
        image=image,
        source=Path(remote_source),
        work=Path(remote_work),
        output=Path(remote_output),
        cargo_home=Path(remote_cargo_home),
        cargo_target=Path(remote_cargo_target),
        commit=commit,
        release_tag=release_tag,
        source_date_epoch=source_date_epoch,
        keep_id=True,
        uid=remote_uid,
        gid=remote_gid,
    )
    _ssh(host, *remote_command)
    _ssh(
        host,
        "tar",
        "--create",
        "--gzip",
        "--file",
        f"{remote_root}/artifacts.tar.gz",
        "--directory",
        remote_output,
        ".",
    )
    local_archive = output.parent / f".{output.name}-remote-artifacts.tar.gz"
    _scp_from(host, f"{remote_root}/artifacts.tar.gz", local_archive)
    _extract_source_archive(local_archive, output)
    local_archive.unlink()
    _ssh(host, "rm", "-rf", remote_root)


def _ssh(host: str, *remote_command: str) -> None:
    command = " ".join(shlex.quote(part) for part in remote_command)
    subprocess.run(["ssh", "-o", "BatchMode=yes", host, command], check=True)


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


def _scratch_parent() -> Path:
    configured = os.environ.get("TMPDIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve() / "te2-release-wheel"
    return REPO_ROOT / ".codex-scratch" / "release-wheel"


def _require_empty_output(output: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"Release output must be empty: {output}")


def _check_free_space(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(path).free
    if free < MINIMUM_FREE_BYTES:
        raise SystemExit(
            "Linux wheel build stopped: at least 2 GiB of free disk space is required; "
            f"found {free} bytes near {path}"
        )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Linux release wheel build failed: {exc}", file=sys.stderr)
        raise SystemExit(exc.returncode) from exc
