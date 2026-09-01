# pyright: strict
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.explorer.context import ExplorerSessionHandlerContext
from app.apps.code_te2.explorer.handlers.session import handle_set_open_dirs


class ExplorerOpenDirectoriesTests(unittest.IsolatedAsyncioTestCase):
    async def test_set_open_dirs_replies_and_publishes_authoritative_projection(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project = Path(temp_dir)
            (project / "src" / "feature").mkdir(parents=True)
            emit_personal = AsyncMock()
            publish = AsyncMock()
            listings: list[dict[str, object]] = [
                {"cwd": "src", "entries": []},
                {"cwd": "src/feature", "entries": []},
            ]
            context = ExplorerSessionHandlerContext(
                project_root=project,
                emit_personal=emit_personal,
                broadcast=AsyncMock(),
                broadcast_git_status=AsyncMock(),
                broadcast_review_state=AsyncMock(),
            )

            with (
                patch(
                    "app.apps.code_te2.explorer.handlers.session.build_open_directory_listings",
                    new=AsyncMock(return_value=listings),
                ),
                patch(
                    "app.apps.code_te2.explorer.handlers.session.publish_explorer_open_directories_changed",
                    publish,
                ),
            ):
                await handle_set_open_dirs(
                    context,
                    {"dirs": ["src", "src/feature"]},
                    "request-1",
                )

            emit_personal.assert_awaited_once_with(
                "explorer.openDirs.updated",
                {"dirs": ["src", "src/feature"], "listings": listings},
                "request-1",
            )
            publish.assert_awaited_once_with(
                project,
                ["src", "src/feature"],
                reason="open_directories_set",
                source="explorer_session:set_open_directories",
            )


if __name__ == "__main__":
    _ = unittest.main()
