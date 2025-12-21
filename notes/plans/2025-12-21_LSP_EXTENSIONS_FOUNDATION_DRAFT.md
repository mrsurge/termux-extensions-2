# LSP Extensions (Framework Shells) — Rough Draft
**Date:** 2025-12-21  
**Context:** Code CM6 now has working LSP integration (pyright, TypeScript LS, clangd, JetBrains Kotlin LSP), sticky-scroll powered by `textDocument/documentSymbol`, and a host UI spinner/toast that reflects LSP lifecycle via the iframe bridge.

This document sketches a foundation for turning “LSP servers” into **first-class extensions** that:
- live in a vendor folder
- declare install + config + spawn rules
- run as Framework Shells (pipe shells)
- expose generic capabilities (symbols, folding, diagnostics) to the editor without per-LSP bespoke glue

The key architectural constraint is that `app/static/vendor/nicegui/elements/codemirror/codemirror.js` is effectively a **prebuilt runtime**. We want an extension system that is mostly **data/config driven** so we don’t need to re-bundle CodeMirror/NiceGUI for each server.

---

## Goals

1. **One pattern for all LSPs**
   - Kotlin/clangd/pyright/tsserver should all “look” like the same thing to the framework.
2. **Declarative spawn**
   - Each LSP’s spawn details live in a spec file (preferably `shellspec.yaml`) that the framework can launch as a Framework Shell.
3. **Declarative install/config**
   - Each LSP can ship install scripts and runtime notes per platform (Termux vs Ubuntu, etc).
4. **Capability-first UI**
   - “Does this server support symbols? foldingRange? diagnostics?” is discoverable and can drive UI affordances.
5. **No JS rebuild for most extensions**
   - New LSPs shouldn’t require touching CM6 bundle or NiceGUI vendor code.

---

## Non-goals (for now)

- A full UI “marketplace” (browse, install, update) inside Code CM6.
- Dynamic JS injection of custom CodeMirror features per LSP (requires bundling/build tooling).
- Multi-document LSP sessions in the editor (we’re single-active-doc right now).

---

## Where extensions live

Proposed root:

`app/static/vendor/lsp_extensions/`

Layout per extension:

```
app/static/vendor/lsp_extensions/
  kotlin-jb/
    manifest.json
    shellspec.yaml
    install/
      termux.sh
      ubuntu.sh
    assets/
      README.md               # optional
  clangd/
    manifest.json
    shellspec.yaml
  pyright/
    manifest.json
    shellspec.yaml
  typescript-language-server/
    manifest.json
    shellspec.yaml
```

Notes:
- “Vendored binaries” still live where they live today (e.g. Kotlin under `app/static/vendor/lsp_servers/kotlin-lsp/`). Extensions can reference them by path.
- This folder is primarily **metadata + scripts + spec**.

---

## `manifest.json` — proposed schema (draft)

```jsonc
{
  "id": "kotlin-jb",
  "name": "Kotlin LSP (JetBrains)",
  "version": "261.13587.0",

  "languages": [
    {
      "languageId": "kotlin",
      "extensions": [".kt", ".kts"],
      "notes": "Kotlin source + scripts"
    }
  ],

  "capabilities": {
    "documentSymbol": true,
    "foldingRange": true,
    "diagnostics": true,
    "completion": true,
    "hover": true
  },

  "spawn": {
    "shellspec": "shellspec.yaml",
    "transport": "stdio"
  },

  "install": {
    "termux": "install/termux.sh",
    "ubuntu": "install/ubuntu.sh"
  },

  "requirements": {
    "binaries": ["java"],
    "notes": [
      "Termux/Android: runs bundled glibc JRE via glibc-runner (grun).",
      "Some devices require SELinux permissive (setenforce 0) for file watching."
    ],
    "danger": {
      "android_selinux_permissive": true
    }
  },

  "runtimeHints": {
    "lspTimeoutMs": 180000,
    "isolatedDocumentsDefault": true
  }
}
```

Key ideas:
- **`capabilities`** is what the UI and feature toggles key off of.
- **`runtimeHints`** gives the CM6 iframe / host the ability to tune behavior without per-LSP JS code.
- **`requirements.danger`** is how we later implement “opt-in UI” for Kotlin’s SELinux behavior.

---

## `shellspec.yaml` — what we want from it

We want a `shellspec.yaml` to be the SSOT for:
- command argv
- environment variables
- cwd policy (project root)
- label/subgroups (so the shell list is consistent)
- platform forks (Termux vs desktop Linux) without embedding a ton of logic in Python

Draft shape:

```yaml
id: lsp.kotlin-jb
label: "lsp:kotlin"
subgroups: ["file_editor_cm6", "lsp"]
mode: pipe

cwd:
  kind: projectRoot

env:
  # optional env knobs
  TE2_KOTLIN_LSP_HOME: "{{vendor.kotlin_home}}"

command:
  # resolved by platform at runtime
  termux_android:
    argv: ["bash", "-lc", "sudo -n setenforce 0 >/dev/null 2>&1 || true; exec {{vendor.kotlin_grun_java_cmd}}"]
  linux:
    argv: ["{{vendor.kotlin_java}}", "..."]
```

This is intentionally high-level; the exact templating variables should align with `framework_shells` conventions (or TE2’s own, if we implement a tiny resolver).

---

## How the editor consumes extensions (no JS rebuild)

### 1) Backend: extension registry

Add a small loader that:
- scans `app/static/vendor/lsp_extensions/*/manifest.json`
- validates schema (best-effort)
- exposes a **single list** to the host UI: available servers, supported languages, install status

### 2) Backend: spawn policy

Phase approach:

- **Phase A (low risk):** keep `lsp_shell_manager.py` spawn code, but also load manifests for UI display.
- **Phase B:** switch `lsp_shell_manager.py` to resolve the active LSP by querying the registry:
  - languageId → extension id → command/shellspec

### 3) Frontend host + iframe: generic status + tuning knobs

We already have a generic message bus:
- iframe sends `postMessage({type:'cm6-lsp-status', ...})`
- host displays spinner/toasts

Extend that pattern with **generic config injection** (no imports):
- host fetches extension `runtimeHints` (timeout, etc)
- host sends iframe a config blob (e.g. `editor/set_lsp_hints`) before calling `connectLSP`

No per-LSP JS.

---

## Opt-in UI (future) — Kotlin SELinux + other “danger” requirements

We already have an “Enable LSP Integration” modal, but it’s global and minimal.

Plan:
- Add per-server rows (dynamic from registry) with:
  - installed/not installed
  - supported languages
  - “danger” badges (e.g. “requires sudo setenforce 0 on Android”)
- Require explicit acknowledgement for `requirements.danger.*` flags before enabling that server on that platform.

This keeps the backend behavior honest while meeting shipping needs.

---

## Folding + diagnostics: how this fits

Once extensions declare `capabilities.foldingRange` / `capabilities.diagnostics`, the editor can:
- request `textDocument/foldingRange` for fold gutters
- listen for `textDocument/publishDiagnostics` for problem markers

Important: implement these in **generic** CM6 code once (no per-LSP code).

---

## Migration steps (recommended order)

1. **Write manifests for the 4 current servers** (pyright, tsserver, clangd, kotlin-jb)
2. **Add registry endpoint**: list installed servers + their state (installed, missing binaries, etc.)
3. **Make the LSP modal dynamic** (driven by registry list rather than hard-coded)
4. **Introduce shellspec-backed spawn** behind a feature flag
5. **Add capability-driven features** (foldingRange first, diagnostics next)
6. **Add opt-in UI** for “danger” requirements (Kotlin SELinux on Android)

---

## Why this design avoids CodeMirror bundling pain

Most LSP integrations only need:
- spawn rules
- capability discovery
- generic LSP method calls
- a little tuning (timeouts, root selection)

All of that is doable with:
- backend registry + spawn
- iframe “status + config” messaging

We only need an actual JS build step if an extension wants to inject novel editor UI/behavior that isn’t expressible as config. That should be the exception, not the norm.

---

## Open questions

1. Should “extensions” be scoped to **Code CM6** only, or a general TE2 extension type?
2. Should `shellspec.yaml` be launched directly by `framework_shells` via `spec_id`, or should TE2 resolve templates into argv/env and call `spawn_shell_pipe`?
3. Should the registry live under `app/static/vendor/` (fully vendored) or under `app/apps/file_editor_cm6/extensions/` (app-owned)?
4. How do we want updates handled (pin versions vs “latest”)?

