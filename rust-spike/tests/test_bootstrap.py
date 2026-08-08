from __future__ import annotations

import importlib.util
import sys
import tempfile
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
        self.assertNotIn("CARGO_TARGET_DIR", env)

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
        args = self.bootstrap._parse_args([])

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
        args = self.bootstrap._parse_args(["--broadcast", "all", "--port", "8123"])
        with mock.patch.object(self.bootstrap, "_reserve_local_port", return_value=49123), mock.patch.object(
            self.bootstrap, "_ensure_framework_shells_env"
        ):
            env = self.bootstrap._build_env(args)

        self.assertEqual(env["TE_FRAMEWORK_URL"], "http://127.0.0.1:8123")
        self.assertEqual(env["FRAMEWORK_SHELLS_FWS_SOCKETIO_URL"], env["TE_FRAMEWORK_URL"])
        self.assertEqual(env["TE2_RUST_SPIKE_BIND_HOSTS"], '["0.0.0.0","::"]')
        self.assertEqual(
            env["TE2_RUST_SPIKE_NETWORK_POLICY"],
            '{"allowAll":true,"localAddresses":[],"sourceNetworks":[]}',
        )

    def test_native_interface_discovery_returns_loopback_on_linux_or_android(self) -> None:
        addresses = self.bootstrap._interface_addresses()

        self.assertTrue(any(item.name == "lo" and item.ip.is_loopback for item in addresses))


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
