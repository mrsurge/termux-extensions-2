# pyright: strict
from __future__ import annotations

import unittest
from typing import final

from app.apps.code_te2.host.secondary_content_state import (
    HistoricalContent, SecondaryContentState, WorkingContent,
)
from app.apps.code_te2.worker_services.history_service import HistoryBlobPair, HistoryBlobSide


@final
class SecondaryContentStateTests(unittest.TestCase):
    def test_failed_preparation_retains_working_content(self) -> None:
        state = SecondaryContentState()
        opened = state.begin("second", "secondary", "/project", 1)
        content = WorkingContent("/project/drafted.py")
        self.assertTrue(state.commit(opened, content))
        pending = state.begin("second", "secondary", "/project", 1)
        state.abort(pending)
        snapshot = state.snapshot("second", "/project", 1)
        assert snapshot is not None
        self.assertEqual(snapshot.content, content)
        self.assertFalse(state.commit(pending, content))

    def test_latest_selection_wins_and_commits_only_once(self) -> None:
        state = SecondaryContentState()
        first = state.begin("second", "secondary", "/project", 1)
        latest = state.begin("second", "secondary", "/project", 1)
        state.abort(first)
        content = WorkingContent("/project/latest.py")
        self.assertFalse(state.commit(first, content))
        self.assertTrue(state.commit(latest, content))
        self.assertFalse(state.commit(latest, content))

    def test_history_retains_exact_immutable_pair_for_reconnect(self) -> None:
        state = SecondaryContentState()
        token = state.begin("second", "secondary", "/project", 1)
        pair = HistoryBlobPair("a" * 40, None, 0,
            HistoryBlobSide("absent", None, None, None),
            HistoryBlobSide("text", "new.py", "b" * 40, "hello\n"))
        content = HistoricalContent("c" * 64, pair)
        self.assertTrue(state.commit(token, content))
        snapshot = state.snapshot("second", "/project", 1)
        assert snapshot is not None
        self.assertEqual(snapshot.content, content)
        self.assertIsNone(state.snapshot("other", "/project", 1))
        self.assertIsNone(state.snapshot("second", "/other", 1))
        self.assertIsNone(state.snapshot("second", "/project", 2))

    def test_project_generation_change_clears_and_fences(self) -> None:
        state = SecondaryContentState()
        first = state.begin("second", "secondary", "/project", 1)
        latest = state.begin("second", "secondary", "/project", 2)
        self.assertFalse(state.commit(first, WorkingContent("old")))
        snapshot = state.snapshot("second", "/project", 2)
        assert snapshot is not None
        self.assertIsNone(snapshot.content)
        self.assertTrue(state.commit(latest, WorkingContent("new")))

    def test_close_recreate_does_not_revive_old_token(self) -> None:
        state = SecondaryContentState()
        first = state.begin("second", "secondary", "/project", 1)
        state.close("second")
        latest = state.begin("second", "secondary", "/project", 1)
        self.assertNotEqual(first, latest)
        self.assertFalse(state.commit(first, WorkingContent("old")))
        state.clear_project("/project")
        self.assertFalse(state.is_current(latest))

    def test_client_capacity_does_not_evict_another_view(self) -> None:
        state = SecondaryContentState(capacity=1)
        first = state.begin("second", "secondary", "/project", 1)
        with self.assertRaises(RuntimeError):
            _ = state.begin("other", "secondary", "/project", 1)
        self.assertTrue(state.is_current(first))
        state.close("second")
        _ = state.begin("other", "secondary", "/project", 1)

    def test_primary_and_missing_identity_are_rejected(self) -> None:
        state = SecondaryContentState()
        with self.assertRaises(PermissionError):
            _ = state.begin("primary", "primary", "/project", 1)
        with self.assertRaises(ValueError):
            _ = state.begin("", "secondary", "/project", 1)
        with self.assertRaises(ValueError):
            _ = SecondaryContentState(capacity=0)

    def test_project_cleanup_preserves_other_clients_and_projects(self) -> None:
        state = SecondaryContentState()
        first = state.begin("one", "secondary", "/one", 1)
        other = state.begin("two", "secondary", "/two", 1)
        state.clear_project("/one")
        self.assertFalse(state.is_current(first))
        self.assertTrue(state.is_current(other))
