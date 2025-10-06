# Persistent State Store

The front-end now shares a lightweight state cache backed by `/api/state`. The
helper lives in `app/static/js/te_state.js` and exposes `window.teState` with a
simple promise-based API:

```javascript
await window.teState.preload(['sessions_and_shortcuts.sessionNames']);
const names = window.teState.getSync('sessions_and_shortcuts.sessionNames', {});
await window.teState.set('sessions_and_shortcuts.sessionNames', names);
```

## API Surface

| Method | Description |
| --- | --- |
| `preload(keys)` | Batch fetches one or more keys (deduplicated). Returns a promise. |
| `get(key, defaultValue)` | Fetches a key (preloading on-demand). Resolves to cached value or fallback. |
| `getSync(key, defaultValue)` | Returns the cached copy synchronously (no network). |
| `set(key, value)` | Persists a value via `POST /api/state`. Updates the local cache. |
| `merge(key, value)` | Convenience helper for `POST` with `merge=true`. |
| `remove(keys)` | Deletes one or more keys via `DELETE /api/state`. |
| `has(key)` | Returns `true` when the value is already cached. |

All requests use the shared `/api/state` endpoints in `app/main.py`. Values are
stored in `~/.cache/termux_extensions/state_store.json` so settings survive browser
reloads and device reboots without relying on cookies or `localStorage`.

## Usage Guidelines

- Keep payloads small (JSON-serialisable). The store currently persists entire
  objects per key.
- Namespaces are recommended (`feature.key`) to avoid collisions.
- The helper caches responses in-memory, so repeated `getSync` calls are cheap.
- Handle failures gracefully (e.g. `get` returns the provided default if a request
  fails or the key is missing).

The Sessions & Shortcuts extension uses the store to keep framework tokens, custom
session names, and auto-refresh settings. The universal picker tracks its last
start directory per mode internally using `localStorage` because that behaviour is
per-device; everything else should prefer the shared state store for persistence.
