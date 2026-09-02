import json
from pathlib import Path
import unittest

from socketio.exceptions import ConnectionRefusedError as SocketIoConnectionRefusedError

from app.apps.terminal import terminal_lifecycle
from app.apps.terminal.terminal_stream_protocol import pack_message, unpack_message


def _terminal_shell(
    shell_id: str = "shell-a",
    *,
    status: str = "running",
    pid: int | None = 123,
) -> dict[str, object]:
    return {
        "id": shell_id,
        "label": "terminal-stream:1",
        "spec_id": "terminal-stream",
        "app_id": "terminal",
        "env_overrides": {"TERMINAL_STREAM_PROTOCOL": "msgpack-v1"},
        "status": status,
        "pid": pid,
        "cwd": "/workspace",
        "created_at": 100.0,
        "updated_at": 105.0,
    }


class TerminalShellFactStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_incremental_event_does_not_claim_complete_snapshot_readiness(self) -> None:
        store = terminal_lifecycle.TerminalShellFactStore("generation-a")
        shell = terminal_lifecycle.normalize_terminal_shell(_terminal_shell(), now=110.0)
        assert shell is not None
        snapshot, changed = await store.upsert(shell)
        self.assertTrue(changed)
        self.assertFalse(snapshot["ready"])
        self.assertEqual(snapshot["generation"], "generation-a")

    async def test_revisions_advance_only_for_meaningful_changes(self) -> None:
        store = terminal_lifecycle.TerminalShellFactStore("generation-a")
        shell = terminal_lifecycle.normalize_terminal_shell(_terminal_shell(), now=110.0)
        self.assertIsNotNone(shell)
        assert shell is not None

        snapshot, changed = await store.replace([shell])
        self.assertTrue(changed)
        self.assertEqual(snapshot["revision"], 1)
        self.assertEqual(snapshot["generation"], "generation-a")
        self.assertTrue(snapshot["ready"])
        self.assertEqual(snapshot["shells"], [shell])

        snapshot, changed = await store.replace([shell])
        self.assertFalse(changed)
        self.assertEqual(snapshot["revision"], 1)

        exited = terminal_lifecycle.normalize_terminal_shell(
            _terminal_shell(status="exited", pid=None),
            now=111.0,
        )
        assert exited is not None
        snapshot, changed = await store.upsert(exited)
        self.assertTrue(changed)
        self.assertEqual(snapshot["revision"], 2)
        shells = snapshot["shells"]
        self.assertIsInstance(shells, list)
        assert isinstance(shells, list)
        self.assertEqual(shells[0]["stats"], {"alive": False, "uptime": 0.0})

        snapshot, changed = await store.remove("shell-a")
        self.assertTrue(changed)
        self.assertEqual(snapshot["revision"], 3)
        self.assertEqual(snapshot["shells"], [])

    async def test_fws_events_filter_unrelated_shells_and_publish_terminal_changes(self) -> None:
        original_store = terminal_lifecycle._store
        original_emit = terminal_lifecycle._emit_snapshot
        emitted: list[dict[str, object]] = []

        async def capture(snapshot: dict[str, object], *, sid: str | None = None) -> None:
            self.assertIsNone(sid)
            emitted.append(snapshot)

        terminal_lifecycle._store = terminal_lifecycle.TerminalShellFactStore()
        terminal_lifecycle._emit_snapshot = capture
        try:
            unrelated = await terminal_lifecycle.apply_fws_notification(
                {
                    "method": "fws.shell.created",
                    "params": {"shell": {"id": "other", "label": "other"}},
                }
            )
            self.assertIsNone(unrelated)
            self.assertEqual(emitted, [])

            created = await terminal_lifecycle.apply_fws_notification(
                {
                    "method": "fws.shell.created",
                    "params": {"shell": _terminal_shell()},
                }
            )
            self.assertIsNotNone(created)
            self.assertEqual(len(emitted), 1)
            created_shells = emitted[0]["shells"]
            self.assertIsInstance(created_shells, list)
            assert isinstance(created_shells, list)
            self.assertEqual(created_shells[0]["id"], "shell-a")

            removed = await terminal_lifecycle.apply_fws_notification(
                {
                    "method": "fws.shell.removed",
                    "params": {"shell_id": "shell-a"},
                }
            )
            self.assertIsNotNone(removed)
            self.assertEqual(len(emitted), 2)
            self.assertEqual(emitted[-1]["shells"], [])
        finally:
            terminal_lifecycle._store = original_store
            terminal_lifecycle._emit_snapshot = original_emit


class TerminalLifecycleNamespaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_missing_codec_auth(self) -> None:
        namespace = terminal_lifecycle.TerminalLifecycleNamespace("/terminal")
        with self.assertRaises(SocketIoConnectionRefusedError):
            await namespace.on_connect("sid", {}, {"rpcCodec": "json"})

    async def test_requests_require_binary_messagepack(self) -> None:
        namespace = terminal_lifecycle.TerminalLifecycleNamespace("/terminal")
        response = unpack_message(
            await namespace.on_terminal_request("sid", {"method": "shells.get"})
        )
        self.assertFalse(response["ok"])
        self.assertIn("binary MessagePack", str(response["error"]))

    async def test_snapshot_request_returns_current_revision(self) -> None:
        original_store = terminal_lifecycle._store
        terminal_lifecycle._store = terminal_lifecycle.TerminalShellFactStore()
        try:
            request = pack_message(
                {"id": "request-a", "method": "shells.get", "params": {}}
            )
            namespace = terminal_lifecycle.TerminalLifecycleNamespace("/terminal")
            response = unpack_message(
                await namespace.on_terminal_request("sid", request)
            )
            self.assertTrue(response["ok"])
            self.assertEqual(response["id"], "request-a")
            result = response["result"]
            self.assertIsInstance(result, dict)
            assert isinstance(result, dict)
            snapshot = result["snapshot"]
            self.assertIsInstance(snapshot, dict)
            assert isinstance(snapshot, dict)
            self.assertEqual(snapshot["revision"], 0)
            self.assertFalse(snapshot["ready"])
        finally:
            terminal_lifecycle._store = original_store


class TerminalLifecycleRouteTests(unittest.TestCase):
    def test_manifest_declares_canonical_app_worker_socket_route(self) -> None:
        app_root = Path(__file__).resolve().parents[1] / "app" / "apps" / "terminal"
        manifest = json.loads((app_root / "manifest.json").read_text(encoding="utf-8"))
        descriptor = json.loads((app_root / "sio_service.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["sio_service"], "sio_service.json")
        self.assertEqual(
            descriptor["routes"],
            [
                {
                    "id": "app_worker",
                    "description": "Websocket-only Socket.IO lifecycle and control lane for the Terminal app.",
                    "target": "app_worker",
                    "public_path": "/api/app/terminal/socket.io",
                    "upstream_path": "/socket.io/",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
