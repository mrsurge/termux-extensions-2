from __future__ import annotations

import importlib.util
import fcntl
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_PATH = REPO_ROOT / "rust-spike" / "app" / "bootstrap.py"


def _load_bootstrap() -> ModuleType:
    spec = importlib.util.spec_from_file_location("te2_rust_spike_bootstrap_test", BOOTSTRAP_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load rust spike bootstrap")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RustSpikeBootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bootstrap = _load_bootstrap()

    def test_default_launch_resolves_to_fingerprinted_cache_binary_without_runtime_cargo_target(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            cache_dir = Path(raw_tmp) / "cache"
            args = self.bootstrap._parse_args(["--cache-dir", str(cache_dir)])
            env: dict[str, str] = {}

            command = self.bootstrap._server_command(args, env, build=False)

            self.assertFalse(command.build_already_done)
            self.assertIn(str(cache_dir / "bin"), command.argv[0])
            self.assertTrue(command.argv[0].endswith(self.bootstrap._server_binary_name()))
            self.assertNotIn("CARGO_TARGET_DIR", env)

    def test_default_build_cache_uses_explicit_te2_cache_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            cache_home = Path(raw_tmp) / "te2-cache"
            args = self.bootstrap._parse_args([])
            environment = {"TE2_CACHE_HOME": str(cache_home)}

            command = self.bootstrap._server_command(args, environment, build=False)

            self.assertTrue(
                command.argv[0].startswith(str(cache_home / "framework" / "build" / "bin"))
            )

    def test_framework_shells_default_uses_explicit_te2_cache_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            cache_home = Path(raw_tmp) / "te2-cache"

            base_dir = self.bootstrap._default_framework_shells_base_dir(
                {"TE2_CACHE_HOME": str(cache_home)}
            )

            self.assertEqual(base_dir, cache_home / "framework_shells")

    def test_release_is_default_and_debug_is_explicit(self) -> None:
        release_args = self.bootstrap._parse_args([])
        debug_args = self.bootstrap._parse_args(["--debug"])

        self.assertTrue(release_args.release)
        self.assertFalse(debug_args.release)
        with self.assertRaises(SystemExit):
            self.bootstrap._parse_args(["--release", "--debug"])

    def test_explicit_cargo_manifest_keeps_direct_cargo_run_mode(self) -> None:
        args = self.bootstrap._parse_args(
            [
                "--cargo-manifest",
                "/example/rust/Cargo.toml",
                "--no-ferrous-framework",
            ]
        )
        env: dict[str, str] = {}

        command = self.bootstrap._server_command(args, env, build=False)

        self.assertEqual(command.argv[:4], ["cargo", "run", "--manifest-path", "/example/rust/Cargo.toml"])
        self.assertIn("--release", command.argv)
        self.assertNotIn("CARGO_TARGET_DIR", env)

    def test_debug_direct_cargo_mode_omits_release(self) -> None:
        args = self.bootstrap._parse_args(
            [
                "--cargo-manifest",
                "/example/rust/Cargo.toml",
                "--no-ferrous-framework",
                "--debug",
            ]
        )

        command = self.bootstrap._server_command(args, {}, build=False)

        self.assertNotIn("--release", command.argv)

    def test_successful_cached_build_prunes_stale_final_binaries_only(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            cache_dir = root / "cache"
            workspace = root / "rust"
            manifest = workspace / "Cargo.toml"
            _write(manifest, "[workspace]\n")
            stale = cache_dir / "bin" / "stale" / "release" / self.bootstrap._server_binary_name()
            _write(stale, "old")
            stale.chmod(0o755)
            incremental = cache_dir / "cargo-target" / "incremental" / "keep"
            _write(incremental, "incremental")

            args = self.bootstrap._parse_args(
                ["--cache-dir", str(cache_dir), "--cargo-manifest", str(manifest)]
            )
            environment: dict[str, str] = {}

            def fake_build(*_args, **kwargs):
                build_env = kwargs["env"]
                built = Path(build_env["CARGO_TARGET_DIR"]) / "release" / self.bootstrap._server_binary_name()
                _write(built, "new-binary")
                built.chmod(0o755)
                return subprocess.CompletedProcess([], 0)

            with mock.patch.object(self.bootstrap, "_rust_source_fingerprint", return_value="selected"), mock.patch.object(
                self.bootstrap.subprocess,
                "run",
                side_effect=fake_build,
            ):
                command = self.bootstrap._cached_server_command(
                    args,
                    environment,
                    manifest,
                    build=True,
                )

            selected = cache_dir / "bin" / "selected" / "release" / self.bootstrap._server_binary_name()
            self.assertEqual(command.argv, [str(selected)])
            self.assertTrue(self.bootstrap._cached_binary_is_usable(selected))
            self.assertFalse(stale.exists())
            self.assertEqual(incremental.read_text(encoding="utf-8"), "incremental")

    def test_build_cache_lock_serializes_independent_processes(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            cache_dir = Path(raw_tmp) / "cache"
            acquired = Path(raw_tmp) / "child-acquired"
            script = "\n".join(
                [
                    "import fcntl",
                    "import pathlib",
                    "import sys",
                    "lock_path = pathlib.Path(sys.argv[1])",
                    "lock_path.parent.mkdir(parents=True, exist_ok=True)",
                    "with lock_path.open('a+b') as lock_file:",
                    "    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)",
                    "    pathlib.Path(sys.argv[2]).write_text('acquired', encoding='utf-8')",
                ]
            )

            with self.bootstrap._exclusive_build_cache_lock(cache_dir):
                child = subprocess.Popen(
                    [sys.executable, "-c", script, str(cache_dir / ".build.lock"), str(acquired)]
                )
                time.sleep(0.15)
                self.assertIsNone(child.poll())
                self.assertFalse(acquired.exists())

            self.assertEqual(child.wait(timeout=5), 0)
            self.assertEqual(acquired.read_text(encoding="utf-8"), "acquired")

    def test_framework_lifetime_holds_shared_migration_guard(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            environment = {
                "HOME": str(root / "home"),
                "TE2_CACHE_HOME": str(root / "cache"),
                "TE2_DATA_HOME": str(root / "data"),
                "TE2_CONFIG_HOME": str(root / "config"),
                "TE2_RUNTIME_HOME": str(root / "runtime"),
            }

            with self.bootstrap._framework_migration_guard(environment):
                guard_path = root / "runtime" / "framework" / "migration.guard"
                with guard_path.open("a+b") as competing_guard:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(
                            competing_guard.fileno(),
                            fcntl.LOCK_EX | fcntl.LOCK_NB,
                        )

            self.assertEqual(0o700, (root / "runtime" / "framework").stat().st_mode & 0o777)

    def test_build_resolution_holds_shared_migration_guard(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            environment = {
                "HOME": str(root / "home"),
                "TE2_CACHE_HOME": str(root / "cache"),
                "TE2_DATA_HOME": str(root / "data"),
                "TE2_CONFIG_HOME": str(root / "config"),
                "TE2_RUNTIME_HOME": str(root / "runtime"),
            }
            args = self.bootstrap._parse_args(["--build-only"])

            def inspect_guard(_args: object, _env: object, *, build: bool) -> object:
                self.assertTrue(build)
                guard_path = root / "runtime" / "framework" / "migration.guard"
                with guard_path.open("a+b") as competing_guard:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(
                            competing_guard.fileno(),
                            fcntl.LOCK_EX | fcntl.LOCK_NB,
                        )
                return self.bootstrap.ServerCommand(["unused"], build_already_done=True)

            with (
                mock.patch.object(self.bootstrap, "_parse_args", return_value=args),
                mock.patch.object(self.bootstrap, "_build_env", return_value=environment),
                mock.patch.object(self.bootstrap, "_server_command", side_effect=inspect_guard),
            ):
                result = self.bootstrap.main([])

            self.assertEqual(0, result)

    def test_runtime_env_strips_generic_cargo_target_dir(self) -> None:
        env = {"CARGO_TARGET_DIR": "/shared/cargo-target"}

        self.bootstrap._sanitize_runtime_env(env)

        self.assertNotIn("CARGO_TARGET_DIR", env)
        self.assertEqual(env["TE2_RUST_SPIKE_CARGO_TARGET_DIR"], "/shared/cargo-target")

    def test_rust_source_fingerprint_changes_when_source_changes(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            workspace = Path(raw_tmp)
            manifest = workspace / "Cargo.toml"
            source = workspace / "crates" / "server" / "src" / "main.rs"
            _write(manifest, "[workspace]\nmembers = [\"crates/server\"]\n")
            _write(workspace / "Cargo.lock", "# lock\n")
            _write(workspace / "crates" / "server" / "Cargo.toml", "[package]\nname = \"server\"\n")
            _write(source, "fn main() {}\n")

            first = self.bootstrap._rust_source_fingerprint(manifest, profile="debug", features=[])
            _write(source, "fn main() { println!(\"changed\"); }\n")
            second = self.bootstrap._rust_source_fingerprint(manifest, profile="debug", features=[])

            self.assertNotEqual(first, second)

    def test_default_exposure_is_loopback_only(self) -> None:
        args = self.bootstrap._parse_args(["--host", self.bootstrap.DEFAULT_HOST])

        exposure = self.bootstrap._resolve_network_exposure(args)

        self.assertEqual(exposure.bind_hosts, ("127.0.0.1",))
        self.assertEqual(exposure.internal_host, "127.0.0.1")
        self.assertFalse(exposure.allow_all)
        self.assertEqual(exposure.source_networks, ())
        self.assertEqual(exposure.local_addresses, ())

    def test_broadcast_all_binds_dual_stack_but_keeps_internal_loopback(self) -> None:
        args = self.bootstrap._parse_args(["--broadcast", "all"])

        exposure = self.bootstrap._resolve_network_exposure(args)

        self.assertEqual(exposure.bind_hosts, ("0.0.0.0", "::"))
        self.assertEqual(exposure.internal_host, "127.0.0.1")
        self.assertTrue(exposure.allow_all)
        self.assertNotIn("0.0.0.0", self.bootstrap._http_url(exposure.internal_host, 8089))

    def test_exact_ip_and_cidr_selectors_resolve_for_both_families(self) -> None:
        args = self.bootstrap._parse_args(
            ["--broadcast", "192.168.50.42", "10.42.8.99/24", "fd7a:115c:a1e0::99/48"]
        )

        exposure = self.bootstrap._resolve_network_exposure(args)

        self.assertEqual(exposure.bind_hosts, ("0.0.0.0", "::"))
        self.assertEqual(
            exposure.source_networks,
            ("10.42.8.0/24", "192.168.50.42/32", "fd7a:115c:a1e0::/48"),
        )
        self.assertEqual(exposure.local_addresses, ())

    def test_ipv6_only_selector_keeps_a_private_ipv4_loopback_listener(self) -> None:
        args = self.bootstrap._parse_args(["--broadcast", "fd7a:115c:a1e0::/48"])

        exposure = self.bootstrap._resolve_network_exposure(args)

        self.assertEqual(exposure.bind_hosts, ("::", "127.0.0.1"))
        self.assertEqual(exposure.internal_host, "127.0.0.1")

    def test_interface_selector_uses_its_exact_local_destination_addresses(self) -> None:
        addresses = [
            self.bootstrap.InterfaceAddress("tailscale0", "100.108.128.8", 32),
            self.bootstrap.InterfaceAddress("tailscale0", "fd7a:115c:a1e0::7634:8008", 128),
            self.bootstrap.InterfaceAddress("wlan0", "192.168.1.50", 24),
        ]
        args = self.bootstrap._parse_args(["--broadcast", "tailscale0"])

        exposure = self.bootstrap._resolve_network_exposure(args, addresses)

        self.assertEqual(exposure.bind_hosts, ("0.0.0.0", "::"))
        self.assertEqual(exposure.source_networks, ())
        self.assertEqual(
            exposure.local_addresses,
            ("100.108.128.8", "fd7a:115c:a1e0::7634:8008"),
        )

    def test_exact_host_override_binds_only_that_address_plus_private_loopback(self) -> None:
        args = self.bootstrap._parse_args(["--host", "192.168.1.153"])

        exposure = self.bootstrap._resolve_network_exposure(args)

        self.assertEqual(exposure.bind_hosts, ("192.168.1.153", "127.0.0.1"))
        self.assertEqual(exposure.internal_host, "127.0.0.1")
        self.assertTrue(exposure.allow_all)

    def test_invalid_or_empty_selectors_fail_before_binding(self) -> None:
        with self.assertRaisesRegex(SystemExit, "non-empty selectors"):
            self.bootstrap._normalize_broadcast_arg([""])
        with self.assertRaisesRegex(SystemExit, "invalid --broadcast CIDR"):
            args = self.bootstrap._parse_args(["--broadcast", "10.0.0.0/not-a-prefix"])
            self.bootstrap._resolve_network_exposure(args, [])
        with self.assertRaisesRegex(SystemExit, "does not exist or has no usable"):
            args = self.bootstrap._parse_args(["--broadcast", "missing0"])
            self.bootstrap._resolve_network_exposure(args, [])

    def test_interface_inventory_is_structured_and_includes_empty_interfaces(self) -> None:
        addresses = [
            self.bootstrap.InterfaceAddress("lo", "127.0.0.1", 8),
            self.bootstrap.InterfaceAddress("lo", "::1", 128),
        ]
        with mock.patch.object(self.bootstrap.socket, "if_nameindex", return_value=[(1, "lo"), (2, "empty0")]), mock.patch.object(
            self.bootstrap.socket,
            "if_nametoindex",
            side_effect=lambda name: {"lo": 1, "empty0": 2}[name],
        ):
            inventory = self.bootstrap._interface_inventory(addresses)

        self.assertEqual([item["name"] for item in inventory["interfaces"]], ["empty0", "lo"])
        self.assertEqual(inventory["interfaces"][0]["addresses"], [])
        self.assertEqual(
            inventory["interfaces"][1]["addresses"],
            [
                {
                    "family": "ipv4",
                    "address": "127.0.0.1",
                    "prefixLength": 8,
                    "network": "127.0.0.0/8",
                },
                {
                    "family": "ipv6",
                    "address": "::1",
                    "prefixLength": 128,
                    "network": "::1/128",
                },
            ],
        )

    def test_build_env_publishes_loopback_internal_url_and_serialized_policy(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            explicit_roots = {
                "TE2_CACHE_HOME": str(root / "cache"),
                "TE2_DATA_HOME": str(root / "data"),
                "TE2_CONFIG_HOME": str(root / "config"),
                "TE2_RUNTIME_HOME": str(root / "runtime"),
            }
            args = self.bootstrap._parse_args(["--broadcast", "all", "--port", "8123"])
            with mock.patch.dict(os.environ, explicit_roots), mock.patch.object(
                self.bootstrap, "_reserve_local_port", return_value=49123
            ), mock.patch.object(self.bootstrap, "_ensure_framework_shells_env"):
                env = self.bootstrap._build_env(args)

            self.assertEqual(env["TE_FRAMEWORK_URL"], "http://127.0.0.1:8123")
            self.assertEqual(env["FRAMEWORK_SHELLS_FWS_SOCKETIO_URL"], env["TE_FRAMEWORK_URL"])
            self.assertEqual(env["TE2_RUST_SPIKE_BIND_HOSTS"], '["0.0.0.0","::"]')
            self.assertEqual(
                env["TE2_RUST_SPIKE_NETWORK_POLICY"],
                '{"allowAll":true,"localAddresses":[],"sourceNetworks":[]}',
            )
            for key, value in explicit_roots.items():
                self.assertEqual(env[key], value)
            self.assertEqual(
                env["TE2_RUST_SPIKE_APP_ROOTS"].split(os.pathsep)[-1],
                str(root / "data" / "apps"),
            )
            self.assertEqual((root / "runtime").stat().st_mode & 0o777, 0o700)

    def test_native_interface_discovery_returns_loopback_on_linux_or_android(self) -> None:
        addresses = self.bootstrap._interface_addresses()

        self.assertTrue(any(item.name == "lo" and item.ip.is_loopback for item in addresses))


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
