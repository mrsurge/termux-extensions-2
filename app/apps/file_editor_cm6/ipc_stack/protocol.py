"""Protocol adapters used by the IPC agent stack."""

from __future__ import annotations

# Re-export the existing CodexAdapter implementation so the IPC stack stays
# in sync with the ASGI bridge until the legacy code is removed.
from app.apps.file_editor_cm6.agent_bridge import CodexAdapter

__all__ = ["CodexAdapter"]
