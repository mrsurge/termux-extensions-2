from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType


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


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
