# scripts/migrate_agent_sessions.py

"""
Backs up the existing agent sessions file to prevent data loss during
schema changes or other migrations.
"""

import shutil
from pathlib import Path

_SESSION_DIR = Path.home() / ".codex" / "agent_sessions"
_SESSION_FILE = _SESSION_DIR / "sessions.json"


def main():
    """
    Creates a timestamped backup of the sessions.json file.
    """
    if not _SESSION_FILE.exists():
        print("No sessions file found. Nothing to back up.")
        return

    backup_path = _SESSION_FILE.with_suffix(".json.bak")
    
    try:
        shutil.copy2(_SESSION_FILE, backup_path)
        print(f"Successfully backed up sessions to: {backup_path}")
    except Exception as e:
        print(f"Error creating backup: {e}")


if __name__ == "__main__":
    main()
