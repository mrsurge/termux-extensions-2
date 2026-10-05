"""Guard the compiled intelligence launch expression against suspension."""
from __future__ import annotations

import ast
from pathlib import Path
import unittest


class IntelligenceLaunchContextTests(unittest.TestCase):
    def test_launch_dictionaries_do_not_suspend_mid_construction(self) -> None:
        root = Path(__file__).resolve().parents[1] / "app/apps/code_te2"
        for filename in (
            "workbench_adapter_shell_manager.py",
            "code_server_shell_manager.py",
        ):
            with self.subTest(filename=filename):
                tree = ast.parse((root / filename).read_text())
                contexts: list[ast.Dict] = []
                for node in ast.walk(tree):
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "start_from_ref":
                        contexts.extend(
                            kw.value for kw in node.keywords
                            if kw.arg == "ctx" and isinstance(kw.value, ast.Dict)
                        )
                self.assertTrue(contexts)
                for context in contexts:
                    self.assertFalse(any(isinstance(node, ast.Await) for node in ast.walk(context)))
                    cache_values = [
                        value for key, value in zip(context.keys, context.values)
                        if isinstance(key, ast.Constant) and key.value == "NODE_COMPILE_CACHE"
                    ]
                    self.assertEqual(len(cache_values), 1)
                    self.assertIsInstance(cache_values[0], ast.Name)


if __name__ == "__main__":
    unittest.main()
