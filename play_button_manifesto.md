# Play Button Manifesto

## Purpose
The ▶ **Play button** is the user’s fastest path from **editing** to **feedback**.

It must scale from the current “run active file” behavior into a **unified run/build/install loop** across languages and platforms (Termux/mobile + desktop), without losing the simplicity that makes it useful.

The Play button is not “a Python runner.” It is a **dispatch system**.

---

## Current behavior (baseline)
**Play** dispatches the active file into the project terminal.

### Frontend
- Button: `#run-active-file-btn` (`app/apps/file_editor_cm6/template.html`)
- Enable/disable policy: `RUNNABLE_EXTENSIONS` (`app/apps/file_editor_cm6/main.js`)

### Backend
- Endpoint: `POST /api/app/file_editor_cm6/terminal/run_active_file` (`app/apps/file_editor_cm6/terminal_backend.py`)
- Dispatch model: backend writes a **single shell command line** into the dtach-backed PTY (`write_to_pty`).

### Supported today
- Python: `.py`, `.pyw` → `python3 <file>`
- Shell: `.sh`, `.bash`, `.zsh` → `bash|zsh <file>`
- C/C++: `.c`, `.cc`, `.cpp`, `.cxx` → compile then run
  - Output: `<file_dir>/.te2_build/<stem>.out`
  - Compiler selection: `.c` → `gcc`, C++ → `g++`

This is intentionally a single-file path; project build integration is future work.

---

## The new contract: “Play runs a **Run Mode**”
The Play button executes a **Run Mode**.

A **Run Mode** is a named, configurable routine that:
- may run one command or many
- may require setup (env vars, toolchain)
- may produce artifacts (apk/out/bin)
- may stream logs
- may publish diagnostics

### Core principles
1) **One click, one intent**
   - The user clicks ▶ and expects *something to happen now*.

2) **Simple by default; powerful by configuration**
   - Default behavior remains “Run Active File.”
   - Advanced workflows are opt-in via “modes.”

3) **Everything is routed through the terminal dispatch model**
   - A Run Mode ultimately becomes:
     - a shell session (dtach)
     - and a stream of command lines written to it

4) **Reproducible and bookmarkable**
   - If a workflow is useful once, it must be storable as a reusable mode.

5) **Unified feedback loop**
   - Run output, build logs, diagnostics, and metrics belong to the same action.

---

## UX design: Play as a dropdown + “bookmark modal”
### Play UI
- Default click: run the **current default Run Mode**
- Long-press / chevron: open a **Run Modes dropdown**

### Run Modes dropdown
- “Run Active File” (existing behavior)
- “Build Current Project” (new entry)
- pinned/bookmarked modes (user-defined)

### Bookmark modal
A modal for creating/editing Run Modes:
- Name (display label)
- Scope:
  - Active File
  - Current Project
  - Workspace
- Trigger:
  - Play default
  - Dropdown only
  - Hotkey binding (desktop)

---

## Run Mode types (initial set)

### A) File Runner Modes (existing)
- Python runner
- Shell runner
- C/C++ single-file compile+run

These use:
- active file path
- fixed command templates

### B) Project Builder Modes (new)
- “Build Current Project” is the first-class entry point.
- It delegates to a per-project build adapter.

Examples:
- Android (Gradle/AGP): `./gradlew :app:assembleDebug`
- CMake/Make (future): `cmake --build …` or `make`

### C) Project Run/Deploy Modes (Android-focused)
Modes that extend beyond build:
- Build APK → Install → Launch
- Build APK → Install (interactive)
- Build APK → Install (root/Shizuku)

### D) Metrics / Observation Modes
Modes that capture runtime signals:
- tail logcat for a package
- start metrics capture → run → stop capture

---

## Android: the “Play loop” for mobile dev

### Why Android needs Play
Android dev breaks beginners because the feedback loop is fragmented.
Play becomes the unified loop:
- Diagnose → Build → Install → Launch → Observe

### Proposed Android Run Modes (minimum viable)
1) **Android: Diagnose (debounced / manual)**
   - triggers pseudo-LSP compile task (`compileDebugKotlin`)
   - publishes diagnostics

2) **Android: Build Debug APK**
   - runs `:app:assembleDebug`
   - captures APK path

3) **Android: Install (interactive)**
   - opens APK in system installer UI

4) **Android: Install + Launch**
   - install, then launch main activity

5) **Android: Logcat (package)**
   - tail logcat filtered to the app package

### Android mode routing
Android modes are driven by an **Android Build Service**:
- manages toolchain (JDK/SDK/Gradle)
- manages shadow workspace
- streams logs
- exports diagnostics

The Play button simply selects and triggers these modes.

---

## Data model: what a Run Mode stores
A Run Mode is stored as a compact JSON record.

### Required
- `id`
- `name`
- `scope` (file/project/workspace)
- `kind` (file_runner/project_build/project_deploy/metrics)

### Command execution
- `shell_backend` (dtach/pipe)
- `commands` (templated lines)
- `cwd` (optional)
- `env` (optional)

### Toolchain & adapters
- `adapter` (none/android/clang/make/etc)
- `adapter_config` (variant, module, package name, build dir, etc.)

### UI/behavior
- `pinned` (bool)
- `default` (bool)
- `show_logs` (bool)
- `publish_diagnostics` (bool)

---

## Dispatch semantics
### Uniform dispatch
All Run Modes dispatch through one backend concept:
- resolve mode → materialize command lines → write to PTY

### Cancellation
- A running mode can be:
  - canceled (send ctrl-c or kill process)
  - superseded (new run interrupts old)

### Output ownership
- Each run has an ID
- Logs are associated to run ID
- Diagnostics (if produced) are associated to run ID and published only if current

---

## Relationship to LSP
Play is not LSP, but it **coordinates** with LSP.

- The pseudo-LSP publishes diagnostics from AGP compile.
- Play can:
  - trigger diagnose now
  - display the last diagnostic run status
  - open the Issues panel filtered to the last run

This keeps the “developer loop” coherent:
- one button triggers action
- the editor shows results in the same visual system

---

## MVP scope (what ships first)
### Must ship
- Keep existing “Run Active File” exactly as-is.
- Add dropdown UX.
- Add “Build Current Project” placeholder entry.
- Add Android modes for your GeckoView project:
  - Build Debug APK
  - Install (interactive)
  - (optional) Install + Launch

### Nice to have
- Logcat tail mode
- Root/Shizuku install modes
- Mode bookmarking UI polish

### Not in MVP
- Full build-toolchain manager/installer
- Multi-module / multi-variant UI
- Complex debugging integration

---

## Definition of success
A user opens your native GeckoView Android project in TE2 and can:
1) edit code
2) hit ▶ → build debug apk
3) hit ▶ → install
4) (optional) hit ▶ → launch + tail logs

…and all of this feels like one cohesive system, not a pile of scripts.

