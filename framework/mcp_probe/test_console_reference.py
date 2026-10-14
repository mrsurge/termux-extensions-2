"""Compare native golden fixtures with Python under disposable TE2 paths.

The package initializer transitively imports the live-console module: isolate
cache/config/data before importing any app.te2_mcp module, not merely the server.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class ConsoleReferenceTests(unittest.TestCase):
    def test_shared_golden_fixture(self) -> None:
        fixture = json.loads((Path(__file__).parent / "fixtures/console_projection.json").read_text())
        scratch = Path(os.environ.get("TMPDIR") or Path(__file__).resolve().parents[2] / ".codex-scratch")
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="mcp-console-reference-", dir=scratch) as root:
            for name in ("CACHE", "CONFIG", "DATA", "RUNTIME"):
                os.environ[f"TE2_{name}_HOME"] = str(Path(root) / name.lower())
            # This script is a disposable subprocess. Never import this module
            # into the running runtime or move the import above these guards.
            from app.te2_mcp.console_store import ConsoleStore
            from app.te2_console_runtime import _log_fh
            self.assertTrue(Path(_log_fh.name).is_relative_to(Path(root)))
            self.addCleanup(_log_fh.close)

            path = Path(root) / "console.jsonl"
            path.write_text("\n".join(fixture["lines"]), encoding="utf-8")
            store = ConsoleStore(path)
            for case in fixture["cases"]:
                with self.subTest(operation=case["operation"], input=case["input"]):
                    if case["operation"] == "workers":
                        result = {"workers": store.list_workers(), "source": "console_log_jsonl"}
                    else:
                        entries = getattr(store, case["operation"])(**case["input"])
                        result = {"entries": [entry.model_dump(mode="json") for entry in entries], "total_returned": len(entries)}
                        if case["operation"] == "search":
                            result["query"] = case["input"]["query"]
                    self.assertEqual(result, case["expected"])


if __name__ == "__main__":
    unittest.main()
