from __future__ import annotations

import argparse
from collections.abc import Iterator, Mapping
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from zipfile import ZipFile


MANAGED_MARKER = "# TE2_INSTALLER_MANAGED=1"
MINIMUM_FREE_BYTES = 2 * 1024 * 1024 * 1024
MANAGED_COMMANDS = (
    "te2",
    "te2-rust",
    "fws",
    "als-rs",
    "als-rs-extension-adapter",
)
LINUX_APT_PACKAGES = ("git", "build-essential", "python3-venv")
LINUX_LIBARCHIVE_PACKAGES = ("libarchive13t64", "libarchive13")
LINUX_TARGET = "linux-glibc-x86_64"
TERMUX_TARGET = "termux-android-aarch64"


def main() -> int:
    args = _parse_args()
    payload = Path(args.payload_root).expanduser().resolve()
    target = _detect_target()
    data_home = _resolve_data_home(args.data_home)
    install_root = data_home / "install"
    install_root.mkdir(mode=0o755, parents=True, exist_ok=True)
    if target == TERMUX_TARGET:
        return _run_termux(args, payload, install_root)
    return _run_linux(args, payload, install_root, data_home)


def _run_termux(args: argparse.Namespace, payload: Path, install_root: Path) -> int:
    if args.desktop:
        raise SystemExit("--desktop is supported only on glibc Linux")
    prefix = _resolve_prefix(args.prefix)
    with _install_lock(install_root / ".install.lock"):
        if args.uninstall:
            _uninstall(install_root, prefix)
            print("TE2 installation removed; user settings and app state were preserved.")
            return 0
        if args.rollback:
            _rollback(install_root, prefix, args.rollback)
            print(f"TE2 current release rolled back to {args.rollback}.")
            return 0

        manifest = _load_manifest(payload)
        _validate_target(manifest, prefix)
        _verify_payload(payload, manifest)
        _ensure_prerequisites(manifest, prefix, assume_yes=args.yes)
        _check_free_space(install_root)
        version = _manifest_version(manifest)
        release = _materialize_release(payload, manifest, install_root, prefix, version)
        try:
            _activate_release(install_root, prefix, release, version)
        except BaseException:
            if release.name.startswith(f".{version}.stage-"):
                shutil.rmtree(release, ignore_errors=True)
            raise
    installed_release = install_root / "releases" / version
    print(f"TE2 {version} installed at {installed_release}")
    print(f"Launch with: {prefix / 'bin' / 'te2'}")
    return 0


def _run_linux(
    args: argparse.Namespace,
    payload: Path,
    install_root: Path,
    data_home: Path,
) -> int:
    if args.prefix:
        raise SystemExit("--prefix is a Termux-only option")
    home = _resolve_user_home()
    bin_dir = home / ".local" / "bin"
    with _install_lock(install_root / ".install.lock"):
        if args.uninstall:
            _uninstall_linux(install_root, bin_dir)
            print("TE2 installation removed; user settings and app state were preserved.")
            return 0
        if args.rollback:
            _rollback_linux(install_root, bin_dir, args.rollback)
            print(f"TE2 current release rolled back to {args.rollback}.")
            return 0

        version = (
            _release_version(args.release_version)
            if args.release_version
            else _manifest_version(_load_manifest(payload))
        )
        _ensure_linux_prerequisites(assume_yes=args.yes)
        _check_free_space(install_root)
        release = _materialize_linux_release(install_root, version)
        try:
            _activate_linux_release(install_root, bin_dir, release, version)
        except BaseException:
            if release.name.startswith(f".{version}.stage-"):
                shutil.rmtree(release, ignore_errors=True)
            raise

    installed_release = install_root / "releases" / version
    print(f"TE2 {version} installed at {installed_release}")
    print(f"Launch with: {bin_dir / 'te2'}")
    if args.desktop:
        _install_linux_desktop(
            installed_release,
            install_root=install_root,
            bin_dir=bin_dir,
            data_home=data_home,
            home=home,
        )
        print(f"TE2 Desktop installed; launcher: {bin_dir / 'te2-desktop'}")
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install a verified TE2 release payload")
    parser.add_argument("--payload-root", default=".", help=argparse.SUPPRESS)
    parser.add_argument("--release-version", help=argparse.SUPPRESS)
    parser.add_argument("--prefix", help="Target prefix; defaults to PREFIX")
    parser.add_argument("--data-home", help="Canonical TE2 data root override")
    parser.add_argument("-y", "--yes", action="store_true", help="Consent to missing apt prerequisites")
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="On glibc Linux, build and install the Electron desktop integration",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--uninstall", action="store_true")
    action.add_argument("--rollback", metavar="VERSION")
    return parser.parse_args()


def _detect_target() -> str:
    prefix = str(os.environ.get("PREFIX") or "")
    if sys.platform == "android" or "/com.termux/" in prefix:
        return TERMUX_TARGET
    machine = platform.machine().lower()
    if sys.platform != "linux":
        raise SystemExit(f"Unsupported operating system: {sys.platform}")
    if machine not in {"x86_64", "amd64"}:
        raise SystemExit(f"Unsupported glibc Linux architecture: {machine}")
    libc_name = str(platform.libc_ver()[0] or "").strip().lower()
    if libc_name not in {"glibc", "gnu libc"}:
        raise SystemExit(f"Unsupported Linux C library: {libc_name or 'unknown'}")
    if shutil.which("apt-get") is None or shutil.which("dpkg-query") is None:
        raise SystemExit("The initial glibc Linux installer supports apt-based systems only")
    return LINUX_TARGET


def _resolve_prefix(raw: str | None) -> Path:
    value = str(raw or os.environ.get("PREFIX") or "").strip()
    if not value:
        raise SystemExit("This payload supports Termux only; PREFIX is not set")
    prefix = Path(value).expanduser()
    if not prefix.is_absolute() or "/com.termux/" not in str(prefix):
        raise SystemExit(f"This payload supports a Termux prefix only: {prefix}")
    return prefix.resolve()


def _resolve_data_home(raw: str | None) -> Path:
    explicit = str(raw or os.environ.get("TE2_DATA_HOME") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
    else:
        xdg = str(os.environ.get("XDG_DATA_HOME") or "").strip()
        path = Path(xdg).expanduser() / "te2" if xdg else Path.home() / ".local" / "share" / "te2"
    if not path.is_absolute():
        raise SystemExit(f"TE2 data root must be absolute: {path}")
    return path.resolve()


def _resolve_user_home() -> Path:
    raw = str(os.environ.get("HOME") or "").strip()
    path = Path(raw).expanduser() if raw else Path.home()
    if not path.is_absolute():
        raise SystemExit(f"HOME must be absolute: {path}")
    return path.resolve()


@contextlib.contextmanager
def _install_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def _load_manifest(payload: Path) -> dict[str, object]:
    path = payload / "target-manifest.json"
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Unable to read target manifest: {exc}") from exc
    if not isinstance(loaded, dict) or loaded.get("schemaVersion") != 1:
        raise SystemExit("Unsupported or malformed TE2 target manifest")
    return loaded


def _validate_target(manifest: Mapping[str, object], prefix: Path) -> None:
    target = _mapping(manifest.get("target"), "target")
    python = _mapping(target.get("python"), "target.python")
    if target.get("environment") != "termux" or target.get("operatingSystem") != "android":
        raise SystemExit("This installer payload is not a Termux/Android target")
    if target.get("architecture") != "aarch64" or platform.machine() not in {"aarch64", "arm64"}:
        raise SystemExit(f"Unsupported architecture: {platform.machine()}")
    if sys.platform != "android":
        raise SystemExit(f"Termux payload requires Android Python; found sys.platform={sys.platform!r}")
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 14):
        raise SystemExit(
            f"Termux payload requires CPython 3.14; found {sys.implementation.name} "
            f"{sys.version_info.major}.{sys.version_info.minor}"
        )
    if python.get("abi") != "cp314" or python.get("majorMinor") != "3.14":
        raise SystemExit("Manifest Python ABI does not match the supported Termux interpreter")
    sys_platform = sysconfig.get_platform().replace("-", "_").replace(".", "_")
    if not re.fullmatch(r"android_[0-9]+_arm64_v8a", sys_platform):
        raise SystemExit(f"Unexpected Termux Python platform: {sys_platform}")
    sdk = _command_output(["getprop", "ro.build.version.sdk"], required=True)
    minimum_api = target.get("minimumAndroidApi", 24)
    if not isinstance(minimum_api, int):
        raise SystemExit("Manifest minimumAndroidApi must be an integer")
    if not sdk.isdigit() or int(sdk) < minimum_api:
        raise SystemExit(f"Android API level is below the release minimum: {sdk}")
    expected_python = prefix / "bin" / "python"
    if not expected_python.exists() or Path(sys.executable).resolve() != expected_python.resolve():
        raise SystemExit(f"Installer must run with target Termux Python: {expected_python}")


def _verify_payload(payload: Path, manifest: Mapping[str, object]) -> None:
    sums = payload / "SHA256SUMS"
    if not sums.is_file():
        raise SystemExit("Release payload is missing SHA256SUMS")
    listed: set[str] = set()
    for raw in sums.read_text(encoding="utf-8").splitlines():
        if not raw:
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\0]+)", raw)
        if match is None:
            raise SystemExit(f"Malformed checksum entry: {raw!r}")
        digest, relative = match.groups()
        path = _payload_member(payload, relative)
        if not path.is_file() or path.is_symlink():
            raise SystemExit(f"Payload member is missing or unsafe: {relative}")
        if _sha256(path) != digest:
            raise SystemExit(f"Payload checksum mismatch: {relative}")
        listed.add(relative)
    actual = {
        path.relative_to(payload).as_posix()
        for path in payload.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS"
    }
    if actual != listed:
        raise SystemExit(
            f"Payload checksum inventory mismatch: missing={sorted(actual-listed)}, "
            f"unexpected={sorted(listed-actual)}"
        )
    _validate_no_links(payload)
    wheel_records = manifest.get("releaseLocalWheels")
    if not isinstance(wheel_records, list):
        raise SystemExit("Manifest releaseLocalWheels must be a list")
    actual_wheels = {path.name for path in (payload / "wheelhouse").glob("*.whl")}
    expected_wheels: set[str] = set()
    for raw_record in wheel_records:
        record = _mapping(raw_record, "releaseLocalWheels item")
        filename = str(record.get("filename") or "")
        path = payload / "wheelhouse" / filename
        expected_wheels.add(filename)
        if not path.is_file() or _sha256(path) != record.get("sha256"):
            raise SystemExit(f"Wheel does not match target manifest: {filename}")
        _verify_wheel_platform(path)
    if actual_wheels != expected_wheels:
        raise SystemExit("Wheelhouse inventory differs from target manifest")
    server = _mapping(manifest.get("server"), "server")
    server_path = _payload_member(payload, str(server.get("filename") or ""))
    if _sha256(server_path) != server.get("sha256"):
        raise SystemExit("TE2 server does not match target manifest")
    _validate_aarch64_elf(server_path)


def _ensure_prerequisites(
    manifest: Mapping[str, object], prefix: Path, *, assume_yes: bool
) -> None:
    raw_packages = manifest.get("aptPackages")
    if not isinstance(raw_packages, list):
        raise SystemExit("Manifest aptPackages must be a list")
    packages = [_mapping(item, "aptPackages item") for item in raw_packages]
    missing = [str(item["name"]) for item in packages if _dpkg_version(str(item["name"])) is None]
    if missing:
        _confirm_install(
            "TE2 needs these Termux packages: " + ", ".join(missing),
            assume_yes=assume_yes,
        )
        subprocess.run([str(prefix / "bin" / "apt-get"), "update"], check=True)
        subprocess.run([str(prefix / "bin" / "apt-get"), "install", "-y", *missing], check=True)
    for item in packages:
        name = str(item["name"])
        installed = _dpkg_version(name)
        if installed is None:
            raise SystemExit(f"Required Termux package is not installed: {name}")
        minimum = str(item.get("minimumVersion") or "")
        if minimum and subprocess.run(
            ["dpkg", "--compare-versions", installed, "ge", minimum], check=False
        ).returncode != 0:
            raise SystemExit(f"Termux package {name} {installed} is below required {minimum}")
        major = item.get("majorVersion")
        if major is not None and name == "nodejs-lts":
            node = _command_output([str(prefix / "bin" / "node"), "--version"], required=True)
            if not node.startswith(f"v{major}."):
                raise SystemExit(f"Node major version mismatch: {node}")
        for executable in _string_list(item.get("executables"), f"{name}.executables"):
            if shutil.which(executable, path=str(prefix / "bin")) is None:
                raise SystemExit(f"Package {name} did not provide executable: {executable}")
        for library in _string_list(item.get("libraries", []), f"{name}.libraries"):
            library_path = prefix / library
            if not library_path.is_file():
                raise SystemExit(f"Package {name} did not provide library: {library_path}")
    imports = sorted(
        {
            module
            for item in packages
            for module in _string_list(item.get("imports"), f"{item['name']}.imports")
        }
    )
    if imports:
        subprocess.run(
            [sys.executable, "-I", "-c", ";".join(f"import {name}" for name in imports)],
            check=True,
        )


def _ensure_linux_prerequisites(*, assume_yes: bool) -> None:
    libarchive_package = _select_linux_libarchive_package()
    required = [*LINUX_APT_PACKAGES, libarchive_package]
    missing = [package for package in required if _dpkg_version(package) is None]
    if missing:
        _confirm_install(
            "TE2 needs these Linux packages: " + ", ".join(missing),
            assume_yes=assume_yes,
        )
        apt = _privileged_apt_command()
        environment = os.environ.copy()
        environment["DEBIAN_FRONTEND"] = "noninteractive"
        subprocess.run([*apt, "apt-get", "update"], env=environment, check=True)
        subprocess.run(
            [*apt, "apt-get", "install", "-y", *missing],
            env=environment,
            check=True,
        )
    for package in required:
        if _dpkg_version(package) is None:
            raise SystemExit(f"Required Linux package is not installed: {package}")
    for executable in ("git", "cc", "c++", "make"):
        if shutil.which(executable) is None:
            raise SystemExit(f"Linux prerequisite did not provide executable: {executable}")


def _select_linux_libarchive_package() -> str:
    for package in LINUX_LIBARCHIVE_PACKAGES:
        if _dpkg_version(package) is not None:
            return package
    for package in LINUX_LIBARCHIVE_PACKAGES:
        result = subprocess.run(
            ["apt-cache", "show", package],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            return package
    raise SystemExit(
        "No supported libarchive runtime package is available "
        f"({', '.join(LINUX_LIBARCHIVE_PACKAGES)})"
    )


def _privileged_apt_command() -> list[str]:
    if os.geteuid() == 0:
        return []
    sudo = shutil.which("sudo")
    if sudo is None:
        raise SystemExit(
            "Installing Linux prerequisites requires root or a configured sudo command"
        )
    return [sudo]


def _materialize_linux_release(install_root: Path, version: str) -> Path:
    releases = install_root / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{version}.stage-", dir=releases))
    target = releases / version
    venv = stage / "venv"
    try:
        environment = os.environ.copy()
        environment.pop("PYTHONHOME", None)
        environment.pop("PYTHONPATH", None)
        environment.update(
            {
                "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                "PYTHONNOUSERSITE": "1",
            }
        )
        subprocess.run([sys.executable, "-m", "venv", str(venv)], env=environment, check=True)
        python = venv / "bin" / "python"
        subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "--no-compile",
                f"te2=={version}",
            ],
            env=environment,
            check=True,
        )
        _validate_linux_release_imports(stage, version, environment)
        _relocate_linux_venv(venv, target / "venv")
        receipt = {
            "installedAtVersion": version,
            "python": str(Path(sys.executable).resolve()),
            "schemaVersion": 1,
            "target": LINUX_TARGET,
        }
        (stage / "install-receipt.json").write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return stage
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _validate_linux_release(
    release: Path,
    version: str,
    base_environment: Mapping[str, str],
) -> None:
    _validate_linux_release_imports(release, version, base_environment)
    venv = release / "venv"
    environment = dict(base_environment)
    environment.update(
        {
            "PATH": f"{venv / 'bin'}:{environment.get('PATH', '')}",
            "PYTHONNOUSERSITE": "1",
            "VIRTUAL_ENV": str(venv),
        }
    )
    for command in MANAGED_COMMANDS:
        executable = venv / "bin" / command
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise SystemExit(f"Installed TE2 command is unavailable: {executable}")
    for command in ("te2", "fws", "als-rs"):
        subprocess.run(
            [str(venv / "bin" / command), "--help"],
            env=environment,
            check=True,
            timeout=60,
            stdout=subprocess.DEVNULL,
        )


def _validate_linux_release_imports(
    release: Path,
    version: str,
    base_environment: Mapping[str, str],
) -> None:
    venv = release / "venv"
    python = venv / "bin" / "python"
    environment = dict(base_environment)
    environment.update(
        {
            "PATH": f"{venv / 'bin'}:{environment.get('PATH', '')}",
            "PYTHONNOUSERSITE": "1",
            "VIRTUAL_ENV": str(venv),
        }
    )
    script = (
        "import importlib.metadata as m; "
        "import app, framework_shells, agent_log_server_rs, fastapi, libarchive, msgspec; "
        f"assert m.version('te2') == {version!r}"
    )
    subprocess.run([str(python), "-I", "-c", script], env=environment, check=True, timeout=60)


def _relocate_linux_venv(source: Path, target: Path) -> None:
    source_bytes = str(source).encode()
    target_bytes = str(target).encode()
    candidates = [source / "pyvenv.cfg", *(source / "bin").iterdir()]
    for path in candidates:
        if not path.is_file() or path.is_symlink():
            continue
        content = path.read_bytes()
        if source_bytes not in content:
            continue
        path.write_bytes(content.replace(source_bytes, target_bytes))


def _materialize_release(
    payload: Path,
    manifest: Mapping[str, object],
    install_root: Path,
    prefix: Path,
    version: str,
) -> Path:
    releases = install_root / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{version}.stage-", dir=releases))
    python_tree = stage / "python"
    libexec = stage / "libexec"
    python_tree.mkdir()
    libexec.mkdir()
    try:
        wheelhouse = payload / "wheelhouse"
        wheel_paths = sorted(wheelhouse.glob("*.whl"))
        if not wheel_paths:
            raise SystemExit("Verified wheelhouse is empty")
        env = os.environ.copy()
        env.pop("PYTHONPATH", None)
        env.update(
            {
                "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                "PIP_NO_BUILD_ISOLATION": "1",
                "PIP_NO_INDEX": "1",
                "PYTHONNOUSERSITE": "1",
            }
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-index",
                "--no-deps",
                "--only-binary=:all:",
                "--no-compile",
                "--target",
                str(python_tree),
                *[str(path) for path in wheel_paths],
            ],
            env=env,
            check=True,
        )
        server_record = _mapping(manifest.get("server"), "server")
        source_server = _payload_member(payload, str(server_record["filename"]))
        target_server = libexec / "te2-server"
        shutil.copy2(source_server, target_server)
        target_server.chmod(0o755)
        shutil.copy2(payload / "target-manifest.json", stage / "target-manifest.json")
        _validate_installed_tree(stage, manifest, prefix)
        receipt = {
            "installedAtVersion": version,
            "prefix": str(prefix),
            "schemaVersion": 1,
            "serverSha256": _sha256(target_server),
            "wheelCount": len(wheel_paths),
        }
        (stage / "install-receipt.json").write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return stage
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _validate_installed_tree(
    release: Path, manifest: Mapping[str, object], prefix: Path
) -> None:
    python_tree = release / "python"
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{python_tree / 'bin'}:{prefix / 'bin'}",
            "PYTHONNOUSERSITE": "1",
            "PYTHONPATH": str(python_tree),
            "TE2_SERVER_BIN": str(release / "libexec" / "te2-server"),
        }
    )
    versions = _mapping(manifest.get("distribution"), "distribution")
    script = (
        "import importlib.metadata as m; "
        "import app, framework_shells, agent_log_server_rs, fastapi, msgspec; "
        f"assert m.version('te2') == {str(versions['version'])!r}; "
        f"assert m.version('framework-shells') == {str(versions['frameworkShellsVersion'])!r}; "
        f"assert m.version('agent-log-server') == {str(versions['agentLogServerVersion'])!r}"
    )
    subprocess.run([sys.executable, "-c", script], env=env, check=True, timeout=60)
    for command in (
        [sys.executable, "-m", "app.cli.run_rust_framework", "--help"],
        [str(python_tree / "bin" / "fws"), "--help"],
        [str(python_tree / "bin" / "als-rs"), "--help"],
    ):
        subprocess.run(command, env=env, check=True, timeout=60, stdout=subprocess.DEVNULL)
    _validate_aarch64_elf(release / "libexec" / "te2-server")
    _validate_aarch64_elf(python_tree / "framework_shells" / "bin" / "fws-terminal-stream-broker")
    _validate_no_links(release)
    for script_path in (python_tree / "bin").iterdir():
        if not script_path.is_file() or script_path.is_symlink():
            continue
        first = script_path.read_bytes().splitlines()[:1]
        if first and first[0].startswith(b"#!") and str(prefix).encode() not in first[0]:
            raise SystemExit(f"Release script has an invalid interpreter: {script_path}")


def _activate_release(
    install_root: Path, prefix: Path, staged: Path, version: str
) -> None:
    releases = install_root / "releases"
    target = releases / version
    current = install_root / "current"
    wrappers = _wrapper_paths(prefix)
    (prefix / "bin").mkdir(parents=True, exist_ok=True)
    old_wrappers = _read_managed_wrappers(wrappers, action="replace")
    old_current = os.readlink(current) if current.is_symlink() else None
    if current.exists() and not current.is_symlink():
        raise SystemExit(f"TE2 current pointer is not a symbolic link: {current}")
    backup = releases / f".{version}.replaced"
    shutil.rmtree(backup, ignore_errors=True)
    try:
        if target.exists():
            os.replace(target, backup)
        os.replace(staged, target)
        _replace_symlink(current, f"releases/{version}")
        _write_wrappers(wrappers, install_root, prefix)
        shutil.rmtree(backup, ignore_errors=True)
    except BaseException:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        if backup.exists():
            os.replace(backup, target)
        if old_current is None:
            current.unlink(missing_ok=True)
        else:
            _replace_symlink(current, old_current)
        _restore_wrappers(old_wrappers)
        raise


def _activate_linux_release(
    install_root: Path,
    bin_dir: Path,
    staged: Path,
    version: str,
) -> None:
    releases = install_root / "releases"
    target = releases / version
    current = install_root / "current"
    wrappers = _wrapper_paths_for_bin(bin_dir)
    bin_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
    old_wrappers = _read_managed_wrappers(wrappers, action="replace")
    old_current = os.readlink(current) if current.is_symlink() else None
    if current.exists() and not current.is_symlink():
        raise SystemExit(f"TE2 current pointer is not a symbolic link: {current}")
    backup = releases / f".{version}.replaced"
    shutil.rmtree(backup, ignore_errors=True)
    try:
        if target.exists():
            os.replace(target, backup)
        os.replace(staged, target)
        _validate_linux_release(target, version, os.environ)
        _replace_symlink(current, f"releases/{version}")
        _write_linux_wrappers(wrappers, install_root)
        shutil.rmtree(backup, ignore_errors=True)
    except BaseException:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        if backup.exists():
            os.replace(backup, target)
        if old_current is None:
            current.unlink(missing_ok=True)
        else:
            _replace_symlink(current, old_current)
        _restore_wrappers(old_wrappers)
        raise


def _wrapper_paths(prefix: Path) -> dict[str, Path]:
    return {command: prefix / "bin" / command for command in MANAGED_COMMANDS}


def _wrapper_paths_for_bin(bin_dir: Path) -> dict[str, Path]:
    return {command: bin_dir / command for command in MANAGED_COMMANDS}


def _read_managed_wrappers(
    wrappers: Mapping[str, Path], *, action: str
) -> dict[Path, bytes | None]:
    previous: dict[Path, bytes | None] = {}
    for wrapper in wrappers.values():
        payload = wrapper.read_bytes() if wrapper.exists() else None
        if payload is not None and MANAGED_MARKER.encode() not in payload:
            raise SystemExit(f"Refusing to {action} an unmanaged executable: {wrapper}")
        previous[wrapper] = payload
    return previous


def _write_wrappers(
    wrappers: Mapping[str, Path], install_root: Path, prefix: Path
) -> None:
    for command, wrapper in wrappers.items():
        _write_wrapper(wrapper, install_root, prefix, command=command)


def _write_wrapper(
    wrapper: Path, install_root: Path, prefix: Path, *, command: str = "te2"
) -> None:
    if command not in MANAGED_COMMANDS:
        raise ValueError(f"Unsupported managed command: {command}")
    if command == "te2":
        invocation = 'exec "$prefix/bin/python" -m app.cli.run_rust_framework "$@"'
    else:
        invocation = f'exec "$release/python/bin/{command}" "$@"'
    body = f"""#!/bin/sh
{MANAGED_MARKER}
set -eu
install_root={shlex.quote(str(install_root))}
prefix={shlex.quote(str(prefix))}
link=$(readlink "$install_root/current")
case "$link" in
    /*) release=$link ;;
    *) release=$install_root/$link ;;
esac
if [ ! -d "$release/python" ] || [ ! -x "$release/libexec/te2-server" ]; then
    printf '%s\n' 'TE2 current release is incomplete.' >&2
    exit 1
fi
export PYTHONNOUSERSITE=1
export PYTHONPATH="$release/python${{PYTHONPATH:+:$PYTHONPATH}}"
export PATH="$release/python/bin:$prefix/bin:$PATH"
export TE2_SERVER_BIN="$release/libexec/te2-server"
{invocation}
"""
    temporary = wrapper.with_name(f".{wrapper.name}.tmp-{os.getpid()}")
    temporary.write_text(body, encoding="utf-8")
    temporary.chmod(0o755)
    os.replace(temporary, wrapper)


def _write_linux_wrappers(wrappers: Mapping[str, Path], install_root: Path) -> None:
    for command, wrapper in wrappers.items():
        body = f"""#!/bin/sh
{MANAGED_MARKER}
set -eu
install_root={shlex.quote(str(install_root))}
link=$(readlink "$install_root/current")
case "$link" in
    /*) release=$link ;;
    *) release=$install_root/$link ;;
esac
venv="$release/venv"
executable="$venv/bin/{command}"
if [ ! -x "$executable" ]; then
    printf '%s\n' 'TE2 current release is incomplete.' >&2
    exit 1
fi
export VIRTUAL_ENV="$venv"
unset PYTHONHOME
export PYTHONNOUSERSITE=1
export PATH="$venv/bin:$PATH"
exec "$executable" "$@"
"""
        temporary = wrapper.with_name(f".{wrapper.name}.tmp-{os.getpid()}")
        temporary.write_text(body, encoding="utf-8")
        temporary.chmod(0o755)
        os.replace(temporary, wrapper)


def _restore_wrappers(previous: Mapping[Path, bytes | None]) -> None:
    for wrapper, payload in previous.items():
        if payload is None:
            wrapper.unlink(missing_ok=True)
            continue
        wrapper.write_bytes(payload)
        wrapper.chmod(0o755)


def _rollback(install_root: Path, prefix: Path, version: str) -> None:
    release = install_root / "releases" / version
    if not (release / "install-receipt.json").is_file():
        raise SystemExit(f"Installed TE2 release is unavailable: {version}")
    wrappers = _wrapper_paths(prefix)
    _read_managed_wrappers(wrappers, action="replace")
    _replace_symlink(install_root / "current", f"releases/{version}")
    _write_wrappers(wrappers, install_root, prefix)


def _rollback_linux(install_root: Path, bin_dir: Path, version: str) -> None:
    release = install_root / "releases" / version
    if not (release / "install-receipt.json").is_file() or not (
        release / "venv" / "bin" / "te2"
    ).is_file():
        raise SystemExit(f"Installed TE2 release is unavailable: {version}")
    wrappers = _wrapper_paths_for_bin(bin_dir)
    _read_managed_wrappers(wrappers, action="replace")
    _replace_symlink(install_root / "current", f"releases/{version}")
    _write_linux_wrappers(wrappers, install_root)


def _uninstall(install_root: Path, prefix: Path) -> None:
    wrappers = _wrapper_paths(prefix)
    _read_managed_wrappers(wrappers, action="remove")
    for wrapper in wrappers.values():
        wrapper.unlink(missing_ok=True)
    shutil.rmtree(install_root)


def _uninstall_linux(install_root: Path, bin_dir: Path) -> None:
    wrappers = _wrapper_paths_for_bin(bin_dir)
    _read_managed_wrappers(wrappers, action="remove")
    current_te2 = install_root / "current" / "venv" / "bin" / "te2"
    desktop_receipt = install_root.parent / "desktop" / "electron" / "integration-receipt.json"
    if current_te2.is_file() and desktop_receipt.is_file():
        subprocess.run([str(current_te2), "desktop", "uninstall"], check=True, timeout=120)
    for wrapper in wrappers.values():
        wrapper.unlink(missing_ok=True)
    shutil.rmtree(install_root)


def _install_linux_desktop(
    release: Path,
    *,
    install_root: Path,
    bin_dir: Path,
    data_home: Path,
    home: Path,
) -> None:
    venv = release / "venv"
    te2 = venv / "bin" / "te2"
    environment = os.environ.copy()
    environment.update(
        {
            "HOME": str(home),
            "PATH": f"{venv / 'bin'}:{bin_dir}:{environment.get('PATH', '')}",
            "PYTHONNOUSERSITE": "1",
            "TE2_DATA_HOME": str(data_home),
            "VIRTUAL_ENV": str(venv),
        }
    )
    environment.pop("PYTHONHOME", None)
    subprocess.run(
        [str(te2), "desktop", "install"],
        env=environment,
        check=True,
        timeout=30 * 60,
    )
    _seed_desktop_local_framework_config(
        install_root=install_root,
        bin_dir=bin_dir,
        home=home,
    )


def _seed_desktop_local_framework_config(
    *,
    install_root: Path,
    bin_dir: Path,
    home: Path,
) -> Path:
    explicit = str(os.environ.get("TE2_CONFIG_HOME") or "").strip()
    if explicit:
        config_home = Path(explicit).expanduser()
    else:
        xdg = str(os.environ.get("XDG_CONFIG_HOME") or "").strip()
        config_home = Path(xdg).expanduser() / "te2" if xdg else home / ".config" / "te2"
    if not config_home.is_absolute():
        raise SystemExit(f"TE2 config root must be absolute: {config_home}")
    path = config_home / "desktop-local-framework.json"
    payload: dict[str, object]
    if path.exists():
        if not path.is_file():
            raise SystemExit(f"Desktop local-framework configuration is not a file: {path}")
        try:
            decoded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(
                f"Desktop local-framework configuration is invalid: {path}: {exc}"
            ) from exc
        if not isinstance(decoded, dict) or decoded.get("version") != 1:
            raise SystemExit(f"Desktop local-framework configuration is invalid: {path}")
        payload = dict(decoded)
        if payload.get("command") and payload.get("venvPath"):
            return path
        payload.setdefault("broadcast", [])
        payload.setdefault("env", {})
        payload.setdefault("port", 8089)
        payload["command"] = payload.get("command") or str(bin_dir / "te2")
        payload["venvPath"] = payload.get("venvPath") or str(
            install_root / "current" / "venv"
        )
    else:
        payload = {
            "broadcast": [],
            "command": str(bin_dir / "te2"),
            "env": {},
            "port": 8089,
            "venvPath": str(install_root / "current" / "venv"),
            "version": 1,
        }
    config_home.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def _replace_symlink(path: Path, target: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.unlink(missing_ok=True)
    os.symlink(target, temporary)
    os.replace(temporary, path)


def _manifest_version(manifest: Mapping[str, object]) -> str:
    distribution = _mapping(manifest.get("distribution"), "distribution")
    return _release_version(str(distribution.get("version") or ""))


def _release_version(version: str) -> str:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit(f"Invalid TE2 release version: {version!r}")
    return version


def _confirm_install(message: str, *, assume_yes: bool) -> None:
    if assume_yes:
        return
    print(message)
    prompt = "Install them with apt now? [y/N] "
    try:
        with open("/dev/tty", "r+", encoding="utf-8") as terminal:
            terminal.write(prompt)
            terminal.flush()
            answer = terminal.readline()
    except OSError as exc:
        raise SystemExit(
            "Interactive confirmation requires a terminal; rerun with --yes"
        ) from exc
    if answer.strip().lower() not in {"y", "yes"}:
        raise SystemExit("Installation cancelled")


def _payload_member(root: Path, relative: str) -> Path:
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        raise SystemExit(f"Unsafe payload path: {relative!r}")
    path = root / relative
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise SystemExit(f"Payload path escapes release root: {relative}") from exc
    return path


def _validate_no_links(root: Path) -> None:
    inodes: dict[tuple[int, int], Path] = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"Release tree contains a symbolic link: {path}")
        if not path.is_file():
            continue
        metadata = path.stat()
        key = (metadata.st_dev, metadata.st_ino)
        if key in inodes:
            raise SystemExit(f"Release tree contains a hard link: {inodes[key]} and {path}")
        inodes[key] = path


def _verify_wheel_platform(path: Path) -> None:
    with ZipFile(path) as archive:
        wheel_paths = [name for name in archive.namelist() if name.endswith(".dist-info/WHEEL")]
        if len(wheel_paths) != 1:
            raise SystemExit(f"Malformed wheel metadata: {path.name}")
        body = archive.read(wheel_paths[0]).decode("utf-8")
    tags = [line.split(":", 1)[1].strip() for line in body.splitlines() if line.startswith("Tag:")]
    if not tags:
        raise SystemExit(f"Wheel has no tags: {path.name}")
    for tag in tags:
        if tag.endswith("-any"):
            continue
        if not tag.endswith("-android_24_arm64_v8a"):
            raise SystemExit(f"Wheel is not compatible with the Termux target: {path.name} ({tag})")


def _validate_aarch64_elf(path: Path) -> None:
    header = path.read_bytes()[:64]
    if len(header) < 20 or header[:4] != b"\x7fELF":
        raise SystemExit(f"Expected ELF executable: {path}")
    if header[4] != 2 or header[5] != 1 or int.from_bytes(header[18:20], "little") != 183:
        raise SystemExit(f"Expected 64-bit little-endian AArch64 ELF: {path}")


def _dpkg_version(package: str) -> str | None:
    result = subprocess.run(
        ["dpkg-query", "-W", "-f=${Status}\t${Version}", package],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    status, _, version = result.stdout.strip().partition("\t")
    return version if status == "install ok installed" and version else None


def _mapping(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise SystemExit(f"Manifest {name} must be an object")
    return value


def _string_list(value: object, name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SystemExit(f"Manifest {name} must be a string list")
    return list(value)


def _command_output(command: list[str], *, required: bool) -> str:
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if required and result.returncode != 0:
        raise SystemExit(f"Command failed: {shlex.join(command)}")
    return result.stdout.strip()


def _check_free_space(path: Path) -> None:
    free = shutil.disk_usage(path).free
    if free < MINIMUM_FREE_BYTES:
        raise SystemExit(f"TE2 installation requires at least 2 GB free; found {free} bytes")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
