# Where It Fits and Pain Points

## Where TE2 / Code CM6 fits the proposed Android build + pseudo-LSP solution

### 1) Process orchestration is already the core of TE2
TE2 is designed around:
- one framework server
- multiple app workers (editor, terminal, etc.)
- a shared runtime model

This matches the new Android stack perfectly:
- **Android Build Service** as an app worker
- **Pseudo-LSP server** as a pipe shell process
- **Gradle daemon / build tasks** as child processes spawned and supervised through the same mechanisms

### 2) Framework Shells already models “LSP server” vs “terminal/build”
You already have distinct execution backends:
- **pipe shell** (stdio style) → great for JSON-RPC/LSP
- **dtach shell** (terminal style) → great for Gradle builds where logs matter and long-running sessions are useful

That gives you a clean split:
- Pseudo-LSP runs as a pipe shell
- Gradle build runs as a dtach shell (or a controlled process with streaming logs)

### 3) Your LSP transport layer is already in place
You already have a working pipeline:
- Browser (CM6) ↔ websocket/socket.io ↔ backend ↔ shell ↔ stdio tool

So the pseudo-LSP can drop in as “just another LSP server” behind the same bridge.

### 4) Your editor diagnostics UI is already “IDE-like”
Code CM6 already has:
- squiggles driven by LSP diagnostics
- Issues overlay listing diagnostics
- consistent per-file diagnostics lifecycle

This means the pseudo-LSP’s main output (diagnostics) will immediately look and feel correct.

### 5) You already have the most important performance control: debouncing/backpressure
Expensive work (Gradle/AGP compile) only feels good if you don’t flood it.

Your existing LSP broker/debounce concepts map directly to:
- “10s idle debounce”
- one build in flight
- cancel/restart on edits
- publish only latest results

### 6) Workspace root override is already solved
Android projects inside repos often live under `android/`.
You already support per-server workspace root overrides, which prevents a whole class of “LSP/build root mismatch” pain.

---

## Pain points (what will fight you)

### 1) Shadow workspace correctness + mapping
**Problem:** diagnostics will come from a shadow path; the editor needs real URIs.

**Where it bites:**
- compiler reports `.../.te2_shadow/.../Foo.kt`
- editor expects `file:///real/.../Foo.kt`

**Mitigation:**
- persistent `real_path ↔ shadow_path` mapping table
- normalize paths before publishing diagnostics
- never leak shadow paths into the UI

### 2) Incrementality is fragile if you touch too many files
Gradle and Kotlin incremental compilation work best when:
- the workspace stays stable
- only the changed files are rewritten
- caches persist (`.gradle/`, `build/`, Kotlin caches)

**Failure mode:** if you re-mirror frequently or rewrite lots of files, everything becomes a full rebuild.

**Mitigation:**
- keep shadow workspace alive per project
- rewrite only dirty buffers
- avoid touching timestamps unnecessarily

### 3) Cancellation must be hard, not polite
A “debounced build” UX requires:
- kill in-flight Gradle tasks when new edits arrive
- ignore late/stale results if they arrive anyway

**Failure mode:** outdated diagnostics that fight with current code.

**Mitigation:**
- build run IDs
- only publish diagnostics from the latest run ID
- aggressive process cancellation

### 4) Storage pressure (mobile reality)
Gradle caches + build outputs + shadow copies can balloon.

**Failure modes:**
- user runs out of space
- performance degrades

**Mitigation (post-MVP):**
- cache quotas
- “clean project caches” button
- prune old shadow projects
- allow moving caches to external storage if present

### 5) Toolchain compatibility + gating
Android builds depend on a coupled matrix:
- AGP ↔ Gradle ↔ JDK ↔ compileSdk

**Failure mode:** users open random Android project and it fails in weird ways.

**Mitigation (Alpha):**
- detect versions
- present a “supported profile”
- warn or refuse when outside profile
- optionally offer a guided setup later

### 6) Resource/manifest diagnostics are not always produced by `compileDebugKotlin`
Unresolved imports/types will show up there, but:
- `R` and resource merge failures may require running tasks earlier in the chain

**Mitigation:**
- fast path: `compileDebugKotlin` for quick Kotlin errors
- fallback path: escalate to `assembleDebug` (or resource-related tasks) when symptoms indicate resources/manifest issues

### 7) Termux-specific packaging oddities
Even when builds “work,” tool locations and permissions differ:
- SDK paths
- build-tools binaries
- installing APKs without ADB

**Mitigation:**
- keep the install ladder (interactive always)
- treat privileged install as optional
- keep environment probing in the build service

---

## Net assessment
Your framework is a strong match because it already provides:
- process orchestration primitives
- LSP transport
- diagnostics UX
- debounce/backpressure patterns
- workspace/root override support

Your main risks are:
- shadow workspace mapping
- incremental build preservation
- cancellation correctness
- storage/toolchain guardrails

All of these fit naturally into TE2’s architecture as “services” rather than invasive editor rewrites.

