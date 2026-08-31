from __future__ import annotations

from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys
from typing import Final, Mapping
import uuid

import app as app_package

from app.node_toolchain import (
    NodeToolchainError,
    inspect_node_identity,
    node_toolchain_env,
    resolve_node_toolchain,
)
from app.te2_paths import te2_cache_home, te2_data_home


SOURCE_ROOT: Final = Path(__file__).resolve().parent
ELECTRON_SOURCE: Final = SOURCE_ROOT / "electron"
ANDROID_SHELL_SOURCE: Final = SOURCE_ROOT / "android_shell"
DESKTOP_ASSET_INVENTORY: Final = SOURCE_ROOT / "desktop_asset_inventory.json"
COMPONENT_RUNTIME_SOURCE: Final = (
    SOURCE_ROOT.parent
    / "app"
    / "apps"
    / "code_te2"
    / "main_page"
    / "frontend"
    / "ui"
    / "component-runtime"
)
SHARED_DIALOG_SOURCES: Final = (
    SOURCE_ROOT.parent / "app" / "static" / "js" / "te_dialog.mjs",
    SOURCE_ROOT.parent / "app" / "static" / "js" / "te_modal_surface_portal.mjs",
)
PACKAGE_JSON: Final = ELECTRON_SOURCE / "package.json"
PACKAGE_LOCK: Final = ELECTRON_SOURCE / "package-lock.json"
BOOTSTRAP_VERSION: Final = "te2-electron-source-v1"
MINIMUM_NODE_VERSION: Final = (22, 12, 0)
MINIMUM_FREE_BYTES: Final = 3 * 1024 * 1024 * 1024
RUNTIME_MARKER: Final = ".te2-electron-runtime.json"
INTEGRATION_RECEIPT: Final = "integration-receipt.json"
ELECTRON_ROOT_INPUTS: Final = (
    "build.mjs",
    "package-lock.json",
    "package.json",
    "package.mjs",
    "tsconfig.json",
)
ELECTRON_SOURCE_SUFFIXES: Final = frozenset({".css", ".html", ".ts", ".tsx"})
DESKTOP_SHELL_SUFFIXES: Final = frozenset(
    {".css", ".html", ".ico", ".js", ".json", ".png", ".svg", ".webp", ".woff2"}
)


class ElectronRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ElectronRuntime:
    root: Path
    executable: Path
    launcher: Path
    fingerprint: str
    version: str
    identity: dict[str, str]


@dataclass(frozen=True)
class DesktopIntegration:
    wrapper: Path
    desktop_entry: Path
    icon: Path
    receipt: Path


def desktop_runtime_base(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> Path:
    return te2_data_home(environ, home=home) / "desktop" / "electron"


def desktop_build_cache_base(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> Path:
    return te2_cache_home(environ, home=home) / "desktop" / "electron"


def desktop_integration_paths(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> DesktopIntegration:
    source = environ if environ is not None else os.environ
    resolved_home = _user_home(source, home)
    bin_override = str(source.get("TE2_DESKTOP_BIN_DIR") or "").strip()
    bin_dir = (
        _absolute_path(bin_override, "TE2_DESKTOP_BIN_DIR")
        if bin_override
        else resolved_home / ".local" / "bin"
    )
    xdg_data_raw = str(source.get("XDG_DATA_HOME") or "").strip()
    xdg_data = (
        _absolute_path(xdg_data_raw, "XDG_DATA_HOME")
        if xdg_data_raw
        else resolved_home / ".local" / "share"
    )
    runtime_base = desktop_runtime_base(source, home=resolved_home)
    return DesktopIntegration(
        wrapper=bin_dir / "te2-desktop",
        desktop_entry=xdg_data / "applications" / "te2-desktop.desktop",
        icon=xdg_data / "icons" / "hicolor" / "512x512" / "apps" / "te2.png",
        receipt=runtime_base / INTEGRATION_RECEIPT,
    )


def _user_home(environ: Mapping[str, str], override: Path | None) -> Path:
    if override is not None:
        resolved = override
    else:
        raw = str(environ.get("HOME") or "").strip()
        resolved = Path(raw).expanduser() if raw else Path.home()
    if not resolved.is_absolute():
        raise ElectronRuntimeError(f"HOME must be absolute: {resolved}")
    return resolved


def _absolute_path(raw: str, key: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ElectronRuntimeError(f"{key} must be absolute: {raw!r}")
    return path


def _package_metadata() -> dict[str, object]:
    try:
        raw = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ElectronRuntimeError(f"Electron package metadata is unavailable: {exc}") from exc
    if not isinstance(raw, dict):
        raise ElectronRuntimeError("Electron package metadata must be a JSON object")
    return raw


def _electron_version() -> str:
    version = str(_package_metadata().get("version") or "").strip()
    if not version:
        raise ElectronRuntimeError("Electron package metadata has no version")
    return version


def _iter_source_files() -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    if not ELECTRON_SOURCE.is_dir():
        raise ElectronRuntimeError(f"Packaged desktop source is missing: {ELECTRON_SOURCE}")
    for relative_name in ELECTRON_ROOT_INPUTS:
        path = ELECTRON_SOURCE / relative_name
        if not path.is_file():
            raise ElectronRuntimeError(f"Packaged desktop source is missing: {path}")
        files.append((f"electron/{relative_name}", path))
    electron_src = ELECTRON_SOURCE / "src"
    for path in electron_src.rglob("*"):
        if (
            not path.is_file()
            or path.name.endswith(".test.ts")
            or path.suffix not in ELECTRON_SOURCE_SUFFIXES
        ):
            continue
        relative = path.relative_to(ELECTRON_SOURCE)
        files.append((f"electron/{relative.as_posix()}", path))

    if not ANDROID_SHELL_SOURCE.is_dir():
        raise ElectronRuntimeError(
            f"Packaged desktop source is missing: {ANDROID_SHELL_SOURCE}"
        )
    for path in ANDROID_SHELL_SOURCE.rglob("*"):
        if not path.is_file() or path.suffix not in DESKTOP_SHELL_SUFFIXES:
            continue
        relative = path.relative_to(ANDROID_SHELL_SOURCE)
        files.append((f"android_shell/{relative.as_posix()}", path))

    if not COMPONENT_RUNTIME_SOURCE.is_dir():
        raise ElectronRuntimeError(
            f"Packaged desktop source is missing: {COMPONENT_RUNTIME_SOURCE}"
        )
    component_prefix = (
        "app/apps/code_te2/main_page/frontend/ui/component-runtime"
    )
    for path in COMPONENT_RUNTIME_SOURCE.rglob("*.ts"):
        if not path.is_file() or path.name.endswith(".test.ts"):
            continue
        relative = path.relative_to(COMPONENT_RUNTIME_SOURCE)
        files.append((f"{component_prefix}/{relative.as_posix()}", path))
    for path in SHARED_DIALOG_SOURCES:
        if not path.is_file():
            raise ElectronRuntimeError(f"Packaged desktop source is missing: {path}")
        files.append((f"app/static/js/{path.name}", path))
    if not DESKTOP_ASSET_INVENTORY.is_file():
        raise ElectronRuntimeError(
            f"Packaged desktop source is missing: {DESKTOP_ASSET_INVENTORY}"
        )
    files.append(("desktop_asset_inventory.json", DESKTOP_ASSET_INVENTORY))
    files.sort(key=lambda item: item[0])
    required = {
        "electron/package.json",
        "electron/package-lock.json",
        "electron/build.mjs",
        "electron/package.mjs",
        "electron/src/main/index.ts",
        "android_shell/index.html",
        "desktop_asset_inventory.json",
        "app/apps/code_te2/main_page/frontend/ui/component-runtime/index.ts",
        "app/static/js/te_dialog.mjs",
        "app/static/js/te_modal_surface_portal.mjs",
    }
    missing = required.difference(name for name, _path in files)
    if missing:
        raise ElectronRuntimeError(
            f"Packaged desktop source is incomplete: {', '.join(sorted(missing))}"
        )
    return files


def _source_digest() -> str:
    hasher = hashlib.sha256()
    for name, path in _iter_source_files():
        hasher.update(name.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return hasher.hexdigest()


def _parse_node_version(raw: str) -> tuple[int, int, int]:
    pieces = raw.split(".")
    if len(pieces) < 3:
        raise ElectronRuntimeError(f"Node.js returned an invalid version: {raw!r}")
    try:
        return int(pieces[0]), int(pieces[1]), int(pieces[2].split("-")[0])
    except ValueError as exc:
        raise ElectronRuntimeError(f"Node.js returned an invalid version: {raw!r}") from exc


def _host_libc_name() -> str:
    return str(platform.libc_ver()[0] or "").strip().lower()


def _validate_identity(identity: dict[str, str]) -> None:
    if identity.get("platform") != "linux" or identity.get("arch") != "x64":
        raise ElectronRuntimeError(
            "The Electron source bootstrap currently supports only Linux x86-64; "
            f"Node reported {identity.get('platform')}/{identity.get('arch')}"
        )
    if _parse_node_version(identity.get("node", "")) < MINIMUM_NODE_VERSION:
        required = ".".join(str(value) for value in MINIMUM_NODE_VERSION)
        raise ElectronRuntimeError(
            f"Node.js {required} or newer is required; found {identity.get('node') or 'unknown'}"
        )
    libc_name = _host_libc_name()
    if libc_name not in {"glibc", "gnu libc"}:
        raise ElectronRuntimeError(
            "The Electron source bootstrap requires a glibc Linux host; "
            f"detected {libc_name or 'unknown libc'}"
        )


def _fingerprint(identity: dict[str, str], source_digest: str) -> str:
    payload = json.dumps(
        {
            "bootstrap": BOOTSTRAP_VERSION,
            "identity": identity,
            "sourceDigest": source_digest,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    suffix = hashlib.sha256(payload).hexdigest()[:20]
    return f"linux-x64-node{identity['node']}-{suffix}"


def _marker_payload(
    *,
    fingerprint: str,
    identity: dict[str, str],
    source_digest: str,
    version: str,
) -> dict[str, object]:
    return {
        "bootstrap": BOOTSTRAP_VERSION,
        "fingerprint": fingerprint,
        "identity": identity,
        "sourceDigest": source_digest,
        "version": version,
    }


def _runtime_is_ready(root: Path, expected: dict[str, object] | None = None) -> bool:
    try:
        marker = json.loads((root / RUNTIME_MARKER).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(marker, dict) or (expected is not None and marker != expected):
        return False
    executable = root / "TE2Desktop-bin"
    launcher = root / "TE2Desktop"
    app_archive = root / "resources" / "app.asar"
    return (
        executable.is_file()
        and os.access(executable, os.X_OK)
        and launcher.is_file()
        and os.access(launcher, os.X_OK)
        and app_archive.is_file()
    )


def _current_runtime_root(base: Path) -> Path | None:
    current = base / "current"
    if not current.is_symlink():
        return None
    try:
        root = current.resolve(strict=True)
        runtimes = (base / "runtimes").resolve(strict=True)
        root.relative_to(runtimes)
    except (OSError, ValueError):
        return None
    return root if _runtime_is_ready(root) else None


def current_desktop_runtime(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> ElectronRuntime | None:
    base = desktop_runtime_base(environ, home=home)
    root = _current_runtime_root(base)
    if root is None:
        return None
    try:
        marker = json.loads((root / RUNTIME_MARKER).read_text(encoding="utf-8"))
        identity_raw = marker["identity"]
        if not isinstance(identity_raw, dict):
            return None
        identity = {str(key): str(value) for key, value in identity_raw.items()}
        return ElectronRuntime(
            root=root,
            executable=root / "TE2Desktop-bin",
            launcher=root / "TE2Desktop",
            fingerprint=str(marker["fingerprint"]),
            version=str(marker["version"]),
            identity=identity,
        )
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def _check_free_space(path: Path) -> None:
    free = _free_bytes(path)
    if free < MINIMUM_FREE_BYTES:
        gib = free / (1024 * 1024 * 1024)
        raise ElectronRuntimeError(
            "Electron build stopped: at least 3 GiB of free disk space is required; "
            f"{gib:.2f} GiB is available at {path}"
        )


def _toolchain_env(
    node_binary: Path,
    cache_base: Path,
    environ: Mapping[str, str] | None,
) -> dict[str, str]:
    env = node_toolchain_env(node_binary, environ=environ)
    npm_cache = cache_base / "npm"
    electron_cache = cache_base / "downloads"
    npm_cache.mkdir(parents=True, exist_ok=True)
    electron_cache.mkdir(parents=True, exist_ok=True)
    env["npm_config_cache"] = str(npm_cache)
    env["electron_config_cache"] = str(electron_cache)
    env["ELECTRON_CACHE"] = str(electron_cache)
    return env


def _run_checked(
    command: list[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    label: str,
    timeout: int = 1800,
) -> None:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=dict(env),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ElectronRuntimeError(f"{label} failed: {exc}") from exc
    if result.returncode == 0:
        return
    lines = result.stdout.strip().splitlines()
    detail = "\n".join(lines[-80:]) or f"exit status {result.returncode}"
    raise ElectronRuntimeError(f"{label} failed:\n{detail}")


def _copy_packaged_source(workspace: Path) -> Path:
    for relative_name, source in _iter_source_files():
        if relative_name.startswith("app/"):
            target = workspace / relative_name
        else:
            target = workspace / "desktop_client" / relative_name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return workspace / "desktop_client" / "electron"


def _build_runtime(
    *,
    node_binary: Path,
    npm_binary: Path,
    target_stage: Path,
    cache_base: Path,
    environ: Mapping[str, str] | None,
) -> None:
    workspace = cache_base / f".source.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        electron_root = _copy_packaged_source(workspace)
        env = _toolchain_env(node_binary, cache_base, environ)
        _run_checked(
            [str(npm_binary), "ci", "--no-audit", "--no-fund"],
            cwd=electron_root,
            env=env,
            label="Electron dependency installation",
        )
        _run_checked(
            [str(node_binary), "build.mjs"],
            cwd=electron_root,
            env=env,
            label="Electron source compilation",
        )
        _run_checked(
            [str(node_binary), "package.mjs"],
            cwd=electron_root,
            env=env,
            label="Electron application packaging",
        )
        output = electron_root / "build" / "TE2Desktop-linux-x64"
        if not output.is_dir():
            raise ElectronRuntimeError(
                f"Electron packager did not create the expected application: {output}"
            )
        shutil.copytree(output, target_stage)
    finally:
        if workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)


def _publish_target(stage: Path, target: Path) -> Path | None:
    backup = target.with_name(f".{target.name}.{uuid.uuid4().hex}.backup")
    moved_existing = False
    try:
        if target.exists():
            os.replace(target, backup)
            moved_existing = True
        os.replace(stage, target)
    except BaseException:
        if moved_existing and backup.exists() and not target.exists():
            os.replace(backup, target)
        raise
    return backup if moved_existing else None


def _activate_runtime(base: Path, target: Path) -> None:
    current = base / "current"
    temporary = base / f".current.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    relative = target.relative_to(base)
    temporary.symlink_to(relative, target_is_directory=True)
    os.replace(temporary, current)


def _restore_runtime_pointer(path: Path, target: str | None) -> None:
    if target is None:
        path.unlink(missing_ok=True)
        return
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, path)


def _runtime_pointer_fingerprint(target: str | None) -> str | None:
    if not target:
        return None
    parts = Path(target).parts
    if len(parts) != 2 or parts[0] != "runtimes":
        return None
    return parts[1]


def _finalize_runtime_set(
    base: Path,
    *,
    current_fingerprint: str,
    old_current: str | None,
    old_previous: str | None,
) -> None:
    old_current_fingerprint = _runtime_pointer_fingerprint(old_current)
    old_previous_fingerprint = _runtime_pointer_fingerprint(old_previous)
    fallback = (
        old_current_fingerprint
        if old_current_fingerprint and old_current_fingerprint != current_fingerprint
        else old_previous_fingerprint
        if old_previous_fingerprint and old_previous_fingerprint != current_fingerprint
        else None
    )
    previous = base / "previous"
    if fallback is None:
        previous.unlink(missing_ok=True)
    else:
        _restore_runtime_pointer(previous, f"runtimes/{fallback}")

    retained = {current_fingerprint, *([fallback] if fallback else [])}
    runtimes = base / "runtimes"
    for candidate in runtimes.iterdir():
        if not candidate.is_dir() or candidate.name in retained:
            continue
        shutil.rmtree(candidate, ignore_errors=True)


def ensure_desktop_runtime(
    *,
    force: bool = False,
    install_integration: bool = True,
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> ElectronRuntime:
    source = environ if environ is not None else os.environ
    try:
        node_binary, npm_binary = resolve_node_toolchain(
            node_override_key="TE2_DESKTOP_NODE_BIN",
            npm_override_key="TE2_DESKTOP_NPM_BIN",
            environ=source,
        )
        identity = inspect_node_identity(node_binary, environ=source)
    except NodeToolchainError as exc:
        raise ElectronRuntimeError(str(exc)) from exc
    _validate_identity(identity)

    version = _electron_version()
    source_digest = _source_digest()
    fingerprint = _fingerprint(identity, source_digest)
    base = desktop_runtime_base(source, home=home)
    runtimes = base / "runtimes"
    cache_base = desktop_build_cache_base(source, home=home)
    base.mkdir(parents=True, exist_ok=True)
    runtimes.mkdir(parents=True, exist_ok=True)
    cache_base.mkdir(parents=True, exist_ok=True)
    target = runtimes / fingerprint
    expected = _marker_payload(
        fingerprint=fingerprint,
        identity=identity,
        source_digest=source_digest,
        version=version,
    )

    lock_path = base / ".bootstrap.lock"
    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        current = base / "current"
        previous = base / "previous"
        if current.exists() and not current.is_symlink():
            raise ElectronRuntimeError(f"Electron current pointer is not a symlink: {current}")
        if previous.exists() and not previous.is_symlink():
            raise ElectronRuntimeError(f"Electron previous pointer is not a symlink: {previous}")
        old_current = os.readlink(current) if current.is_symlink() else None
        old_previous = os.readlink(previous) if previous.is_symlink() else None
        published_backup: Path | None = None
        published = False
        try:
            if force or not _runtime_is_ready(target, expected):
                _check_free_space(cache_base)
                stage = runtimes / f".{fingerprint}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
                try:
                    _build_runtime(
                        node_binary=node_binary,
                        npm_binary=npm_binary,
                        target_stage=stage,
                        cache_base=cache_base,
                        environ=source,
                    )
                    (stage / RUNTIME_MARKER).write_text(
                        json.dumps(expected, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8",
                    )
                    if not _runtime_is_ready(stage, expected):
                        raise ElectronRuntimeError(
                            "Electron application validation failed after packaging"
                        )
                    published_backup = _publish_target(stage, target)
                    published = True
                finally:
                    if stage.exists():
                        shutil.rmtree(stage, ignore_errors=True)
            _activate_runtime(base, target)
            runtime = ElectronRuntime(
                root=target,
                executable=target / "TE2Desktop-bin",
                launcher=target / "TE2Desktop",
                fingerprint=fingerprint,
                version=version,
                identity=identity,
            )
            if install_integration:
                install_desktop_integration(runtime, environ=source, home=home)
            _finalize_runtime_set(
                base,
                current_fingerprint=fingerprint,
                old_current=old_current,
                old_previous=old_previous,
            )
            if published_backup is not None:
                shutil.rmtree(published_backup, ignore_errors=True)
            return runtime
        except BaseException:
            _restore_runtime_pointer(current, old_current)
            _restore_runtime_pointer(previous, old_previous)
            if published:
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                if published_backup is not None and published_backup.exists():
                    os.replace(published_backup, target)
            raise


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _atomic_write(path: Path, content: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _restore_file_snapshot(
    snapshot: Mapping[Path, tuple[bytes, int] | None],
) -> None:
    for path, prior in snapshot.items():
        if prior is None:
            path.unlink(missing_ok=True)
            continue
        content, mode = prior
        _atomic_write(path, content, mode)


def _desktop_quote(path: Path) -> str:
    raw = str(path).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{raw}"'


def install_desktop_integration(
    runtime: ElectronRuntime,
    *,
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> DesktopIntegration:
    paths = desktop_integration_paths(environ, home=home)
    python = shlex.quote(str(Path(sys.executable)))
    wrapper = (
        "#!/bin/sh\n"
        f"exec {python} -m desktop_client.electron_cli launch \"$@\"\n"
    ).encode("utf-8")
    desktop_entry = (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=TE2 Desktop\n"
        "Comment=TE2 desktop framework client\n"
        f"Exec={_desktop_quote(paths.wrapper)}\n"
        "Icon=te2\n"
        "Terminal=false\n"
        "Categories=Development;IDE;\n"
        "StartupNotify=true\n"
        "StartupWMClass=TE2Desktop\n"
    ).encode("utf-8")

    icon_source = Path(app_package.__file__).resolve().parent / "static" / "icon.png"
    if not icon_source.is_file():
        raise ElectronRuntimeError(f"Packaged TE2 desktop icon is missing: {icon_source}")
    icon = icon_source.read_bytes()

    try:
        prior_receipt = json.loads(paths.receipt.read_text(encoding="utf-8"))
        prior_files = (
            prior_receipt.get("files", {}) if isinstance(prior_receipt, dict) else {}
        )
    except (OSError, json.JSONDecodeError):
        prior_files = {}
    if not isinstance(prior_files, dict):
        prior_files = {}

    outputs = (
        (paths.wrapper, wrapper, 0o755),
        (paths.desktop_entry, desktop_entry, 0o644),
        (paths.icon, icon, 0o644),
    )
    for path, content, _mode in outputs:
        if not path.exists():
            continue
        if not path.is_file():
            raise ElectronRuntimeError(
                f"Desktop integration path exists but is not a file: {path}"
            )
        current_hash = _sha256(path)
        expected_hash = prior_files.get(str(path))
        if current_hash == _content_sha256(content) or current_hash == expected_hash:
            continue
        raise ElectronRuntimeError(
            "Refusing to overwrite an unowned desktop integration file: "
            f"{path}"
        )

    snapshot = {
        path: (path.read_bytes(), path.stat().st_mode & 0o777) if path.is_file() else None
        for path in (paths.wrapper, paths.desktop_entry, paths.icon, paths.receipt)
    }
    try:
        for path, content, mode in outputs:
            _atomic_write(path, content, mode)

        receipt_payload = {
            "version": 1,
            "runtimeFingerprint": runtime.fingerprint,
            "runtimeRoot": str(runtime.root),
            "files": {
                str(path): _sha256(path)
                for path in (paths.wrapper, paths.desktop_entry, paths.icon)
            },
        }
        _atomic_write(
            paths.receipt,
            (json.dumps(receipt_payload, indent=2, sort_keys=True) + "\n").encode(
                "utf-8"
            ),
            0o600,
        )
    except BaseException:
        _restore_file_snapshot(snapshot)
        raise
    return paths


def desktop_runtime_status(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> dict[str, object]:
    runtime = current_desktop_runtime(environ, home=home)
    integration = desktop_integration_paths(environ, home=home)
    return {
        "installed": runtime is not None,
        "fingerprint": runtime.fingerprint if runtime else None,
        "version": runtime.version if runtime else None,
        "runtimeRoot": str(runtime.root) if runtime else None,
        "launcher": str(runtime.launcher) if runtime else None,
        "integration": {
            "wrapper": integration.wrapper.is_file(),
            "desktopEntry": integration.desktop_entry.is_file(),
            "icon": integration.icon.is_file(),
            "receipt": integration.receipt.is_file(),
        },
    }


def uninstall_desktop_runtime(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
) -> dict[str, object]:
    paths = desktop_integration_paths(environ, home=home)
    removed: list[str] = []
    preserved: list[str] = []
    try:
        receipt = json.loads(paths.receipt.read_text(encoding="utf-8"))
        files = receipt.get("files", {}) if isinstance(receipt, dict) else {}
    except (OSError, json.JSONDecodeError):
        files = {}
    if isinstance(files, dict):
        for path in (paths.wrapper, paths.desktop_entry, paths.icon):
            expected_hash = files.get(str(path))
            if not isinstance(expected_hash, str):
                continue
            if not path.is_file():
                continue
            if _sha256(path) != expected_hash:
                preserved.append(str(path))
                continue
            path.unlink()
            removed.append(str(path))

    base = desktop_runtime_base(environ, home=home)
    if base.exists():
        shutil.rmtree(base)
        removed.append(str(base))
    return {"removed": removed, "preserved": preserved}


def launch_desktop_runtime(
    arguments: list[str],
    *,
    environ: Mapping[str, str] | None = None,
    home: Path | None = None,
) -> int:
    runtime = current_desktop_runtime(environ, home=home)
    if runtime is None:
        runtime = ensure_desktop_runtime(environ=environ, home=home)
    try:
        return subprocess.run(
            [str(runtime.launcher), *arguments],
            env=dict(environ if environ is not None else os.environ),
            check=False,
        ).returncode
    except OSError as exc:
        raise ElectronRuntimeError(f"Unable to launch TE2 Desktop: {exc}") from exc
