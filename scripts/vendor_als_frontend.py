"""Snapshot ALS static resources for TE2's proxy-only native asset interception.

This is an explicit build/vendor operation, not an import-time dependency fetch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
from typing import TypeGuard, cast

REPO = Path(__file__).resolve().parents[1]
DESTINATION = REPO / "app/apps/als_rs/vendor/frontend"
STATIC_PATH = "rust/crates/als-server/src/static"
ADDITIONAL_RESOURCES = {
    "extensions/codex/ui/request_cards/codex_ext_request_card.js":
        "extensions/codex_ext/ui/request_cards/codex_ext_request_card.js",
}
EXCLUDED = {".map", ".bak", ".bak2", ".pyc"}
REQUIRED = ("dist/codex_agent.js", "codex_agent.css", "js/console_bridge.js",
            "vendor/socket.io/socket.io.min.js", "vendor/fonts/jetbrains-mono.css")


class VendorArguments(argparse.Namespace):
    source_repo: Path | None
    check: bool


def _record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) for key in cast(dict[object, object], value)
    )


def proxy_text(data: bytes, suffix: str) -> bytes:
    """Offline ALS projection of its existing proxy_shell rewrite declaration.

    Keep server-rendered pages dynamic. Static text must have the same quoted
    API/WS/static and CSS URL roots it would receive through proxy_shell.rs.
    """
    if suffix not in {".js", ".mjs", ".css", ".html", ".json"}:
        return data
    text = data.decode("utf-8")
    for root in ("/api/", "/ws/", "/static/"):
        pattern = r"(['\"`])/api/(?!app/)" if root == "/api/" else r"(['\"`])" + re.escape(root)
        text = re.sub(pattern, r"\g<1>/api/app/als-rs/proxy" + root, text)
    text = re.sub(r"url\(\s*(['\"]?)/static/", r"url(\g<1>/api/app/als-rs/proxy/static/", text)
    return text.encode("utf-8")


def inventory(root: Path) -> dict[str, dict[str, str | int]]:
    result: dict[str, dict[str, str | int]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlink is not a packaged ALS asset: {path}")
        if not path.is_file() or path.suffix in EXCLUDED or "node_modules" in path.parts or "__pycache__" in path.parts:
            continue
        data = path.read_bytes()
        result[path.relative_to(root).as_posix()] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    for name in REQUIRED:
        if name not in result:
            raise ValueError(f"Required ALS resource missing: {name}")
    return result


def check(root: Path = DESTINATION, *, require_approval: bool = True) -> dict[str, object]:
    if {path.name for path in root.iterdir()} != {"static", "manifest.json", "LICENSE"}:
        raise ValueError("Unknown content in ALS vendor snapshot; refusing replacement")
    value: object = json.loads((root / "manifest.json").read_text())
    if not _record(value):
        raise ValueError("Invalid ALS provenance object")
    manifest = value
    for path in (root / "static").rglob("*"):
        if path.is_file() and (path.suffix in EXCLUDED or "node_modules" in path.parts or "__pycache__" in path.parts):
            raise ValueError("Unknown excluded file in vendor snapshot; refusing replacement")
    files = inventory(root / "static")
    if require_approval and any(name not in files for name in ADDITIONAL_RESOURCES):
        raise ValueError("ALS approval request-card resource missing")
    if manifest.get("schema") != 1 or manifest.get("files") != files:
        raise ValueError("ALS vendored static inventory/hash mismatch")
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    if digest != manifest.get("tree_sha256"):
        raise ValueError("ALS vendored tree fingerprint mismatch")
    license_hash = hashlib.sha256((root / "LICENSE").read_bytes()).hexdigest()
    if license_hash != manifest.get("license_sha256"):
        raise ValueError("ALS license fingerprint mismatch")
    return manifest


def snapshot(source: Path, destination: Path = DESTINATION) -> dict[str, object]:
    source = source.resolve(strict=True)
    if destination.is_symlink():
        raise ValueError("Refusing to replace a symlinked vendor snapshot")
    if destination.exists():
        check(destination, require_approval=False)  # Validate the previous schema before upgrading.
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    clean = subprocess.run(["git", "-C", str(source), "diff", "HEAD", "--quiet", "--",
                            STATIC_PATH, *ADDITIONAL_RESOURCES.values(), "pyproject.toml", "LICENSE"], check=False)
    if clean.returncode:
        raise ValueError("ALS static/version/license source has tracked changes; checkpoint it first")
    raw_metadata = cast(object, tomllib.loads((source / "pyproject.toml").read_text()))
    if not _record(raw_metadata):
        raise ValueError("Invalid ALS package metadata")
    metadata = raw_metadata
    project: object = metadata.get("project")
    if not _record(project):
        raise ValueError("Missing ALS project metadata")
    version = project.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("Missing ALS release version")
    files = inventory(source / STATIC_PATH)
    for name, relative in ADDITIONAL_RESOURCES.items():
        path = source / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"ALS approval source must be a regular file: {relative}")
        data = path.read_bytes()
        files[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    tracked = set(subprocess.check_output(["git", "-C", str(source), "ls-files", "-z", "--",
                                          STATIC_PATH, *ADDITIONAL_RESOURCES.values()], text=True).split("\0"))
    if any(ADDITIONAL_RESOURCES.get(name, f"{STATIC_PATH}/{name}") not in tracked for name in files):
        raise ValueError("Uncommitted/untracked static resources cannot be pinned; checkpoint ALS first")
    license_path = source / "LICENSE"
    license_hash = hashlib.sha256(license_path.read_bytes()).hexdigest()
    manifest: dict[str, object] = {
        "schema": 1, "distribution": "agent-log-server", "version": version,
        "source_repository": "https://github.com/mrsurge/agent_log_server",
        "source_commit": commit, "source_static_path": STATIC_PATH,
        "excluded_suffixes": sorted(EXCLUDED), "license_sha256": license_hash,
        "tree_sha256": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
        "files": files,
    }
    proxy_value: object = json.loads((REPO / "app/apps/als_rs/manifest.json").read_text())
    if not _record(proxy_value):
        raise ValueError("Invalid ALS wrapper manifest")
    proxy = proxy_value.get("proxy_shell")
    if not _record(proxy):
        raise ValueError("Missing ALS proxy declaration")
    rewrite = proxy.get("rewrite")
    socketio = proxy.get("socketio")
    if not _record(rewrite) or not _record(socketio):
        raise ValueError("Invalid ALS rewrite/socket declaration")
    if (rewrite.get("absolute_root_paths") != ["/api/", "/ws/", "/static/"] or
            rewrite.get("css_root_paths") != ["/static/"] or socketio.get("inject_path")):
        raise ValueError("ALS proxy rewrite declaration changed; update/validate static projection first")
    manifest["source_files"] = files
    manifest["additional_source_files"] = ADDITIONAL_RESOURCES
    manifest["source_tree_sha256"] = manifest["tree_sha256"]
    manifest["proxy_prefix"] = "/api/app/als-rs/proxy"
    manifest["proxy_rewrite"] = rewrite
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".als-frontend-", dir=destination.parent) as temporary:
        stage = Path(temporary) / "frontend"
        for name in files:
            target = stage / "static" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            relative = ADDITIONAL_RESOURCES.get(name, f"{STATIC_PATH}/{name}")
            target.write_bytes(proxy_text((source / relative).read_bytes(), target.suffix))
        shutil.copyfile(license_path, stage / "LICENSE")
        manifest["files"] = inventory(stage / "static")
        manifest["tree_sha256"] = hashlib.sha256(json.dumps(manifest["files"], sort_keys=True).encode()).hexdigest()
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        check(stage)
        previous = Path(temporary) / "previous"
        if destination.exists():
            destination.rename(previous)
        try:
            stage.rename(destination)
        except BaseException:
            if previous.exists():
                previous.rename(destination)
            raise
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(namespace=VendorArguments())
    if args.check:
        manifest = check()
    elif args.source_repo:
        manifest = snapshot(args.source_repo)
    else:
        parser.error("Provide --source-repo for explicit vendoring, or --check")
    files = manifest["files"]
    if not isinstance(files, dict):
        raise ValueError("Invalid ALS file inventory")
    print(f"ALS {manifest['version']}: {len(files)} verified static resources")


if __name__ == "__main__":
    main()
