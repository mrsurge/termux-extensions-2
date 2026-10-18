from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from app.apps.code_te2.ui_ipc.sidebar_identity import SidebarIdentities


class SidebarIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.saved: dict[str, object] = {}
        self.writes = 0
        self.registry = SidebarIdentities(lambda: copy.deepcopy(self.saved), self.write)

    def write(self, value: dict[str, object]) -> None:
        self.saved = copy.deepcopy(value)
        self.writes += 1

    def target(self, sid: str, host: str, incarnation: str) -> dict[str, object]:
        receipt = self.registry.qualify(sid, host, incarnation, 'als')
        return {**receipt.payload(), 'clientId': receipt.page.client_id,
                'hostId': host, 'presentationId': incarnation}

    def test_shared_state_gets_distinct_parent_suffixes(self) -> None:
        with patch('app.apps.code_te2.ui_ipc.sidebar_identity.secrets.choice',
                   side_effect=list('f0f0c3d4a1b2')):
            a = self.registry.register_page('A', 'client-A', 'window-A')
            b = self.registry.register_page('B', 'client-B', 'window-B')
            first = self.target('A', 'shared-state', 'inc-A')
            second = self.target('B', 'shared-state', 'inc-B')
        self.assertEqual(a.page_id, 'f0f0')
        self.assertEqual(b.page_id, 'c3d4')
        self.assertEqual(first['sidebarWindowId'], 'als:a1b2.f0f0')
        self.assertEqual(second['sidebarWindowId'], 'als:a1b2.c3d4')
        self.assertIsNotNone(self.registry.validate(first))
        self.assertIsNotNone(self.registry.validate(second))

    def test_two_main_pages_in_one_installation_are_distinct(self) -> None:
        a = self.registry.register_page('A', 'same-installation', 'window-A')
        b = self.registry.register_page('B', 'same-installation', 'window-B')
        self.assertNotEqual(a.page_id, b.page_id)

    def test_restart_restoration_reuses_references_without_rewriting_state(self) -> None:
        page = self.registry.register_page('old', 'client-A', 'window-A')
        old = self.target('old', 'shared', 'old-inc')
        writes = self.writes
        registry = SidebarIdentities(lambda: copy.deepcopy(self.saved), self.write)
        self.assertEqual(registry.register_page('new', 'client-A', 'window-A').page_id, page.page_id)
        new = registry.qualify('new', 'shared', 'new-inc', 'als')
        self.assertEqual(new.qualified_id, old['sidebarWindowId'])
        self.assertEqual(writes, self.writes)

    def test_old_disconnect_does_not_remove_replacement_and_stale_incarnation_rejects(self) -> None:
        self.registry.register_page('old', 'c', 'w')
        old = self.target('old', 'shared', 'old-inc')
        self.registry.register_page('new', 'c', 'w')
        new = self.target('new', 'shared', 'new-inc')
        self.registry.disconnect('old')
        self.assertIsNotNone(self.registry.validate(new))
        with self.assertRaisesRegex(ValueError, 'stale'):
            self.registry.validate(old)

    def test_cross_parent_host_client_or_incarnation_rejects(self) -> None:
        self.registry.register_page('A', 'client-A', 'window-A')
        target = self.target('A', 'shared', 'inc-A')
        for field in ('clientId', 'mainPageId', 'sidebarWindowId', 'hostId', 'presentationId'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.registry.validate({**target, field: 'wrong'})
        self.registry.disconnect('A')
        with self.assertRaises(ValueError):
            self.registry.validate(target)

    def test_collisions_are_checked_and_old_urls_remain_compatible(self) -> None:
        with patch('app.apps.code_te2.ui_ipc.sidebar_identity.secrets.choice',
                   side_effect=list('aaaaaaaaBBBB')):
            a = self.registry.register_page('A', 'a', 'w')
            b = self.registry.register_page('B', 'b', 'w')
        self.assertEqual(a.page_id, 'aaaa')
        self.assertEqual(b.page_id, 'BBBB')
        self.assertIsNone(self.registry.validate({'clientId': 'legacy'}))
        with patch('app.apps.code_te2.ui_ipc.sidebar_identity.secrets.choice', return_value='a'):
            with self.assertRaisesRegex(ValueError, 'allocation failed'):
                self.registry.register_page('C', 'c', 'w')
