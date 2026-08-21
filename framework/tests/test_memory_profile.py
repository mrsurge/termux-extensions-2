from __future__ import annotations

import json
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

from app import memory_profile


TOOL_PATH = Path(__file__).resolve().parents[1] / "tools" / "te2_memory_profile.py"


def _load_tool():
    spec = spec_from_file_location("te2_memory_profile_test", TOOL_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load TE2 memory profiling tool")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PythonMemoryProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tool = _load_tool()

    def test_capture_writes_loadable_snapshot_and_bounded_summary(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            output_dir = Path(raw_tmp)
            started_here = not tracemalloc.is_tracing()
            if started_here:
                tracemalloc.start(5)
            try:
                memory_profile._capture_snapshot(output_dir, "unit-test")
            finally:
                if started_here:
                    tracemalloc.stop()

            summaries = list(output_dir.glob("python-unit-test-*.json"))
            snapshots = list(output_dir.glob("python-unit-test-*.tracemalloc"))
            self.assertEqual(len(summaries), 1)
            self.assertEqual(len(snapshots), 1)
            payload = json.loads(summaries[0].read_text(encoding="utf-8"))
            self.assertEqual(payload["schemaVersion"], 1)
            self.assertEqual(payload["role"], "unit-test")
            self.assertLessEqual(len(payload["topAllocations"]), 100)
            self.assertLessEqual(
                len(payload["garbageCollector"]["topTrackedTypes"]),
                100,
            )

    def test_snapshot_signal_requires_explicit_opt_in_environment(self) -> None:
        self.assertFalse(
            self.tool._is_snapshot_capable(
                "node server.js",
                {"NODE_OPTIONS": "--trace-warnings"},
            )
        )
        self.assertTrue(
            self.tool._is_snapshot_capable(
                "node server.js",
                {"NODE_OPTIONS": "--heapsnapshot-signal=SIGUSR2"},
            )
        )
        self.assertFalse(
            self.tool._is_snapshot_capable(
                "python -m app.libs.app_worker",
                {},
            )
        )
        self.assertTrue(
            self.tool._is_snapshot_capable(
                "python -m app.libs.app_worker",
                {"TE2_MEMORY_PROFILE_DIR": "/profiles"},
            )
        )


if __name__ == "__main__":
    unittest.main()
