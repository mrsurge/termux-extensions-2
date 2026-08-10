from __future__ import annotations

import argparse
import ctypes
import fcntl
import hashlib
import importlib
import json
import os
import secrets
import signal
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Callable, Generator, Mapping, MutableMapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from pathlib import Path
from types import FrameType
from typing import Any, cast

from app.te2_paths import ensure_runtime_home, resolve_te2_paths

APP_ID = "te2"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = "8089"
DEFAULT_RUNTIME_BRIDGE_HOST = "127.0.0.1"
SERVER_PACKAGE = "te2-server"

SignalHandler = int | signal.Handlers | Callable[[int, FrameType | None], object]


@dataclass(frozen=True)
class BootstrapArgs:
    host: str
    port: str
    cache_dir: str | None
    server_bin: str | None
    cargo_manifest: str | None
    release: bool
    force_build: bool
    no_build_cache: bool
    build_only: bool
    print_command: bool
    no_ferrous_framework: bool
    broadcast: list[str] | None
    list_interfaces: bool
    framework_shells_base_dir: str | None
    framework_shells_secret: str | None
    framework_shells_repo_fingerprint: str | None
    framework_shells_secret_fingerprint: str | None
    framework_shells_fws_socketio_server_pid: str | None
    framework_shells_run_id: str | None


@dataclass(frozen=True)
class ServerCommand:
    argv: list[str]
    build_already_done: bool = False


@dataclass(frozen=True)
class InterfaceAddress:
    name: str
    address: str
    prefix_length: int

    @property
    def ip(self) -> IPv4Address | IPv6Address:
        return ip_address(self.address)

    @property
    def network(self) -> str:
        return ip_network(f"{self.address}/{self.prefix_length}", strict=False).with_prefixlen


@dataclass(frozen=True)
class NetworkExposureConfig:
    bind_hosts: tuple[str, ...]
    internal_host: str
    allow_all: bool
    source_networks: tuple[str, ...]
    local_addresses: tuple[str, ...]

    def policy_json(self) -> str:
        return json.dumps(
            {
                "allowAll": self.allow_all,
                "sourceNetworks": list(self.source_networks),
                "localAddresses": list(self.local_addresses),
            },
            separators=(",", ":"),
            sort_keys=True,
        )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.list_interfaces:
        print(json.dumps(_interface_inventory(), indent=2, sort_keys=True))
        return 0
    env = _build_env(args)
    if args.print_command:
        command = _server_command(args, env, build=False)
        print(" ".join(command.argv))
        return 0
    with _framework_migration_guard(env):
        command = _server_command(args, env, build=True)
        if args.build_only:
            if command.build_already_done:
                return 0
            return subprocess.run(command.argv, env=env, check=False).returncode
        return _run_child(command.argv, env)


def _parse_args(argv: Sequence[str] | None) -> BootstrapArgs:
    parser = argparse.ArgumentParser(
        prog="te2",
        description="Build and launch the TE2 Rust framework.",
        epilog=(
            "Standalone commands: te2 console <command>; "
            "te2 migrate-legacy-roots [--apply] [--json]"
        ),
    )
    parser.add_argument("--host", default=os.environ.get("TE2_SERVER_HOST", DEFAULT_HOST))
    parser.add_argument("--port", default=os.environ.get("TE2_SERVER_PORT", os.environ.get("TE_PORT", DEFAULT_PORT)))
    parser.add_argument(
        "--cache-dir",
        default=os.environ.get("TE2_SERVER_CACHE_DIR"),
        help="Cache root for packaged Rust builds. Defaults to XDG cache.",
    )
    parser.add_argument(
        "--server-bin",
        default=os.environ.get("TE2_SERVER_BIN"),
        help="Path to an already-built Rust server binary. Defaults to cargo run.",
    )
    parser.add_argument(
        "--cargo-manifest",
        default=os.environ.get("TE2_SERVER_CARGO_MANIFEST"),
        help="Path to rust/Cargo.toml for development launches.",
    )
    profile_group = parser.add_mutually_exclusive_group()
    profile_group.add_argument(
        "--release",
        dest="release",
        action="store_true",
        help="Build the optimized release server (default).",
    )
    profile_group.add_argument(
        "--debug",
        dest="release",
        action="store_false",
        help="Build the unoptimized debug server.",
    )
    parser.set_defaults(release=not _env_flag("TE2_SERVER_DEBUG"))
    parser.add_argument(
        "--force-build",
        action="store_true",
        default=_env_flag("TE2_SERVER_FORCE_BUILD"),
        help="Rebuild the cached Rust server even when the fingerprinted binary exists.",
    )
    parser.add_argument(
        "--no-build-cache",
        action="store_true",
        default=_env_flag("TE2_SERVER_NO_BUILD_CACHE"),
        help="Use cargo run/build directly instead of the fingerprinted binary cache.",
    )
    parser.add_argument("--build-only", action="store_true", help="Build the Rust server and exit without launching it.")
    parser.add_argument("--print-command", action="store_true", help="Print the resolved child command and exit.")
    parser.add_argument(
        "--broadcast",
        nargs="+",
        metavar="IP_SUBNET_OR_IFACE",
        help='Expose TE2 through "all", exact client IPs, CIDR subnets, or interface names.',
    )
    parser.add_argument(
        "--list-interfaces",
        action="store_true",
        help="Print structured interface/address information as JSON and exit.",
    )
    parser.add_argument(
        "--no-ferrous-framework",
        action="store_true",
        default=_env_flag("TE2_SERVER_DISABLE_FERROUS_FRAMEWORK"),
        help="Do not enable the native ferrous-framework feature for cargo builds.",
    )
    parser.add_argument("--framework-shells-base-dir", default=os.environ.get("FRAMEWORK_SHELLS_BASE_DIR"))
    parser.add_argument("--framework-shells-secret", default=os.environ.get("FRAMEWORK_SHELLS_SECRET"))
    parser.add_argument(
        "--framework-shells-repo-fingerprint",
        default=os.environ.get("FRAMEWORK_SHELLS_REPO_FINGERPRINT"),
    )
    parser.add_argument(
        "--framework-shells-secret-fingerprint",
        default=os.environ.get("FRAMEWORK_SHELLS_SECRET_FINGERPRINT"),
    )
    parser.add_argument(
        "--framework-shells-fws-socketio-server-pid",
        default=os.environ.get("FRAMEWORK_SHELLS_FWS_SOCKETIO_SERVER_PID"),
    )
    parser.add_argument("--framework-shells-run-id", default=os.environ.get("FRAMEWORK_SHELLS_RUN_ID"))
    raw = parser.parse_args(argv)
    return BootstrapArgs(
        host=cast(str, raw.host),
        broadcast=_normalize_broadcast_arg(raw.broadcast),
        port=cast(str, raw.port),
        cache_dir=cast(str | None, raw.cache_dir),
        server_bin=cast(str | None, raw.server_bin),
        cargo_manifest=cast(str | None, raw.cargo_manifest),
        release=cast(bool, raw.release),
        force_build=cast(bool, raw.force_build),
        no_build_cache=cast(bool, raw.no_build_cache),
        build_only=cast(bool, raw.build_only),
        print_command=cast(bool, raw.print_command),
        no_ferrous_framework=cast(bool, raw.no_ferrous_framework),
        list_interfaces=cast(bool, raw.list_interfaces),
        framework_shells_base_dir=cast(str | None, raw.framework_shells_base_dir),
        framework_shells_secret=cast(str | None, raw.framework_shells_secret),
        framework_shells_repo_fingerprint=cast(str | None, raw.framework_shells_repo_fingerprint),
        framework_shells_secret_fingerprint=cast(str | None, raw.framework_shells_secret_fingerprint),
        framework_shells_fws_socketio_server_pid=cast(str | None, raw.framework_shells_fws_socketio_server_pid),
        framework_shells_run_id=cast(str | None, raw.framework_shells_run_id),
    )


def _build_env(args: BootstrapArgs) -> dict[str, str]:
    env = os.environ.copy()
    _sanitize_runtime_env(env)
    paths = resolve_te2_paths(env)
    ensure_runtime_home(paths.runtime_home)
    paths.export(env)
    project_root = _project_root()
    framework_shells_root = project_root / "worktrees" / "framework-shells"
    app_roots = [
        project_root / "app" / "apps",
        paths.data_home / "apps",
    ]

    exposure = _resolve_network_exposure(args)
    env["TE2_SERVER_HOST"] = exposure.bind_hosts[0]
    env["TE2_SERVER_BIND_HOSTS"] = json.dumps(list(exposure.bind_hosts), separators=(",", ":"))
    env["TE2_SERVER_INTERNAL_HOST"] = exposure.internal_host
    env["TE2_SERVER_NETWORK_POLICY"] = exposure.policy_json()
    env["TE2_SERVER_PORT"] = str(args.port)
    env["TE2_SERVER_PROJECT_ROOT"] = str(project_root)
    env["TE2_SERVER_APP_ROOTS"] = os.pathsep.join(str(root) for root in app_roots)
    env["TE_PORT"] = str(args.port)
    env["TE_FRAMEWORK_URL"] = _http_url(exposure.internal_host, args.port)
    runtime_bridge_host = env.get("TE2_RUNTIME_BRIDGE_HOST", DEFAULT_RUNTIME_BRIDGE_HOST)
    runtime_bridge_port = env.get("TE2_RUNTIME_BRIDGE_PORT") or str(_reserve_local_port(runtime_bridge_host))
    env["TE2_RUNTIME_BRIDGE_HOST"] = runtime_bridge_host
    env["TE2_RUNTIME_BRIDGE_PORT"] = runtime_bridge_port
    env["TE2_RUNTIME_BRIDGE_URL"] = f"http://{runtime_bridge_host}:{runtime_bridge_port}"
    env["FRAMEWORK_SHELLS_FWS_SOCKETIO_URL"] = env["TE_FRAMEWORK_URL"]
    pythonpath_parts = [part for part in env.get("PYTHONPATH", "").split(os.pathsep) if part]
    prepend_paths = [str(project_root)]
    if framework_shells_root.exists():
        prepend_paths.insert(0, str(framework_shells_root))
    for path in reversed(prepend_paths):
        if path not in pythonpath_parts:
            pythonpath_parts.insert(0, path)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)

    _ensure_framework_shells_env(env, args)
    return env


def _sanitize_runtime_env(env: dict[str, str]) -> None:
    cargo_target_dir = env.pop("CARGO_TARGET_DIR", None)
    if cargo_target_dir:
        env.setdefault("TE2_SERVER_CARGO_TARGET_DIR", cargo_target_dir)


def _normalize_broadcast_arg(raw_broadcast: Sequence[str] | None) -> list[str] | None:
    if raw_broadcast is None:
        return None

    broadcast = [str(item).strip() for item in raw_broadcast]
    if not broadcast or any(not item for item in broadcast):
        raise SystemExit("--broadcast requires non-empty selectors")
    if "all" in broadcast:
        return ["all"]

    return list(dict.fromkeys(broadcast))


def _server_command(
    args: BootstrapArgs,
    env: MutableMapping[str, str],
    *,
    build: bool = True,
) -> ServerCommand:
    if args.server_bin:
        if args.build_only:
            raise SystemExit("--build-only cannot be used with --server-bin")
        return ServerCommand([str(Path(args.server_bin))])

    manifest = Path(args.cargo_manifest) if args.cargo_manifest else _default_rust_manifest()
    if not args.cargo_manifest and not args.no_build_cache:
        return _cached_server_command(args, env, manifest, build=build)

    subcommand = "build" if args.build_only else "run"
    command = [
        "cargo",
        subcommand,
        "--manifest-path",
        str(manifest),
        "-p",
        SERVER_PACKAGE,
    ]
    if args.release:
        command.append("--release")
    if _ferrous_framework_enabled(args):
        command.extend(["--features", "ferrous-framework-native"])
    if not args.build_only:
        command.append("--")
    return ServerCommand(command)


def _cached_server_command(
    args: BootstrapArgs,
    env: MutableMapping[str, str],
    manifest: Path,
    *,
    build: bool,
) -> ServerCommand:
    cache_dir = Path(args.cache_dir) if args.cache_dir else _default_cache_dir(env)
    profile = "release" if args.release else "debug"
    features = ["ferrous-framework-native"] if _ferrous_framework_enabled(args) else []
    fingerprint = _rust_source_fingerprint(manifest, profile=profile, features=features)
    binary_name = _server_binary_name()
    cached_binary = cache_dir / "bin" / fingerprint / profile / binary_name

    cargo_target_dir = Path(env.get("TE2_SERVER_CARGO_TARGET_DIR", cache_dir / "cargo-target"))
    if not build:
        return ServerCommand(
            [str(cached_binary)],
            build_already_done=_cached_binary_is_usable(cached_binary) and not args.force_build,
        )

    with _exclusive_build_cache_lock(cache_dir):
        if _cached_binary_is_usable(cached_binary) and not args.force_build:
            _prune_final_binary_cache(cache_dir / "bin", cached_binary)
            return ServerCommand([str(cached_binary)], build_already_done=True)

        build_command = [
            "cargo",
            "build",
            "--manifest-path",
            str(manifest),
            "-p",
            SERVER_PACKAGE,
        ]
        if args.release:
            build_command.append("--release")
        if features:
            build_command.extend(["--features", ",".join(features)])
        build_env = dict(env)
        build_env["CARGO_TARGET_DIR"] = str(cargo_target_dir)
        result = subprocess.run(build_command, env=build_env, check=False)
        if result.returncode != 0:
            raise SystemExit(result.returncode)

        built_binary = cargo_target_dir / profile / binary_name
        if not _cached_binary_is_usable(built_binary):
            raise SystemExit(f"Rust server build finished but binary is missing or unusable: {built_binary}")
        _publish_cached_binary(built_binary, cached_binary)
        _prune_final_binary_cache(cache_dir / "bin", cached_binary)
    return ServerCommand([str(cached_binary)], build_already_done=True)


@contextmanager
def _exclusive_build_cache_lock(cache_dir: Path) -> Generator[None, None, None]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    lock_path = cache_dir / ".build.lock"
    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


@contextmanager
def _framework_migration_guard(env: Mapping[str, str]) -> Generator[None, None, None]:
    """Hold a shared writer guard for the complete framework lifetime."""
    paths = resolve_te2_paths(env)
    guard_dir = ensure_runtime_home(paths.runtime_home / "framework")
    guard_path = guard_dir / "migration.guard"
    with guard_path.open("a+b") as guard_file:
        fcntl.flock(guard_file.fileno(), fcntl.LOCK_SH)
        try:
            yield
        finally:
            fcntl.flock(guard_file.fileno(), fcntl.LOCK_UN)


def _cached_binary_is_usable(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0 and os.access(path, os.X_OK)
    except OSError:
        return False


def _publish_cached_binary(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp-{os.getpid()}")
    try:
        shutil.copy2(source, temporary)
        temporary.chmod(temporary.stat().st_mode | 0o755)
        with temporary.open("rb") as file_handle:
            os.fsync(file_handle.fileno())
        if not _cached_binary_is_usable(temporary):
            raise RuntimeError(f"published Rust server binary is unusable: {temporary}")
        os.replace(temporary, destination)
        _fsync_directory(destination.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _prune_final_binary_cache(bin_root: Path, selected_binary: Path) -> None:
    if not _cached_binary_is_usable(selected_binary):
        raise RuntimeError(f"refusing to prune before the selected binary validates: {selected_binary}")

    selected_profile_dir = selected_binary.parent
    selected_fingerprint_dir = selected_profile_dir.parent
    if selected_fingerprint_dir.parent != bin_root:
        raise RuntimeError(f"selected binary is outside the final binary cache: {selected_binary}")

    for fingerprint_entry in tuple(bin_root.iterdir()):
        if fingerprint_entry != selected_fingerprint_dir:
            _remove_cache_entry(fingerprint_entry)
    for profile_entry in tuple(selected_fingerprint_dir.iterdir()):
        if profile_entry != selected_profile_dir:
            _remove_cache_entry(profile_entry)
    for binary_entry in tuple(selected_profile_dir.iterdir()):
        if binary_entry != selected_binary:
            _remove_cache_entry(binary_entry)
    _fsync_directory(bin_root)


def _remove_cache_entry(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.exists():
        shutil.rmtree(path)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _resolve_network_exposure(
    args: BootstrapArgs,
    interface_addresses: Sequence[InterfaceAddress] | None = None,
) -> NetworkExposureConfig:
    try:
        requested_host = ip_address(str(args.host).strip())
    except ValueError as exc:
        raise SystemExit(f"--host must be an exact IPv4 or IPv6 address: {args.host!r}") from exc

    if args.broadcast is None:
        host = str(requested_host)
        if requested_host.is_loopback:
            return NetworkExposureConfig((host,), host, False, (), ())
        if requested_host.is_unspecified:
            return NetworkExposureConfig((host,), _loopback_for(requested_host), True, (), ())
        loopback = _loopback_for(requested_host)
        return NetworkExposureConfig((host, loopback), loopback, True, (), ())

    if args.broadcast == ["all"]:
        return NetworkExposureConfig(("0.0.0.0", "::"), "127.0.0.1", True, (), ())

    addresses_by_name: dict[str, list[InterfaceAddress]] | None = None
    source_networks: set[str] = set()
    local_addresses: set[str] = set()
    families: set[int] = set()

    for selector in args.broadcast:
        if "/" in selector:
            try:
                network = ip_network(selector, strict=False)
            except ValueError as exc:
                raise SystemExit(f"invalid --broadcast CIDR selector {selector!r}: {exc}") from exc
            source_networks.add(network.with_prefixlen)
            families.add(network.version)
            continue

        try:
            address = ip_address(selector)
        except ValueError:
            if addresses_by_name is None:
                discovered = list(interface_addresses) if interface_addresses is not None else _interface_addresses()
                addresses_by_name = {}
                for item in discovered:
                    addresses_by_name.setdefault(item.name, []).append(item)
            selected = addresses_by_name.get(selector)
            if not selected:
                raise SystemExit(
                    f"--broadcast interface {selector!r} does not exist or has no usable IP addresses"
                )
            for item in selected:
                local_addresses.add(str(item.ip))
                families.add(item.ip.version)
            continue

        prefix = 32 if address.version == 4 else 128
        source_networks.add(ip_network(f"{address}/{prefix}", strict=False).with_prefixlen)
        families.add(address.version)

    if not families:
        raise SystemExit("--broadcast selectors resolved to no usable IPv4 or IPv6 exposure")

    bind_hosts: list[str] = []
    if 4 in families:
        bind_hosts.append("0.0.0.0")
    if 6 in families:
        bind_hosts.append("::")
    if 4 not in families:
        bind_hosts.append("127.0.0.1")

    return NetworkExposureConfig(
        tuple(bind_hosts),
        "127.0.0.1",
        False,
        tuple(sorted(source_networks)),
        tuple(sorted(local_addresses, key=lambda value: (ip_address(value).version, ip_address(value).packed))),
    )


def _loopback_for(address: IPv4Address | IPv6Address) -> str:
    return "127.0.0.1" if address.version == 4 else "::1"


def _http_url(host: str, port: str | int) -> str:
    parsed = ip_address(host)
    formatted = f"[{parsed}]" if parsed.version == 6 else str(parsed)
    return f"http://{formatted}:{port}"


def _interface_inventory(
    interface_addresses: Sequence[InterfaceAddress] | None = None,
) -> dict[str, list[dict[str, object]]]:
    discovered = list(interface_addresses) if interface_addresses is not None else _interface_addresses()
    grouped: dict[str, list[InterfaceAddress]] = {}
    for item in discovered:
        grouped.setdefault(item.name, []).append(item)
    interfaces: list[dict[str, object]] = []
    for name in sorted(set(grouped) | {item[1] for item in socket.if_nameindex()}):
        addresses = sorted(grouped.get(name, []), key=lambda item: (item.ip.version, item.ip.packed))
        interfaces.append(
            {
                "name": name,
                "index": socket.if_nametoindex(name),
                "addresses": [
                    {
                        "family": "ipv4" if item.ip.version == 4 else "ipv6",
                        "address": str(item.ip),
                        "prefixLength": item.prefix_length,
                        "network": item.network,
                    }
                    for item in addresses
                ],
            }
        )
    return {"interfaces": interfaces}


class _SockAddr(ctypes.Structure):
    _fields_ = [("sa_family", ctypes.c_ushort), ("sa_data", ctypes.c_ubyte * 14)]


class _SockAddrIn(ctypes.Structure):
    _fields_ = [
        ("sin_family", ctypes.c_ushort),
        ("sin_port", ctypes.c_ushort),
        ("sin_addr", ctypes.c_ubyte * 4),
        ("sin_zero", ctypes.c_ubyte * 8),
    ]


class _SockAddrIn6(ctypes.Structure):
    _fields_ = [
        ("sin6_family", ctypes.c_ushort),
        ("sin6_port", ctypes.c_ushort),
        ("sin6_flowinfo", ctypes.c_uint32),
        ("sin6_addr", ctypes.c_ubyte * 16),
        ("sin6_scope_id", ctypes.c_uint32),
    ]


class _IfAddrs(ctypes.Structure):
    pass


_IfAddrsPointer = ctypes.POINTER(_IfAddrs)
_IfAddrs._fields_ = [
    ("ifa_next", _IfAddrsPointer),
    ("ifa_name", ctypes.c_char_p),
    ("ifa_flags", ctypes.c_uint),
    ("ifa_addr", ctypes.POINTER(_SockAddr)),
    ("ifa_netmask", ctypes.POINTER(_SockAddr)),
    ("ifa_ifu", ctypes.POINTER(_SockAddr)),
    ("ifa_data", ctypes.c_void_p),
]


def _interface_addresses() -> list[InterfaceAddress]:
    libc = ctypes.CDLL(None, use_errno=True)
    getifaddrs = libc.getifaddrs
    freeifaddrs = libc.freeifaddrs
    getifaddrs.argtypes = [ctypes.POINTER(_IfAddrsPointer)]
    getifaddrs.restype = ctypes.c_int
    freeifaddrs.argtypes = [_IfAddrsPointer]
    freeifaddrs.restype = None

    head = _IfAddrsPointer()
    if getifaddrs(ctypes.byref(head)) != 0:
        errno_value = ctypes.get_errno()
        raise SystemExit(f"failed to enumerate network interfaces: {os.strerror(errno_value)}")

    discovered: dict[tuple[str, str, int], InterfaceAddress] = {}
    try:
        current = head
        while current:
            entry = current.contents
            if entry.ifa_name and entry.ifa_addr:
                family = int(entry.ifa_addr.contents.sa_family)
                if family in (socket.AF_INET, socket.AF_INET6):
                    raw_address = _sockaddr_bytes(entry.ifa_addr, family)
                    address = ip_address(socket.inet_ntop(family, raw_address))
                    if not address.is_unspecified and not address.is_multicast:
                        prefix_length = _netmask_prefix_length(entry.ifa_netmask, family)
                        if prefix_length is not None:
                            name = entry.ifa_name.decode("utf-8", "surrogateescape")
                            item = InterfaceAddress(name, str(address), prefix_length)
                            discovered[(item.name, item.address, item.prefix_length)] = item
            current = entry.ifa_next
    finally:
        freeifaddrs(head)

    return sorted(
        discovered.values(),
        key=lambda item: (item.name, item.ip.version, item.ip.packed, item.prefix_length),
    )


def _sockaddr_bytes(pointer: Any, family: int) -> bytes:
    if family == socket.AF_INET:
        value = ctypes.cast(pointer, ctypes.POINTER(_SockAddrIn)).contents.sin_addr
    else:
        value = ctypes.cast(pointer, ctypes.POINTER(_SockAddrIn6)).contents.sin6_addr
    return bytes(value)


def _netmask_prefix_length(pointer: Any | None, family: int) -> int | None:
    if not pointer:
        return None
    bits = "".join(f"{byte:08b}" for byte in _sockaddr_bytes(pointer, family))
    if "01" in bits:
        return None
    return bits.count("1")


def _ferrous_framework_enabled(args: BootstrapArgs) -> bool:
    return not args.no_ferrous_framework


def _ensure_framework_shells_env(env: dict[str, str], args: BootstrapArgs) -> None:
    _set_if_present(env, "FRAMEWORK_SHELLS_BASE_DIR", args.framework_shells_base_dir)
    _set_if_present(env, "FRAMEWORK_SHELLS_SECRET", args.framework_shells_secret)
    _set_if_present(env, "FRAMEWORK_SHELLS_REPO_FINGERPRINT", args.framework_shells_repo_fingerprint)
    _set_if_present(
        env,
        "FRAMEWORK_SHELLS_SECRET_FINGERPRINT",
        args.framework_shells_secret_fingerprint or args.framework_shells_repo_fingerprint,
    )
    _set_if_present(env, "FRAMEWORK_SHELLS_FWS_SOCKETIO_SERVER_PID", args.framework_shells_fws_socketio_server_pid)
    _set_if_present(env, "FRAMEWORK_SHELLS_RUN_ID", args.framework_shells_run_id)
    env.setdefault("FRAMEWORK_SHELLS_RUN_ID", APP_ID)
    env.setdefault("FRAMEWORK_SHELLS_SIGWINCH_ON_RESIZE", "1")

    if env.get("FRAMEWORK_SHELLS_SECRET"):
        _prime_framework_shells_import(env)
        return

    fingerprint = env.get("FRAMEWORK_SHELLS_REPO_FINGERPRINT") or _framework_shells_fingerprint()
    env["FRAMEWORK_SHELLS_REPO_FINGERPRINT"] = fingerprint
    env.setdefault("FRAMEWORK_SHELLS_SECRET_FINGERPRINT", fingerprint)

    base_dir = Path(env.get("FRAMEWORK_SHELLS_BASE_DIR") or _default_framework_shells_base_dir(env))
    secret_dir = base_dir / "runtimes" / fingerprint
    secret_file = secret_dir / "secret"
    if secret_file.is_file():
        secret = secret_file.read_text(encoding="utf-8").strip()
    else:
        secret_dir.mkdir(parents=True, exist_ok=True)
        secret = secrets.token_hex(32)
        secret_file.write_text(secret, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except OSError:
            pass

    env["FRAMEWORK_SHELLS_BASE_DIR"] = str(base_dir)
    env["FRAMEWORK_SHELLS_SECRET"] = secret
    _prime_framework_shells_import(env)


def _set_if_present(env: dict[str, str], key: str, value: str | None) -> None:
    if value:
        env[key] = value


def _framework_shells_fingerprint() -> str:
    root = os.environ.get("PWD") or str(_project_root())
    return hashlib.sha256(root.encode("utf-8")).hexdigest()[:16]


def _default_framework_shells_base_dir(environ: MutableMapping[str, str] | None = None) -> Path:
    source = environ if environ is not None else os.environ
    paths = resolve_te2_paths(source)
    return paths.cache_home / "framework_shells"


def _prime_framework_shells_import(env: dict[str, str]) -> None:
    try:
        framework_shells = importlib.import_module("framework_shells")
    except ImportError:
        return
    get_secret = getattr(framework_shells, "get_secret", None)
    if not callable(get_secret):
        return

    framework_env = {key: value for key, value in env.items() if key.startswith("FRAMEWORK_SHELLS_")}
    previous = {key: os.environ.get(key) for key in framework_env}
    try:
        os.environ.update(framework_env)
        get_secret()
    finally:
        for key, old_value in previous.items():
            if old_value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old_value


def _run_child(command: Sequence[str], env: dict[str, str]) -> int:
    runtime_bridge = _start_runtime_bridge(env)
    child = subprocess.Popen(command, env=env)
    previous_handlers: dict[signal.Signals, SignalHandler] = {}

    def forward_signal(signum: int, _frame: FrameType | None) -> object:
        # Let the Rust server run its FWS shutdown-tree sequence first. The
        # runtime bridge stays available for console/MCP traffic until cleanup.
        if child.poll() is None:
            child.send_signal(signum)

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signum] = cast(SignalHandler, signal.getsignal(signum))
        signal.signal(signum, forward_signal)

    try:
        return child.wait()
    finally:
        _stop_process(runtime_bridge, "runtime bridge")
        _stop_process(child, "Rust framework")
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _source_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _project_root() -> Path:
    source_project_root = _source_root().parent
    if (source_project_root / "app" / "apps").is_dir():
        return source_project_root
    try:
        import app as app_pkg
    except ImportError:
        return source_project_root
    package_project_root = Path(app_pkg.__file__).resolve().parents[1]
    if (package_project_root / "app" / "apps").is_dir():
        return package_project_root
    return source_project_root


def _default_rust_manifest() -> Path:
    source_manifest = _source_root() / "rust" / "Cargo.toml"
    if source_manifest.is_file():
        return source_manifest
    return _project_root() / "framework" / "rust" / "Cargo.toml"


def _default_cache_dir(environ: MutableMapping[str, str] | None = None) -> Path:
    source = environ if environ is not None else os.environ
    paths = resolve_te2_paths(source)
    return paths.cache_home / "framework" / "build"


def _server_binary_name() -> str:
    suffix = ".exe" if sys.platform == "win32" else ""
    return f"{SERVER_PACKAGE}{suffix}"


def _rust_source_fingerprint(manifest: Path, *, profile: str, features: Sequence[str]) -> str:
    workspace = manifest.parent
    hasher = hashlib.sha256()
    hasher.update(b"te2-server-build-cache-v2\0")
    hasher.update(str(workspace.resolve()).encode("utf-8", "surrogateescape"))
    hasher.update(b"\0")
    hasher.update(profile.encode("utf-8"))
    hasher.update(b"\0")
    hasher.update(",".join(sorted(features)).encode("utf-8"))
    hasher.update(b"\0")
    hasher.update(sys.platform.encode("utf-8"))
    hasher.update(b"\0")
    uname_result = os.uname() if hasattr(os, "uname") else None
    hasher.update(uname_result.machine.encode("utf-8") if uname_result is not None else b"")
    for path in _rust_fingerprint_paths(workspace):
        rel = path.relative_to(workspace).as_posix()
        hasher.update(b"\0path:")
        hasher.update(rel.encode("utf-8", "surrogateescape"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
    return hasher.hexdigest()[:24]


def _rust_fingerprint_paths(workspace: Path) -> list[Path]:
    candidates: list[Path] = []
    for relative in ("Cargo.toml", "Cargo.lock"):
        path = workspace / relative
        if path.is_file():
            candidates.append(path)
    crates_root = workspace / "crates"
    if crates_root.is_dir():
        candidates.extend(path for path in crates_root.rglob("Cargo.toml") if path.is_file())
        candidates.extend(path for path in crates_root.rglob("*.rs") if path.is_file())
    return sorted(candidates)


def _reserve_local_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def _start_runtime_bridge(env: dict[str, str]) -> subprocess.Popen[bytes]:
    command = [
        sys.executable,
        str(_source_root() / "bootstrap" / "runtime_bridge.py"),
        "--host",
        env["TE2_RUNTIME_BRIDGE_HOST"],
        "--port",
        env["TE2_RUNTIME_BRIDGE_PORT"],
    ]
    child = subprocess.Popen(command, env=env)
    time.sleep(0.2)
    if child.poll() is not None:
        raise SystemExit(child.returncode or 1)
    return child


def _stop_process(child: subprocess.Popen[bytes], label: str) -> None:
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
