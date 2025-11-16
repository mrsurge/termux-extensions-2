## Cache Bridge Tweaks (2025-11-16)
_Timestamp: 2025-11-16 00:29:28 UTC_

- Host `handleCacheStateBridgeEvent` now watches for `reason: 'watcher_external'` and calls `openFile(path, { forceRefresh: true })` via a new `triggerExternalRefresh` helper (guarded by `externalRefreshInProgress`).
- `openFile` gained a `forceRefresh` option so we can bypass the restored-session guard intentionally.
- Notes updated to mention the host-side full reload after external edits.

Overwrite with your own notes after review.
