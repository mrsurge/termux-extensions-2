# pyright: strict
from __future__ import annotations

import unittest

from app.apps.code_te2.host.history_handoff import HistoryHandoffs
from app.apps.code_te2.host.secondary_content_state import HistoricalContent
from app.apps.code_te2.worker_services.history_service import HistoryBlobPair, HistoryBlobSide

CONTENT = HistoricalContent('a' * 64, HistoryBlobPair('b' * 40, None, 0,
    HistoryBlobSide('absent', None, None, None),
    HistoryBlobSide('text', 'gone.py', 'c' * 40, 'historical\n')))


class HistoryHandoffTests(unittest.TestCase):
    def test_single_use_and_project_generation_fences(self) -> None:
        queue = HistoryHandoffs()
        ticket = queue.issue('primary', '/project', 3, CONTENT, lambda: True)
        self.assertEqual(len(ticket), 48)
        self.assertEqual(queue.take(ticket, '/project', 3), CONTENT)
        with self.assertRaises(ValueError):
            _ = queue.take(ticket, '/project', 3)
        for project, generation in [('/other', 3), ('/project', 4)]:
            ticket = queue.issue('primary', '/project', 3, CONTENT, lambda: True)
            with self.assertRaises(ValueError):
                _ = queue.take(ticket, project, generation)

    def test_supersession_and_expiration(self) -> None:
        clock: list[float] = [0]
        queue = HistoryHandoffs(lambda: clock[0])
        first = queue.issue('primary', '/project', 3, CONTENT, lambda: True)
        second = queue.issue('primary', '/project', 3, CONTENT, lambda: True)
        with self.assertRaises(ValueError):
            _ = queue.take(first, '/project', 3)
        clock[0] = 61
        with self.assertRaises(ValueError):
            _ = queue.take(second, '/project', 3)

    def test_capacity_and_session_invalidation(self) -> None:
        queue = HistoryHandoffs()
        active = [True]
        for i in range(32):
            _ = queue.issue(str(i), '/project', 3, CONTENT, lambda: active[0])
        with self.assertRaises(RuntimeError):
            _ = queue.issue('overflow', '/project', 3, CONTENT, lambda: True)
        active[0] = False
        ticket = queue.issue('new', '/project', 3, CONTENT, lambda: True)
        self.assertEqual(queue.take(ticket, '/project', 3), CONTENT)
        with self.assertRaises(ValueError):
            _ = queue.issue('closed', '/project', 3, CONTENT, lambda: False)
