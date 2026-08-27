from __future__ import annotations

import argparse
import csv
import email
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tarfile
import tempfile
from typing import Final
from zipfile import ZipFile


ROOT: Final = Path(__file__).resolve().parents[2]
RELEASE_ROOT: Final = Path(__file__).resolve().parent
TARGET_PLATFORM: Final = "android_24_arm64_v8a"
TARGET_TRIPLE: Final = "aarch64-linux-android"
MINIMUM_FREE_BYTES: Final = 2 * 1024 * 1024 * 1024
FIRST_PARTY_REQUIRED_MEMBERS: Final = {
    "te2": (
        "app/cli/run_rust_framework.py",
        "te2/framework/bootstrap/bootstrap.py",
    ),
    "framework-shells": (
        "framework_shells/fws_pipe_pump.so",
        "framework_shells/bin/fws-terminal-stream-broker",
    ),
    "agent-log-server": (
        "agent_log_server_rs/bin/als-server",
        "agent_log_server_rs/bin/als-server.manifest.json",
        "agent_log_server_rs/rust/crates/als-server/src/static/dist/codex_agent.js",
        (
            "agent_log_server_rs/rust/crates/als-server/src/static/vendor/"
            "socket.io-msgpack-parser/socket.io-msgpack-parser.js"
        ),
    ),
}


def main() -> int:
    args = _parse_args()
    wheelhouse = Path(args.wheelhouse).expanduser().resolve()
    server = Path(args.server).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    _check_free_space(output_dir.parent)
    if not wheelhouse.is_dir():
        raise SystemExit(f"Wheelhouse does not exist: {wheelhouse}")
    if not server.is_file():
        raise SystemExit(f"TE2 server does not exist: {server}")
    _validate_aarch64_elf(server)

    locked = _load_lock(RELEASE_ROOT / "requirements.lock")
    expected = {
        **locked,
        "te2": args.version,
        "framework-shells": args.framework_shells_version,
        "agent-log-server": args.agent_log_server_version,
    }
    wheels = _audit_wheelhouse(wheelhouse, expected)
    dirty_first_party = _audit_first_party_provenance(wheels, args)
    source_date_epoch = int(args.source_date_epoch)
    archive_stem = f"te2-{args.version}-termux-aarch64"
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"{archive_stem}.tar.gz"
    if archive_path.exists():
        raise SystemExit(f"Refusing to overwrite release archive: {archive_path}")

    scratch_parent = _scratch_parent()
    scratch_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="te2-termux-release-", dir=scratch_parent) as raw:
        stage = Path(raw) / archive_stem
        wheel_target = stage / "wheelhouse"
        libexec = stage / "libexec"
        wheel_target.mkdir(parents=True)
        libexec.mkdir()
        for wheel in wheels:
            shutil.copy2(Path(str(wheel["sourcePath"])), wheel_target / str(wheel["filename"]))
        server_target = libexec / "te2-server"
        shutil.copy2(server, server_target)
        server_target.chmod(0o755)
        for name in ("install-te2", "install_te2.py", "requirements.lock"):
            source = (RELEASE_ROOT.parent / "installer" / name) if name != "requirements.lock" else RELEASE_ROOT / name
            target = stage / name
            shutil.copy2(source, target)
            if name == "install-te2":
                target.chmod(0o755)

        manifest = _manifest(args, wheels, server_target, dirty_first_party)
        (stage / "target-manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _write_checksums(stage)
        _validate_payload_tree(stage)
        _create_archive(stage, archive_path, source_date_epoch)

    digest = _sha256(archive_path)
    (output_dir / f"{archive_path.name}.sha256").write_text(
        f"{digest}  {archive_path.name}\n",
        encoding="utf-8",
    )
    print(json.dumps({"archive": str(archive_path), "sha256": digest}, sort_keys=True))
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build TE2's audited Termux AArch64 payload")
    parser.add_argument("--wheelhouse", required=True)
    parser.add_argument("--server", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--framework-shells-version", default="0.0.63")
    parser.add_argument("--agent-log-server-version", default="0.2.119")
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--framework-shells-commit", required=True)
    parser.add_argument("--agent-log-server-commit", required=True)
    parser.add_argument("--ferrous-framework-commit", required=True)
    parser.add_argument("--source-date-epoch", required=True)
    parser.add_argument(
        "--allow-dirty-first-party",
        action="store_true",
        help="Build an explicitly marked, publication-ineligible validation candidate",
    )
    return parser.parse_args()


def _load_lock(path: Path) -> dict[str, str]:
    locked: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "==" not in line:
            raise RuntimeError(f"Unpinned Termux requirement: {line}")
        name, version = line.split("==", 1)
        normalized = _canonical_name(name)
        if normalized in locked:
            raise RuntimeError(f"Duplicate Termux requirement: {normalized}")
        locked[normalized] = version
    return locked


def _audit_wheelhouse(wheelhouse: Path, expected: dict[str, str]) -> list[dict[str, object]]:
    found: dict[str, dict[str, object]] = {}
    for path in sorted(wheelhouse.glob("*.whl")):
        record = _audit_wheel(path)
        name = str(record["name"])
        if name in found:
            raise RuntimeError(f"Duplicate wheel distribution: {name}")
        found[name] = record
    missing = sorted(set(expected) - set(found))
    unexpected = sorted(set(found) - set(expected))
    mismatched = sorted(
        f"{name}: expected {expected[name]}, found {found[name]['version']}"
        for name in set(expected) & set(found)
        if expected[name] != found[name]["version"]
    )
    if missing or unexpected or mismatched:
        raise RuntimeError(
            "Invalid Termux wheelhouse: "
            f"missing={missing}, unexpected={unexpected}, mismatched={mismatched}"
        )
    for name, members in FIRST_PARTY_REQUIRED_MEMBERS.items():
        _require_wheel_members(Path(str(found[name]["sourcePath"])), members)
    return [found[name] for name in sorted(found)]


def _audit_wheel(path: Path) -> dict[str, object]:
    with ZipFile(path) as archive:
        names = archive.namelist()
        metadata_paths = [name for name in names if name.endswith(".dist-info/METADATA")]
        wheel_paths = [name for name in names if name.endswith(".dist-info/WHEEL")]
        record_paths = [name for name in names if name.endswith(".dist-info/RECORD")]
        if len(metadata_paths) != 1 or len(wheel_paths) != 1 or len(record_paths) != 1:
            raise RuntimeError(f"Malformed wheel metadata layout: {path.name}")
        metadata = email.message_from_bytes(archive.read(metadata_paths[0]))
        wheel_metadata = email.message_from_bytes(archive.read(wheel_paths[0]))
        raw_name = str(metadata.get("Name") or "")
        version = str(metadata.get("Version") or "")
        if not raw_name or not version:
            raise RuntimeError(f"Wheel lacks Name/Version metadata: {path.name}")
        tags = tuple(str(tag) for tag in wheel_metadata.get_all("Tag", []))
        if not tags:
            raise RuntimeError(f"Wheel lacks compatibility tags: {path.name}")
        for tag in tags:
            if tag.endswith("-any"):
                continue
            if not tag.endswith(f"-{TARGET_PLATFORM}"):
                raise RuntimeError(f"Wheel has an unsupported platform tag {tag}: {path.name}")
            if not (
                tag.startswith("cp314-cp314-")
                or tag.startswith("cp39-abi3-")
                or tag.startswith("py3-none-")
            ):
                raise RuntimeError(f"Wheel has an unsupported ABI tag {tag}: {path.name}")
        _verify_record(archive, record_paths[0])
    return {
        "filename": path.name,
        "name": _canonical_name(raw_name),
        "native": any(not tag.endswith("-any") for tag in tags),
        "sha256": _sha256(path),
        "size": path.stat().st_size,
        "sourcePath": str(path),
        "tags": list(tags),
        "version": version,
    }


def _verify_record(archive: ZipFile, record_path: str) -> None:
    rows = csv.reader(io.StringIO(archive.read(record_path).decode("utf-8")))
    recorded: set[str] = set()
    for row in rows:
        if len(row) != 3:
            raise RuntimeError(f"Malformed wheel RECORD row in {archive.filename}: {row}")
        name, digest, size = row
        recorded.add(name)
        if name == record_path:
            if digest or size:
                raise RuntimeError(f"Wheel RECORD hashes itself: {archive.filename}")
            continue
        payload = archive.read(name)
        if size != str(len(payload)):
            raise RuntimeError(f"Wheel RECORD size mismatch for {name}: {archive.filename}")
        if not digest.startswith("sha256="):
            raise RuntimeError(f"Wheel RECORD lacks SHA-256 for {name}: {archive.filename}")
        import base64

        actual = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).rstrip(b"=").decode()
        if digest != f"sha256={actual}":
            raise RuntimeError(f"Wheel RECORD digest mismatch for {name}: {archive.filename}")
    missing = {name for name in archive.namelist() if not name.endswith("/")} - recorded
    if missing:
        raise RuntimeError(f"Wheel RECORD omits members in {archive.filename}: {sorted(missing)[:5]}")


def _require_wheel_members(path: Path, required: tuple[str, ...]) -> None:
    with ZipFile(path) as archive:
        members = set(archive.namelist())
    missing = [
        member
        for member in required
        if not any(candidate == member or candidate.endswith(f"/{member}") for candidate in members)
    ]
    if missing:
        raise RuntimeError(f"{path.name} is missing release payloads: {missing}")


def _audit_first_party_provenance(
    wheels: list[dict[str, object]], args: argparse.Namespace
) -> list[str]:
    records = {str(wheel["name"]): wheel for wheel in wheels}
    als_wheel = Path(str(records["agent-log-server"]["sourcePath"]))
    manifest_name = "agent_log_server_rs/bin/als-server.manifest.json"
    with ZipFile(als_wheel) as archive:
        try:
            loaded = json.loads(archive.read(manifest_name))
        except (KeyError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"ALS-RS wheel has invalid release provenance: {als_wheel.name}") from exc
    if not isinstance(loaded, dict):
        raise RuntimeError(f"ALS-RS wheel provenance must be an object: {als_wheel.name}")
    expected = {
        "package_version": args.agent_log_server_version,
        "platform_tag": TARGET_PLATFORM,
        "source_commit": args.agent_log_server_commit,
        "target": TARGET_TRIPLE,
    }
    mismatched = {
        key: {"expected": value, "found": loaded.get(key)}
        for key, value in expected.items()
        if loaded.get(key) != value
    }
    if mismatched:
        raise RuntimeError(f"ALS-RS wheel provenance mismatch: {mismatched}")
    source_dirty = loaded.get("source_dirty")
    if not isinstance(source_dirty, bool):
        raise RuntimeError("ALS-RS wheel provenance has invalid source_dirty")
    dirty = ["agent-log-server"] if source_dirty else []
    if dirty and not bool(args.allow_dirty_first_party):
        raise RuntimeError(
            "Refusing to build a publishable Termux archive from dirty first-party inputs: "
            + ", ".join(dirty)
        )
    return dirty


def _manifest(
    args: argparse.Namespace,
    wheels: list[dict[str, object]],
    server: Path,
    dirty_first_party: list[str],
) -> dict[str, object]:
    clean_wheels = [{key: value for key, value in wheel.items() if key != "sourcePath"} for wheel in wheels]
    return {
        "aptPackages": [
            {
                "executables": [],
                "imports": [],
                "minimumVersion": "1.0.1",
                "name": "tur-repo",
                "role": "Code Server Node 24 dependency repository",
            },
            {
                "executables": ["python"],
                "imports": [],
                "libraries": ["lib/libpython3.14.so"],
                "minimumVersion": "3.14.6-1",
                "name": "python",
                "role": "target CPython 3.14 interpreter",
            },
            {
                "executables": ["git"],
                "imports": [],
                "name": "git",
                "role": "source acquisition and user project workflows",
            },
            {
                "executables": ["pip"],
                "imports": [],
                "minimumVersion": "26.2.1",
                "name": "python-pip",
                "role": "binary-only release-tree materialization",
            },
            {
                "executables": [],
                "imports": ["cryptography", "cffi", "pycparser"],
                "minimumVersion": "50.0.1",
                "name": "python-cryptography",
                "role": "Termux-owned crypto stack and its post-install Python inputs",
            },
            {
                "executables": ["node"],
                "imports": [],
                "majorVersion": 24,
                "minimumVersion": "24.18.0-1",
                "name": "nodejs-lts",
                "role": "WBA and Terminal Node runtime",
            },
            {
                "executables": ["npm"],
                "imports": [],
                "minimumVersion": "11.19.0",
                "name": "npm",
                "role": "Terminal first-use dependency bootstrap",
            },
            {
                "executables": ["cc", "c++", "make"],
                "imports": [],
                "minimumVersion": "4.1",
                "name": "build-essential",
                "role": "Terminal node-pty first-use native build",
            },
            {
                "executables": [],
                "imports": [],
                "libraries": ["lib/libarchive.so"],
                "minimumVersion": "3.8.9",
                "name": "libarchive",
                "role": "system libarchive runtime",
            },
            {
                "executables": [],
                "imports": [],
                "libraries": ["lib/libgit2.so"],
                "minimumVersion": "1.9.7",
                "name": "libgit2",
                "role": "TE2 and ALS-RS Git runtime",
            },
            {
                "executables": [],
                "imports": [],
                "libraries": ["lib/libssl.so.3", "lib/libcrypto.so.3"],
                "minimumVersion": "1:3.4.1",
                "name": "openssl",
                "role": "TE2 and ALS-RS TLS runtime",
            },
        ],
        "distribution": {
            "agentLogServerVersion": args.agent_log_server_version,
            "frameworkShellsVersion": args.framework_shells_version,
            "name": "te2",
            "version": args.version,
        },
        "releaseLocalWheels": clean_wheels,
        "releaseProvenance": {
            "dirtyFirstParty": dirty_first_party,
            "publicationEligible": not dirty_first_party,
        },
        "schemaVersion": 1,
        "server": {
            "architecture": "aarch64",
            "filename": "libexec/te2-server",
            "libc": "bionic",
            "sha256": _sha256(server),
            "size": server.stat().st_size,
            "target": TARGET_TRIPLE,
        },
        "sources": {
            "agentLogServerCommit": args.agent_log_server_commit,
            "ferrousFrameworkCommit": args.ferrous_framework_commit,
            "frameworkShellsCommit": args.framework_shells_commit,
            "te2Commit": args.source_commit,
        },
        "target": {
            "architecture": "aarch64",
            "environment": "termux",
            "minimumAndroidApi": 24,
            "operatingSystem": "android",
            "python": {"abi": "cp314", "implementation": "cpython", "majorMinor": "3.14"},
            "rustTarget": TARGET_TRIPLE,
            "wheelPlatform": TARGET_PLATFORM,
        },
    }


def _write_checksums(stage: Path) -> None:
    lines = []
    for path in sorted(candidate for candidate in stage.rglob("*") if candidate.is_file()):
        relative = path.relative_to(stage).as_posix()
        if relative == "SHA256SUMS":
            continue
        lines.append(f"{_sha256(path)}  {relative}")
    (stage / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _validate_payload_tree(stage: Path) -> None:
    inode_counts: dict[tuple[int, int], list[Path]] = {}
    for path in stage.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"Release payload contains a symbolic link: {path}")
        metadata = path.stat()
        if path.is_file():
            inode_counts.setdefault((metadata.st_dev, metadata.st_ino), []).append(path)
    hard_links = [paths for paths in inode_counts.values() if len(paths) > 1]
    if hard_links:
        raise RuntimeError(f"Release payload contains hard links: {hard_links}")


def _create_archive(stage: Path, destination: Path, source_date_epoch: int) -> None:
    raw_tar = destination.with_suffix("").with_suffix(".tar")
    try:
        with tarfile.open(raw_tar, "w", format=tarfile.PAX_FORMAT) as archive:
            _add_tar_member(archive, stage, stage.name, source_date_epoch)
            for path in sorted(stage.rglob("*"), key=lambda item: item.relative_to(stage).as_posix()):
                _add_tar_member(
                    archive,
                    path,
                    f"{stage.name}/{path.relative_to(stage).as_posix()}",
                    source_date_epoch,
                )
        with raw_tar.open("rb") as source, destination.open("wb") as target:
            with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=source_date_epoch) as compressed:
                shutil.copyfileobj(source, compressed)
    finally:
        raw_tar.unlink(missing_ok=True)


def _add_tar_member(archive: tarfile.TarFile, path: Path, arcname: str, epoch: int) -> None:
    info = archive.gettarinfo(str(path), arcname=arcname)
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = epoch
    if info.isdir():
        info.mode = 0o755
        archive.addfile(info)
        return
    mode = stat.S_IMODE(path.stat().st_mode)
    info.mode = 0o755 if mode & 0o111 else 0o644
    with path.open("rb") as handle:
        archive.addfile(info, handle)


def _validate_aarch64_elf(path: Path) -> None:
    header = path.read_bytes()[:64]
    if len(header) < 20 or header[:4] != b"\x7fELF":
        raise RuntimeError(f"Not an ELF binary: {path}")
    if header[4] != 2 or header[5] != 1:
        raise RuntimeError(f"TE2 server is not 64-bit little-endian ELF: {path}")
    machine = int.from_bytes(header[18:20], "little")
    if machine != 183:
        raise RuntimeError(f"TE2 server is not AArch64 ELF (machine={machine}): {path}")


def _check_free_space(parent: Path) -> None:
    parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(parent).free
    if free < MINIMUM_FREE_BYTES:
        raise SystemExit(f"Termux release build requires at least 2 GB free; found {free} bytes")


def _scratch_parent() -> Path:
    configured = os.environ.get("TMPDIR", "").strip()
    return Path(configured).expanduser() if configured else ROOT / ".codex-scratch"


def _canonical_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
