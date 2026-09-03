import asyncio
import unittest

from app.apps.code_te2 import terminal_backend, terminal_shell_facts
from app.apps.code_te2.worker_services import run_profile_fws_bridge


class _Sidecar:
    def __init__(self) -> None:
        self.ids = ["shell-a", "shell-b"]

    def get_terminal_shell_ids(self) -> list[str]:
        return list(self.ids)

    def get_active_terminal_shell_id(self) -> str:
        return "shell-a"

    def get_terminal_shell_title(self, shell_id: str) -> str | None:
        return "build" if shell_id == "shell-a" else None


class _ProjectSidecarFactory:
    sidecar = _Sidecar()

    @classmethod
    def load_or_create(cls, _project_path: str) -> _Sidecar:
        return cls.sidecar


class _HistoryStore:
    def get_active_project(self) -> str:
        return "/workspace"


class CodeTe2TerminalFactTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        terminal_shell_facts.replace_terminal_shell_facts([])

    async def test_sidecar_projection_uses_retained_facts_without_manager_scan(self) -> None:
        terminal_shell_facts.record_terminal_shell_fact(
            {
                "id": "shell-a",
                "label": "code-editor-terminal:workspace:hash:1",
                "status": "running",
                "pid": 123,
                "stdout_log": "/logs/a",
            }
        )
        original_sidecar = terminal_backend.ProjectSidecar
        original_manager = terminal_backend._get_terminal_manager

        async def manager_must_not_run() -> object:
            raise AssertionError("shell-list projection performed a manager scan")

        terminal_backend.ProjectSidecar = _ProjectSidecarFactory
        terminal_backend._get_terminal_manager = manager_must_not_run
        try:
            result = await terminal_backend._build_terminal_shell_list("/workspace")
        finally:
            terminal_backend.ProjectSidecar = original_sidecar
            terminal_backend._get_terminal_manager = original_manager

        self.assertEqual(result["active_shell_id"], "shell-a")
        self.assertEqual(
            result["shells"],
            [
                {
                    "id": "shell-a",
                    "title": "build",
                    "display_label": "build/ll-a",
                    "status": "live",
                    "pid": 123,
                },
                {
                    "id": "shell-b",
                    "title": None,
                    "display_label": "Terminal/ll-b",
                    "status": "missing",
                    "pid": None,
                },
            ],
        )

    async def test_socket_shell_list_request_returns_correlated_result(self) -> None:
        original_history = terminal_backend.get_history_store
        original_sidecar = terminal_backend.ProjectSidecar
        terminal_backend.get_history_store = lambda: _HistoryStore()
        terminal_backend.ProjectSidecar = _ProjectSidecarFactory
        try:
            namespace = terminal_backend.TerminalSocketIONamespace("/terminal")
            response = await namespace.on_terminal_request(
                "sid",
                {"id": "request-a", "method": "shells.get", "params": {}},
            )
        finally:
            terminal_backend.get_history_store = original_history
            terminal_backend.ProjectSidecar = original_sidecar

        self.assertEqual(response["id"], "request-a")
        self.assertTrue(response["ok"])
        result = response.get("result")
        self.assertIsInstance(result, dict)
        if not isinstance(result, dict):
            self.fail("terminal request result must be an object")
        self.assertIn("shells", result)

    async def test_register_emits_identity_before_starting_history(self) -> None:
        events: list[str] = []
        original_history = terminal_backend.get_history_store
        original_manager = terminal_backend._get_terminal_manager
        original_resolve = terminal_backend._resolve_terminal_shell_id
        original_bind = terminal_backend._bind_terminal_sid
        original_generation = terminal_backend._next_terminal_bind_generation
        original_history_task = terminal_backend._start_terminal_history_task
        original_shell_list = terminal_backend._emit_terminal_shell_list_to_sid

        class _Namespace(terminal_backend.TerminalSocketIONamespace):
            async def emit(
                self,
                event: str,
                data: object | None = None,
                to: object | None = None,
                room: object | None = None,
                skip_sid: object | None = None,
                namespace: object | None = None,
                callback: object | None = None,
                ignore_queue: bool = False,
            ) -> object:
                del data, to, room, skip_sid, namespace, callback, ignore_queue
                events.append(event)
                return None

        async def manager() -> object:
            return object()

        async def resolve(*_args: object, **_kwargs: object) -> tuple[str, str]:
            return "shell-a", "/workspace"

        async def bind(*_args: object, **_kwargs: object) -> tuple[bool, str]:
            return False, "/workspace"

        async def generation(_sid: str) -> int:
            return 7

        async def start_history(
            _sid: str,
            _shell_id: str,
            _generation: int,
            columns: int,
            lines: int,
        ) -> None:
            self.assertEqual(columns, terminal_backend.DEFAULT_COLUMNS)
            self.assertEqual(lines, terminal_backend.DEFAULT_LINES)
            events.append("history:start")

        async def emit_shell_list(_sid: str, _project_path: str | None) -> None:
            events.append("shell-list:start")

        terminal_backend.get_history_store = lambda: _HistoryStore()
        terminal_backend._get_terminal_manager = manager
        terminal_backend._resolve_terminal_shell_id = resolve
        terminal_backend._bind_terminal_sid = bind
        terminal_backend._next_terminal_bind_generation = generation
        terminal_backend._start_terminal_history_task = start_history
        terminal_backend._emit_terminal_shell_list_to_sid = emit_shell_list
        try:
            namespace = _Namespace("/terminal")
            await namespace.on_terminal_register("sid", {"shellId": "auto"})
            await asyncio.sleep(0)
        finally:
            terminal_backend.get_history_store = original_history
            terminal_backend._get_terminal_manager = original_manager
            terminal_backend._resolve_terminal_shell_id = original_resolve
            terminal_backend._bind_terminal_sid = original_bind
            terminal_backend._next_terminal_bind_generation = original_generation
            terminal_backend._start_terminal_history_task = original_history_task
            terminal_backend._emit_terminal_shell_list_to_sid = original_shell_list

        self.assertEqual(events[0:2], ["terminal:shell_id", "history:start"])
        self.assertIn("shell-list:start", events)

    async def test_history_is_emitted_only_for_current_bind_generation(self) -> None:
        original_history = terminal_backend._terminal_history_data
        original_emit = terminal_backend._emit_terminal_to_sid
        emitted: list[tuple[str, dict[str, object], str]] = []

        async def history(
            _shell_id: str,
            _tail: int = 2000,
            *,
            columns: int,
            lines: int,
        ) -> dict[str, object]:
            self.assertEqual(columns, terminal_backend.DEFAULT_COLUMNS)
            self.assertEqual(lines, terminal_backend.DEFAULT_LINES)
            return {"stdout_text": "prompt"}

        async def emit(event: str, payload: dict[str, object], sid: str) -> None:
            emitted.append((event, payload, sid))

        terminal_backend._terminal_history_data = history
        terminal_backend._emit_terminal_to_sid = emit
        terminal_backend._terminal_sid_shells["sid"] = "shell-a"
        terminal_backend._terminal_sid_bind_generations["sid"] = 2
        try:
            await terminal_backend._emit_terminal_history_to_sid(
                "sid",
                "shell-a",
                1,
                terminal_backend.DEFAULT_COLUMNS,
                terminal_backend.DEFAULT_LINES,
            )
            self.assertEqual(emitted, [])
            await terminal_backend._emit_terminal_history_to_sid(
                "sid",
                "shell-a",
                2,
                terminal_backend.DEFAULT_COLUMNS,
                terminal_backend.DEFAULT_LINES,
            )
        finally:
            terminal_backend._terminal_history_data = original_history
            terminal_backend._emit_terminal_to_sid = original_emit
            terminal_backend._terminal_sid_shells.pop("sid", None)
            terminal_backend._terminal_sid_bind_generations.pop("sid", None)

        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0][0], "terminal:history")
        self.assertEqual(emitted[0][1]["bind_generation"], 2)
        self.assertEqual(emitted[0][1]["stdout_text"], "prompt")

    async def test_history_waits_for_fws_log_subscription(self) -> None:
        original_ensure = terminal_backend.ensure_terminal_log_stream
        original_history = terminal_backend._emit_terminal_history_to_sid
        events: list[str] = []
        stream_gate = asyncio.Event()

        async def ensure(_shell_id: str) -> None:
            events.append("stream")
            await stream_gate.wait()

        async def history(
            _sid: str,
            _shell_id: str,
            _generation: int,
            columns: int,
            lines: int,
        ) -> None:
            self.assertEqual(columns, terminal_backend.DEFAULT_COLUMNS)
            self.assertEqual(lines, terminal_backend.DEFAULT_LINES)
            events.append("history")

        terminal_backend.ensure_terminal_log_stream = ensure
        terminal_backend._emit_terminal_history_to_sid = history
        try:
            await terminal_backend._start_terminal_history_task(
                "sid",
                "shell-a",
                1,
                terminal_backend.DEFAULT_COLUMNS,
                terminal_backend.DEFAULT_LINES,
            )
            task = terminal_backend._terminal_history_tasks.get("sid")
            self.assertIsNotNone(task)
            await asyncio.sleep(0)
            self.assertEqual(events, ["stream"])
            stream_gate.set()
            if task is not None:
                await task
        finally:
            terminal_backend.ensure_terminal_log_stream = original_ensure
            terminal_backend._emit_terminal_history_to_sid = original_history
            terminal_backend._terminal_history_tasks.pop("sid", None)

        self.assertEqual(events, ["stream", "history"])


class CodeTe2TerminalFwsFactTests(unittest.TestCase):
    def setUp(self) -> None:
        terminal_shell_facts.replace_terminal_shell_facts([])

    def test_snapshot_replacement_filters_non_terminal_shells(self) -> None:
        changed = terminal_shell_facts.replace_terminal_shell_facts(
            [
                {
                    "id": "shell-a",
                    "label": "code-editor-terminal:workspace:hash:1",
                    "status": "running",
                    "pid": 123,
                    "stdout_log": "/logs/a",
                },
                {"id": "other", "label": "other", "status": "running", "pid": 456},
            ]
        )
        self.assertTrue(changed)
        fact = terminal_shell_facts.get_terminal_shell_fact("shell-a")
        self.assertIsNotNone(fact)
        self.assertEqual(fact.status if fact else None, "running")
        self.assertIsNone(terminal_shell_facts.get_terminal_shell_fact("other"))


class CodeTe2TerminalFwsStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_log_stream_open_is_idempotent_for_the_active_shell(self) -> None:
        original_client = run_profile_fws_bridge._client
        original_requested = run_profile_fws_bridge._terminal_log_requested_shell_id
        original_open = run_profile_fws_bridge._terminal_log_open_shell_id
        original_ready = run_profile_fws_bridge._terminal_log_stream_ready
        calls: list[dict[str, object]] = []

        class _Client:
            connected = True

            async def call(
                self,
                _event: str,
                data: object,
                *,
                namespace: str,
                timeout: int,
            ) -> dict[str, object]:
                del namespace, timeout
                if isinstance(data, dict):
                    calls.append(data)
                return {"result": {"accepted": True, "shell_id": "shell-a"}}

        run_profile_fws_bridge._client = _Client()
        run_profile_fws_bridge._terminal_log_requested_shell_id = ""
        run_profile_fws_bridge._terminal_log_open_shell_id = ""
        run_profile_fws_bridge._terminal_log_stream_ready = False
        try:
            await run_profile_fws_bridge.ensure_terminal_log_stream("shell-a")
            await run_profile_fws_bridge.ensure_terminal_log_stream("shell-a")
        finally:
            run_profile_fws_bridge._client = original_client
            run_profile_fws_bridge._terminal_log_requested_shell_id = original_requested
            run_profile_fws_bridge._terminal_log_open_shell_id = original_open
            run_profile_fws_bridge._terminal_log_stream_ready = original_ready

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].get("method"), "fws.logs.open")

    async def test_only_requested_stdout_chunks_are_forwarded(self) -> None:
        original_handler = run_profile_fws_bridge._terminal_log_chunk_handler
        original_requested = run_profile_fws_bridge._terminal_log_requested_shell_id
        chunks: list[tuple[str, str]] = []

        async def on_chunk(shell_id: str, chunk: str) -> None:
            chunks.append((shell_id, chunk))

        run_profile_fws_bridge._terminal_log_chunk_handler = on_chunk
        run_profile_fws_bridge._terminal_log_requested_shell_id = "shell-a"
        try:
            await run_profile_fws_bridge._on_notification(
                {
                    "method": "fws.logs.chunk",
                    "params": {"shell_id": "shell-a", "stream": "stdout", "chunk": "prompt"},
                }
            )
            await run_profile_fws_bridge._on_notification(
                {
                    "method": "fws.logs.chunk",
                    "params": {"shell_id": "shell-a", "stream": "stderr", "chunk": "ignored"},
                }
            )
            await run_profile_fws_bridge._on_notification(
                {
                    "method": "fws.logs.chunk",
                    "params": {"shell_id": "shell-b", "stream": "stdout", "chunk": "ignored"},
                }
            )
        finally:
            run_profile_fws_bridge._terminal_log_chunk_handler = original_handler
            run_profile_fws_bridge._terminal_log_requested_shell_id = original_requested

        self.assertEqual(chunks, [("shell-a", "prompt")])


if __name__ == "__main__":
    unittest.main()
