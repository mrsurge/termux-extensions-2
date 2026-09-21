# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
import subprocess
import sys
import unittest

from app.apps.code_te2.monaco_editor.editor_backend_services.outcomes import EditorServiceError, SaveConflict
from app.apps.code_te2.monaco_editor.editor_backend_services.preferences_routes_service import handle_update_preference
from app.apps.code_te2.monaco_editor.editor_backend_services.save_routes_service import handle_save_current_file, SaveValidationError
from app.apps.code_te2.monaco_editor.editor_backend_services.view_settings_service import handle_set_font_scale, handle_set_view_settings

JsonMap = dict[str, object]


class Stores:
    def __init__(self) -> None:
        self.updates: list[JsonMap] = []
        self.failure: Exception | None = None

    def get_active_project(self) -> str | None:
        return None

    def get_preferences(self, project_path: str | None = None) -> JsonMap:
        del project_path
        return {"editor": {"autoSave": False}}

    def update_preferences(self, *, editor: JsonMap) -> JsonMap:
        if self.failure is not None:
            raise self.failure
        self.updates.append(editor)
        return {"editor": editor}

    def clear_cached_document(self, project_path: str, file_path: str) -> bool:
        del project_path, file_path
        return False

    def get_document_revision(self, project_path: str, file_path: str) -> int:
        del project_path, file_path
        return 0

    def advance_document_revision(self, project_path: str, file_path: str) -> int:
        del project_path, file_path
        return 1

    def prune_clean_drafts(self, project_path: str) -> int:
        del project_path
        return 0


def noop(*_args: object, **_kwargs: object) -> None:
    pass


def invalid(_value: object) -> float:
    raise RuntimeError("bad scale")


class Mismatch(Exception):
    def __init__(self) -> None:
        super().__init__("conflict")
        self.current_meta: JsonMap = {"sha256": "actual"}


class ServiceOutcomeTests(unittest.IsolatedAsyncioTestCase):
    async def preference(self, data: JsonMap, store: Stores) -> JsonMap:
        return await handle_update_preference(
            data, editors=[], preferences_store=store, history_store=store,
            get_project_root=lambda: Path("/project"), get_current_file=lambda: None,
            resolve_font_scale=invalid, normalize_rel_path=lambda _, path: path,
            collect_diff=lambda _root, _path, _base: {}, current_diff_base=lambda _: "HEAD",
            broadcast_cache_state=noop, refresh_active_diffs=noop,
            build_view_state_dict=lambda: {"ready": True}, theme_map={},
            emit_preferences_changed=noop,
        )

    async def save(self, writer: Callable[[str, str | None, str | None], Awaitable[JsonMap]]) -> JsonMap | SaveConflict:
        store = Stores()
        return await handle_save_current_file(
            {}, write_editor_buffer_to_disk_fn=writer, history_store=store,
            get_current_file=lambda: "/project/file", get_current_file_sha256=lambda: "old",
            base_mismatch_error_type=Mismatch, get_active_editor=lambda: None,
            get_cached_editor_content=lambda _: "", get_preferences=store.get_preferences,
            nicegui_broadcast=noop,
        )

    async def test_invalid_preferences_keep_socket_error_text_(self) -> None:
        cases: list[tuple[JsonMap, str]] = [
            ({}, "key is required"),
            ({"key": "no_such_key"}, "Invalid preference key: no_such_key"),
            ({"key": "fontScale", "value": 42}, "bad scale"),
            ({"key": "comparisonMode", "value": "bad"}, "Invalid comparison mode"),
        ]
        for data, detail in cases:
            store = Stores()
            with self.assertRaises(EditorServiceError) as error:
                _ = await self.preference(data, store)
            self.assertEqual(str(error.exception), f"400: {detail}")
            self.assertEqual(store.updates, [])

    async def test_preference_success_and_persistence_failure(self) -> None:
        store = Stores()
        self.assertEqual(await self.preference({"key": "comparisonMode", "value": "disk"}, store),
                         {"ok": True, "data": {"ready": True}})
        self.assertEqual(store.updates, [{"showInlineDiffs": False, "showDraftDiffs": True, "autoSave": False}])
        store.failure = RuntimeError("store offline")
        with self.assertRaises(EditorServiceError) as error:
            _ = await self.preference({"key": "showShading", "value": True}, store)
        self.assertEqual(error.exception.kind, "internal")
        self.assertEqual(str(error.exception), "500: Failed to apply preference: store offline")

    async def test_save_conflict_is_data_without_http_response(self) -> None:
        async def writer(*_args: object) -> JsonMap:
            raise Mismatch()
        result = await self.save(writer)
        self.assertIsInstance(result, SaveConflict)
        assert isinstance(result, SaveConflict)
        self.assertEqual(result.current, {"sha256": "actual"})

    async def test_save_success_validation_and_unexpected_failure(self) -> None:
        async def success(*_args: object) -> JsonMap:
            return {"sha256": "new"}
        result = await self.save(success)
        self.assertEqual(result, {"ok": True, "data": {"sha256": "new"}})

        for error in (SaveValidationError("no editor"), RuntimeError("write failed")):
            async def failure(*_args: object) -> JsonMap:
                raise error
            result = await self.save(failure)
            self.assertEqual(result, {"ok": False, "error": str(error)})


    async def test_cancellation_passes_through_service_(self) -> None:
        async def writer(*_args: object) -> JsonMap:
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            _ = await self.save(writer)

    async def test_font_scale_and_theme_validation(self) -> None:
        with self.assertRaises(EditorServiceError) as error:
            _ = handle_set_font_scale({}, get_active_editor=lambda: None,
                                      resolve_font_scale=invalid, update_editor_preferences=noop)
        self.assertEqual(str(error.exception), "400: bad scale")
        def invalid_theme(_name: str) -> str:
            raise RuntimeError("bad theme")
        with self.assertRaises(EditorServiceError) as error:
            _ = handle_set_view_settings(
                {"theme": "bad"}, get_active_editor=lambda: None,
                update_editor_preferences=noop, active_project=lambda: None,
                project_root=lambda: Path("/project"), normalize_rel_path=lambda _, p: p,
                collect_diff=lambda _root, _path, _base: {}, current_diff_base=lambda _: "HEAD",
                resolve_theme_preference=invalid_theme,
            )
        self.assertEqual(str(error.exception), "400: bad theme")

    async def test_font_scale_success_and_internal_error(self) -> None:
        updates: list[JsonMap] = []
        result = handle_set_font_scale({}, get_active_editor=lambda: None,
                                       resolve_font_scale=lambda _: 0.85,
                                       update_editor_preferences=updates.append)
        self.assertEqual(result, {"ok": True, "data": {"fontScale": 0.85}})
        self.assertEqual(updates, [{"fontScale": 0.85}])
        def fail(_data: JsonMap) -> object:
            raise RuntimeError("store offline")
        with self.assertRaises(EditorServiceError) as error:
            _ = handle_set_font_scale({}, get_active_editor=lambda: None,
                                      resolve_font_scale=lambda _: 1,
                                      update_editor_preferences=fail)
        self.assertEqual(error.exception.kind, "internal")
        self.assertEqual(error.exception.detail, "Failed to persist font scale: store offline")

    async def test_services_import_without_web_frameworks(self) -> None:
        # Fresh interpreter prevents cached imports from hiding transitive coupling.
        script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'pydantic', 'pydantic_core', 'starlette'}:
            raise ImportError('forbidden: ' + fullname)
sys.meta_path.insert(0, Block())
from app.apps.code_te2.monaco_editor.editor_backend_services import (
    outcomes, preferences_routes_service, view_settings_service, save_routes_service,
)
"""
        result = subprocess.run([sys.executable, "-c", script], capture_output=True,
                                cwd=Path(__file__).resolve().parents[1], timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
