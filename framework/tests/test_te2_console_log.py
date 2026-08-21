from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.cli import console_cli
from app.te2_console_log import iter_console_log_lines_reverse, read_console_log_tail
from app.te2_console_runtime import _normalize_tail_lines
from app.te2_mcp.console_store import ConsoleStore


class Te2ConsoleLogTests(unittest.TestCase):
    def test_reverse_reader_yields_complete_records_newest_first(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            log_path = Path(raw_tmp) / "console.jsonl"
            records = [json.dumps({"index": index}) for index in range(3000)]
            log_path.write_text("\n".join(records) + "\n", encoding="utf-8")

            latest = list(iter_console_log_lines_reverse(log_path))[:3]

            self.assertEqual(
                [json.loads(record)["index"] for record in latest],
                [2999, 2998, 2997],
            )

    def test_tail_stops_at_requested_lines_without_reading_history_into_result(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            log_path = Path(raw_tmp) / "console.jsonl"
            records = [json.dumps({"index": index}) for index in range(10000)]
            log_path.write_text("\n".join(records) + "\n", encoding="utf-8")

            tail = read_console_log_tail(log_path, max_lines=5, max_bytes=1024)

            self.assertTrue(tail.truncated)
            self.assertLessEqual(tail.bytes_selected, 1024)
            self.assertEqual(
                [json.loads(record)["index"] for record in tail.lines],
                [9995, 9996, 9997, 9998, 9999],
            )

    def test_mcp_tail_filters_while_retaining_chronological_order(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            log_path = Path(raw_tmp) / "console.jsonl"
            records = [
                {
                    "workerId": "worker-a" if index % 2 == 0 else "worker-b",
                    "level": "log",
                    "ts": index,
                    "args": [index],
                }
                for index in range(20)
            ]
            log_path.write_text(
                "".join(json.dumps(record) + "\n" for record in records),
                encoding="utf-8",
            )

            entries = ConsoleStore(log_path).tail(limit=3, worker_id="worker-a")

            self.assertEqual([entry.args[0] for entry in entries], [14, 16, 18])

    def test_cli_tail_is_bounded_and_search_iterator_keeps_full_history(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            log_path = Path(raw_tmp) / "console.jsonl"
            records = [
                {
                    "workerId": "worker-a",
                    "level": "log",
                    "ts": index,
                    "args": [f"entry-{index}"],
                }
                for index in range(100)
            ]
            log_path.write_text(
                "".join(json.dumps(record) + "\n" for record in records),
                encoding="utf-8",
            )

            with mock.patch.object(console_cli, "LOG_PATH", log_path):
                tail = console_cli._read_log_tail(limit=3)
                history = list(console_cli._iter_log_entries())

            self.assertEqual([entry["args"][0] for entry in tail], ["entry-97", "entry-98", "entry-99"])
            self.assertEqual(len(history), 100)
            self.assertEqual(history[0]["args"], ["entry-0"])

    def test_zero_tail_lines_means_inventory_without_replay(self) -> None:
        self.assertEqual(_normalize_tail_lines(0), 0)

    def test_oversized_manual_line_is_skipped_without_hiding_older_records(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            log_path = Path(raw_tmp) / "console.jsonl"
            log_path.write_bytes(b'{"older":true}\n' + (b"x" * 128) + b'\n')

            records = list(iter_console_log_lines_reverse(log_path, max_line_bytes=32))

            self.assertEqual(records, [b'{"older":true}'])


if __name__ == "__main__":
    unittest.main()
