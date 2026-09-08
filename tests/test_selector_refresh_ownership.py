"""Comparison selection publishes intent once; the fact projector owns refresh."""
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

from app.apps.code_te2.explorer.context import ExplorerGitHandlerContext
from app.apps.code_te2.explorer.handlers import git
from app.apps.code_te2.worker_services import git_service


class SelectionHistory:
    def __init__(self) -> None:
        self.selections: list[tuple[str, str | None]] = []

    def set_diff_base(self, project: str, ref: str | None) -> str:
        self.selections.append((project, ref))
        return ref or 'HEAD'


class SelectorRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_head_and_historical_selection_have_only_fact_owned_refresh(self) -> None:
        for ref in ('HEAD', 'a' * 40):
            with self.subTest(ref=ref):
                status = AsyncMock()
                decorations = AsyncMock()
                context = ExplorerGitHandlerContext(
                    Path('/project'), set(), AsyncMock(), AsyncMock(), status, decorations,
                )
                history = SelectionHistory()
                fact = AsyncMock()
                with (
                    patch.object(git_service, 'get_commit_info', return_value=None) as lookup,
                    patch.object(git, '_get_history_store', return_value=history),
                    patch.object(git, 'publish_git_diff_base_changed', fact),
                    patch.object(git, 'mark_git_cache_dirty') as invalidate,
                ):
                    await git.handle_git_set_diff_base(context, {'ref': ref}, None)
                lookup.assert_called_once_with(Path('/project'), ref)
                self.assertEqual(history.selections, [('/project', ref)])
                fact.assert_awaited_once_with(
                    Path('/project'), ref=ref, refresh=False, source='explorer_git:set_diff_base',
                )
                status.assert_not_awaited()
                decorations.assert_not_awaited()
                invalidate.assert_not_called()

    async def test_invalid_ref_does_not_publish_or_persist(self) -> None:
        history = SelectionHistory()
        fact = AsyncMock()
        context = ExplorerGitHandlerContext(
            Path('/project'), set(), AsyncMock(), AsyncMock(), AsyncMock(), AsyncMock(),
        )
        with (
            patch.object(git_service, 'get_commit_info', side_effect=ValueError('invalid ref')),
            patch.object(git, '_get_history_store', return_value=history),
            patch.object(git, 'publish_git_diff_base_changed', fact),
        ):
            with self.assertRaisesRegex(ValueError, 'invalid ref'):
                await git.handle_git_set_diff_base(context, {'ref': 'invalid'}, None)
        self.assertEqual(history.selections, [])
        fact.assert_not_awaited()
