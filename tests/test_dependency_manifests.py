from __future__ import annotations

import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
FRAMEWORK_SHELLS_REQUIREMENT = "framework-shells==0.0.63"
AGENT_LOG_SERVER_REQUIREMENT = "agent-log-server==0.2.122"
NODEJS_WHEEL_REQUIREMENT = (
    'nodejs-wheel==24.16.0; sys_platform == "linux" '
    'and platform_machine == "x86_64"'
)


def _manifest_entries(relative_path: str) -> list[str]:
    entries: list[str] = []
    for raw_line in (REPO_ROOT / relative_path).read_text(encoding="utf-8").splitlines():
        entry = raw_line.split("#", maxsplit=1)[0].strip()
        if entry:
            entries.append(entry)
    return entries


class DependencyManifestTests(unittest.TestCase):
    def test_python_runtime_uses_pinned_first_party_wheels(self) -> None:
        requirements = _manifest_entries("requirements.txt")

        self.assertIn("uvicorn", requirements)
        self.assertIn("websockets", requirements)
        self.assertNotIn("uvicorn[standard]", requirements)
        self.assertNotIn("sse-starlette", requirements)
        self.assertIn(FRAMEWORK_SHELLS_REQUIREMENT, requirements)
        self.assertIn(AGENT_LOG_SERVER_REQUIREMENT, requirements)
        self.assertIn(NODEJS_WHEEL_REQUIREMENT, requirements)

    def test_als_shellspec_executes_the_wheel_entrypoint_without_login_shell(self) -> None:
        raw = (REPO_ROOT / "app/apps/als_rs/shellspec/app_worker.yaml").read_text(
            encoding="utf-8"
        )
        document = yaml.safe_load(raw)

        command = document["shells"]["app-worker"]["command"]
        self.assertEqual(["als-rs", "--port", "12459"], command)

if __name__ == "__main__":
    unittest.main()
