from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path
from typing import Final, cast


SERVER_MEMBER: Final = "app/release_runtime/bin/te2-server"
PROVENANCE_MEMBER: Final = "app/release_runtime/provenance.json"
FORBIDDEN_MEMBER_PARTS: Final = (
    "/framework/rust/target/",
    "/desktop_client/electron/build/",
    "/desktop_client/electron/dist/",
)
ALLOWED_NODE_MODULES_PREFIXES: Final = (
    "app/apps/code_te2/vendor/node_socketio/node_modules/",
)


def main() -> int:
    args = _parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    wheel = Path(args.wheel).resolve()
    sdist = Path(args.sdist).resolve()
    server = Path(args.server).resolve()
    minimum_glibc = _numeric_version(args.minimum_glibc)

    wheel_manifest = _validate_wheel(
        wheel,
        server=server,
        commit=args.commit,
        release_tag=args.release_tag,
        platform_tag=args.platform_tag,
        minimum_glibc=args.minimum_glibc,
    )
    _validate_sdist(sdist)
    maximum_glibc = _maximum_glibc_reference(server)
    if maximum_glibc > minimum_glibc:
        raise RuntimeError(
            f"server references GLIBC {_format_version(maximum_glibc)}, "
            f"above declared {_format_version(minimum_glibc)}"
        )

    auditwheel_report = Path(args.auditwheel_report).read_text(encoding="utf-8")
    if args.platform_tag not in auditwheel_report:
        raise RuntimeError(
            f"auditwheel did not affirm the requested platform tag {args.platform_tag}"
        )
    ldd_report = Path(args.ldd_report).read_text(encoding="utf-8")
    if "not found" in ldd_report:
        raise RuntimeError("server has an unresolved shared-library dependency")

    final_wheel = output / wheel.name
    final_sdist = output / sdist.name
    shutil.copy2(wheel, final_wheel)
    shutil.copy2(sdist, final_sdist)
    (output / "auditwheel-show.txt").write_text(auditwheel_report, encoding="utf-8")
    (output / "server-ldd.txt").write_text(ldd_report, encoding="utf-8")

    metadata = {
        "builderImage": args.builder_image,
        "commit": args.commit,
        "maximumReferencedGlibc": _format_version(maximum_glibc),
        "minimumGlibc": args.minimum_glibc,
        "packageVersion": wheel_manifest["packageVersion"],
        "platformTag": args.platform_tag,
        "releaseTag": args.release_tag,
        "schemaVersion": 1,
        "sdist": {
            "filename": final_sdist.name,
            "sha256": _sha256_file(final_sdist),
            "size": final_sdist.stat().st_size,
        },
        "serverSha256": wheel_manifest["serverSha256"],
        "sourceDateEpoch": int(args.source_date_epoch),
        "wheel": {
            "filename": final_wheel.name,
            "sha256": _sha256_file(final_wheel),
            "size": final_wheel.stat().st_size,
        },
    }
    (output / "build-metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", required=True)
    parser.add_argument("--sdist", required=True)
    parser.add_argument("--server", required=True)
    parser.add_argument("--auditwheel-report", required=True)
    parser.add_argument("--ldd-report", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--platform-tag", required=True)
    parser.add_argument("--minimum-glibc", required=True)
    parser.add_argument("--source-date-epoch", required=True)
    parser.add_argument("--builder-image", required=True)
    return parser.parse_args()


def _validate_wheel(
    wheel: Path,
    *,
    server: Path,
    commit: str,
    release_tag: str,
    platform_tag: str,
    minimum_glibc: str,
) -> dict[str, object]:
    if not wheel.name.endswith(f"-{platform_tag}.whl"):
        raise RuntimeError(f"wheel filename has the wrong platform tag: {wheel.name}")
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        server_member = _unique_suffix(names, SERVER_MEMBER)
        provenance_member = _unique_suffix(names, PROVENANCE_MEMBER)
        for name in names:
            normalized = "/" + name.strip("/") + "/"
            if any(part in normalized for part in FORBIDDEN_MEMBER_PARTS):
                raise RuntimeError(f"wheel contains forbidden build intermediate: {name}")
            if "/node_modules/" in normalized and not any(
                name.startswith(prefix) for prefix in ALLOWED_NODE_MODULES_PREFIXES
            ):
                raise RuntimeError(f"wheel contains forbidden node_modules tree: {name}")
        server_payload = archive.read(server_member)
        manifest_value = cast(object, json.loads(archive.read(provenance_member)))
        if not isinstance(manifest_value, dict):
            raise RuntimeError("wheel provenance is not a JSON object")
        manifest = cast(dict[str, object], manifest_value)
        expected = {
            "architecture": "x86_64",
            "commit": commit,
            "distributionMode": "binary-release",
            "libc": "glibc",
            "minimumGlibc": minimum_glibc,
            "platform": "linux",
            "platformTag": platform_tag,
            "releaseTag": release_tag,
            "schemaVersion": 1,
            "serverRelativePath": "bin/te2-server",
        }
        for field, expected_value in expected.items():
            if manifest.get(field) != expected_value:
                raise RuntimeError(
                    f"wheel provenance field {field} is {manifest.get(field)!r}, "
                    f"expected {expected_value!r}"
                )
        digest = hashlib.sha256(server_payload).hexdigest()
        if manifest.get("serverSha256") != digest:
            raise RuntimeError("wheel server digest does not match provenance")
        if digest != _sha256_file(server):
            raise RuntimeError("auditwheel changed the packaged server executable")
        mode = archive.getinfo(server_member).external_attr >> 16
        if mode & 0o111 == 0:
            raise RuntimeError("packaged server is not executable in the wheel")
        return manifest


def _validate_sdist(sdist: Path) -> None:
    with tarfile.open(sdist, mode="r:gz") as archive:
        names = archive.getnames()
        provenance_member = _unique_suffix(names, PROVENANCE_MEMBER)
        if any(name.endswith(SERVER_MEMBER) for name in names):
            raise RuntimeError("source distribution contains the release server")
        extracted = archive.extractfile(provenance_member)
        if extracted is None:
            raise RuntimeError("source distribution provenance cannot be read")
        manifest = json.load(extracted)
        if manifest != {"distributionMode": "source-build", "schemaVersion": 1}:
            raise RuntimeError("source distribution provenance is not source-build")


def _maximum_glibc_reference(server: Path) -> tuple[int, ...]:
    result = subprocess.run(
        ["readelf", "--version-info", str(server)],
        check=True,
        capture_output=True,
        text=True,
    )
    versions = {
        (int(major), int(minor))
        for major, minor in re.findall(r"GLIBC_([0-9]+)\.([0-9]+)", result.stdout)
    }
    if not versions:
        raise RuntimeError("server does not expose any auditable GLIBC symbol versions")
    return max(versions)


def _unique_suffix(names: list[str], suffix: str) -> str:
    matches = [name for name in names if name.endswith(suffix)]
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one archive member ending in {suffix}: {matches}")
    return matches[0]


def _numeric_version(value: str) -> tuple[int, ...]:
    parts = value.split(".")
    if not parts or any(not part.isdigit() for part in parts):
        raise RuntimeError(f"invalid numeric version: {value!r}")
    return tuple(int(part) for part in parts)


def _format_version(value: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
