# NiceGUI WS “Handshake Failed” / Reload Loops — What We Know + Current Mitigations

This note captures the **actual behavior we observed**, the **concrete culprits**, and the **current mitigations in TE2** for `file_editor_cm6`.

Primary goal: avoid “reload loops” / “handshake failed” cascades on flaky remote connections (e.g. accessing TE2 over LAN from desktop/mobile), while keeping state stable (SSOT, editor cursor, diffs, drafts).

---

## 0) Context: what is breaking?

We saw remote browsers repeatedly:

- Successfully upgrade to websocket (HTTP `101 Switching Protocols`)
- Immediately log: `reloading because handshake failed for clientId ...`
- Then trigger navigation / abort inflight fetches (Firefox: `NS_BINDING_ABORTED`)
- Then reconnect and repeat

This churn makes the overall framework “feel blocked” even though the server is running.

---

## 1) The specific log strings that matter

### 1.1 Client-side messages (browser console)

- `handshake failed for clientId <...> (failures=1); reloading in 2000ms`
- `reloading because handshake failed for clientId <...>`

These are emitted by **our modified CM6 bundle layer** and/or host `main.js` glue.

### 1.2 Server-side messages (TE2)

We also saw server logs like:

- `[NiceGUI WS] No Referer/app_id; defaulting to file_editor_cm6`
- `[NiceGUI Assets] No Referer, defaulting to file_editor_cm6`

Interpretation:
- The NiceGUI websocket + asset proxy logic is **falling back** to a default app id because the request lacks `Referer` and/or a usable `app_id` signal.
- This can be normal in some browsers (especially embedded / privacy / backgrounded contexts), but it is also a diagnostic signal that routing may be relying on heuristics instead of explicit metadata.

---

## 2) What we changed already (important)

### 2.1 We stopped hard reloading on every transient disconnect

We implemented a mitigation in the NiceGUI client JS path that:

- Sets `window.NICEGUI_CONTINUE_ON_DISCONNECT = true` (rarely-documented NiceGUI client knob)
- Patches the “handshake failed” branch to **not immediately hard reload** (or at least to back off / delay)

Why:
- Hard reload + flaky wifi creates a “storm” where the page never stabilizes long enough to resync.
- A reconnect strategy that tries to recover the session is better than repeatedly nuking the UI.

### 2.2 We made routing more explicit by sending `app_id` / avoiding referer reliance

Where possible, we pass `app_id=file_editor_cm6` explicitly to reduce dependency on referer.

This is aligned with the “services” approach we already use for explorer:
- Service endpoints and websocket mounts should **not** depend on the embedding page having a referer.

---

## 3) Why you saw “NiceGUI prefers one client”

This is not actually a websocket limitation.

NiceGUI’s UI state is per-client; if the backend updates only one element instance (e.g. the last-connected editor), only that client updates.

We fixed this by moving from:
- “update one `ui.codemirror` instance”
to:
- “iterate `get_active_editors()` and update all”

This is documented in:
- `new notes/code_cm6_current_runtime_contract.md`
- `new notes/nicegui_broadcast-multicast.md`

---

## 4) Related: why cross-origin remote clients exposed this sooner

When you access TE2 remotely (e.g. `http://192.168.x.x:8089`):

- Any missing/incorrect `Origin`, `Referer`, or query params can change how the host routes websocket requests.
- If any part of the client logic assumes `localhost` vs `192.168.x.x`, you can end up with inconsistent hostnames for the “same” service.
- Firefox’s `NS_BINDING_ABORTED` often shows up when a navigation occurs while requests are in-flight; our forced reload logic amplified this.

Thus: the underlying failure can be “small” (a transient reconnection mismatch), but the forced reload makes it catastrophic.

---

## 5) “Do we have conflicts with other sockets?” (NiceGUI vs explorer vs LSP)

### 5.1 Explorer socket (separate from NiceGUI)

Explorer has its own backend transport defined as a **system service**:

- `app/apps/file_editor_cm6/services/explorer_transport.py`
- declared via `app/apps/file_editor_cm6/manifest.json` under `services.modules`
- documented in `app/apps/file_editor_cm6/services/README.md` (must-read)

Explorer websocket is *not* the NiceGUI socket, and it is expected to be isolated.

### 5.2 LSP transport

The CM6 bundle has LSP support and can open its own sockets/ports depending on the language server.
If LSP uses a websocket bridge, it should **not** share the same routing heuristics as NiceGUI’s UI socket.

If we see “No Referer/app_id” associated with LSP-side sockets, that indicates we may be routing those sockets through the wrong proxy path.

Mitigation direction:
- If needed, mount LSP websocket(s) on an explicit service route (mirroring explorer’s service pattern), so it never touches the NiceGUI proxy code-path.

---

## 6) What we still may want to implement (next iteration ideas)

### 6.1 “New handshake without reload”

Instead of hard reload, prefer:

- clear/reset the NiceGUI client’s state for `client_id / next_message_id`
- re-init socket.io connection
- request a fresh server snapshot to resync UI state

The key is: “recover the session” rather than “restart the page”.

### 6.2 Client-id caching (localStorage + backend cache) — cautious use

Idea:
- keep a *soft* cache so transient disconnects don’t cause “identity loss”.

Risk:
- caching IDs across server restarts can cause “stale identity” problems unless the server can validate and reject them cleanly.

If we do this:
- cache must be ephemeral (overwrite each page load)
- server must accept “unknown id → mint new id” without forcing client reload

---

## 7) Where to look when debugging this in code

### 7.1 Client-side (NiceGUI + CM6)

- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - handshake/reconnect logging
  - any reload/backoff logic
  - any derived “client id” parsing / caching

### 7.2 Host shell (outer JS)

- `app/apps/file_editor_cm6/main.js`
  - hooks that may reload the page or iframe
  - events from the iframe: `cm6_client_id`, cache-state, toasts

### 7.3 Proxy layer (server routing)

- `app/main.py`
  - websocket proxy routing for `/ui/_nicegui_ws/...`
  - logging: “No Referer/app_id”
  - any default-app-id heuristics

### 7.4 Services architecture reference

- `app/apps/file_editor_cm6/services/README.md`

This is the model we want: explicit routing, explicit metadata, no reliance on browser referer.

---

## 8) Current status

- Most of the “handshake failed → hard reload” pain is mitigated.
- Remaining instability should be investigated as:
  1) true networking flakiness (wifi, Android backgrounding)
  2) routing metadata missing (`app_id` / referer)
  3) multiple independent sockets confusing logs (NiceGUI vs explorer vs LSP)

