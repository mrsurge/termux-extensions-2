"""Typed fixtures shared by the selected-commit branch regression tests."""
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from app.apps.code_te2.worker_services.git_service import GitSnapshot


def snapshot(head: str | None = 'b' * 40) -> GitSnapshot:
    return {
        'dto': 'GitSnapshot', 'version': 1, 'root': '/project',
        'projectPath': '/project', 'projectGeneration': None,
        'isRepository': True, 'hasHead': head is not None,
        'branch': 'main', 'detached': False,
        'head': {'full': head, 'short': head[:7]} if head else None,
        'ahead': 0, 'behind': 0, 'staged': [], 'unstaged': [],
        'untracked': [], 'statuses': {},
    }


def object_map(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise AssertionError(f'Expected mapping, got {type(value).__name__}')
    entries = cast(Mapping[object, object], value)
    if not all(isinstance(key, str) for key in entries):
        raise AssertionError('Expected string keys')
    return {str(key): item for key, item in entries.items()}


@dataclass
class History:
    ref: str = 'HEAD'
    refs: list[str] = field(default_factory=list)

    def get_diff_base(self, project_path: str | None) -> str:
        del project_path
        return self.refs.pop(0) if self.refs else self.ref

    def get_active_project(self) -> str:
        return '/project'

    def clear_cached_document(self, project_path: str, file_path: str) -> bool:
        del project_path, file_path
        return False


@dataclass
class Preferences:
    editor: dict[str, object] = field(default_factory=lambda: {
        'showInlineDiffs': True, 'showDraftDiffs': False, 'autoSave': False,
    })
    updates: list[dict[str, object]] = field(default_factory=list)

    def get_preferences(self, project_path: str | None = None) -> dict[str, object]:
        del project_path
        return {'editor': dict(self.editor)}

    def update_preferences(self, *, editor: dict[str, object]) -> dict[str, object]:
        self.updates.append(dict(editor))
        self.editor.update(editor)
        return self.get_preferences()


@dataclass
class SearchProvider:
    response: dict[str, object] = field(default_factory=dict)
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    async def __call__(self, method: str, params: dict[str, object], *, root: Path,
                       project_generation: int | None = None,
                       correlation_id: str | None = None, op_id: str | None = None) -> object:
        del root, project_generation, correlation_id, op_id
        self.calls.append((method, params))
        return self.response
