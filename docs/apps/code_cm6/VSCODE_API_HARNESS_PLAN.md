# VS Code API Harness (TE2) — Implementation Plan

Context:
- Repo: `/data/data/com.termux/files/home/mrselect6`
- App: `file_editor_cm6`
- Goal: make VSIX-provided features “just work” (themes, TextMate grammars, semantic tokens, diagnostics, completion, etc.) through a single server-side **API harness**, proxied by TE2 “services”.

Non‑negotiable invariants (TE2):
- TE2 main process remains **proxy-only** for transports (no SSOT mutation or interpretation).
- Worker process owns SSOT (`_history_store`, `_preference_store`, project sidecar).
- Browser talks to TE2 via **WS** shims whenever possible (avoid ad-hoc POST command endpoints).

Current status (already present in this repo):
- `vscode_api` scaffolding exists:
  - Discover: `GET /api/app/file_editor_cm6/vscode_api/discover` (worker)
  - WS shim: `WS /vscode_api_ws?shell_id=...` (host service)
  - Shellspec: `app/apps/file_editor_cm6/shellspec/vscode_api.yaml#vscode-api`
  - Server stub: `worktrees/vscode-te2-diff/te2/vscode_api_server.mjs` (JSON-RPC over WS; placeholder methods)

Reference worktree:
- `worktrees/monaco-vscode-api` (CodinGame’s integration of VS Code services on top of Monaco).
- Key findings were summarized in agent log message `#591`.

Attribution plan:
- When we port patterns/structures, we’ll cite “monaco-vscode-api” as the upstream conceptual reference in docs and note which files influenced which TE2 components.
- Before copying any non-trivial code, confirm upstream license in `worktrees/monaco-vscode-api/` and keep notices consistent with that license.

---

## Why we’re “ripping it off”

`worktrees/monaco-vscode-api` is not a server-side JSON-RPC harness; it primarily implements VS Code-ish services in the browser and runs the extension host via VS Code IPC (not JSON-RPC).

But it is still extremely valuable for TE2 because it provides:
- A concrete list of **which VS Code services exist vs are stubbed** (`worktrees/monaco-vscode-api/src/missing-services.ts`).
- Known-good integration points for:
  - **TextMate** tokenization service override (`worktrees/monaco-vscode-api/src/service-override/textmate.ts`)
  - **Theme** service override (`worktrees/monaco-vscode-api/src/service-override/theme.ts`)
  - **Extension host** modes and requirements (`worktrees/monaco-vscode-api/src/service-override/extensions.ts`, `src/localExtensionHost.ts`)

We will adapt these ideas into TE2’s architecture:
- Server-side harness over **WS JSON-RPC** (`vscode_api`)
- TE2 host services that proxy WS frames only
- Worker-owned SSOT and persistence

---

## Target architecture (TE2)

### A) One “API harness” WS connection
- Browser connects to TE2 host:
  - `GET /api/app/file_editor_cm6/vscode_api/discover` → returns `ws_url`
  - Browser connects to `WS /vscode_api_ws?shell_id=...`
- Host service `app/apps/file_editor_cm6/services/vscode_api_transport.py` proxies frames verbatim to the shell.
- Shell runs a long-lived Node process: `worktrees/vscode-te2-diff/te2/vscode_api_server.mjs`.

### B) Modular “capabilities” behind that WS
The server-side harness exposes versioned JSON-RPC capabilities, for example:
- `vscode.themes.*` (list, load, apply)
- `vscode.textmate.*` (list grammars, resolve grammar by language id)
- `vscode.vsix.*` (install/uninstall/list; enable/disable)
- `vscode.workspace.*` (workspace roots; file system provider)
- `vscode.languages.*` (semantic tokens, diagnostics, completion, hover, symbols)

### C) Editor iframe stays “dumb renderer”
- Monaco stays in the iframe (`app/apps/file_editor_cm6/monaco_editor/m_editor_app.py` + `m_editor_app.js`).
- Monaco consumes:
  - TextMate tokens/scopes (client-side tokenization worker) OR tokens delivered from API harness (later).
  - Semantic tokens + diagnostics from API harness (preferred).
- Do not add local fallback harnesses that silently mask WBA/editor contract errors.

---

## Implementation phases

### Phase 0 — Formalize contract + observability (small)
Deliverable: stable RPC “shape” that we can evolve.
- Add `vscode_api` methods:
  - `rpc.ping`
  - `vscode_api.capabilities` (returns supported namespaces + versions)
  - `vscode_api.version` (returns commit hash, build timestamp, protocol version)
- Add structured error frames:
  - `error.code`, `error.message`, and `error.data` for diagnostics.
- Add server-side logging categories (startup, rpc, vsix, textmate, themes).

### Phase 1 — VSIX registry + storage (server-side, no UI yet)
Deliverable: install + persistence, even if not “applied” to editor yet.
- Decide install root:
  - Global install pool (preferred): `~/.local/share/termux-extensions-2/code-te2-extensions/`
    - Keeps installs out of repos and aligns with other TE2 state.
- Implement:
  - `vscode.vsix.installLocal({path})` (local filesystem `.vsix`, no URL fetch)
  - `vscode.vsix.listInstalled()`
  - `vscode.vsix.uninstall(id)`
- Per-project enablement (SSOT = `ProjectSidecar`):
  - `vscode.vsix.listEnabled()`
  - `vscode.vsix.enable({id})`
  - `vscode.vsix.disable({id})`
- Persist registry:
  - `installed_extensions.json` with `id`, `version`, `path`, `enabled`, `contributes`.

Notes:
- `worktrees/monaco-vscode-api` currently installs via bundler plugin (`src/rollup-vsix-plugin.ts`); TE2 needs runtime install, so we implement our own unzip + parse pipeline.

### Phase 2 — Themes via API harness (GitHub Dark Default parity path)
Deliverable: “theme VSIX installed → theme appears in TE2 menu → apply updates editor”.
- Implement:
  - `vscode.themes.list()`
  - `vscode.themes.load({id})` returns raw theme JSON (text) + metadata
- In iframe:
  - apply via `monaco.editor.defineTheme` + `setTheme`.

### Phase 3 — Grammars (TextMate) via API harness
Deliverable: “grammar contributes → syntax coloring works” without hand-vendoring.
- Implement:
  - `vscode.textmate.grammars.list()`
  - `vscode.textmate.grammars.load(scopeName)` returns raw grammar text + metadata.
- In iframe:
  - use `vscode-textmate` + `vscode-oniguruma` (client-side) to tokenize.

Note:
- This is compatible with today’s “client-side TextMate” approach, but shifts the *source of truth* to VSIX contributions.

### Phase 4 — Language features (semantic tokens + diagnostics first)
Deliverable: “install language extension → semantic tokens + squiggles”.
- Implement:
  - `vscode.languages.semanticTokens.full` (doc)
  - `vscode.languages.diagnostics.subscribe` (push channel)
  - `vscode.languages.completion` (later)
- Use server-side language servers (existing LSP infrastructure) as the first backend provider.
- Later: when the full VS Code extension host exists, swap providers to those VS Code APIs.

### Phase 5 — Full extension host (largest)
Deliverable: “VSIX that depends on vscode.* APIs runs”.
- Choose host type:
  - Worker-based host (Node) is preferred for TE2; browser worker is optional.
- Bridge protocol:
  - VS Code uses its own IPC; we can either:
    1) embed “real” VS Code IPC inside the server process and expose a minimal JSON-RPC facade to the browser, or
    2) adopt code-server style server protocol (bigger change).

---

## Termux/Android constraints (risks)

From `worktrees/monaco-vscode-api` findings (#591):
- Upstream includes heavy native deps (e.g. `node-pty`, `keytar`, `kerberos`) which may not build on Termux.
- Therefore:
  - TE2 harness should avoid pulling those as hard deps.
  - Prefer minimal npm deps and optional adapters.

---

## Immediate next concrete task

Phase 0 is implemented (contract + observability):
- `rpc.ping`
- `vscode_api.version`
- `vscode_api.capabilities`

Next concrete task:
- Implement VSIX install + registry + per-project enable/disable behind `vscode_api` (Phase 1).

### Minimal WS JSON-RPC test (example)
1) Discover:
- `GET /api/app/file_editor_cm6/vscode_api/discover`

2) Connect WS to returned `ws_url` and send JSON-RPC:

```json
{"jsonrpc":"2.0","id":1,"method":"rpc.ping","params":{}}
```

Then:

```json
{"jsonrpc":"2.0","id":2,"method":"vscode_api.version","params":{}}
```

And:

```json
{"jsonrpc":"2.0","id":3,"method":"vscode_api.capabilities","params":{}}
```
