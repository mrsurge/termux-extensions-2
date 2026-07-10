# Persistent State Store

The shared `/api/state` service is implemented by the Rust framework in:

- `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/state_ops.rs`
- `rust-spike/rust/crates/te2-rust-spike-server/src/framework_services/net/state_net_ops.rs`

State is stored in
`$XDG_CACHE_HOME/termux_extensions/state_store.json` (or the equivalent
`~/.cache` path) using atomic JSON replacement.

## HTTP Contract

- `GET /api/state?key=<name>` reads one or more repeated `key` parameters.
- `POST /api/state` writes `{ "key": "...", "value": ..., "merge": false }`.
- `DELETE /api/state?key=<name>` removes one or more repeated keys.

Responses use the normal `{ "ok": true, "data": ... }` envelope.

The browser helper at `app/static/js/te_state.js` exposes `window.teState` with
`preload`, `get`, `getSync`, `set`, `merge`, `remove`, and `has`. Its cache is a
frontend projection; the Rust store is persistence authority.

Keep values small and JSON-serializable, and namespace keys by feature. Do not
restore a Python `/api/state` router or treat historical extension-specific
keys as part of the framework contract.
