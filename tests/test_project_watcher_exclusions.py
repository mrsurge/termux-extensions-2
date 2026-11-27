from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.apps.code_te2.explorer.context import ExplorerWatcherHandlerContext
from app.apps.code_te2.explorer.handlers.watcher import watcher_exclusions_request
from app.apps.code_te2.history_store import HistoryStore
from app.apps.code_te2.project_sidecar import ProjectSidecar
from app.apps.code_te2 import code_server_shell_manager


def test_watcher_mode_gate_preserves_unmanaged_user_rules(tmp_path: Path) -> None:
    settings = tmp_path / "settings.json"
    settings.write_text('{"files.watcherExclude":{"**/output/**":true},"other":42}')
    with patch.object(code_server_shell_manager, "_USER_SETTINGS_PATH", settings):
        for mode in ("none", "ipc"):
            code_server_shell_manager.sync_vscode_watcher_settings(mode)
            data = json.loads(settings.read_text())
            assert data["other"] == 42
            assert data["files.watcherExclude"]["**/output/**"] is True
            assert ("**" in data["files.watcherExclude"]) == (mode == "none")


def test_save_restart_readback_noop_and_stale_project(tmp_path: Path) -> None:
    project = tmp_path / "repo"
    config = project / ".vscode" / "settings.json"
    config.parent.mkdir(parents=True)
    config.write_text('{"files.watcherExclude":{"**/inherited/**":true}}')
    history = HistoryStore(tmp_path / "history.json")
    emit = AsyncMock()
    ctx = ExplorerWatcherHandlerContext(project, emit, AsyncMock())
    rules = {"**/worktrees/**": True, "**/.codex-scratch/**": False}
    payload: dict[str, object] = {"projectPath": str(project), "generation": 9, "previous": {}, "exclusions": rules}
    with (patch("app.apps.code_te2.project_sidecar._sidecar_root", return_value=tmp_path),
          patch("app.apps.code_te2.stores.get_history_store", return_value=history),
          patch("app.apps.code_te2.worker_services.event_bus.current_project_generation", return_value=9),
          patch("app.apps.code_te2.explorer.services.extension_restarts.schedule_code_server_and_adapter_restart") as restart):
        history.set_active_project(str(project))
        asyncio.run(watcher_exclusions_request(ctx, payload, "save", save=True))
        restart.assert_called_once_with(emit, "watcher_exclusions")
        assert ProjectSidecar(str(project)).watcher_config()["exclusions"] == rules
        assert json.loads(config.read_text()) == {"files.watcherExclude": {"**/inherited/**": True}}
        asyncio.run(watcher_exclusions_request(ctx, {}, "read", save=False))
        reply = emit.await_args.args[1]
        assert reply["workspace"] == {"**/inherited/**": True}
        assert reply["exclusions"] == rules
        with pytest.raises(ValueError, match="changed"):
            asyncio.run(watcher_exclusions_request(ctx, payload, "stale", save=True))
        payload["previous"] = rules
        asyncio.run(watcher_exclusions_request(ctx, payload, "noop", save=True))
        assert emit.await_args.args[1]["changed"] is False
        history.set_active_project(str(tmp_path))
        with pytest.raises(ValueError, match="project changed"):
            asyncio.run(watcher_exclusions_request(ctx, payload, "switched", save=True))
        assert restart.call_count == 1
