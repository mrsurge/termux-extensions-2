from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FRAMEWORK_SHELLS_REQUIREMENT = (
    "framework-shells @ "
    "git+https://github.com/mrsurge/framework-shells"
    "@0bf3269cd69a000015b0ac484a04004b8dc564d1"
)


def _manifest_entries(relative_path: str) -> list[str]:
    entries: list[str] = []
    for raw_line in (REPO_ROOT / relative_path).read_text(encoding="utf-8").splitlines():
        entry = raw_line.split("#", maxsplit=1)[0].strip()
        if entry:
            entries.append(entry)
    return entries


class DependencyManifestTests(unittest.TestCase):
    def test_python_runtime_uses_portable_uvicorn_and_pinned_framework_shells(self) -> None:
        requirements = _manifest_entries("requirements.txt")

        self.assertIn("uvicorn", requirements)
        self.assertIn("websockets", requirements)
        self.assertNotIn("uvicorn[standard]", requirements)
        self.assertNotIn("sse-starlette", requirements)
        self.assertIn(FRAMEWORK_SHELLS_REQUIREMENT, requirements)

    def test_platform_manifests_do_not_install_global_code_server(self) -> None:
        ubuntu_npm = _manifest_entries("scripts/requirements/ubuntu/npm.txt")
        termux_tur = _manifest_entries("scripts/requirements/termux/tur.txt")

        self.assertNotIn("code-server", ubuntu_npm)
        self.assertNotIn("code-server", termux_tur)


if __name__ == "__main__":
    unittest.main()
