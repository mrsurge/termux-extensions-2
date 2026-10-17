import unittest
from unittest.mock import patch

from app.libs.console_workers import ConsoleWorkers


class ConsoleWorkersTests(unittest.TestCase):
    def test_qualified_sidebar_names_are_preserved_and_old_disconnect_is_fenced(self) -> None:
        registry = ConsoleWorkers()
        old = registry.register('old', 'als:a1b2.f0f0', 'als', 'client-A', 'old-inc', compact=True, qualified=True)
        new = registry.register('new', 'als:a1b2.f0f0', 'als', 'client-A', 'new-inc', compact=True, qualified=True)
        registry.remove(old.sid)
        self.assertEqual(new.worker_id, 'als:a1b2.f0f0')
        self.assertEqual(registry.lookup('als:a1b2.f0f0').sid, 'new')
        self.assertEqual(registry.register('main', 'main_page:f0f0', 'main_page', 'client-A', qualified=True).worker_id,
                         'main_page:f0f0')
    def test_duplicate_legacy_name_is_ambiguous_but_both_sockets_survive(self) -> None:
        registry = ConsoleWorkers()
        first = registry.register('old', 'als:shared', 'als')
        second = registry.register('new', 'als:shared', 'als')
        self.assertNotEqual(first.worker_id, second.worker_id)
        with self.assertRaisesRegex(LookupError, 'ambiguous'):
            registry.lookup('als:shared')
        registry.remove('old')
        self.assertEqual(registry.lookup('als:shared').sid, 'new')
        registry.remove('old')
        self.assertEqual(registry.lookup(second.worker_id), second)

    def test_short_handles_share_only_parent_suffix_not_socket_address(self) -> None:
        registry = ConsoleWorkers()
        a = registry.register('a', 'shared', 'als', 'client-A', 'p1', compact=True)
        b = registry.register('b', 'shared', 'als', 'client-A', 'p2', compact=True)
        c = registry.register('c', 'shared', 'als', 'client-B', 'p3', compact=True)
        self.assertRegex(a.worker_id, r'^als:[a-zA-Z0-9]{4}\.[a-zA-Z0-9]{4}$')
        self.assertNotEqual(a.worker_id, b.worker_id)
        self.assertEqual(a.worker_id.split('.')[1], b.worker_id.split('.')[1])
        self.assertNotEqual(a.worker_id.split('.')[1], c.worker_id.split('.')[1])
        self.assertEqual(registry.lookup(a.worker_id).sid, 'a')

    def test_reregistration_is_idempotent_but_reconnect_never_reuses_address(self) -> None:
        registry = ConsoleWorkers()
        old = registry.register('old', 'shared', 'als', 'c', 'p', compact=True)
        self.assertIs(registry.register('old', 'shared', 'als', 'c', 'p', compact=True), old)
        new = registry.register('new', 'shared', 'als', 'c', 'p', compact=True)
        registry.remove('old')
        self.assertEqual(registry.lookup(new.worker_id).sid, 'new')
        with self.assertRaises(LookupError):
            registry.lookup(old.worker_id)

    def test_newer_socket_disconnect_does_not_remove_older_live_page(self) -> None:
        registry = ConsoleWorkers()
        old = registry.register('old', 'shared', 'als', 'c', 'p', compact=True)
        new = registry.register('new', 'shared', 'als', 'c', 'p', compact=True)
        registry.remove(new.sid)
        self.assertEqual(registry.lookup(old.worker_id), old)

    def test_random_collisions_retry_and_exhaustion_fails_explicitly(self) -> None:
        registry = ConsoleWorkers()
        with patch('app.libs.console_workers.secrets.choice', side_effect=list('aaaaaaaabbbb')):
            first = registry.register('a', 'shared', 'als', compact=True)
            second = registry.register('b', 'shared', 'als', compact=True)
        self.assertEqual(first.worker_id, 'als:aaaa')
        self.assertEqual(second.worker_id, 'als:bbbb')
        with patch('app.libs.console_workers.secrets.choice', return_value='a'):
            with self.assertRaisesRegex(ValueError, 'allocation failed'):
                registry.register('c', 'shared', 'als', compact=True)
        self.assertEqual(len(registry.by_sid), 2)
