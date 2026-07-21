# Electron Desktop Shell Implementation

## What changed

The active desktop shell moved to Electron and retains the desktop launcher,
Settings, persistent header, zoom controls, asset version/update UI, app-scoped
Quit, Copy/Paste context menus, and floating modal presentation. Framework apps
run in a sandboxed `WebContentsView`; the trusted shell is a separate local
`te2-desktop://shell/` renderer.

The important networking change is an in-process loopback reverse proxy. The
configured framework can be a remote HTTP or HTTPS origin, but Chromium always
loads framework pages through one dynamically allocated localhost origin. This
provides a stable browser origin and localhost secure-context behavior without
requiring the framework server to enable HTTPS.

## Framework-origin localization

### 1. Normalize and persist the upstream

Desktop Settings stores `frameworkHost`, `frameworkPort`, and `zoomLevel` in
`$XDG_CONFIG_HOME/te2/desktop-shell.json`, falling back to
`~/.config/te2/desktop-shell.json`. A host without a scheme is interpreted as
HTTP. Only HTTP and HTTPS are accepted, embedded credentials are rejected, and
the configured path, query, and fragment are discarded so the result is one
canonical upstream origin:

```text
100.91.80.45 + 8089
    -> http://100.91.80.45:8089
```

Settings writes are atomic: the complete normalized object is written to a
temporary sibling and renamed over the live configuration.

### 2. Allocate one private browser origin

At process startup, `startFrameworkRelay` creates a Node HTTP server and asks
the operating system for an unused port with this effective bind:

```text
host: 127.0.0.1
port: 0
exclusive: true
```

If the kernel chooses port `43127`, the renderer-facing origin becomes:

```text
http://127.0.0.1:43127
```

The server binds only explicit IPv4 loopback. It is not reachable on the LAN,
does not require an external proxy executable, and remains open until the
desktop process exits. The chosen port—and therefore the browser origin—stays
constant when the user changes the configured framework target.

### 3. Project navigation onto localhost

Framework lifecycle calls such as app catalog/open/quit remain low-frequency
native requests made directly from Electron's main process to the configured
upstream. When an app-open response supplies a framework URL, the desktop shell
keeps its path, query, and fragment but replaces its origin with the relay
origin:

```text
http://100.91.80.45:8089/app/file_editor_cm6?project=x
    -> http://127.0.0.1:43127/app/file_editor_cm6?project=x&gv_native=1
```

Native app-navigation requests require that relay origin, and popup requests
are denied unless they point back to it. `gv_native=1` disables the framework
PWA Service Worker for the wrapper so an old browser cache cannot mask the
desktop asset layer. Node integration stays off, context isolation stays on,
and the framework view uses its own persistent Electron session partition.

### 4. Handle an ordinary HTTP request

For each request received on the loopback server, the relay parses the path
against its own browser origin and follows this order:

1. Check the shared desktop asset inventory.
2. If the path is an inventory-approved exact file or prefix, resolve it under
   the installed desktop asset root.
3. Serve a present local file with its known MIME type and
   `Cache-Control: max-age=31536000, immutable`.
4. Return a local 404 if an approved local path is missing. Declared local
   assets do not silently fall through to the network.
5. Proxy every other request to the current configured upstream.

The proxy selects Node's `http` or `https` transport from the upstream scheme.
It preserves the incoming method, complete request path/query, body stream, and
headers, except that `Host` is replaced with the upstream host and port. The
request body is piped directly upstream. The upstream status and response
headers are copied back, and the response body is piped directly to Chromium.
There is no full-response buffering, so ordinary downloads and long-lived SSE
responses keep their streaming behavior.

`Origin`, `Referer`, cookies, and other headers are not rewritten by custom
logic; only `Host` is explicitly replaced. Authentication schemes that depend
on those headers must therefore accept the localhost-facing browser origin.
HTTPS protects the relay-to-upstream hop when the configured origin uses HTTPS,
while the renderer-to-relay hop remains local HTTP.

If an upstream response includes `Location`, the relay resolves it against the
upstream. Redirects that stay on the configured upstream are rewritten back to
the stable localhost origin while retaining their path, query, and fragment.
Cross-origin redirects are preserved verbatim. A connection failure becomes a
502 response unless response streaming has already begun, in which case the
downstream response is destroyed with the error.

```text
Chromium WebContentsView
    -> http://127.0.0.1:43127/path?query
        -> inventory match: installed asset
        -> otherwise: http(s)://configured-framework/path?query
```

### 5. Tunnel WebSocket and Socket.IO upgrades

The same HTTP server owns its `upgrade` event, so raw WebSocket and Socket.IO
WebSocket traffic use the same loopback port and URL paths as page/API traffic.
For an upgrade, the relay:

1. Chooses HTTP or HTTPS from the current upstream scheme.
2. Forwards the original method, request path/query, and headers with the
   upstream `Host` value.
3. Writes the upstream HTTP upgrade status line and raw headers to Chromium.
4. Flushes any bytes already read after either side's headers.
5. Pipes the downstream and upstream sockets in both directions.

The relay does not decode Engine.IO, Socket.IO, MessagePack, terminal frames,
or application payloads. Those bytes pass through unchanged. Consequently,
Socket.IO namespaces and raw framework WebSocket paths need no desktop-specific
codec implementation.

### 6. Retarget without restarting the desktop client

Saving a different framework host or port computes and persists a new upstream
origin, then calls `relay.retarget(newOrigin)`. Retargeting does not close the
listener and does not allocate a new browser port. It atomically replaces the
in-memory upstream target, destroys all tracked HTTP and WebSocket connections,
and clears the connection set. The current app view is closed and the launcher
remains visible.

The next navigation or socket connection uses the new upstream through the
same browser origin:

```text
before: http://127.0.0.1:43127 -> http://100.91.80.45:8089
after:  http://127.0.0.1:43127 -> http://192.168.1.20:8089
```

Closing active sockets is required: otherwise an already upgraded WebSocket or
HTTP keep-alive connection could continue talking to the old framework after
Settings reports the new target. The desktop process itself does not restart,
and origin-scoped renderer state does not move to a new localhost port.

### 7. Local assets use the same origin

Desktop assets are downloaded directly from the configured upstream's
`/api/editor_version` and `/api/editor_assets_bundle` endpoints. Installation
uses a staged complete tree, required-file validation, monotonic version checks,
backup, atomic rename, and rollback. Android launcher assets inside the shared
bundle are deliberately omitted because desktop owns a separate launcher.

After installation the relay refreshes one boolean indicating whether the
complete required asset set is available. Approved asset paths are then served
from `$XDG_DATA_HOME/te2/desktop_assets` on the same localhost origin as the
proxied framework document. This is important for Monaco module workers: page,
worker, font, editor, and dynamic framework traffic retain one browser origin
even though selected static bytes come from disk.

### 8. Clipboard and security consequence

Remote plain-HTTP framework pages no longer appear to Chromium as arbitrary
insecure network origins. They appear as the relay's exact localhost origin.
Electron's permission handler grants only `clipboard-read` and
`clipboard-sanitized-write`, only to the current framework `WebContentsView`,
and only while its document has that exact relay origin. Other permission
requests and other renderers are denied. The Copy/Paste context menu uses
Electron's native editing commands on the focused renderer and does not depend
on the page Clipboard API.

The relay is therefore both an origin-localization boundary and a transport
bridge. It is not a general open proxy: it listens only on loopback, has one
configured upstream, limits native navigation and popup routing to its browser
origin, and serves local files only through a fixed inventory.

## Android parity boundary

No Android source changed in this desktop work. An Android implementation can
mirror the behavior by owning one app-private loopback listener, projecting the
selected framework URL onto it, forwarding HTTP/SSE and WebSocket upgrades,
and swapping the upstream while keeping the local origin stable. It should
reproduce the request/redirect/socket semantics above using Android-native
components rather than spawning `socat` or copying Electron APIs.
