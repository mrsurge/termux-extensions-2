"""Compare native golden fixtures with Python under disposable TE2 paths.

The baseline is development-only and does not import any runtime/MCP server.
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
            from framework.mcp_probe.console_reference import ConsoleStore
            self.assertNotIn("app.te2_console_runtime", sys.modules)
            self.assertNotIn("fastmcp", sys.modules)

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
