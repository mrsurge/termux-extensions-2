from __future__ import annotations

import unittest
from importlib.metadata import PackagePath
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app.cli import run_rust_framework


class FrameworkBootstrapDiscoveryTests(unittest.TestCase):
    def test_source_checkout_candidate_uses_canonical_framework_path(self) -> None:
        package_root = Path(run_rust_framework.app_pkg.__file__).resolve().parents[1]

        candidates = run_rust_framework._bootstrap_candidates()

        self.assertEqual(
            candidates[0],
            package_root / "framework" / "bootstrap" / "bootstrap.py",
        )
        self.assertTrue(
            all(
                candidate.as_posix().endswith("framework/bootstrap/bootstrap.py")
                for candidate in candidates
            )
        )

    def test_installed_distribution_candidate_uses_canonical_data_path(self) -> None:
        installed_root = Path("/opt/te2-install")
        distribution = SimpleNamespace(
            files=(
                PackagePath("te2/framework/bootstrap/bootstrap.py"),
                PackagePath("te2/framework/rust/Cargo.toml"),
            ),
            locate_file=lambda file: installed_root / file,
        )

        with mock.patch.object(
            run_rust_framework.metadata,
            "distribution",
            return_value=distribution,
        ):
            candidates = run_rust_framework._distribution_bootstrap_candidates()

        self.assertEqual(
            candidates,
            [installed_root / "te2/framework/bootstrap/bootstrap.py"],
        )


if __name__ == "__main__":
    unittest.main()
