from __future__ import annotations

# pyright: reportAny=false, reportPrivateUsage=false

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.libs.jobs import Job, JobManager, JobStatus, jobs_state_file


class FrameworkJobsStoreTests(unittest.TestCase):
    def test_default_path_uses_the_canonical_framework_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            with patch.dict("os.environ", {"TE2_DATA_HOME": str(root)}, clear=False):
                self.assertEqual(jobs_state_file(), root / "framework" / "jobs.json")

    def test_round_trip_preserves_schema_and_marks_inflight_jobs_failed(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            state_file = Path(raw_root) / "framework" / "jobs.json"
            manager = JobManager(state_file=state_file)
            completed = Job(job_type="extract_archive", params={"archive_path": "/a.zip"})
            completed.mark_succeeded(result={"destination": "/out"})
            running = Job(job_type="bulk_copy", params={"items": ["/a"]})
            running.mark_running("Copying")
            manager._jobs = {completed.id: completed, running.id: running}
            manager._save_state()

            payload = json.loads(state_file.read_text())
            self.assertEqual(payload[completed.id]["type"], "extract_archive")
            self.assertEqual(payload[completed.id]["params"], {"archive_path": "/a.zip"})

            restored = JobManager(state_file=state_file)
            completed_after_restart = restored.get_job(completed.id)
            self.assertIsNotNone(completed_after_restart)
            assert completed_after_restart is not None
            self.assertEqual(completed_after_restart.status, JobStatus.SUCCEEDED)
            interrupted = restored.get_job(running.id)
            self.assertIsNotNone(interrupted)
            assert interrupted is not None
            self.assertEqual(interrupted.status, JobStatus.FAILED)
            self.assertEqual(interrupted.error, "Job interrupted by restart")

    def test_malformed_state_is_removed_as_before(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            state_file = Path(raw_root) / "framework" / "jobs.json"
            state_file.parent.mkdir(parents=True)
            _ = state_file.write_text("not-json")

            manager = JobManager(state_file=state_file)

            self.assertEqual(manager.list_jobs(), {})
            self.assertFalse(state_file.exists())
