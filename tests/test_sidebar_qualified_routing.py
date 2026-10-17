from __future__ import annotations

import unittest
from unittest.mock import patch

from app.apps.code_te2.ui_ipc import sidebar_ws
from app.apps.code_te2.ui_ipc.sidebar_identity import SidebarIdentities


class SidebarQualifiedRoutingTests(unittest.TestCase):
    def test_shared_client_and_slot_can_still_resolve_each_exact_main_page(self) -> None:
        refs: dict[str, object] = {}

        def save(value: dict[str, object]) -> None:
            refs.clear()
            refs.update(value)

        registry = SidebarIdentities(lambda: dict(refs), save)
        client = 'client_abcdefghijkl'
        a = registry.register_page('A', client, 'window_aaaaaaaaaaaaaaaaaaaa')
        b = registry.register_page('B', client, 'window_bbbbbbbbbbbbbbbbbbbb')
        first = registry.qualify('A', 'shared-host', 'inc-a', 'als')
        second = registry.qualify('B', 'shared-host', 'inc-b', 'als')
        state = {'slots': {'shared-host': {'app_id': 'als-rs'}}}
        with (
            patch.object(sidebar_ws, 'sidebar_identities', registry),
            patch('app.apps.code_te2.ui_ipc.sidebar_window_state.get_sidebar_window_state', return_value=state),
            patch.object(sidebar_ws, '_registered_hosts', {'A', 'B'}),
            patch.object(sidebar_ws, '_client_ids_by_sid', {'A': client, 'B': client}),
            patch.object(sidebar_ws, '_client_presentations', {(client, 'shared-host'): 'inc-b'}),
            patch.object(sidebar_ws, '_client_active_windows', {}),
        ):
            for receipt in (first, second):
                target = {**receipt.payload(), 'clientId': client, 'hostId': 'shared-host',
                          'presentationId': receipt.incarnation}
                resolved_client, routed = sidebar_ws.resolve_sidebar_request_client(
                    {'path': '/project/file.py', 'target': target}, requester_app_id='als-rs',
                    require_presentation=True, allow_registered_inactive=True)
                self.assertEqual(resolved_client, client)
                self.assertEqual(routed['target']['sidebarWindowId'], receipt.qualified_id)
                self.assertEqual(routed['target']['windowId'], receipt.page.window_id)
            target = {**first.payload(), 'clientId': client, 'hostId': 'shared-host', 'presentationId': 'inc-b'}
            with self.assertRaisesRegex(ValueError, 'another main page'):
                sidebar_ws.resolve_sidebar_request_client({'target': target}, requester_app_id='als-rs')
        self.assertNotEqual(a.page_id, b.page_id)
