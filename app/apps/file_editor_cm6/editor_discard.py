import hashlib
import os
import sys
from pathlib import Path


def handle_external_discard(project_path: str, file_path: str) -> None:
    """Revert the active editor when a draft is discarded externally."""
    from app.apps.file_editor_cm6.monaco_editor import editor_backend as backend

    editor = backend.get_active_editor()
    current = backend.get_current_file()

    if not editor or not current or os.path.abspath(file_path) != os.path.abspath(current):
        return

    print(f"[EDITOR] External discard detected for active file: {file_path}", file=sys.stderr)

    try:
        if os.path.exists(file_path):
            content = Path(file_path).read_text(encoding='utf-8', errors='replace')
            sha = hashlib.sha256(content.encode('utf-8')).hexdigest()
        else:
            content = ''
            sha = None

        editor.set_value(content)
        editor._cached_content = content
        backend.set_current_file(file_path, sha)
        backend._broadcast_cache_state(
            project_path,
            file_path,
            state='clean',
            unsaved=False,
            reason='discard_external',
        )
        editor.notify_parent('notification', {
            'message': 'Draft discarded from Review panel',
            'type': 'info',
        })
        editor.set_diff_decorations([])
    except Exception as exc:
        print(f"[EDITOR] Failed to revert active file: {exc}", file=sys.stderr)
