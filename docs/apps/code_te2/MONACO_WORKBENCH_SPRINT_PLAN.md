# Monaco + Workbench Integration Sprint Plan

This plan executes the current direction:
- TE2 remains editor/save SSOT.
- Workbench adapter/proxy supplies language intelligence.
- Monaco stays thin and consumes normalized TE2 events.

Cross references:
- `docs/apps/code_te2/VSCODE_API_CONTRACT.md`
- `docs/apps/code_te2/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_te2/VSCODE_API_DEPRECATIONS.md`
- `docs/apps/code_te2/CODE_TE2.md`
- `docs/apps/code_te2/README.md`

Implementation anchors (where to look first):
- Code-server framework shell: `app/apps/code_te2/code_server_shell_manager.py`, `app/apps/code_te2/shellspec/code_server.yaml`
- Node adapter: `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/server.mjs`,
  `app/apps/code_te2/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
- Monaco iframe: `app/apps/code_te2/monaco_editor/m_editor_app.py`, `app/apps/code_te2/monaco_editor/m_editor_app.js`

## Sprint 1 - Contract and Bridge Hardening
Goal: Lock API contracts and wire a stable frontend language bridge without changing TE2 draft/save authority.

Steps:
1. Define and freeze normalized RPC/event contract for:
- `vscode.hover`
- `vscode.documentSymbols`
- diagnostics event payload
- completion payload
2. Make the backend runtime deterministic for integration tests:
- code-server runs as a framework shell on `127.0.0.1:18180` with `--disable-workspace-trust`
- adapter defaults assume `http://127.0.0.1:18180` and authority `localhost:18180`
2. Implement/clean `language_bridge` integration in Monaco iframe lifecycle:
- connect on editor ready
- bind per-model open/change/close notifications
- dispose on model/editor teardown
3. Add strict request tracking:
- request id
- uri
- model version
- timeout + cancellation path
4. Ignore stale responses where `(uri, version)` no longer matches active model state.
5. Keep all save/draft/autosave flows on existing `editor_ws` path only.

Acceptance:
- Hover and symbols requests succeed repeatedly on active file.
- No cross-talk between `editor_ws` and language channel responsibilities.
- No stale hover/symbols rendered after rapid edits/switches.

## Sprint 2 - Extension Validation Matrix (Python, C++, Rust)
Goal: Validate deterministic language feature behavior across three major ecosystems.

Steps:
1. Define extension test matrix:
- Python: baseline `ms-pyright` (plus optional `ms-python.python` / Pylance variants)
- C++: baseline `ms-vscode.cpptools`
- Rust: baseline `rust-lang.rust-analyzer`
- Control: built-in TypeScript/JavaScript service behavior
2. For each language, run deterministic test sequence:
- connect adapter
- open file
- request symbols
- request hover
- collect diagnostics stream
3. Capture provider registration and RPC method observations in logs.
4. Record per-language pass/fail against baseline metrics:
- registration observed
- symbols returned
- hover returned
- diagnostics update observed
5. Keep TS/JS as baseline control (built-in service behavior).

Acceptance:
- Python/C++/Rust each have a documented pass/fail sheet.
- At least two deterministic language features pass per ecosystem.
- Failures are mapped to missing bootstrap/contract items, not guessed.

## Sprint 3 - Watcher Scalability Refactor
Goal: Replace brittle high-watch-count assumptions with scalable repo change detection.

Steps:
1. Introduce directory-scoped watch strategy with excludes.
2. Add event coalescing window for explorer refresh events.
3. Add bounded reconciliation loop:
- git status refresh cadence
- optional lightweight untracked refresh policy
4. Add adaptive degradation mode when repo size crosses thresholds.
5. Keep open-file freshness path independent and prioritized.

Acceptance:
- Large repos no longer require inotify limit increases for basic explorer usability.
- Explorer change indicators remain correct under sustained churn.
- Mobile behavior remains stable under default system limits.

## Sprint 4 - Reliability and Observability
Goal: Make failures obvious and actionable; remove silent regressions.

Steps:
1. Add structured counters and health endpoints for:
- requests sent
- replies received
- timeouts
- stale drops
2. Add per-language diagnostics for provider registration state.
3. Add bounded debug logging profiles:
- normal mode
- trace mode (size-capped)
4. Document operational runbook for regression triage.
5. Add reproducible smoke scripts for Python/C++/Rust checks.

Acceptance:
- Regressions can be triaged from logs/counters without packet-level spelunking.
- Smoke run output clearly indicates pass/fail by feature and language.

## Sprint 5 - UX Completion Layer
Goal: Expose language sidecar capabilities cleanly in current Monaco UX.

Steps:
1. Wire diagnostics into existing marker and explorer badge surfaces.
2. Wire hover/symbols/completion into current UI affordances without changing editor authority model.
3. Add optional settings toggles for language sidecar behavior:
- enable/disable per language
- timeout tuning
- diagnostics verbosity
4. Validate coexistence with draft overlay visuals (blue/yellow) and git diff decorations.
5. Update docs with final architecture and user-visible behavior.

Acceptance:
- Language features feel native in current Monaco UX.
- Draft/git visual cues remain intact and unambiguous.
- Settings are understandable and safe by default.

## Definition of Done (Program)
1. TE2 remains sole authority for edit/save/draft/autosave/versioning.
2. Language intelligence is sidecar-driven and transport-separated.
3. Python, C++, Rust have deterministic validation records.
4. Large repo explorer behavior is stable without manual watch-limit tuning.
5. Docs and runbooks are current and reproducible.
