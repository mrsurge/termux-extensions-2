# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import fcntl
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
from typing import BinaryIO, Final, Literal, TypedDict, cast
from urllib.request import Request, urlopen
import uuid

from .extension_registry import (
    CodeServerInstallation,
    PINNED_CODE_SERVER_VERSION,
    code_server_installation_from_executable,
    get_code_server_version,
    select_code_server_runtime_installation,
    te2_managed_code_server_installation,
    te2_managed_code_server_root,
)


REQUIRED_CODE_SERVER_VERSION: Final = PINNED_CODE_SERVER_VERSION
OFFICIAL_INSTALL_SCRIPT_URL: Final = "https://code-server.dev/install.sh"
ANDROID_RELEASE_TAG: Final = "0.2.327"
ANDROID_PACKAGE_NAME: Final = "code-server_4.130.0_aarch64.deb"
ANDROID_PACKAGE_URL: Final = (
    "https://github.com/mrsurge/termux-extensions-2/releases/download/"
    f"{ANDROID_RELEASE_TAG}/{ANDROID_PACKAGE_NAME}"
)
ANDROID_PACKAGE_SHA256: Final = (
    "3637320fd8f8c890ab8d50aa1b0ba57cd6cad2e02045843f3a50a46305f9444b"
)
ANDROID_DEPENDENCIES: Final = (
    "libandroid-spawn",
    "libsecret",
    "krb5",
    "nodejs-24",
    "ripgrep",
)
TERMUX_PACKAGE_PREFIX: Final = Path("data/data/com.termux/files/usr")
_MAX_INSTALL_SCRIPT_BYTES: Final = 1024 * 1024

CodeServerPrerequisiteState = Literal["ready", "missing", "incompatible"]


class CodeServerPrerequisitePayload(TypedDict):
    state: CodeServerPrerequisiteState
    compatible: bool
    reason: str
    code_server_version: str
    code_version: str
    source: str
    executable: str
    install_version: str
    install_prefix: str
    android: bool


@dataclass(frozen=True)
class CodeServerPrerequisite:
    state: CodeServerPrerequisiteState
    installation: CodeServerInstallation | None
    version_info: Mapping[str, object] | None
    reason: str

    @property
    def compatible(self) -> bool:
        return self.state == "ready" and self.installation is not None

    def payload(self) -> CodeServerPrerequisitePayload:
        version_info = self.version_info or {}
        installation = self.installation
        return {
            "state": self.state,
            "compatible": self.compatible,
            "reason": self.reason,
            "code_server_version": str(version_info.get("version") or ""),
            "code_version": str(version_info.get("code_version") or ""),
            "source": installation.source if installation is not None else "",
            "executable": (
                str(installation.executable) if installation is not None else ""
            ),
            "install_version": REQUIRED_CODE_SERVER_VERSION,
            "install_prefix": str(code_server_install_prefix()),
            "android": _is_termux_android(),
        }


class CodeServerBootstrapError(RuntimeError):
    pass


def code_server_bootstrap_cache_dir() -> Path:
    cache_home = Path(
        os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))
    ).expanduser()
    return (cache_home / "te2" / "code_server").resolve()


def code_server_install_prefix() -> Path:
    return (
        te2_managed_code_server_root() / REQUIRED_CODE_SERVER_VERSION
    ).resolve()


def _is_termux_android() -> bool:
    prefix = str(os.environ.get("PREFIX") or "").strip()
    return bool(
        os.environ.get("ANDROID_ROOT")
        or os.environ.get("ANDROID_DATA")
        or "/com.termux/" in prefix
        or Path("/system/build.prop").is_file()
    )


def _assess_installation(
    installation: CodeServerInstallation | None,
) -> CodeServerPrerequisite:
    if installation is None:
        return CodeServerPrerequisite(
            state="missing",
            installation=None,
            version_info=None,
            reason="Code Server was not found.",
        )

    if installation.vscode_root is None:
        return CodeServerPrerequisite(
            state="incompatible",
            installation=installation,
            version_info={"version": REQUIRED_CODE_SERVER_VERSION},
            reason="Code Server's bundled Code/extension-host tree was not found.",
        )

    return CodeServerPrerequisite(
        state="ready",
        installation=installation,
        version_info={"version": REQUIRED_CODE_SERVER_VERSION},
        reason="TE2's managed Code Server extension host is available.",
    )


def inspect_code_server_prerequisite() -> CodeServerPrerequisite:
    managed = te2_managed_code_server_installation(REQUIRED_CODE_SERVER_VERSION)
    return _assess_installation(managed)


def require_compatible_code_server_installation() -> CodeServerInstallation:
    prerequisite = inspect_code_server_prerequisite()
    if prerequisite.compatible and prerequisite.installation is not None:
        return prerequisite.installation
    raise CodeServerBootstrapError(
        f"{prerequisite.reason} Automatic installation requires user confirmation."
    )


def ensure_code_server_installation() -> CodeServerInstallation:
    """Return a compatible installation without downloading or mutating anything."""
    return require_compatible_code_server_installation()


def _command_output(output: bytes) -> str:
    lines = output.decode("utf-8", errors="replace").strip().splitlines()
    return "\n".join(lines[-40:])


def _run_checked(
    command: list[str],
    *,
    label: str,
    timeout_s: float,
    input_bytes: bytes | None = None,
    env: Mapping[str, str] | None = None,
) -> None:
    try:
        result = subprocess.run(
            command,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout_s,
            check=False,
            env=dict(env) if env is not None else None,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CodeServerBootstrapError(f"{label} failed: {exc}") from exc
    if result.returncode == 0:
        return
    detail = _command_output(result.stdout) or f"exit status {result.returncode}"
    raise CodeServerBootstrapError(f"{label} failed:\n{detail}")


def _fetch_install_script() -> bytes:
    request = Request(
        OFFICIAL_INSTALL_SCRIPT_URL,
        headers={"User-Agent": f"TE2/code-server-bootstrap-{REQUIRED_CODE_SERVER_VERSION}"},
    )
    try:
        with cast(BinaryIO, urlopen(request, timeout=30)) as response:
            script: bytes = response.read(_MAX_INSTALL_SCRIPT_BYTES + 1)
    except OSError as exc:
        raise CodeServerBootstrapError(
            f"Unable to download {OFFICIAL_INSTALL_SCRIPT_URL}: {exc}"
        ) from exc
    if len(script) > _MAX_INSTALL_SCRIPT_BYTES:
        raise CodeServerBootstrapError("The Code Server install script exceeded 1 MiB.")
    if not script.strip():
        raise CodeServerBootstrapError("The Code Server install script was empty.")
    return script


def _new_stage_path(parent: Path, label: str) -> Path:
    return parent / f".{label}.{os.getpid()}.{uuid.uuid4().hex}.stage"


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.exists():
        shutil.rmtree(path)


def _activate_staged_prefix(stage: Path, destination: Path) -> None:
    backup = destination.parent / (
        f".{destination.name}.{os.getpid()}.{uuid.uuid4().hex}.backup"
    )
    moved_existing = False
    try:
        if destination.exists() or destination.is_symlink():
            os.replace(destination, backup)
            moved_existing = True
        os.replace(stage, destination)
    except Exception:
        if moved_existing and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise
    finally:
        _remove_path(backup)


def _official_launcher_payload(prefix: Path) -> Path:
    return (
        prefix
        / "lib"
        / f"code-server-{REQUIRED_CODE_SERVER_VERSION}"
        / "bin"
        / "code-server"
    )


def _replace_launcher_with_relative_symlink(
    launcher: Path,
    payload: Path,
) -> None:
    relative_payload = os.path.relpath(payload, start=launcher.parent)
    launcher.unlink()
    launcher.symlink_to(relative_payload)
    if not launcher.is_file():
        raise CodeServerBootstrapError(
            f"The Code Server launcher symlink could not be normalized: {launcher}"
        )


def _normalize_staged_official_launcher(stage: Path) -> None:
    launcher = stage / "bin" / "code-server"
    if not launcher.is_file():
        raise CodeServerBootstrapError(
            f"The Code Server installer did not create {launcher}."
        )
    if not launcher.is_symlink():
        return

    payload = launcher.resolve(strict=True)
    try:
        _ = payload.relative_to(stage)
    except ValueError as exc:
        raise CodeServerBootstrapError(
            f"The Code Server installer created an out-of-prefix launcher: {launcher}"
        ) from exc
    _replace_launcher_with_relative_symlink(launcher, payload)


def _repair_relocated_official_launcher(prefix: Path) -> bool:
    """Repair the absolute staging symlink emitted by the standalone installer."""
    launcher = prefix / "bin" / "code-server"
    payload = _official_launcher_payload(prefix)
    if launcher.is_file() or not launcher.is_symlink() or not payload.is_file():
        return False

    raw_target = Path(os.readlink(launcher))
    if not raw_target.is_absolute():
        return False
    expected_suffix = payload.relative_to(prefix)
    stage_root = raw_target
    for _part in expected_suffix.parts:
        stage_root = stage_root.parent
    if raw_target != stage_root / expected_suffix:
        return False
    if stage_root.parent != prefix.parent:
        return False
    if not (
        stage_root.name.startswith(f".{prefix.name}.")
        and stage_root.name.endswith(".stage")
    ):
        return False

    _replace_launcher_with_relative_symlink(launcher, payload)
    return True


def _install_official_code_server(
    install_prefix: Path,
    cache_dir: Path,
) -> None:
    shell = shutil.which("sh")
    if not shell:
        raise CodeServerBootstrapError("Unable to install Code Server: sh was not found.")
    script = _fetch_install_script()
    install_prefix.parent.mkdir(parents=True, exist_ok=True)
    stage = _new_stage_path(install_prefix.parent, install_prefix.name)
    _remove_path(stage)
    install_env = os.environ.copy()
    install_env["XDG_CACHE_HOME"] = str(cache_dir)
    try:
        _run_checked(
            [
                shell,
                "-s",
                "--",
                "--method=standalone",
                f"--prefix={stage}",
                "--version",
                REQUIRED_CODE_SERVER_VERSION,
            ],
            input_bytes=script,
            label=f"Code Server {REQUIRED_CODE_SERVER_VERSION} installation",
            timeout_s=1200,
            env=install_env,
        )
        _normalize_staged_official_launcher(stage)
        _activate_staged_prefix(stage, install_prefix)
    finally:
        _remove_path(stage)


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def _download_to_path(url: str, destination: Path) -> None:
    request = Request(
        url,
        headers={"User-Agent": f"TE2/code-server-bootstrap-{REQUIRED_CODE_SERVER_VERSION}"},
    )
    try:
        with (
            cast(BinaryIO, urlopen(request, timeout=60)) as response,
            destination.open("xb") as target,
        ):
            while chunk := response.read(1024 * 1024):
                _ = target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
    except (OSError, ValueError) as exc:
        raise CodeServerBootstrapError(f"Unable to download {url}: {exc}") from exc


def _ensure_android_package(cache_dir: Path) -> Path:
    package = cache_dir / ANDROID_PACKAGE_NAME
    if package.is_file() and _sha256(package) == ANDROID_PACKAGE_SHA256:
        return package

    stage = cache_dir / f".{ANDROID_PACKAGE_NAME}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        _download_to_path(ANDROID_PACKAGE_URL, stage)
        actual_sha256 = _sha256(stage)
        if actual_sha256 != ANDROID_PACKAGE_SHA256:
            detail = (
                f"expected {ANDROID_PACKAGE_SHA256}, got {actual_sha256}"
            )
            raise CodeServerBootstrapError(
                f"Downloaded Android Code Server package failed SHA-256 verification: {detail}"
            )
        os.replace(stage, package)
    finally:
        stage.unlink(missing_ok=True)
    return package


def _resolve_termux_command(name: str) -> str:
    command = shutil.which(name)
    if command:
        return command
    prefix = str(os.environ.get("PREFIX") or "").strip()
    if prefix:
        candidate = Path(prefix) / "bin" / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise CodeServerBootstrapError(
        f"Unable to install Code Server: {name} was not found."
    )


def _install_android_dependencies() -> None:
    _run_checked(
        [_resolve_termux_command("apt"), "install", "-y", *ANDROID_DEPENDENCIES],
        label="Android Code Server dependency installation",
        timeout_s=1200,
    )


def _write_android_launcher(stage: Path) -> None:
    prefix = str(os.environ.get("PREFIX") or "/data/data/com.termux/files/usr").rstrip("/")
    launcher = stage / "bin" / "code-server"
    launcher.parent.mkdir(parents=True, exist_ok=True)
    launcher_source = (
        f"#!{prefix}/bin/sh\n"
        + 'ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\n'
        + 'exec "$ROOT/lib/code-server/bin/code-server" "$@"\n'
    )
    _ = launcher.write_text(
        launcher_source,
        encoding="utf-8",
    )
    launcher.chmod(0o755)


def _install_android_code_server(cache_dir: Path, install_prefix: Path) -> None:
    machine = platform.machine().lower()
    if machine not in {"aarch64", "arm64"}:
        detected = machine or "unknown"
        raise CodeServerBootstrapError(
            f"The TE2 Android Code Server package supports only aarch64; detected {detected}."
        )

    _install_android_dependencies()
    package = _ensure_android_package(cache_dir)
    install_prefix.parent.mkdir(parents=True, exist_ok=True)
    extract_root = _new_stage_path(install_prefix.parent, "code-server-extract")
    stage = _new_stage_path(install_prefix.parent, install_prefix.name)
    _remove_path(extract_root)
    _remove_path(stage)
    try:
        _run_checked(
            [
                _resolve_termux_command("dpkg-deb"),
                "--extract",
                str(package),
                str(extract_root),
            ],
            label=f"Android Code Server {REQUIRED_CODE_SERVER_VERSION} extraction",
            timeout_s=1200,
        )
        package_root = extract_root / TERMUX_PACKAGE_PREFIX
        source = package_root / "lib" / "code-server"
        if not source.is_dir():
            raise CodeServerBootstrapError(
                f"The Android Code Server package did not contain {source}."
            )
        (stage / "lib").mkdir(parents=True, exist_ok=True)
        os.replace(source, stage / "lib" / "code-server")
        _write_android_launcher(stage)
        _activate_staged_prefix(stage, install_prefix)
    finally:
        _remove_path(stage)
        _remove_path(extract_root)


def _verify_bootstrapped_installation(
    installation: CodeServerInstallation,
) -> CodeServerInstallation:
    version_info = get_code_server_version(installation) or {}
    package_version = str(version_info.get("version") or "")
    if package_version != REQUIRED_CODE_SERVER_VERSION:
        reported = package_version or "unknown"
        message = f"The private Code Server executable reported package version {reported} instead of {REQUIRED_CODE_SERVER_VERSION}: {installation.executable}"
        raise CodeServerBootstrapError(message)
    prerequisite = _assess_installation(installation)
    if not prerequisite.compatible:
        message = f"The private Code Server installation is not compatible: {prerequisite.reason}"
        raise CodeServerBootstrapError(message)
    return installation


def install_code_server_installation() -> CodeServerInstallation:
    """Install the pinned private runtime after the frontend obtains consent."""
    prerequisite = inspect_code_server_prerequisite()
    if prerequisite.compatible and prerequisite.installation is not None:
        return prerequisite.installation

    cache_dir = code_server_bootstrap_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    install_prefix = code_server_install_prefix()
    lock_path = cache_dir / ".bootstrap.lock"

    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        prerequisite = inspect_code_server_prerequisite()
        if prerequisite.compatible and prerequisite.installation is not None:
            return prerequisite.installation

        if _is_termux_android():
            _install_android_code_server(cache_dir, install_prefix)
        else:
            repaired = _repair_relocated_official_launcher(install_prefix)
            if not repaired:
                _install_official_code_server(install_prefix, cache_dir)

        installed = code_server_installation_from_executable(
            install_prefix / "bin" / "code-server",
            "te2-managed",
        )
        if installed is None:
            launcher = install_prefix / "bin" / "code-server"
            message = f"Code Server installation completed, but the private launcher was not usable: {launcher}"
            raise CodeServerBootstrapError(message)
        verified = _verify_bootstrapped_installation(installed)
        select_code_server_runtime_installation(verified)
        return verified


def remove_code_server_installation() -> bool:
    """Remove only the pinned TE2-managed runtime, preserving user extensions."""
    cache_dir = code_server_bootstrap_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    install_prefix = code_server_install_prefix()
    lock_path = cache_dir / ".bootstrap.lock"

    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        existed = install_prefix.exists() or install_prefix.is_symlink()
        select_code_server_runtime_installation(None)
        _remove_path(install_prefix)
        select_code_server_runtime_installation(None)
        return existed
