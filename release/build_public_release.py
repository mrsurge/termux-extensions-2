from __future__ import annotations

import argparse
from collections.abc import Mapping
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
from typing import Final, cast


ROOT: Final = Path(__file__).absolute().parents[1]
INSTALLER_ROOT: Final = ROOT / "release" / "installer"
VERSION_PATTERN: Final = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")


def main() -> int:
    args = _parse_args()
    version = _release_version(cast(str, args.version))
    source_commit = cast(str, args.source_commit).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise SystemExit(f"Invalid TE2 source commit: {source_commit!r}")
    current_commit = _git_output("rev-parse", "HEAD")
    if current_commit != source_commit:
        raise SystemExit(
            f"Release source commit does not match HEAD: expected={source_commit}, actual={current_commit}"
        )
    source_dirty = bool(_git_output("status", "--porcelain", "--untracked-files=no"))
    if source_dirty and not cast(bool, args.allow_dirty_source):
        raise SystemExit(
            "Refusing to assemble a public release from dirty tracked source; "
            + "use --allow-dirty-source only for an unpublished validation candidate"
        )

    output = Path(cast(str, args.output)).expanduser().absolute()
    _require_empty_output(output)
    termux_archive = Path(cast(str, args.termux_archive)).expanduser().absolute()
    termux_manifest = _read_termux_manifest(termux_archive)
    _validate_termux_manifest(
        termux_manifest,
        version=version,
        source_commit=source_commit,
        allow_ineligible=cast(bool, args.allow_ineligible_termux),
    )

    output.mkdir(parents=True)
    assets: dict[str, dict[str, object]] = {}
    _publish_asset(
        INSTALLER_ROOT / "install-te2",
        output,
        assets,
        role="bootstrap",
        executable=True,
    )
    _publish_asset(
        INSTALLER_ROOT / "install_te2.py",
        output,
        assets,
        role="installer",
    )
    _publish_asset(
        termux_archive,
        output,
        assets,
        role="termux-archive",
        target="termux-android-aarch64",
    )
    for raw in cast(list[str], args.asset):
        _publish_asset(
            Path(raw).expanduser().absolute(),
            output,
            assets,
            role="release-asset",
        )

    distribution = _mapping(termux_manifest.get("distribution"), "distribution")
    publication_eligible = not source_dirty and bool(
        _mapping(termux_manifest.get("releaseProvenance"), "releaseProvenance").get(
            "publicationEligible"
        )
    )
    tag_arg = cast(str | None, args.tag)
    manifest = {
        "assets": assets,
        "components": {
            "agentLogServerVersion": str(distribution["agentLogServerVersion"]),
            "frameworkShellsVersion": str(distribution["frameworkShellsVersion"]),
        },
        "release": {
            "publicationEligible": publication_eligible,
            "sourceCommit": source_commit,
            "tag": tag_arg or version,
            "version": version,
        },
        "schemaVersion": 1,
        "targets": {
            "linux-glibc-x86_64": {
                "distribution": {"name": "te2", "version": version},
                "installer": "install_te2.py",
            },
            "termux-android-aarch64": {
                "archive": termux_archive.name,
                "installer": "install_te2.py",
            },
        },
    }
    manifest_path = output / "release-manifest.json"
    _ = manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _write_checksums(output)
    print(
        json.dumps(
            {
                "assetCount": len(assets),
                "output": str(output),
                "publicationEligible": publication_eligible,
                "version": version,
            },
            sort_keys=True,
        )
    )
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Assemble TE2's public GitHub release manifest and checksums"
    )
    _ = parser.add_argument("--output", required=True)
    _ = parser.add_argument("--version", required=True)
    _ = parser.add_argument("--tag")
    _ = parser.add_argument("--source-commit", required=True)
    _ = parser.add_argument("--termux-archive", required=True)
    _ = parser.add_argument(
        "--asset",
        action="append",
        default=[],
        help="Additional immutable release asset; repeat for wheels, sdists, and APKs",
    )
    _ = parser.add_argument(
        "--allow-dirty-source",
        action="store_true",
        help="Build an explicitly publication-ineligible local validation candidate",
    )
    _ = parser.add_argument(
        "--allow-ineligible-termux",
        action="store_true",
        help="Accept a publication-ineligible Termux archive for local validation only",
    )
    return parser.parse_args()


def _git_output(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def _release_version(value: str) -> str:
    if VERSION_PATTERN.fullmatch(value) is None:
        raise SystemExit(f"Invalid TE2 release version: {value!r}")
    return value


def _require_empty_output(output: Path) -> None:
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise SystemExit(f"Public release output must be an empty directory: {output}")


def _read_termux_manifest(archive_path: Path) -> dict[str, object]:
    if not archive_path.is_file():
        raise SystemExit(f"Termux release archive is missing: {archive_path}")
    with tarfile.open(archive_path, "r:gz") as archive:
        matches = [
            member
            for member in archive.getmembers()
            if member.isfile() and member.name.endswith("/target-manifest.json")
        ]
        if len(matches) != 1:
            raise SystemExit(
                f"Expected one target-manifest.json in Termux archive, found {len(matches)}"
            )
        handle = archive.extractfile(matches[0])
        if handle is None:
            raise SystemExit("Unable to read Termux target manifest")
        try:
            loaded = cast(object, json.load(handle))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Malformed Termux target manifest: {exc}") from exc
    if not isinstance(loaded, dict):
        raise SystemExit("Termux target manifest must be an object")
    return cast(dict[str, object], loaded)


def _validate_termux_manifest(
    manifest: Mapping[str, object],
    *,
    version: str,
    source_commit: str,
    allow_ineligible: bool,
) -> None:
    if manifest.get("schemaVersion") != 1:
        raise SystemExit("Unsupported Termux target manifest")
    distribution = _mapping(manifest.get("distribution"), "distribution")
    if distribution.get("version") != version:
        raise SystemExit(
            "Termux archive version does not match public release: "
            + f"archive={distribution.get('version')}, release={version}"
        )
    sources = _mapping(manifest.get("sources"), "sources")
    if sources.get("te2Commit") != source_commit:
        raise SystemExit("Termux archive TE2 commit does not match public release source")
    provenance = _mapping(manifest.get("releaseProvenance"), "releaseProvenance")
    if provenance.get("publicationEligible") is not True and not allow_ineligible:
        raise SystemExit("Termux archive is not publication eligible")


def _publish_asset(
    source: Path,
    output: Path,
    assets: dict[str, dict[str, object]],
    *,
    role: str,
    target: str | None = None,
    executable: bool = False,
) -> None:
    if not source.is_file():
        raise SystemExit(f"Release asset is missing: {source}")
    if source.name in assets:
        raise SystemExit(f"Duplicate release asset filename: {source.name}")
    destination = output / source.name
    _ = shutil.copy2(source, destination)
    if executable:
        destination.chmod(0o755)
    record: dict[str, object] = {
        "filename": destination.name,
        "role": role,
        "sha256": _sha256(destination),
        "size": destination.stat().st_size,
    }
    if target:
        record["target"] = target
    assets[destination.name] = record


def _write_checksums(output: Path) -> None:
    lines = [
        f"{_sha256(path)}  {path.name}"
        for path in sorted(output.iterdir(), key=lambda candidate: candidate.name)
        if path.is_file() and path.name != "SHA256SUMS"
    ]
    _ = (output / "SHA256SUMS").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _mapping(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise SystemExit(f"Manifest {name} must be an object")
    return cast(Mapping[str, object], value)


if __name__ == "__main__":
    raise SystemExit(main())
