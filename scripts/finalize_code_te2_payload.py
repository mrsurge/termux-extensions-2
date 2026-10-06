"""Refresh native payload digests after controlled ELF repair (build tooling only)."""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import zipfile

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from app.release_runtime.code_te2 import MANIFEST, sha256, validate_runtime
from app.release_runtime.package_policy import development_asset, validate_wheel_size


def finalize(root: Path) -> None:
    manifest_path = root / MANIFEST
    manifest = json.loads(manifest_path.read_text())
    paths = sorted(root.rglob("*"))
    if any(path.is_symlink() for path in paths):
        raise RuntimeError("cannot finalize payload symlinks")
    manifest["files"] = {path.relative_to(root).as_posix(): sha256(path)
                         for path in paths if path.is_file() and path != manifest_path}
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    validate_runtime(root)


def finalize_wheel(wheel: Path, *, trim_development: bool = False) -> None:
    with tempfile.TemporaryDirectory(prefix=".code-te2-repair-", dir=wheel.parent) as temporary:
        stage = Path(temporary)
        extracted = stage / "extracted"
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise RuntimeError("wheel has duplicate members")
            if any(name.endswith(("/RECORD.jws", "/RECORD.p7s")) for name in names):
                raise RuntimeError("cannot rewrite a signed wheel")
            records = [name for name in names
                       if len(Path(name).parts) == 2 and name.endswith('.dist-info/RECORD')]
            if len(records) != 1:
                raise RuntimeError("wheel must have one RECORD")
            for info in archive.infolist():
                path = Path(info.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
                    raise RuntimeError("unsafe wheel member")
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise RuntimeError("wheel symlink cannot be finalized")
                archive.extract(info, extracted)
                if not info.is_dir():
                    (extracted / path).chmod(mode & 0o777 or 0o644)
        root = extracted / "app/release_runtime/code_te2"
        if trim_development:
            for path in extracted.rglob("*"):
                if path.is_file() and development_asset(path):
                    path.unlink()
            alias = root / "python/lib/libpython3.14.so"
            library = root / "python/lib/libpython3.14.so.1.0"
            if alias.exists():
                if not library.is_file() or sha256(alias) != sha256(library):
                    raise RuntimeError("private libpython aliases differ")
                # Never remove an alias actually used by an ELF consumer.
                for path in extracted.rglob("*"):
                    if not path.is_file():
                        continue
                    with path.open("rb") as handle:
                        elf = handle.read(4) == b"\x7fELF"
                    if elf:
                        dynamic = subprocess.run(["readelf", "--dynamic", str(path)],
                                                 check=True, capture_output=True, text=True)
                        if "Shared library: [libpython3.14.so]" in dynamic.stdout:
                            raise RuntimeError(f"ELF requires unversioned libpython: {path}")
                alias.unlink()
        manifest_path = root / MANIFEST
        manifest = json.loads(manifest_path.read_text())
        manifest['wheelLibraries'] = {path.relative_to(extracted).as_posix(): sha256(path)
            for path in sorted((extracted / 'te2.libs').rglob('*')) if path.is_file()}
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        finalize(root)
        repaired = stage / wheel.name
        rows: list[tuple[str, str, str]] = []
        with zipfile.ZipFile(repaired, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(extracted.rglob("*")):
                relative = path.relative_to(extracted).as_posix()
                if path.is_file() and relative != records[0]:
                    archive.write(path, relative)
                    digest = base64.urlsafe_b64encode(bytes.fromhex(sha256(path))).rstrip(b'=').decode()
                    rows.append((relative, f'sha256={digest}', str(path.stat().st_size)))
            rows.append((records[0], '', ''))
            record = io.StringIO(newline='')
            csv.writer(record, lineterminator='\n').writerows(rows)
            archive.writestr(records[0], record.getvalue())
        validate_wheel_size(repaired)
        os.replace(repaired, wheel)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", type=Path, nargs="?")
    parser.add_argument("--wheel", type=Path)
    parser.add_argument("--trim-development", action="store_true",
                        help="Trim release-only assets and identical libpython linker alias")
    args = parser.parse_args()
    if bool(args.payload) == bool(args.wheel):
        parser.error("supply exactly one payload or --wheel")
    if args.trim_development and not args.wheel:
        parser.error("--trim-development requires --wheel")
    if args.wheel:
        finalize_wheel(args.wheel, trim_development=args.trim_development)
    else:
        finalize(args.payload)


if __name__ == "__main__":
    main()
