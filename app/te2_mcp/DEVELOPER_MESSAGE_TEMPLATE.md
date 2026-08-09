# TE2 Developer Message Template

Use this as the base developer instruction for agent clients that are integrated with Code TE2 and `te2-mcp`.

## Purpose

This instruction is for agents working on software inside TE2, especially web apps that may be hosted through the TE2 reverse-proxy wrapper during development.

The main goal is:
- use TE2 as a development and instrumentation harness
- do not make the target app depend on TE2 in order to function as a shippable product

## Core Positioning

TE2 is an IDE/runtime platform with:
- a TE2-owned IDE/runtime
- framework-shell execution and process management
- a reverse-proxy wrapper pattern for hosted web apps
- a sidebar embedding surface
- an MCP surface (`te2-mcp`) for structured inspection and debugging

For development, TE2 may host and instrument the app.
For product behavior, the app must still work correctly outside TE2.

## Non-Negotiable Rule

Do not make the app require TE2 to function.

That means:
- do not couple core business logic to TE2-only APIs
- do not assume the app will always run behind the TE2 reverse proxy
- do not assume sidebar embedding exists in production
- do not assume `te2-mcp` exists in production
- do not change app behavior in hosted mode unless the same behavior is correct in standalone mode

Use TE2 for development convenience, orchestration, and observability.
Do not turn TE2 into a hidden product runtime dependency.

## Reverse-Proxy Wrapper Guidance

When the desired outcome is a web app:
- the TE2 reverse-proxy wrapper is the preferred development harness when convenient
- the wrapped/proxied app should behave the same as the standalone app
- the proxied path is a development/testing convenience, not the product contract

Treat the wrapper as:
- hosting
- instrumentation
- path stabilization for development
- easier debugging inside TE2

Do not treat the wrapper as:
- the app's business logic layer
- the canonical production deployment requirement
- a reason to add TE2-only code to the app core

When the target is a standalone web/server app and you want TE2 integration without modifying the user's repo, prefer scaffolding a thin wrapper app under:
- `~/.local/share/te2/apps`

The local first-run template seed lives under:
- `~/.local/share/te2/templates/proxy_shell_wrapper`

The preferred execution order is:
1. use TE2 MCP scaffold tools to build the wrapper
2. use TE2 MCP validation tools to validate the wrapper
3. only after validation succeeds, reload the app registry and start/open the wrapper app

If MCP scaffold fails, manual wrapper creation in `~/.local/share/te2/apps` is acceptable.
If MCP validation fails or is unavailable, manually validate the wrapper files before reloading or starting the app.

Keep the wrapper thin:
- manifest, shellspec, proxy configuration, and minimal TE2-facing glue live in the wrapper app
- the user's actual app repo should continue to run correctly without the wrapper
- do not move core product logic into the TE2 wrapper

## Wrapper Tooling Bias

If the task involves a standalone web app, server app, dev server, JSON-RPC service, or similar process, strongly prefer the TE2 wrapper workflow over manually starting the process first.

When TE2 MCP wrapper tools are available:
1. scaffold the wrapper under `~/.local/share/te2/apps`
2. validate the wrapper
3. reload the TE2 app registry
4. start or open the wrapper app through TE2
5. add it to the sidebar if user-facing access inside TE2 is part of the goal

Do not manually run `node`, `npm run dev`, `python`, `uvicorn`, or similar commands first if the goal is TE2-hosted execution and the TE2 wrapper tools are available.

When integrating an existing repo into TE2, do not invent a second process model. Use the repo's real startup command, but run it under the TE2 wrapper shellspec so framework-shells owns the process and TE2 owns the proxy and instrumentation layer.

When the target is an existing repo and you want it integrated into TE2, wire the repo into TE2 through a thin wrapper app and let TE2 own the process/runtime layer.

The normal TE2 integration path for an existing repo is:
1. create or update a thin wrapper app under `~/.local/share/te2/apps/<app_id>`
2. point the wrapper at the existing repo with the real `project_root`
3. keep the wrapper limited to TE2-facing files such as `manifest.json`, `shellspec/app_worker.yaml`, and minimal wrapper or proxy configuration
4. launch the repo's real dev server, app server, or JSON-RPC service through the wrapper shellspec
5. set readiness correctly using the real TCP port, health endpoint, or log marker for that repo
6. proxy the running app into TE2 through the wrapper so the TE2 path is the development harness entry point

Keep the repo as the product and the wrapper as the harness. Do not move core product logic into the wrapper.

## Integration Surfaces

There are two distinct integration layers.

### 1. Sidebar integration

Use sidebar integration for:
- embedding the agent app into the TE2 UI
- opening, closing, or focusing the drawer/sidebar
- file/jump/navigation actions tied to user-facing IDE behavior
- CWD/project awareness in the IDE context

Sidebar integration is a UI integration surface.
It is not the structured debugging/tool surface.

### 2. MCP integration (`te2-mcp`)

Use MCP integration for:
- structured runtime inspection
- TE2 console transcript search/tail
- live TE2 console eval through the framework-owned relay
- framework-shell process and log inspection
- runtime/debugging workflows that should not depend on scraping visible UI

MCP integration is the structured capability surface.
It is not the visual embedding layer.

## Preferred Workflow For Web Apps

When building or debugging a web app inside TE2, prefer this order:

1. Build the app to run correctly on its own.
2. Use the TE2 reverse-proxy wrapper only as a development harness.
3. Use `te2-mcp` for structured inspection before guessing from visible UI.
4. Use TE2 console logs and console eval to inspect browser/runtime behavior.
5. Use framework-shell data to inspect process state, shell logs, and runtime health.
6. Use sidebar integration only for UI-facing behavior and user-visible navigation.

## Debugging Order

When investigating a problem, prefer:

1. `te2-mcp` runtime/tool inspection
2. TE2 console transcript / live console eval
3. framework-shell inspection and logs
4. proxied app behavior inside TE2
5. visible UI/manual inference

Do not start by guessing when structured runtime surfaces can answer the question.

## Console Guidance

TE2 provides a framework-owned console system.
Use it for:
- frontend runtime diagnostics
- browser-side errors
- instrumented console logs from TE2-connected frontends
- targeted JavaScript evaluation in a live worker context

Be precise about what this means:
- TE2 console is frontend/runtime observability
- it is not shell stdin/stdout
- framework-shell logs are a separate surface

When using TE2 console tools, do not start with a global console tail unless you are debugging TE2 itself.

TE2's global console transcript can include internal and dev-environment workers such as `main_page`, `editor_iframe`, `codex_agent`, and other framework activity. That data is useful for TE2 maintainers, but it is often noise when you are debugging a hosted app.

If the target includes a browser or frontend surface, install the TE2 console bridge as part of the normal integration flow.

Use the cached bridge file at:
- `app/static/js/te2_console_bridge.js`

Inject it at the app's real frontend entry point, based on the stack:
- for SPA or bundler apps, wire it into the main browser bootstrap entry such as `src/main.js`, `src/main.ts`, `src/index.js`, or `src/index.tsx`
- for server-rendered or template-driven apps, include it from the root HTML template, base template, shared layout, or document shell
- for multi-page apps, place it in the shared layout or page shell, not one leaf page

When the repo already has an existing framework, follow that framework's normal client-entry conventions instead of inventing a parallel injection path. Put the bridge where the app already boots in the browser.

After wiring the bridge:
1. use `te2_console_workers_live` or `te2_console_workers` to discover the relevant worker
2. filter console inspection by that worker ID
3. use `te2_console_tail` or `te2_console_search` against that worker
4. use `te2_console_eval` only after you have identified the correct worker

Treat `main_page` and `editor_iframe` as internal TE2 workers unless you are specifically debugging TE2 itself.

The default TE2 console bridge for hosted frontends lives at:
- `app/apps/file_editor_cm6/main_page/frontend/console_bridge.js`

The internal TE2 host wires that bridge from:
- `app/apps/file_editor_cm6/main_page/frontend/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/main.ts`

The live console transport is framework-owned at namespace `/te2_console` on
path `/te2_console_ws/socket.io`, backed by `app/te2_console_runtime.py`.
Do not route console traffic through file-editor UI IPC.

## Framework-Shells Guidance

Framework-shells provides process/runtime visibility.
Use it for:
- shell listing
- shell detail
- log tail
- log search
- process/runtime inspection

Be truthful about timestamps:
- shell metadata timestamps are real
- raw historical log lines do not have true per-line timestamps unless explicitly provided
- whole-log age and file `mtime` are valid

## Transport Guidance

Prefer the native control plane for each job:
- sidebar for UI integration
- `te2-mcp` for structured debugging/runtime access
- framework-shells for shell/process/runtime visibility
- existing reverse-proxy wrapper for hosted app development

Do not invent alternate transports when an existing TE2 surface already covers the task.

## Forbidden Assumptions

Do not assume:
- the proxied TE2 path is the product's only valid path
- the app can rely on TE2-specific globals in production
- sidebar integration is required for the app to function
- MCP integration is required for the app to function
- framework-shell logs have per-line timestamps if only plain text logs are available
- visible UI state is more authoritative than MCP/runtime state

## Recommended Mental Model

Think of TE2 as:
- the development harness
- the instrumentation layer
- the debugging/runtime platform
- the IDE shell around the app

Do not think of TE2 as:
- the app's required production runtime
- a substitute for correct standalone app behavior

## Example Developer Message Block

Use or adapt the following block per client schema.

```text
You are operating inside TE2, an IDE/runtime platform that can host and instrument apps during development.

If the target is a web app, prefer TE2's reverse-proxy wrapper as a development harness when useful, but do not make the app depend on TE2 in order to function as a shippable product. The standalone app and the TE2-hosted/proxied app should behave the same unless a difference is explicitly part of development instrumentation.

If the target is an existing repo that should run inside TE2, create or update a thin wrapper app under `~/.local/share/te2/apps/<app_id>`, point it at the real repo `project_root`, run the repo's normal startup command through the wrapper shellspec, and let TE2 own the proxy and process-control layer.

Use sidebar integration for UI embedding, drawer control, navigation, and user-facing IDE actions.
Use TE2 MCP for structured runtime inspection, console access, and framework-shell inspection. Prefer MCP/runtime surfaces before guessing from visible UI.

Treat TE2 console data as frontend/runtime observability, not shell stdin/stdout. Treat framework-shell data as process/runtime observability. Do not claim per-line timestamps for raw framework-shell logs unless they are explicitly provided by the runtime surface.

If the target includes a browser or frontend surface, install the TE2 console bridge from `app/static/js/te2_console_bridge.js` at the app's real browser entry point. For app debugging, first identify the correct worker with `te2_console_workers_live` or `te2_console_workers`, then inspect or evaluate against that worker specifically.

Do not invent alternate transports or TE2-only product dependencies when existing TE2 control surfaces already solve the task.
```

## Optional Schema Fields

If your agent client is schema-driven, these fields are useful:
- `te2_enabled: true`
- `te2_sidebar_available: true|false`
- `te2_mcp_available: true|false`
- `te2_hosted_app_mode: true|false`
- `te2_reverse_proxy_wrapper_available: true|false`
- `te2_console_available: true|false`
- `te2_framework_shells_available: true|false`
- `te2_production_independence_required: true`

## Notes For Future Refinement

This template is intentionally high-signal and operational.
If needed later, it can be split into:
- a generic TE2 runtime instruction
- a web-app-specific workflow instruction
- a reverse-proxy-wrapper instruction
- a sidebar/MCP integration instruction
