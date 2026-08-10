from __future__ import annotations

import os
import stat
import tempfile
import unittest
from pathlib import Path

from app.te2_paths import ensure_runtime_home, resolve_te2_paths


class Te2PathsTests(unittest.TestCase):
    def test_explicit_roots_are_final_and_xdg_values_are_bases(self) -> None:
        paths = resolve_te2_paths(
            {
                "HOME": "/home/test",
                "TE2_CACHE_HOME": "/custom/cache",
                "XDG_DATA_HOME": "/xdg/data",
                "XDG_CONFIG_HOME": "/xdg/config",
                "XDG_RUNTIME_DIR": "/run/user/1000",
            },
            home=Path("/home/test"),
            platform_temp=Path("/tmp"),
            uid=1000,
        )

        self.assertEqual(paths.cache_home, Path("/custom/cache"))
        self.assertEqual(paths.data_home, Path("/xdg/data/te2"))
        self.assertEqual(paths.config_home, Path("/xdg/config/te2"))
        self.assertEqual(paths.runtime_home, Path("/run/user/1000/te2"))

    def test_no_xdg_uses_home_and_platform_temp(self) -> None:
        paths = resolve_te2_paths(
            {},
            home=Path("/home/test"),
            platform_temp=Path("/var/tmp"),
            uid=1000,
        )

        self.assertEqual(paths.cache_home, Path("/home/test/.cache/te2"))
        self.assertEqual(paths.data_home, Path("/home/test/.local/share/te2"))
        self.assertEqual(paths.config_home, Path("/home/test/.config/te2"))
        self.assertEqual(paths.runtime_home, Path("/var/tmp/te2-1000"))

    def test_complete_explicit_roots_do_not_consult_lower_priority_fallbacks(self) -> None:
        paths = resolve_te2_paths(
            {
                "HOME": "relative-home",
                "TE2_CACHE_HOME": "/explicit/cache",
                "TE2_DATA_HOME": "/explicit/data",
                "TE2_CONFIG_HOME": "/explicit/config",
                "TE2_RUNTIME_HOME": "/explicit/runtime",
            },
            home=Path("relative-home"),
            platform_temp=Path("relative-temp"),
            uid=1000,
        )

        self.assertEqual(paths.cache_home, Path("/explicit/cache"))
        self.assertEqual(paths.data_home, Path("/explicit/data"))
        self.assertEqual(paths.config_home, Path("/explicit/config"))
        self.assertEqual(paths.runtime_home, Path("/explicit/runtime"))

    def test_termux_without_xdg_uses_prefix_temp(self) -> None:
        paths = resolve_te2_paths(
            {"PREFIX": "/data/data/com.termux/files/usr"},
            home=Path("/data/data/com.termux/files/home"),
            platform_temp=Path("/ignored"),
            uid=10234,
        )

        self.assertEqual(
            paths.runtime_home,
            Path("/data/data/com.termux/files/usr/tmp/te2-10234"),
        )

    def test_tmpdir_precedes_termux_prefix(self) -> None:
        paths = resolve_te2_paths(
            {
                "PREFIX": "/data/data/com.termux/files/usr",
                "TMPDIR": "/custom/tmp",
            },
            home=Path("/data/data/com.termux/files/home"),
            platform_temp=Path("/ignored"),
            uid=10234,
        )

        self.assertEqual(paths.runtime_home, Path("/custom/tmp/te2-10234"))

    def test_relative_override_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "TE2_CACHE_HOME must be an absolute path"):
            resolve_te2_paths(
                {"TE2_CACHE_HOME": "relative"},
                home=Path("/home/test"),
                platform_temp=Path("/tmp"),
                uid=1000,
            )

    def test_runtime_root_is_private_and_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            root = Path(raw_tmp)
            runtime = root / "runtime"
            ensure_runtime_home(runtime, uid=os.getuid())
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o700)

            target = root / "target"
            target.mkdir()
            link = root / "link"
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "must not be a symbolic link"):
                ensure_runtime_home(link, uid=os.getuid())


if __name__ == "__main__":
    unittest.main()
