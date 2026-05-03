# File Editor CM6 HTML Preview Engine Plan

## Status

Planning only. Do not treat this as an approved implementation batch yet.

This plan captures the desired shape for adding an HTML preview engine behind the existing `fe-toolbar` play button. The feature should start a project-scoped Node preview server through framework-shells, then show the requested HTML page as an ephemeral side-bar iframe shortcut while that server is alive.

Main-page/sidebar decomposition progress is tracked in `FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`. This preview plan should consume the current sidebar shortcut lane; it should not recreate the removed in-app agent harness or `/agent/*` route family.

## Goals

- Make `Play` on an `.html` file open a live preview in the existing side-bar iframe surface.
- Keep source-file execution behavior unchanged for Python, shell, JS/TS, and C/C++ files.
- Run the preview server as a framework-shell `pipe` shell through a dedicated shellspec.
- Scope each preview server to the active project/repo, using project sidecar state for durable project metadata.
- Keep the first version simple for fast prototyping while leaving room for later shortcut settings.
- Preserve a split between fast expert defaults and beginner-friendly safe behavior for every user-facing function.

## Current Anchors

The current run button already uses the desired backend-owned hook shape:

```text
host run button
  -> src/host/file-ops/run-file.ts
  -> /ui_ipc ui_event { type: "run_active_file", path }
  -> host/terminal_actions_backend.py
  -> terminal_backend.py
```

The preview feature should extend that pattern rather than creating a direct frontend-to-server path.

Relevant existing surfaces:

- `template.html` owns the structural DOM for `#run-active-file-btn`, the side-bar drawer, `#sidebar-iframe-stack`, and `#agent-refresh-active`.
- `main_page/frontend/host-sidebar-runtime.ts` owns main-page drawer shell open/close/toggle behavior and consumes sidebar IPC/RPC events bridged as `cm6:sidebar-event`.
- `src/host/file-ops/run-file.ts` owns the host-side play-button flow.
- `ui_ipc/ui_ipc_ws.py` owns host request/reply routing for app actions.
- `project_sidecar.py` is the project-scoped state store.
- `extensions/sidebar_extension/static/js/sidebar_shortcuts.js` owns side-bar shortcut preferences, iframe activation, and refresh.
- `/sidebar_ipc` owns host/shortcut-frame coordination such as active shortcut state, mentions, refresh relay, and editor-open requests from shortcut frames.
- `shellspec/*.yaml` shows the framework-shell pipe and project subgroup conventions.

## Ownership Model

### Host Page

Owns:

- detecting that the active file is previewable HTML
- saving before preview, using the existing save flow
- issuing a backend preview request over `/ui_ipc`
- opening/selecting the side-bar preview through the existing drawer runtime and sidebar IPC/shortcut lane after the backend returns a preview shortcut payload

Should not own:

- preview server lifecycle
- filesystem serving policy
- project-scoped preview state
- direct framework-shell calls

Every host-facing control should keep two paths visible in the implementation:

- expert path: one click previews the selected HTML file using the active project server
- safe path: invalid paths, missing project roots, or non-HTML files produce clear fallback behavior without exposing arbitrary filesystem serving

### Preview Backend Hook

Add a host backend hook next to the existing host action modules, for example:

```text
host/html_preview_backend.py
```

Owns:

- validating the requested path against the active project
- deciding whether a request is `html preview` or should fall back to terminal run
- delegating preview server lifecycle to the preview shell manager
- projecting the active preview as a side-bar event/shortcut payload

### Preview Shell Manager

Add a focused preview shell manager, for example:

```text
html_preview_shell_manager.py
```

Owns:

- one running preview shell per active project
- adopting/reusing a matching live shell when possible
- killing/re-spawning stale or wrong-project shells
- stdio JSON-RPC request/response with the Node preview server
- writing active shell status into the project sidecar

It should follow the same broad discipline as the workbench adapter shell manager: stdout is the control plane, logs go to stderr, and live pipe capabilities are verified before RPC.

### Node Preview Server

Add a Node entrypoint owned by `file_editor_cm6`, for example:

```text
html_preview/preview_server.mjs
```

Owns:

- binding a local HTTP server on `127.0.0.1:${free_port}`
- serving the project as a directory-mediated URL tree
- serving the selected HTML file by repo-relative URL when possible
- falling back to a safe single-file URL when tree mediation is ambiguous
- watching the served root and referenced assets enough to support manual refresh
- stdio JSON-RPC methods for status/open/refresh/shutdown

Do not make this server a production dependency. It is a development harness for the editor.

## Shellspec Shape

Add a dedicated shellspec:

```text
app/apps/file_editor_cm6/shellspec/html_preview.yaml#html-preview
```

Expected shape:

```yaml
version: "1"

shells:
  html-preview:
    backend: pipe
    cwd: ${ctx:PROJECT_ROOT}
    command:
      - node
      - ${ctx:HTML_PREVIEW_ENTRY}
    env:
      TE_APP_ID: ${ctx:APP_ID}
      PROJECT_ROOT: ${ctx:PROJECT_ROOT}
      TE_INSTANCE_ID: ${ctx:INSTANCE_ID}
      TE2_HTML_PREVIEW_PORT: ${free_port}
    subgroups:
      - ${ctx:APP_ID}
      - html_preview
      - "project:${ctx:PROJECT_HASH}"
    readiness:
      type: tcp_port
      host: 127.0.0.1
      port: ${free_port}
      timeout: 10
```

The backend should label shells predictably by project, such as:

```text
html_preview:file_editor_cm6:<project-name>:<project-hash>
```

## Preview URL Contract

For an active project root and selected HTML file:

1. If the file is inside the project and has a clean relative path, serve it under the directory-mediated tree:

```text
http://127.0.0.1:<port>/<repo-relative-html-path>
```

2. Relative assets referenced by that HTML should resolve naturally against the same served root.

3. If the tree cannot be safely inferred, use a safe single-file route:

```text
http://127.0.0.1:<port>/_te2_preview/file?path=<opaque-token-or-encoded-path>
```

The fallback must not expose arbitrary filesystem traversal. The backend should validate the path before handing it to the server, and the server should validate again before serving bytes.

## Stdio RPC Contract

Use JSON-RPC 2.0 requests on stdin. Reserve stdout for framed RPC responses/events and send ordinary logs to stderr.

Minimum methods:

- `preview.ping` -> `{ ok: true }`
- `preview.open` with `{ htmlPath, projectRoot }` -> `{ url, servedRoot, mode, watchedFiles }`
- `preview.status` -> `{ port, projectRoot, activeHtmlPath, activeUrl }`
- `preview.refresh` with `{ htmlPath? }` -> `{ ok: true, url }`
- `preview.shutdown` -> `{ ok: true }`

Minimum events:

- `preview.ready` with `{ port, projectRoot }`
- `preview.changed` with `{ paths }`
- `preview.error` with `{ message }`

The first UI iteration only needs manual refresh. Change events are still useful for later status badges or auto-refresh.

## Project Sidecar State

Add a project-scoped `html_preview` object to the sidecar default data:

```json
{
  "shell_id": null,
  "port": null,
  "base_url": null,
  "active_html_path": null,
  "active_url": null,
  "served_root": null,
  "mode": "directory",
  "installed_server": {
    "enabled": false,
    "shellspec_ref": null,
    "entry": null
  },
  "updated_at": null
}
```

Notes:

- `shell_id`, `port`, and `base_url` are runtime hints and must be verified before reuse.
- `installed_server` is for the later "install the server from the repo itself" phase.
- Do not store this as a normal global `agentShortcuts` entry.

## Side-Bar Integration

Initial behavior should be an ephemeral project-owned shortcut injected into the existing side-bar shortcut runtime:

```json
{
  "id": "html_preview:<project-hash>",
  "kind": "temporary_url",
  "label": "Preview",
  "url": "<active preview url>",
  "icon": { "kind": "text", "text": "P" },
  "load": "lazy",
  "source": "html_preview",
  "project": "<project path>"
}
```

This temporary shortcut should:

- appear in the side-bar iframe stack without being saved into global `agentShortcuts`
- become active when `Play` starts or reuses the preview server
- update its URL when the user presses `Play` on a different HTML file in the same project
- disappear or mark itself unavailable when the preview shell exits
- use the existing refresh button to reload the active iframe

Implementation-wise, this likely means adding a new side-bar IPC event family rather than mutating the persisted shortcut preference:

```text
sidebar:event { type: "temporary_shortcut:set", payload: { ...shortcut } }
sidebar:event { type: "temporary_shortcut:remove", payload: { id, reason } }
```

The side-bar shortcut runtime should merge temporary shortcuts with persisted shortcuts at render/activation time, with temporary entries winning by id.

## Play Button Behavior

The host-side file-kind split should be explicit:

- `.html` / `.htm`: save, then request HTML preview
- existing runnable source extensions: save, open terminal, run in terminal
- unsupported files: show the existing disabled/unsupported state

The title/tooltip should reflect the active file kind:

- HTML: `Preview active HTML file`
- runnable source: `Run active file in terminal`
- unsupported: `Open a runnable or previewable file`

This keeps one button while preserving a clean function split internally.

## Watch And Refresh

V1 should support manual refresh reliably:

- Side-bar refresh button reloads the active preview iframe.
- A long-press/cache-flush refresh can replace the iframe, matching existing side-bar behavior.
- The preview server should watch the selected HTML path and safely resolved referenced assets such as scripts, stylesheets, and images.
- If asset graph parsing is incomplete, fall back to watching the served root with normal high-noise excludes.
- Change events do not need to auto-refresh in the first implementation.

Later phases can add:

- auto-refresh toggle
- referenced asset graph tracking
- debounce policy
- shortcut settings modal controls

## Later Project-Installed Server Option

The later "install server from the repo itself" path should not change the V1 fallback server contract.

Planned shape:

- Store install metadata under `ProjectSidecar.html_preview.installed_server`.
- Allow a project to provide its own shellspec ref or Node entry.
- Mark the shortcut settings modal with whether a project-installed server exists and which shellspec ref/entry is active.
- Keep the built-in safe static server as fallback when the installed server is missing, dead, or invalid.

This must still run under framework-shells and remain project-scoped.

## Proposed Implementation Phases

### Phase 1: Planning And Contracts

- Write this plan.
- Confirm the side-bar temporary shortcut event shape.
- Confirm the Node stdio RPC framing.
- Confirm whether auto-refresh is deferred.

### Phase 2: Backend And Shell

- Add the `html-preview` shellspec.
- Add the preview shell manager and Node preview server.
- Add project sidecar getters/setters for `html_preview`.
- Add `/ui_ipc` host action routing for `preview_html_file`.

### Phase 3: Host And Side-Bar UI

- Split play-button behavior by file kind.
- Add temporary side-bar shortcut support.
- Open/select the preview shortcut after a successful backend preview request.
- Wire shell-exit removal/status events.

### Phase 4: Verification

- Preview `index.html` at repo root.
- Preview nested `pages/example.html` and verify relative CSS/JS/image paths.
- Press `Play` again while server is running and verify it reuses the shell and only updates/opens the side-bar.
- Kill the preview shell and verify the temporary side-bar shortcut disappears or becomes unavailable.
- Switch projects and verify preview shell/state does not bleed across projects.
- Verify existing terminal run behavior still works for Python, shell, JS/TS, and C/C++.

## Open Questions

- Should V1 include auto-refresh on file change, or only watched-change events plus manual refresh?
- Should the fallback single-file route use an opaque token table in the Node process, or an encoded path signed by the Python backend?
- Should HTML previewable status enable the play button even if the file has unsaved content that has not yet been saved to disk, assuming the existing save-before-run flow succeeds?
- Should temporary preview shortcuts be visible in the shortcut manager as read-only runtime entries, or only in the side-bar header/dropdown?
