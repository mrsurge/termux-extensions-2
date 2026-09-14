# pyright: strict
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from app.apps.code_te2.explorer.context import ExplorerGitHandlerContext
from app.apps.code_te2.explorer.handlers.git import handle_git_commit
from app.apps.code_te2.worker_services.git_service import GitStatus


async def emit(method: str, payload: dict[str, object], reply_to: str | None = None) -> None:
    del method, payload, reply_to


async def noop() -> None:
    pass


async def fact(*args: object, **kwargs: object) -> None:
    del args, kwargs


class CommitActionTest(IsolatedAsyncioTestCase):
    async def test_stage_completes_before_commit_and_failure_stops_commit(self) -> None:
        context = ExplorerGitHandlerContext(Path('/project'), set(), emit, emit, noop, noop)
        calls: list[str] = []
        status = GitStatus('main', False, 0, 0, [], ['a.txt'], [])

        def stage(root: Path) -> GitStatus:
            del root
            calls.append('stage')
            return status

        def commit(root: Path, message: str, amend: bool) -> GitStatus:
            del root, message, amend
            calls.append('commit')
            return status

        def failed_stage(root: Path) -> GitStatus:
            del root
            raise RuntimeError('stage failed')

        with patch('app.apps.code_te2.explorer.services.git_comparison.selected_ref', return_value='HEAD'), \
             patch('app.apps.code_te2.explorer.handlers.git.worker_git_service.get_status', return_value=status), \
             patch('app.apps.code_te2.explorer.handlers.git.worker_git_service.commit_changes', new=commit), \
             patch('app.apps.code_te2.explorer.handlers.git._mark_dirty_and_refresh', new=fact), \
             patch('app.apps.code_te2.explorer.handlers.git.publish_git_diff_base_changed', new=fact):
            with patch('app.apps.code_te2.explorer.handlers.git.worker_git_service.stage_all', new=stage):
                await handle_git_commit(context, {'message': 'test', 'amend': False, 'stageAll': True, 'projectPath': '/project'}, None)
                self.assertEqual(calls, ['stage', 'commit'])
                status.staged = ['other-client.txt']
                with self.assertRaisesRegex(ValueError, 'Staged selection changed'):
                    await handle_git_commit(context, {'message': 'test', 'amend': False, 'stageAll': True}, None)
                self.assertEqual(calls, ['stage', 'commit'])
                status.staged = []
            with patch('app.apps.code_te2.explorer.handlers.git.worker_git_service.stage_all', new=failed_stage):
                with self.assertRaisesRegex(RuntimeError, 'stage failed'):
                    await handle_git_commit(context, {'message': 'test', 'amend': False, 'stageAll': True}, None)
                self.assertEqual(calls, ['stage', 'commit'])
