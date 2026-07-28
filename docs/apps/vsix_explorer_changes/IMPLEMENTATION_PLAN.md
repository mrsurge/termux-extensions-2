# Open VSX Explorer Marketplace Plan

Status: implemented with automated validation; live cross-client acceptance is
still pending.

This plan covers two related Code TE2 Explorer changes:

1. add a small Open VSX extension marketplace to the Explorer; and
2. replace the Explorer header's project/directory label with the current Git
   branch.

The marketplace is a new Explorer-owned overlay. It must not reuse, replace, or
project the existing Settings extension modal. The current local-VSIX install,
extension configuration, language-slot, theme, and Settings workflows remain
unchanged.

## Goals

- Add a `🧩` button to the Explorer header.
- Open a dedicated search-and-results overlay inside the Explorer drawer.
- State plainly in that overlay that UI extensions are not currently supported.
- Open extension details in a second element that slides over the results
  element while preserving the current query and result list beneath it.
- Show basic Open VSX metadata, the latest available version, and the currently
  installed version, including the registry-hosted extension icon.
- Provide Install and Uninstall actions.
- Keep all marketplace API and mutation traffic on the existing strict
  MessagePack `/rpc/explorer` lane. Validated registry icon assets may load
  directly as browser images.
- Use the already resolved code-server executable and TE2 extension directory
  for installation and removal.
- Show the current Git branch in the Explorer header instead of the project
  directory name.

## Non-goals

- Reusing or redesigning the Settings extension manager.
- Replacing the existing local `.vsix` picker/install path.
- Rendering Open VSX README or changelog content.
- Supporting Microsoft Marketplace.
- Supporting UI-only extensions.
- Building a general browser or app-wide marketplace component.
- Adding another HTTP route, Socket.IO namespace, WebSocket, or frontend-direct
  API request to Open VSX.
- Publishing Android assets, changing versions, or changing package metadata as
  part of the initial implementation.

## Source-backed findings

### Code-server

The code-server checkout at `/home/mrsurge/knowhere/code-server` defaults its
VS Code product gallery to Open VSX in `patches/marketplace.diff`. The patch
provides the Open VSX gallery, item, extension, and resource URLs and permits an
`EXTENSIONS_GALLERY` override.

Code-server's CLI accepts either an extension identifier or a local VSIX:

```text
code-server --install-extension publisher.name
code-server --install-extension publisher.name@version
code-server --uninstall-extension publisher.name
```

This is the correct installation authority. The Explorer backend should not
reimplement VSIX extraction, code-server compatibility selection, or extension
directory mutation.

### Open VSX public API

The public API currently exposes the small surface this UI needs:

```text
GET https://open-vsx.org/api/-/search?query=<query>&size=<n>&offset=<n>
GET https://open-vsx.org/api/<namespace>/<name>/latest
```

Search responses contain an `extensions` array plus `offset` and `totalSize`.
Detail responses include fields such as namespace, name, display name, version,
description, download count, average rating, license, repository, homepage,
files, engines, and `extensionKind`.

Only normalized, bounded fields should cross Explorer RPC. The first
implementation must not render remote Markdown or arbitrary remote HTML.

### Existing TE2 extension path

The existing Explorer extension contract already uses `/rpc/explorer`:

- `explorer.extensions.list`
- `explorer.extensions.install` for a local `vsix_path`
- `explorer.extensions.uninstall`
- extension configuration, toggle, and restart methods

`extension_registry.py` already:

- resolves one code-server installation through `TE2_CODE_SERVER_BIN`, `PATH`,
  the login shell, NVM, `$PREFIX/bin`, and `~/.local/bin`;
- supplies the shared TE2 extensions directory;
- invokes code-server for local VSIX install and identifier uninstall;
- rescans the extension registry;
- rebuilds the settings gate; and
- returns a UI-friendly installed-extension list.

Marketplace install should extend this authority with an install-by-ID helper.
The local-VSIX `explorer.extensions.install` contract must remain unchanged.

### Existing Explorer overlay and branch facts

`template.html` places the file tree and `#fe-search-overlay` as siblings inside
the relatively positioned `.fe-drawer-body`. The search overlay is an absolute,
inset layer with its own controller, loading/error/empty states, Escape
handling, and project-change teardown.

The marketplace should use the same lifecycle convention in a separate DOM root
and controller. It must not add marketplace behavior to the search controller.

The backend already publishes `branch`, `detached`, `head`, `isRepository`, and
`hasHead` through `explorer.git.status.updated`. The frontend currently retains
only part of that payload. No new Git request is needed for the header label.

## Proposed user experience

### Explorer header

The header order remains:

```text
Close | Branch label | Project… | … | Search | 🧩
```

The `🧩` button has:

- `title="Extensions"`
- `aria-label="Open Extension Marketplace"`
- `aria-expanded` synchronized with overlay visibility.

The existing Project and Explorer menus are unchanged.

### Marketplace search layer

The new `#fe-extension-marketplace-overlay` is a sibling of the tree and search
overlay in `.fe-drawer-body`.

Its root contains:

- a header with close button and `Extensions` title;
- a persistent note: `UI extensions are not currently supported.`;
- a search input;
- a result-status area;
- a scrollable result list; and
- an optional `Load more` action driven by API pagination.

Search behavior:

- trim the query;
- do not request fewer than two characters;
- debounce typing;
- cap the page size;
- cancel or ignore superseded responses;
- retain the last valid results while a later page loads;
- distinguish initial loading, paging, empty, offline/error, and ready states;
- use text and the local `🧩` glyph initially rather than loading arbitrary
  remote icons in the browser.

Each result shows:

- display name;
- `namespace.name`;
- latest version;
- one bounded description;
- download count and rating when present;
- an `Installed <version>` marker when locally installed.

Opening the marketplace closes the existing Explorer search overlay. Opening
Explorer search closes the marketplace. Project changes close both.

### Detail layer

Selecting a result immediately opens an absolute detail element in a loading
state. It slides from the right over the search/list layer:

```text
translateX(100%) -> translateX(0)
```

The search input, scroll position, results, and selection remain mounted below
it. The detail header has a Back action that slides the element away without
closing the marketplace.

The detail layer shows only normalized basic information:

- display name and `namespace.name`;
- description;
- latest available version;
- currently installed version, or `Not installed`;
- extension kinds;
- VS Code engine range;
- license;
- download count and rating;
- repository/homepage as safe external links when valid;
- compatibility/support status; and
- Install or Uninstall.

The persistent UI-extension warning is repeated near the action area. When
`extensionKind` is explicitly UI-only, Install is disabled with a clear reason.
An extension that includes `workspace` is eligible for the initial path.
Missing/ambiguous metadata is reported as unknown and code-server remains the
final compatibility authority.

Escape behavior is layered:

1. when details are open, Escape returns to the result list;
2. otherwise, Escape closes the marketplace overlay.

Focus returns to the selected result after Back and to the `🧩` button after the
overlay closes.

### Install and uninstall

Install:

1. require an explicit confirmation that third-party extension code will run in
   the code-server extension host;
2. disable the action while the mutation is active;
3. request marketplace install by normalized extension ID;
4. let code-server install through the shared TE2 extension directory;
5. rescan the registry and rebuild the settings gate;
6. reuse the existing code-server/WBA restart behavior;
7. refresh the installed-version projection; and
8. leave the detail layer open with the updated state.

Uninstall reuses `explorer.extensions.uninstall`, including builtin protection,
registry rebuild, and restart behavior. Its confirmation names the extension
being removed.

Errors stay inside the detail action area and do not destroy the search state.

## Explorer RPC design

All methods are request/response calls on `/rpc/explorer`.

### Search

```text
explorer.extensions.marketplace.search
```

Request:

```json
{
  "query": "python",
  "offset": 0,
  "size": 20
}
```

Normalized result:

```json
{
  "query": "python",
  "offset": 0,
  "total": 722,
  "items": [
    {
      "id": "ms-python.python",
      "namespace": "ms-python",
      "name": "python",
      "displayName": "Python",
      "version": "2026.4.0",
      "description": "…",
      "iconUrl": "https://open-vsx.org/api/ms-python/python/2026.4.0/file/icon.png",
      "downloadCount": 53892293,
      "averageRating": 3.875,
      "verified": true,
      "installedVersion": null
    }
  ]
}
```

The backend merges installed versions from the existing extension registry so
the frontend does not maintain a second installed-state authority.

### Detail

```text
explorer.extensions.marketplace.detail
```

Request:

```json
{
  "ext_id": "ms-python.python"
}
```

Normalized result:

```json
{
  "extension": {
    "id": "ms-python.python",
    "namespace": "ms-python",
    "name": "python",
    "displayName": "Python",
    "version": "2026.4.0",
    "installedVersion": null,
    "description": "…",
    "iconUrl": "https://open-vsx.org/api/ms-python/python/2026.4.0/file/icon.png",
    "extensionKind": ["workspace", "web"],
    "engine": "^1.95.0",
    "license": "MIT",
    "repository": "https://github.com/Microsoft/vscode-python.git",
    "homepage": "https://github.com/Microsoft/vscode-python",
    "downloadCount": 53892293,
    "averageRating": 3.875,
    "installSupported": true,
    "unsupportedReason": null
  }
}
```

### Marketplace install

```text
explorer.extensions.marketplace.install
```

Request:

```json
{
  "ext_id": "ms-python.python",
  "version": "2026.4.0"
}
```

The version is the exact version returned by the detail request. The backend
revalidates both fields and invokes:

```text
<resolved-code-server> \
  --install-extension ms-python.python@2026.4.0 \
  --extensions-dir <te2-extension-dir> \
  --force
```

The response returns the normalized installed extension and registry summary.
The existing local-VSIX install method is not overloaded.

### Uninstall

Use the existing:

```text
explorer.extensions.uninstall
```

with:

```json
{
  "ext_id": "ms-python.python"
}
```

## Backend implementation

### Open VSX service

Add a small Explorer service, for example:

```text
app/apps/file_editor_cm6/explorer/services/openvsx_marketplace.py
```

Responsibilities:

- own the public Open VSX API base;
- execute bounded `httpx` requests in the backend;
- apply connect/read/overall timeouts;
- validate query length, page size, offset, extension IDs, and versions;
- normalize optional fields and lengths;
- reject non-HTTPS or unexpected external links before returning them;
- merge installed-version state;
- classify explicit UI-only metadata as unsupported; and
- return concise errors without leaking `httpx` traces to the browser.

The browser does not supply a registry URL, download URL, or arbitrary fetch
target.

### Registry install-by-ID

Refactor the common code-server subprocess and post-install rescan logic in
`extension_registry.py` so local-VSIX and marketplace-ID installation share the
same authority without changing the local-VSIX contract.

The new helper accepts only:

- a normalized `publisher.name`; and
- an optional validated semantic version selected from the detail response.

### Contract and dispatch

Extend:

- `explorer/contracts/extensions.py`
- `explorer/handlers/extensions.py`
- `explorer_runtime.py`
- `explorer/transport/rpc_contract.py`
- `src/explorer/rpc/contract.ts`

with the three explicit marketplace methods. Do not create a sibling transport.

The handler runs blocking code-server work off the event loop and reuses
`restart_code_server_and_adapter`.

## Frontend implementation

Add an isolated controller family under:

```text
app/apps/file_editor_cm6/src/explorer/extensions/
```

Suggested files:

- `marketplace-types.ts`
- `marketplace-controller.ts`
- `marketplace-renderer.ts`

The controller owns:

- overlay visibility;
- query and debounce timer;
- request generation/stale-response suppression;
- paging state;
- selected extension;
- detail loading/error state;
- installed-version projection;
- install/uninstall mutation state;
- focus restoration; and
- close/destroy behavior.

Wire it through:

- `template.html` for the header button and empty overlay root;
- `main_page/frontend/explorer.css` for the overlay and sliding detail layer;
- `src/explorer/app/bootstrap.ts` for construction and notification lifecycle;
- `src/explorer/chrome/explorer-chrome-controller.ts` for the header button; and
- `src/explorer/rpc/notifications.ts` for project-change closure and any
  relevant installed-state refresh.

Build DOM with typed source code and `textContent`; do not interpolate registry
data through `innerHTML`.

## Branch label implementation

Rename the existing misleading symbols:

```text
fe-project-label       -> fe-branch-label
projectLabel           -> branchLabel
renderProjectLabel()   -> renderBranchLabel()
```

Extend `ExplorerGitStatus` and `coerceGitStatus()` to retain:

- `branch`
- `detached`
- `head`
- `isRepository`
- `hasHead`

Render states:

| State | Header text |
| --- | --- |
| branch available | branch name |
| detached HEAD | `HEAD @ <short-hash>` |
| repository with no first commit | `(no commits)` |
| not a Git repository | `(no branch)` |
| project/status pending | `…` |

The title attribute contains the full branch name or full detached HEAD hash,
not the project path.

Refresh the label on:

- Explorer bootstrap;
- project-root change/reset;
- `explorer.git.status.updated`; and
- reconnect/state resynchronization.

The project path remains backend authority and continues to drive the tree; it
is simply no longer rendered as the Explorer header label.

## Failure and concurrency rules

- Search request N cannot overwrite state from newer request N+1.
- Detail request A cannot populate the panel after selection B replaces it.
- Closing the overlay invalidates outstanding frontend generations.
- A failed next-page request preserves earlier results.
- Install/uninstall is single-flight per marketplace controller.
- Closing the overlay does not cancel a backend mutation already accepted.
- Disconnection produces a concise recoverable state; reconnect permits retry.
- A code-server restart must not reset the query, results, or selected detail.
- Marketplace API failure does not affect the tree, search overlay, local VSIX
  flow, installed-extension Settings UI, or current editor session.

## Validation plan

### Backend

- contract tests for query, pagination, identifier, and version validation;
- service tests with mocked Open VSX success, missing fields, HTTP failure,
  malformed payload, and timeout;
- installed-version merge tests;
- UI-only classification tests;
- code-server install-by-ID command construction tests;
- registry-rescan and restart-handler tests;
- regression coverage for unchanged local-VSIX install and uninstall.

### Frontend

- controller tests for debounce, stale search response, paging, detail
  selection, Back, Escape, overlay close, and focus restoration;
- installed-version rendering and Install/Uninstall state tests;
- UI-only disabled-install test;
- mutation failure/retry test;
- project-change and reconnect lifecycle tests;
- branch-label state table tests;
- assertion that marketplace and Explorer search overlays are mutually
  exclusive.

### Required build checks

From `app/apps/file_editor_cm6`:

```text
npm run typecheck
node build.mjs
```

Run the targeted Python and Node tests added for this feature.

### Manual checks

- desktop-width Explorer;
- narrow/mobile Explorer;
- browser, Android wrapper, and Electron wrapper;
- keyboard-only navigation and Escape layering;
- touch scrolling of result and detail layers;
- install, upgrade, uninstall, rejected UI-only extension, incompatible
  extension, offline Open VSX, and code-server restart;
- existing Settings extension modal and local-VSIX picker remain unchanged.

Android asset publication and release versioning are separate follow-up scopes
after the source implementation is accepted.
