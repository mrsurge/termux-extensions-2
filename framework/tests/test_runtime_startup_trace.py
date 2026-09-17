from __future__ import annotations

import io
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import msgspec

from app.libs.runtime_startup_trace import StartupTrace


class StartupTraceTests(unittest.TestCase):
    def test_external_origin_and_wall_clock(self) -> None:
        output = io.StringIO()
        with patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "1"}), redirect_stderr(output):
            with patch("time.perf_counter", return_value=12.5), patch("time.time_ns", return_value=1234000000):
                StartupTrace("fixture", started=10.0).mark("python.module_entry")
        self.assertIn('"sinceEntryMs": 2500.0', output.getvalue())
        self.assertIn('"unixMs": 1234', output.getvalue())

    def test_disabled_has_no_output(self) -> None:
        output = io.StringIO()
        with patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "0"}), redirect_stderr(output):
            trace = StartupTrace("fixture")
            with trace.span("import"):
                trace.mark("ready")
        self.assertEqual(output.getvalue(), "")

    def test_enabled_spans_are_stderr_only(self) -> None:
        output, protocol = io.StringIO(), io.StringIO()
        with patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "1"}), redirect_stderr(output), redirect_stdout(protocol):
            trace = StartupTrace("fixture")
            with trace.span("import"):
                pass
        self.assertEqual(protocol.getvalue(), "")
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn('"phase": "import.begin"', lines[0])
        self.assertIn('"phase": "import.end"', lines[1])
        self.assertIn('"outcome": "ok"', lines[1])
        self.assertIn('"elapsedMs":', lines[1])
        # Validate that log payloads remain parseable independent of the prefix.
        for line in lines:
            decoded: object = msgspec.json.decode(line.removeprefix("[startup_timing] "), type=object)
            self.assertIsInstance(decoded, dict)

    def test_exception_is_logged_and_preserved(self) -> None:
        output = io.StringIO()
        with patch.dict("os.environ", {"TE2_RUNTIME_DEBUG": "1"}), redirect_stderr(output):
            with self.assertRaisesRegex(ValueError, "original"):
                with StartupTrace("fixture").span("import"):
                    raise ValueError("original")
        self.assertIn('"outcome": "error"', output.getvalue())


if __name__ == "__main__":
    _ = unittest.main()
