# termux-extensions-2 Project To-Do

## 1. System Stats Extension

- [ ] Replace the per-poll `su` execution with a single privileged metrics worker.
  - [ ] Design a backend helper (likely a `framework_shell`-managed root shell or daemon script) that starts once via `su -c` and streams/publishes metrics.
  - [ ] Add an API surface (REST or websocket/SSE) so the extension can subscribe to metrics without shelling out each refresh.
  - [ ] Ensure teardown hooks stop the worker cleanly on framework shutdown or extension unload.
- [ ] Expand CPU telemetry.
  - [ ] Extend the metrics worker to collect per-core frequencies (e.g. `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq`) and mode time slices derived from `/proc/stat`.
  - [ ] Update the extension UI to offer an expandable CPU card that fills the panel with per-core stats and a mode-time visual (canvas/SVG or flex-table with inline bars).
  - [ ] Add responsive behaviours so the expanded view collapses gracefully on smaller screens and preserves keyboard accessibility.
- [ ] Expand RAM telemetry.
  - [ ] Extend metrics collection to include detailed memory categories (`/proc/meminfo`, `swapon -s`, mount stats) that map to htop’s RAM/SWAP breakdown.
  - [ ] Mirror the CPU UX: collapsible RAM card with a full-width detail view plus lightweight charts/bars for each category.
  - [ ] Validate polling cadence and data size so the richer payload does not impact UI jank or network usage.

## 2. Platform Neutrality Improvements

- [ ] Introduce a central environment resolver that exposes `HOME`, `PREFIX`, TMP paths, and detects Termux vs generic POSIX so code can request paths without hard-coding `/data/data/...`.
- [ ] Refactor frontend constants (e.g. `app/apps/file_editor/main.js`, `app/extensions/sessions_and_shortcuts/main.js`, `app/static/js/file_picker.js`) to use the resolver hook instead of literals.
- [ ] Update shell scripts and helpers to use portable shebangs (`#!/usr/bin/env bash`) or dynamically injected prefixes while maintaining Termux compatibility.
- [ ] Audit install/bootstrap flows (`scripts/bootstrap_termux.sh`, `scripts/run_framework.sh`, etc.) for hidden assumptions about `$PREFIX` and adjust to respect standard POSIX layouts.
- [ ] Backfill automated checks (lint/test or CI script) that scan for newly introduced hard-coded Termux paths or shebang regressions.

## 3. Termux-LM Feature Completion

- [ ] Wire the “Refresh Log” button to an API call that refetches shell descriptors (`/api/framework_shells` or a dedicated endpoint) and re-renders STDOUT/STDERR without waiting for the polling interval.
- [ ] Round out the Open Interpreter console UX: persist the websocket URL/port in settings, surface connection errors inline, and add a visible stop/shutdown control.
- [ ] Tighten Hugging Face search/download flow: expose download progress (poll Aria RPC), allow cancelling queued jobs, and surface path validation errors early.
- [x] Normalize the `reasoning_effort` field to behave as a string both in the backend (`_write_model_manifest`, `_remote_payload`) and the frontend modal handling, so remote providers that expect textual tiers (“low”, “medium”, “high”) work.
- [x] Ensure remote model cards display the configured display name in both local and remote contexts.
- [ ] Add regression/unit tests around model manifests, session persistence, and streaming SSE handling to catch future backend/front-end drift.
- [ ] Document the full Termux-LM lifecycle (model add → load → session → interpreter) for contributors so follow-up work stays aligned.

## 4. Code-OSS Full-Page App Integration

- [x] Promote the “mobile IDE shell” scaffold into an official app module: create an `app/apps/code_oss` package with manifest, blueprint, template, and static bundle entrypoints.
- [x] Follow the full-page integration guide:
  - [x] Register `/ide` routes (and deep-link variants) that reuse existing auth/session and seed the SPA with user/project context.
  - [x] Produce standalone HTML/CSS/JS bundles (`ide_fullpage.html`, `ide_fullpage.js`, `ide_fullpage.css`) via the project’s build pipeline (vite/webpack) instead of the demo Flask server (relocated under app/static/).
  - [x] Ensure websocket/job bus integrations mirror the windowed IDE so background tasks and toasts function identically.
  - [ ] Add workspace/project selection UI inside the wrapper.
  - [ ] Provide a clear navigation/back button when launching the full-page IDE.
- [ ] Harden the bridge extension:
  - [ ] Replace the CLI TODOs for installing/uninstalling VS Code extensions with actual code-server or `code` invocations plus error reporting.
  - [ ] Expand the `postMessage` protocol to cover panel resizing, theme sync, status bar updates, and chat provider discovery from live extensions.
- [ ] Integrate app settings:
  - [ ] Persist CODE_IFRAME_URL and bridge configuration inside the framework settings store instead of ad-hoc JSON files.
  - [ ] Add UI affordances in the new app for selecting the code-server instance, choosing default chat providers, and managing stored credentials/tokens securely.
- [ ] QA checklist: feature-flag the app, test on mobile/desktop breakpoints, verify same-origin iframe policies, and smoke-test extension install/uninstall flows before general release.
## 5. Archive Manager Enhancements

- [x] Port the File Explorer bookmark experience (menus, modals, persistence) into the Archive Manager app.
