"""Retired change-ledger cleanup hook.

The old external-edit ledger diffed ``git diff HEAD`` on watcher events, which made
untracked/generated files expensive and noisy. The feature is retired; keep this
module as a tiny compatibility cleanup surface for project-switch paths that
still clear any old in-memory ledger state.
"""

from __future__ import annotations

import sys


def clear() -> None:
    """Clear retired change-ledger cache if it exists.

    The current implementation no longer keeps a ledger cache, so this is an
    intentionally safe no-op for callers that reset project-scoped runtime state.
    """
    print("[change_ledger] retired ledger cache clear requested", file=sys.stderr)
