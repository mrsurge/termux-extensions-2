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
import sys
import tempfile
import zipfile

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from app.release_runtime.code_te2 import MANIFEST, sha256, validate_runtime


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


def finalize_wheel(wheel: Path) -> None:
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
        os.replace(repaired, wheel)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", type=Path, nargs="?")
    parser.add_argument("--wheel", type=Path)
    args = parser.parse_args()
    if bool(args.payload) == bool(args.wheel):
        parser.error("supply exactly one payload or --wheel")
    if args.wheel:
        finalize_wheel(args.wheel)
    else:
        finalize(args.payload)


if __name__ == "__main__":
    main()
