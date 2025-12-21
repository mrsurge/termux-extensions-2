# Kotlin and C++ LSP (CM6) — Current State + Next Steps
**Date:** 2025-12-19  
**Scope:** Kotlin LSP is working end-to-end (stdio → sticky scroll). C++ LSP section is intentionally stubbed for the next iteration.

This note captures how Code CM6’s LSP pipeline works today, what was required to make **JetBrains Kotlin LSP** run under **Termux/Android**, and what remains for the **C++ LSP** and **UI opt-in** work.

---

## 0) High-level: what “LSP-backed sticky scroll” means here

The sticky scroll implementation prefers **LSP `textDocument/documentSymbol`** when LSP is enabled, and falls back to parser-derived scopes otherwise.

Pipeline (Kotlin / Python / TS all use the same bridge):

1. Browser iframe (CodeMirror 6) connects Socket.IO namespace **`/lsp`**
2. Browser emits **`initialize`** `{ languageId, projectRoot }`
3. Backend spawns a **Framework Shell** (pipe-backed process) for that language server
4. Backend bridges JSON-RPC over stdio (adds `Content-Length` framing)
5. Browser `@codemirror/lsp-client` performs normal LSP handshake and requests symbols
6. Sticky scroll consumes `documentSymbol` and renders nested headers with correct scopes

Primary references:
- Frontend LSP client + sticky scroll integration: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Backend Socket.IO bridge: `app/apps/file_editor_cm6/lsp_ws.py`
- LSP process spawning (Framework Shells): `app/apps/file_editor_cm6/lsp_shell_manager.py`
- Sticky-scroll + LSP MVP doc: `notes/2025-12-11_STICKY-S-LSP_WORKING_MVP.md`

---

## 1) Kotlin: what we’re running (and why)

### 1.1 Which Kotlin LSP distribution

We vendor the JetBrains Kotlin LSP under:

`app/static/vendor/lsp_servers/kotlin-lsp/`

This directory contains (current working shape):
- `kotlin-lsp.sh`
- `lib/` (hundreds of jars)
- `native/` (JNI `.so`)
- `jre/` (bundled JRE in the `linux-aarch64` zip)

We ended up needing the **platform build** (e.g. `kotlin-lsp-*-linux-aarch64.zip`) because the platform-agnostic distro expects native pieces that don’t load cleanly on Termux without a glibc userland story.

Vendoring helper script (added earlier):
- `scripts/vendor_kotlin_lsp.sh`

### 1.2 Stdio mode (not socket mode)

Code CM6’s backend bridge is built around **stdio** (pipes), so Kotlin LSP is run with:
- `--stdio`

Important gotcha discovered:
- Kotlin LSP **stdio mode is single-client**. It rejects `--multi-client` in stdio mode.

So: we stay on stdio; we do **not** switch to socket/HTTP mode.

---

## 2) Kotlin on Termux/Android: process + compatibility shims

### 2.1 Why `grun` is used on Android

The vendored JetBrains Kotlin LSP bundle includes a **glibc-linked JRE** in:

`app/static/vendor/lsp_servers/kotlin-lsp/jre/bin/java`

On Termux/Android, the host libc is **bionic**, so launching that JRE directly fails. We run it through **glibc-runner** (`grun`) which uses the glibc loader.

Spawn logic lives in:
- `app/apps/file_editor_cm6/lsp_shell_manager.py`

Behavior:
- If we detect Termux/Android and a bundled `jre/bin/java` exists, we spawn Kotlin LSP via `grun <java> ...`.
- On non-Android platforms, we run `kotlin-lsp.sh --stdio` directly (no `grun`).

### 2.2 No `/tmp`: JVM/IDEA cache dirs redirected

The Kotlin LSP / IntelliJ platform stack assumes writable temp/cache locations.

On Termux/Android, `/tmp` is not reliable, so we set:
- `-Djava.io.tmpdir=~/.cache/te2_kotlin_lsp/tmp`
- `-Didea.system.path=~/.cache/te2_kotlin_lsp/idea-system`
- `-Didea.config.path=~/.cache/te2_kotlin_lsp/idea-config`
- Kotlin LSP `--system-path ~/.cache/te2_kotlin_lsp/kotlin-lsp-system`

All created before spawning in `lsp_shell_manager.py`.

### 2.3 SELinux: `sudo -n setenforce 0` (current behavior)

Current reality (as of 2025-12-19): Kotlin LSP’s file watching / inotify behavior on Android requires SELinux permissive on the devices tested.

Implementation (backend-side, automatic for now):
- When launching Kotlin LSP under Termux/Android, we wrap the command with:
  - `uname -a | grep -qi Android`
  - `command -v sudo`
  - `sudo -n setenforce 0 || true`
  - then `exec <kotlin lsp cmd>`

This is done in:
- `app/apps/file_editor_cm6/lsp_shell_manager.py`

Notes:
- Uses `sudo -n` (non-interactive) to avoid hanging if sudo prompts for a password.
- If sudo is not installed or permission is denied, it does nothing and continues.
- The UI opt-in work will later gate the *user-facing* enablement flow; for now the backend applies the workaround when Kotlin LSP is enabled.

### 2.4 Kotlin LSP flags

Current Kotlin runtime flags (Termux path):
- `--stdio`
- `--system-path <cache>`
- optionally `--isolated-documents` (default `true` on Android; preference exists for this)

`--isolated-documents` is used because Android file watching has proven unreliable; it reduces the need for workspace-wide watchers by isolating analysis state per document.

Preference key:
- `editor.kotlinLspIsolatedDocuments` (default: `true`)
Defined in:
- `app/apps/file_editor_cm6/preferences_store.py`

---

## 3) LSP connection: fixing the initial connect race

### 3.1 The symptom

On initial load the Kotlin LSP process was up (Framework Shell running), but the CM6 LSP client sometimes didn’t connect reliably. This looked like a startup timing/race issue between:
- Socket.IO connection establishment
- Backend spawning the LSP shell
- CM6 `LSPClient.connect(...)` starting the JSON-RPC handshake

### 3.2 The fix

We now wait for a backend “shell is ready” acknowledgment before starting the JSON-RPC handshake.

Backend already emits:
- `lsp_initialized` (sent at end of `on_initialize` in `app/apps/file_editor_cm6/lsp_ws.py`)

Frontend changes:
- `SocketIOTransport` now exposes:
  - `ready` (Socket.IO connected)
  - `lspInitialized` (resolves when `lsp_initialized` received)
- `connectLSP` now defers creating/connecting `LSPClient` until `lsp_initialized` arrives.
- Adds retry: if `lsp_initialized` doesn’t arrive within a timeout, it re-emits `initialize` and retries a few times.

All in:
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

This materially improves “first open” reliability for slow-start servers (Kotlin LSP in particular).

### 3.3 Exit/crash recovery (respawn)

All LSP servers (kotlin/clangd/pyright/typescript-language-server) can be manually exited by the user or crash.
The backend `/lsp` bridge tracks session health; if the cached per-(language, projectRoot) session is dead, the
next client `initialize` respawns a fresh shell and re-establishes the pipe bridge automatically.

---

## 4) Sticky scroll: where symbols go and how they’re used

Frontend maintains a `this.lspSymbols` array populated by:
- `requestDocumentSymbols()` → `textDocument/documentSymbol`
- `handleDocumentSymbols(symbols)` normalizes payloads and triggers sticky scroll refresh

Sticky scroll then:
- Walks the nested symbol tree, finds ancestor scopes for the current line, and renders them as sticky headers.

Implementation details and MVP background:
- `notes/2025-12-11_STICKY-S-LSP_WORKING_MVP.md`

---

## 5) C++ LSP (stub for next session)

### 5.1 Status (as of 2025-12-20)

✅ **Working basic integration** using Termux-packaged `clangd` over stdio.

What’s done:
- Extension → languageId mapping for C/C++ headers/sources
- `clangd` spawned as a Framework Shell (pipe-backed) and bridged over stdio
- Sticky scroll scopes come from `textDocument/documentSymbol` via clangd

Files:
- Extension mapping + last-file language selection: `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- LSP spawn command mapping: `app/apps/file_editor_cm6/lsp_shell_manager.py`

How to verify quickly:
- Set `editor.enableLsp=true`
- Open a `.c` or `.cpp`/`.h` file
- Confirm a running Framework Shell exists with label `lsp:c` or `lsp:cpp`

### 5.2 Goal (next)

Add a C/C++ LSP (likely `clangd`) that provides:
- `documentSymbol` for sticky scroll scopes
- `foldingRange` for fold gutter twisties (and later LSP-driven folding)

### 5.3 Planned follow-ups (not implemented yet)

- Wire `textDocument/foldingRange` into the fold gutter (clangd supports it).
- Decide how to handle compilation databases:
  - `compile_commands.json` discovery
  - `--compile-commands-dir` defaults vs UI/prefs
- Consider enabling background index and where index/caches should live on Termux.

Open questions for implementation:
- Per-project configuration surface (likely preferences + sidecar).

---

## 6) UI opt-in + warning modal (stub)

### 6.1 What “opt-in” should mean

The user should explicitly acknowledge risk when enabling Kotlin LSP on Android, because it may set SELinux permissive.

Desired UX (stub):
- Existing “Enable LSP” modal is extended for Kotlin/Android to include:
  - A clear warning: “Requires root; will run `sudo setenforce 0` on Android to operate”
  - A checkbox acknowledgement
  - Optional per-language toggles

### 6.2 Backend behavior post-UI

After UI exists:
- The backend `setenforce` prelude should be conditional on that explicit user choice (persisted in preferences).
- Keep the current Android detection and `sudo` presence guard.

---

## 7) Current “what to check” debug checklist

When Kotlin LSP is enabled and not behaving:

1. Confirm preference `editor.enableLsp=true` is set on disk.
2. Confirm Framework Shell exists and is running: look for label `lsp:kotlin`.
3. Confirm frontend logs show:
   - `Socket.IO connected, sending initialize...`
   - `Backend reported lsp_initialized`
   - `Connecting client to transport...`
4. Confirm symbols are received:
   - `[LSP] Received N document symbols`
5. If Android: confirm `sudo` exists and is configured, otherwise the `setenforce` step is a no-op.
