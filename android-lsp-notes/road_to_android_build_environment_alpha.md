# Road to Android Build Environment Alpha

## Purpose
Deliver an **Android-capable build + diagnostics + install** experience inside TE2’s **FastAPI + CodeMirror 6** editor on **mobile (Termux + GeckoView)** and **desktop**, using:
- TE2’s existing **Framework Shells** process model
- Code CM6’s existing **LSP bridge + Issues Overlay + squiggles pipeline**
- A new **AGP/Gradle-backed pseudo-LSP** (forking `fwcd/kotlin-language-server` as the LSP chassis)

The intent is not “replace Android Studio”, but to reach an **Alpha** where:
- edits produce **Android-correct diagnostics** (imports/types/resources/manifest)
- you can **build APK** on-device
- you can **install** (interactive always, root/Shizuku optionally)
- the experience is coherent in TE2’s UI

---

## Definitions
### Proof-of-Concept (POC)
A narrow spike proving the core loop works end-to-end on the **native GeckoView TE2 app** project:
1) Edit Kotlin
2) Trigger compile-backed diagnostics
3) Build APK
4) Install via interactive installer

### MVP
A usable “developer loop” for Android projects:
- stable shadow workspace
- debounced incremental compile diagnostics
- build/install UX integrated into Code CM6
- supports at least one canonical Android project layout

### Alpha
An end-to-end workflow that a real user can adopt for a small Android app:
- reliable diagnostics + build
- repeatable setup guidance
- basic run loop (install + launch, optional logs)
- guardrails for toolchain compatibility

---

## Current assets you already have (leverage hard)
### TE2 runtime + process management
- Single framework server + per-app workers
- Framework Shells supports:
  - dtach shells (terminals)
  - pipe shells (LSP/stdio processes)
- Existing routes and UI for shell lifecycle/logs

### Code CM6 integration primitives
- LSP server stdio bridge via Framework Shells + Socket.IO
- Issues Overlay + squiggles decorations already driven by LSP diagnostics
- Project-scoped per-language-server root overrides (useful for nested `android/` folders)
- Request broker (debounce + one-in-flight) and explicit didChange sending
- Export diagnostics snapshots (useful for debugging & agent workflows)

These mean the only “new” work is Android correctness + build orchestration.

---

## Target architecture (unified build environment)

### 1) Android Build Service (FastAPI-side)
A project-scoped service that owns:
- toolchain discovery (gradlew, java, android sdk paths)
- shadow workspace lifecycle
- build execution + cancellation
- log streaming
- artifact discovery (APK path)

### 2) AGP-backed Diagnostics Provider (pseudo-LSP)
- Fork `fwcd/kotlin-language-server` as protocol chassis
- Implement minimal LSP:
  - initialize
  - didOpen/didChange/didClose
  - publishDiagnostics
  - cancel
- Delegate to Android Build Service:
  - debounced `:app:compileDebugKotlin` (or `assembleDebug` when needed)
  - parse output → diagnostics
- Publish diagnostics into Code CM6 (existing overlay/squiggles)

### 3) Build UX (Code CM6 chrome)
A focused “Android” panel:
- Variant: fixed `debug` initially
- Actions:
  - **Diagnose** (manual trigger; also runs on debounce)
  - **Build APK** (assemble)
  - **Install** (best available path)
- Status:
  - last build result
  - current task (idle/running/canceled)
  - streaming logs

### 4) Install Service
- Path A (always): open APK in system installer UI
- Path B (optional): root silent install
- Path C (optional): Shizuku install

### 5) Helper agent (later)
Use exported diagnostics snapshots + build logs as structured input.

---

## Constraints to embrace (don’t fight)
- Android correctness comes from **AGP/Gradle**; semantic Kotlin LSP is not the source of truth for Android projects.
- “No ADB” does not imply “silent install”. Interactive install is the default baseline.
- Incrementality depends on a **persistent shadow workspace** and stable caches.

---

## Milestones

## Milestone 0 — POC: Android diagnostics + build + install on your GeckoView project
**Goal:** prove the entire loop on one known project.

### Deliverables
1) **Android Build Service (minimal)**
   - Inputs:
     - project root
     - module `:app`
     - variant `debug`
   - Commands:
     - `compileDebugKotlin` (diagnostics)
     - `assembleDebug` (APK)
   - Outputs:
     - parsed diagnostics list
     - raw build log stream
     - APK path

2) **Shadow workspace v0**
   - create once per project
   - naive mirroring (copy or symlink)
   - draft swap for 1 file (the active editor buffer)

3) **Diagnostics wiring**
   - no full LSP yet required for POC
   - simplest bridge:
     - backend emits diagnostics to the existing CM6 Issues system format
     - (or uses existing publishDiagnostics payload shape)

4) **Install v0 (interactive)**
   - open the built APK with the system installer

### Success criteria
- Unresolved import in Kotlin becomes a squiggle after a compile run.
- APK builds on-device.
- APK installs via tap-to-confirm.

### Notes
- Keep it brutally narrow: one project, one module, debug only.

---

## Milestone 1 — MVP: Pseudo-LSP + debounce + stable shadow workspace
**Goal:** transition from “manual POC scripts” to a repeatable developer loop.

### Deliverables
1) **Forked pseudo-LSP server (KLS chassis)**
   - Minimal LSP methods only
   - Runs as a Framework Shell pipe process
   - Receives didOpen/didChange from Code CM6

2) **Debounced diagnostics (10s idle)**
   - cancel in-flight compile on new edits
   - only publish latest diagnostics

3) **Shadow workspace v1 (persistent + incremental-friendly)**
   - maintain `.gradle/` + `build/` outputs across runs
   - only rewrite dirty files
   - support multiple dirty files
   - map shadow paths → real URIs

4) **Build panel UX v1**
   - Diagnose (manual)
   - Build APK
   - Install (interactive)
   - Log stream viewer

5) **Project root override support**
   - if Android project is nested, allow per-project root override (reuse existing feature)

### Success criteria
- Diagnostics refresh automatically after idle.
- Repeated diagnoses are faster (incremental builds kicking in).
- Build/Install flow is one obvious place in the UI.

---

## Milestone 2 — Alpha: toolchain compatibility + install ladder + “run loop”
**Goal:** make it usable by someone other than you.

### Deliverables
1) **Toolchain profile + gating (lightweight)**
   - Detect and display:
     - gradle wrapper version
     - AGP version (from build files)
     - java version
     - android sdk/build-tools availability
   - Provide a clear “supported profile” (what you test).
   - Refuse or warn when outside the profile.

2) **Install ladder**
   - Detect root
   - Detect Shizuku
   - Use best available path
   - Always keep interactive fallback

3) **Artifact handling**
   - surface APK path
   - “Open outputs folder”
   - cache last successful APK for quick reinstall

4) **Basic run loop (nice-to-have but high value)**
   - after install: launch app
   - optionally: tail logs (logcat integration can be minimal)

5) **Docs for users**
   - “How to point TE2 at an Android project”
   - “What works / what doesn’t”
   - “How install works (interactive vs privileged)”

### Success criteria
- A user can clone a simple Android app, open it, see diagnostics, build, install.
- The UI explains what’s happening and why.

---

## Best route to Alpha (reasoned path)

### Step 1: Validate correctness first (POC)
- Android correctness is the hard part.
- Don’t burn time on perfect LSP plumbing until the diagnostics are real.

### Step 2: Formalize the transport (MVP)
- Once correctness is proven, swap the delivery mechanism to the forked pseudo-LSP so it plugs cleanly into existing Code CM6 LSP + Issues pipeline.

### Step 3: Stabilize incremental builds (MVP)
- Persistent shadow workspace + minimal file rewrites unlocks speed.
- Speed is what makes debounce diagnostics feel “IDE-like”.

### Step 4: Make the UX obvious (MVP)
- One panel. Three buttons. One log stream.
- Anything else is noise until alpha.

### Step 5: Add guardrails (Alpha)
- Toolchain gating isn’t “extra”; it prevents impossible bug reports.
- Keep it informational + minimal, not a full installer yet.

---

## Implementation checklist (condensed)

### POC
- [ ] `AndroidBuildService.run_compile_debug_kotlin()`
- [ ] parse kotlin/javac/aapt/manifest errors → diagnostics
- [ ] `AndroidBuildService.assemble_debug()`
- [ ] `AndroidInstallService.install_interactive(apk_path)`

### MVP
- [ ] fork KLS → minimal pseudo-LSP
- [ ] LSP → BuildService delegation
- [ ] debounce + cancel
- [ ] shadow workspace v1
- [ ] Code CM6 Android panel

### Alpha
- [ ] toolchain detect + supported profile
- [ ] root/shizuku install paths
- [ ] launch app after install
- [ ] minimal user docs

