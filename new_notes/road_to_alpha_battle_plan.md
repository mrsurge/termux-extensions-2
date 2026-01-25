# Road to Alpha: Battle Plan

**Created:** 2024-12-24
**Status:** Ready for Review

This document consolidates the three planning docs (`road_to_android_build_environment_alpha.md`, `where_it_fits_and_pain_points.md`, `play_button_manifesto.md`) into a concrete, actionable implementation plan mapped to the existing TE2/Code CM6 codebase.

---

## Executive Summary

Build an **Android-capable build + diagnostics + install** experience inside Code CM6 by:
1. Leveraging existing Framework Shells process model **via shellspec YAML declarations**
2. Reusing the LSP bridge + Issues Overlay + squiggles pipeline
3. Extending the Play button into a **Run Modes** dispatch system
4. Adding an **Android Build Service** that delegates to Gradle/AGP

### Key Design Decision: Shellspec-Driven Process Management

All Android build processes will be declared in **shellspec YAML files** under `app/apps/file_editor_cm6/shellspec/` and spawned via the `Orchestrator.start_from_ref()` pattern (same as app workers). This gives us:

- Declarative process definitions (no hardcoded spawn calls)
- Template variables (`${ctx:PROJECT_ROOT}`, `${env:ANDROID_HOME}`, `${free_port}`)
- UI hints for FWS dashboard (`ui.subgroup_styles`)
- Consistent lifecycle management across all Code CM6 shells

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Code CM6 Host                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Play Button  │  │ Build Panel  │  │ Issues Overlay (existing)│  │
│  │ (dropdown)   │  │ (new drawer) │  │ + squiggles              │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────▲─────────────┘  │
│         │                 │                       │                 │
│         ▼                 ▼                       │                 │
│  ┌─────────────────────────────────────┐         │                 │
│  │         postMessage Bus             │         │                 │
│  └─────────────────┬───────────────────┘         │                 │
└────────────────────┼─────────────────────────────┼─────────────────┘
                     │                             │
                     ▼                             │
┌─────────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ AndroidBuildSvc  │  │ ShadowWorkspace  │  │ DiagnosticsParser│  │
│  │ (android_build.py)  │ (shadow_ws.py)   │  │ (gradle output)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                     │            │
│           ▼                     ▼                     ▼            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │             Framework Shells + Orchestrator                 │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │ shellspec/android_build.yaml  (declarative specs)     │  │   │
│  │  │   - gradle-compile (dtach)                            │  │   │
│  │  │   - gradle-assemble (dtach)                           │  │   │
│  │  │   - android-lsp (pipe, pseudo-LSP)                    │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│  │  │ dtach shell │  │ pipe shell  │  │ Gradle daemon       │  │   │
│  │  │ (build logs)│  │ (pseudo-LSP)│  │ (child process)     │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Socket.IO /lsp namespace                         │
│              (existing LSP bridge, reused for diagnostics)          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Shellspec Files (New)

All Android build shells will be defined in `app/apps/file_editor_cm6/shellspec/android_build.yaml`:

```yaml
version: "1"

shells:
  # Gradle compile task for diagnostics (quick Kotlin errors)
  gradle-compile:
    backend: dtach
    cwd: ${ctx:PROJECT_ROOT}
    subgroups:
      - file_editor_cm6
      - android
      - "project:${ctx:PROJECT_HASH}"
    ui:
      subgroup_styles:
        android:
          bg: rgba(61, 220, 132, 0.15)
          border: rgba(61, 220, 132, 0.60)
        project:*:
          bg: rgba(0, 0, 0, 0.88)
          border: rgba(29, 70, 126, 0.88)
    command:
      - ./gradlew
      - ":${ctx:MODULE}:compile${ctx:VARIANT}Kotlin"
      - --console=plain
      - --no-daemon
    env:
      ANDROID_HOME: ${env:ANDROID_HOME}
      ANDROID_SDK_ROOT: ${env:ANDROID_SDK_ROOT}
      JAVA_HOME: ${env:JAVA_HOME}
      GRADLE_USER_HOME: ${ctx:GRADLE_CACHE}

  # Gradle assemble task for APK build
  gradle-assemble:
    backend: dtach
    cwd: ${ctx:PROJECT_ROOT}
    subgroups:
      - file_editor_cm6
      - android
      - "project:${ctx:PROJECT_HASH}"
    ui:
      subgroup_styles:
        android:
          bg: rgba(61, 220, 132, 0.15)
          border: rgba(61, 220, 132, 0.60)
    command:
      - ./gradlew
      - ":${ctx:MODULE}:assemble${ctx:VARIANT}"
      - --console=plain
    env:
      ANDROID_HOME: ${env:ANDROID_HOME}
      ANDROID_SDK_ROOT: ${env:ANDROID_SDK_ROOT}
      JAVA_HOME: ${env:JAVA_HOME}
      GRADLE_USER_HOME: ${ctx:GRADLE_CACHE}

  # Pseudo-LSP for Android diagnostics (MVP)
  android-lsp:
    backend: pipe
    cwd: ${ctx:PROJECT_ROOT}
    subgroups:
      - file_editor_cm6
      - lsp
      - android
    ui:
      subgroup_styles:
        lsp:
          bg: rgba(68, 45, 47, 0.80)
          border: rgba(168, 85, 247, 0.60)
    command:
      - python3
      - -m
      - app.apps.file_editor_cm6.android_lsp
      - --project-root
      - ${ctx:PROJECT_ROOT}
      - --module
      - ${ctx:MODULE}
      - --variant
      - ${ctx:VARIANT}
    env:
      ANDROID_HOME: ${env:ANDROID_HOME}
      PYTHONPATH: ${env:PYTHONPATH}

  # Logcat tail (Alpha)
  logcat-tail:
    backend: dtach
    cwd: ${ctx:PROJECT_ROOT}
    subgroups:
      - file_editor_cm6
      - android
      - logcat
    command:
      - logcat
      - --pid=${ctx:APP_PID}
    # Or filtered by tag:
    # command: ["logcat", "-s", "${ctx:PACKAGE_NAME}"]
```

### Spawning via Orchestrator

```python
from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from pathlib import Path

async def start_gradle_compile(project_root: str, module: str = "app", variant: str = "Debug"):
    mgr = await get_manager()
    orch = Orchestrator(mgr)
    
    project_hash = hashlib.sha1(project_root.encode()).hexdigest()[:8]
    gradle_cache = Path.home() / ".gradle"  # Or per-project cache
    
    shell = await orch.start_from_ref(
        "shellspec/android_build.yaml#gradle-compile",
        base_dir=Path(__file__).parent,  # app/apps/file_editor_cm6/
        ctx={
            "PROJECT_ROOT": project_root,
            "PROJECT_HASH": project_hash,
            "MODULE": module,
            "VARIANT": variant,
            "GRADLE_CACHE": str(gradle_cache),
        },
        label=f"android:compile:{project_hash}",
    )
    return shell
```

---

## Phase 0: POC (Proof-of-Concept)

**Goal:** Prove the entire loop on your GeckoView project.
**Success Criteria:**
- Unresolved import in Kotlin → squiggle after compile
- APK builds on-device
- APK installs via tap-to-confirm

### Task 0.1: Create Shellspec for Android Builds

**File:** `app/apps/file_editor_cm6/shellspec/android_build.yaml`

Define `gradle-compile` and `gradle-assemble` shell specs (see Shellspec Files section above).

### Task 0.2: AndroidBuildService (Shellspec-backed)

**File:** `app/apps/file_editor_cm6/android_build.py`

```python
from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from pathlib import Path

SHELLSPEC_DIR = Path(__file__).parent / "shellspec"

class AndroidBuildService:
    def __init__(self, project_root: str, module: str = "app", variant: str = "Debug"):
        self.project_root = project_root
        self.module = module
        self.variant = variant
        self.project_hash = hashlib.sha1(project_root.encode()).hexdigest()[:8]
        self._current_shell_id: Optional[str] = None
    
    def _ctx(self) -> dict:
        return {
            "PROJECT_ROOT": self.project_root,
            "PROJECT_HASH": self.project_hash,
            "MODULE": self.module,
            "VARIANT": self.variant,
            "GRADLE_CACHE": str(Path.home() / ".gradle"),
        }
    
    async def compile(self) -> ShellRecord:
        """Run compileDebugKotlin via shellspec."""
        mgr = await get_manager()
        orch = Orchestrator(mgr)
        
        # Kill any existing compile shell for this project
        await self._cancel_current()
        
        shell = await orch.start_from_ref(
            "android_build.yaml#gradle-compile",
            base_dir=SHELLSPEC_DIR,
            ctx=self._ctx(),
            label=f"android:compile:{self.project_hash}",
        )
        self._current_shell_id = shell.id
        return shell
    
    async def assemble(self) -> ShellRecord:
        """Run assembleDebug via shellspec."""
        mgr = await get_manager()
        orch = Orchestrator(mgr)
        
        shell = await orch.start_from_ref(
            "android_build.yaml#gradle-assemble",
            base_dir=SHELLSPEC_DIR,
            ctx=self._ctx(),
            label=f"android:assemble:{self.project_hash}",
        )
        return shell
    
    async def _cancel_current(self):
        if self._current_shell_id:
            mgr = await get_manager()
            try:
                await mgr.terminate_shell(self._current_shell_id, force=True)
            except Exception:
                pass
            self._current_shell_id = None

# FastAPI endpoints
@android_router.post('/android/compile')
async def compile_endpoint():
    history_store = get_history_store()
    project_path = history_store.get_active_project()
    if not project_path:
        raise HTTPException(400, "No active project")
    
    svc = AndroidBuildService(project_path)
    shell = await svc.compile()
    return {"ok": True, "shell_id": shell.id}

@android_router.post('/android/assemble')
async def assemble_endpoint():
    # Similar pattern...
```

**Reuse patterns from:**
- `app_manager.py`: `Orchestrator.start_from_ref()` usage
- `terminal_backend.py`: endpoint patterns, history store access

### Task 0.3: Gradle Output Parser

**File:** `app/apps/file_editor_cm6/android_diagnostics.py`

Parse patterns:
```
e: /path/to/File.kt:42:15: Unresolved reference: foo
w: /path/to/File.kt:10:1: Deprecated API usage
```

Output LSP diagnostic format:
```python
{
    "uri": "file:///real/path/to/File.kt",
    "diagnostics": [{
        "range": {"start": {"line": 41, "character": 14}, "end": {...}},
        "severity": 1,  # 1=error, 2=warning
        "source": "kotlinc",
        "message": "Unresolved reference: foo"
    }]
}
```

### Task 0.4: Shadow Workspace v0 (Diagnostics Only)

**File:** `app/apps/file_editor_cm6/shadow_workspace.py`

**Important Design Decision:** Shadow workspace is used **only for LSP diagnostics**, not for APK builds.

| Use Case | Workspace | Rationale |
|----------|-----------|-----------|
| Diagnostics (squiggles) | Shadow | Fast feedback without saving garbage mid-thought |
| Build APK | Real (save first) | Artifact matches disk state, simple mental model |
| Install | Real | APK came from real build |

This matches the existing Play button philosophy: save dirty buffers before running.

**Future option (back pocket):** Add "Build from workspace (unsaved)" as an advanced modal checkbox.

```python
class ShadowWorkspace:
    """Shadow workspace for diagnostics only (not for APK builds)."""
    
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.shadow_root = Path.home() / ".cache" / "te2_android_shadow" / self._hash()
    
    def ensure_mirror(self) -> Path:
        """Create/update shadow copy of project."""
        
    def swap_dirty_file(self, real_path: Path, content: str) -> Path:
        """Write dirty buffer content to shadow location for diagnostics."""
        
    def real_to_shadow(self, real_path: Path) -> Path:
        """Map real path to shadow path."""
        
    def shadow_to_real(self, shadow_path: Path) -> Path:
        """Map shadow path back to real path (for diagnostics normalization)."""
```

**APK Build flow (save-then-build):**
```python
async def build_apk():
    # 1. Save any dirty buffers (reuse existing save logic)
    await save_dirty_buffers()
    
    # 2. Build from real project root (no shadow)
    shell = await build_service.assemble()  # runs on real project
    
    # 3. APK path is in real project: app/build/outputs/apk/debug/
    return await find_apk_path(project_root)
```

### Task 0.5: Diagnostics Injection

**Option A (Simplest for POC):** Emit diagnostics via existing `/lsp` Socket.IO namespace
- After compile completes, backend parses output
- Emits `publishDiagnostics` event to connected client
- Existing CM6 Issues Overlay receives it automatically

**Option B (Cleaner separation):** New `/android` Socket.IO namespace
- Dedicated namespace for build events
- Host forwards to iframe via postMessage

**Recommendation:** Start with Option A for POC speed.

### Task 0.6: Install v0

```python
async def install_interactive(apk_path: str) -> dict:
    """Open APK with system installer."""
    # Termux method
    if shutil.which("termux-open"):
        subprocess.run(["termux-open", apk_path])
        return {"method": "termux-open"}
    
    # Fallback: am start with ACTION_VIEW intent
    subprocess.run([
        "am", "start", "-a", "android.intent.action.VIEW",
        "-d", f"file://{apk_path}",
        "-t", "application/vnd.android.package-archive"
    ])
    return {"method": "am-intent"}
```

---

## Phase 1: MVP

**Goal:** Transition from POC scripts to repeatable developer loop.
**Success Criteria:**
- Diagnostics refresh automatically after 10s idle
- Repeated diagnoses are faster (incremental builds)
- Build/Install is one obvious place in the UI

### Task 1.1: Pseudo-LSP Server (Shellspec-backed)

**Option A:** Fork `fwcd/kotlin-language-server` as protocol chassis
**Option B:** Minimal Python stdio server (faster to build)

Minimal LSP methods:
- `initialize` → return capabilities (diagnosticsProvider)
- `initialized` → trigger initial compile
- `textDocument/didOpen` → track open files
- `textDocument/didChange` → debounce → compile
- `textDocument/didClose` → cleanup
- `shutdown` / `exit` → graceful stop

**Shellspec entry** in `android_build.yaml`:
```yaml
android-lsp:
  backend: pipe
  cwd: ${ctx:PROJECT_ROOT}
  subgroups: [file_editor_cm6, lsp, android]
  command:
    - python3
    - -m
    - app.apps.file_editor_cm6.android_lsp
    - --project-root
    - ${ctx:PROJECT_ROOT}
  env:
    ANDROID_HOME: ${env:ANDROID_HOME}
```

**Spawn from lsp_shell_manager.py:**
```python
async def get_or_spawn_android_lsp(project_root: Path) -> Optional[ShellRecord]:
    mgr = await get_manager()
    orch = Orchestrator(mgr)
    
    project_hash = hashlib.sha1(str(project_root).encode()).hexdigest()[:8]
    label = f"lsp:android:{project_hash}"
    
    # Check for existing
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing and mgr.get_pipe_state(existing.id):
        return existing
    
    # Spawn via shellspec
    shell = await orch.start_from_ref(
        "android_build.yaml#android-lsp",
        base_dir=Path(__file__).parent / "shellspec",
        ctx={"PROJECT_ROOT": str(project_root)},
        label=label,
    )
    return shell
```

### Task 1.2: Debounced Diagnostics

```python
class AndroidDiagnosticsDebouncer:
    IDLE_TIMEOUT = 10.0  # seconds
    
    def __init__(self, build_service: AndroidBuildService):
        self.build_service = build_service
        self.pending_task: Optional[asyncio.Task] = None
        self.current_build_id: int = 0
    
    async def on_change(self, uri: str, content: str):
        # Cancel pending
        if self.pending_task:
            self.pending_task.cancel()
        
        # Schedule new
        self.pending_task = asyncio.create_task(
            self._debounced_compile(uri, content)
        )
    
    async def _debounced_compile(self, uri: str, content: str):
        await asyncio.sleep(self.IDLE_TIMEOUT)
        self.current_build_id += 1
        build_id = self.current_build_id
        
        result = await self.build_service.compile(build_id)
        
        # Only emit if still current
        if build_id == self.current_build_id:
            await self._emit_diagnostics(result.diagnostics)
```

### Task 1.3: Shadow Workspace v1

Enhancements over v0:
- Persist `.gradle/` and `build/` directories across runs
- Only rewrite files that changed (dirty buffer tracking)
- Support multiple dirty files simultaneously
- Never leak shadow paths into diagnostics (normalize before emit)

### Task 1.4: Build Panel UI

**Location:** New drawer or section in existing terminal drawer

```html
<!-- In template.html -->
<div id="android-build-panel" class="fe-drawer">
  <div class="fe-drawer-head">
    <span>Android Build</span>
    <button id="android-diagnose-btn">Diagnose</button>
    <button id="android-build-btn">Build APK</button>
    <button id="android-install-btn">Install</button>
  </div>
  <div id="android-build-status">
    <!-- Status: idle / running / success / failed -->
  </div>
  <div id="android-build-log" class="terminal-output">
    <!-- Streaming log output -->
  </div>
</div>
```

### Task 1.5: Play Button Dropdown

**Current:** Single `#run-active-file-btn` button
**New:** Dropdown with modes

```html
<div class="fe-play-dropdown">
  <button id="play-btn" class="fe-btn">▶</button>
  <button id="play-dropdown-toggle" class="fe-btn">▾</button>
  <div id="play-dropdown-menu" class="fe-dropdown">
    <div class="fe-dd-item" data-mode="run-file">Run Active File</div>
    <div class="fe-dd-item" data-mode="android-diagnose">Android: Diagnose</div>
    <div class="fe-dd-item" data-mode="android-build">Android: Build APK</div>
    <div class="fe-dd-item" data-mode="android-install">Android: Install</div>
  </div>
</div>
```

**JavaScript:**
```javascript
const RUN_MODES = {
  'run-file': { handler: runActiveFile, enabledFor: RUNNABLE_EXTENSIONS },
  'android-diagnose': { handler: androidDiagnose, enabledFor: isAndroidProject },
  'android-build': { handler: androidBuild, enabledFor: isAndroidProject },
  'android-install': { handler: androidInstall, enabledFor: hasBuiltApk },
};
```

---

## Phase 2: Alpha

**Goal:** Make it usable by someone other than you.
**Success Criteria:**
- User can clone a simple Android app, open it, see diagnostics, build, install
- UI explains what's happening and why

### Task 2.1: Toolchain Profile Detection

**File:** `app/apps/file_editor_cm6/android_toolchain.py`

```python
@dataclass
class ToolchainProfile:
    gradle_version: Optional[str]
    agp_version: Optional[str]
    java_version: Optional[str]
    android_sdk_path: Optional[str]
    build_tools_version: Optional[str]
    is_supported: bool
    warnings: List[str]

async def detect_toolchain(project_root: Path) -> ToolchainProfile:
    """Probe project for toolchain versions."""
    # Parse gradle-wrapper.properties for gradle version
    # Parse build.gradle(.kts) for AGP version
    # Run java -version
    # Check ANDROID_HOME / ANDROID_SDK_ROOT
```

**Supported Profile (what you test):**
- Gradle 8.x
- AGP 8.x
- JDK 17+
- Android SDK with build-tools 34+

### Task 2.2: Install Ladder

```python
class InstallMethod(Enum):
    INTERACTIVE = "interactive"  # Always available
    ROOT = "root"                # su -c pm install
    SHIZUKU = "shizuku"          # Shizuku API

async def detect_install_methods() -> List[InstallMethod]:
    methods = [InstallMethod.INTERACTIVE]
    
    # Check root
    if await _check_root():
        methods.insert(0, InstallMethod.ROOT)
    
    # Check Shizuku
    if await _check_shizuku():
        methods.insert(0, InstallMethod.SHIZUKU)
    
    return methods

async def install_apk(apk_path: str, method: Optional[InstallMethod] = None):
    available = await detect_install_methods()
    method = method or available[0]
    
    if method == InstallMethod.ROOT:
        return await _install_root(apk_path)
    elif method == InstallMethod.SHIZUKU:
        return await _install_shizuku(apk_path)
    else:
        return await _install_interactive(apk_path)
```

### Task 2.3: Launch After Install

```python
async def launch_app(package_name: str, activity: Optional[str] = None):
    """Launch installed app."""
    if activity:
        cmd = ["am", "start", "-n", f"{package_name}/{activity}"]
    else:
        # Launch main activity
        cmd = ["am", "start", "-a", "android.intent.action.MAIN",
               "-c", "android.intent.category.LAUNCHER",
               "-p", package_name]
    
    subprocess.run(cmd)
```

### Task 2.4: Logcat Integration

```python
async def tail_logcat(package_name: str, shell_id: str):
    """Stream logcat filtered to package."""
    # Get PID of running app
    pid = await _get_app_pid(package_name)
    
    if pid:
        cmd = f"logcat --pid={pid}"
    else:
        cmd = f"logcat -s {package_name}"
    
    mgr = await get_manager()
    await mgr.write_to_pty(shell_id, cmd + "\n")
```

---

## Risk Mitigations

| Risk | Mitigation | Phase |
|------|------------|-------|
| Shadow path leaks to UI | `shadow_to_real()` normalization before all diagnostic emits | POC |
| Incremental build breakage | Preserve `.gradle/` + `build/`; only rewrite dirty files in shadow | MVP |
| Stale diagnostics from old builds | Build run IDs; ignore results where `build_id != current_build_id` | MVP |
| Gradle process hangs | Hard timeout (5 min); `--no-daemon` option for debugging | POC |
| Storage bloat | Cache quota monitoring; "Clean Caches" button | Alpha |
| Toolchain matrix explosion | Detect + gate on supported profile; refuse unknown combos | Alpha |
| Resource/manifest errors missed | Escalate to `assembleDebug` when `compileDebugKotlin` shows no errors but build fails | MVP |
| APK doesn't match disk state | **Save-then-build policy** for APK builds (shadow only for diagnostics) | POC |

---

## File Inventory (New Files)

| File | Phase | Purpose |
|------|-------|---------|
| `app/apps/file_editor_cm6/shellspec/android_build.yaml` | POC | **Shellspec declarations** for gradle-compile, gradle-assemble, android-lsp, logcat-tail |
| `app/apps/file_editor_cm6/android_build.py` | POC | FastAPI router + AndroidBuildService (uses Orchestrator) |
| `app/apps/file_editor_cm6/android_diagnostics.py` | POC | Gradle output parser |
| `app/apps/file_editor_cm6/shadow_workspace.py` | POC | Project mirroring for safe builds |
| `app/apps/file_editor_cm6/android_lsp.py` | MVP | Pseudo-LSP server (Python module, spawned via shellspec) |
| `app/apps/file_editor_cm6/android_toolchain.py` | Alpha | Toolchain detection |
| `app/apps/file_editor_cm6/android_install.py` | Alpha | Install ladder logic |
| `app/apps/file_editor_cm6/static/js/android_panel.js` | MVP | Build panel UI |
| `docs/android_build.md` | Alpha | User documentation |

---

## File Inventory (Modified Files)

| File | Phase | Changes |
|------|-------|---------|
| `app/apps/file_editor_cm6/main.py` | POC | Mount android_build router |
| `app/apps/file_editor_cm6/template.html` | MVP | Add build panel, Play dropdown |
| `app/apps/file_editor_cm6/main.js` | MVP | Run modes dispatch, panel wiring |
| `app/apps/file_editor_cm6/lsp_shell_manager.py` | MVP | Add `kotlin-android` pseudo-LSP entry |
| `app/apps/file_editor_cm6/lsp_ws.py` | POC | (Optional) emit build diagnostics via existing namespace |

---

## Implementation Order

### Sprint 1: POC Core (Tasks 0.1-0.4)
1. `shellspec/android_build.yaml` - declare gradle-compile & gradle-assemble shells
2. `android_build.py` - compile/assemble endpoints using Orchestrator
3. `android_diagnostics.py` - gradle output parser
4. `shadow_workspace.py` - basic mirroring

### Sprint 2: POC Wiring (Tasks 0.5-0.6)
5. Wire diagnostics to CM6 Issues (via lsp_ws.py)
6. Install endpoint + UI trigger

### Sprint 3: MVP Backend (Tasks 1.1-1.3)
7. Add `android-lsp` to shellspec + pseudo-LSP server module
8. Shadow workspace v1 (incremental)
9. Cancel/supersede logic

### Sprint 4: MVP UI (Tasks 1.4-1.5)
10. Build panel drawer
11. Play button dropdown

### Sprint 5: Alpha Polish (Tasks 2.1-2.4)
12. Toolchain detection + gating
13. Install ladder
14. Add `logcat-tail` to shellspec + launch integration
15. User docs

---

## Definition of Done

### POC Complete
- [ ] `shellspec/android_build.yaml` defines gradle-compile and gradle-assemble
- [ ] AndroidBuildService spawns shells via `Orchestrator.start_from_ref()`
- [ ] Edit Kotlin in Code CM6
- [ ] Trigger compile via endpoint
- [ ] See error squiggles in editor
- [ ] Build APK on-device
- [ ] Install via system installer

### MVP Complete
- [ ] `android-lsp` shellspec entry + pseudo-LSP module
- [ ] Diagnostics auto-refresh after 10s idle
- [ ] Incremental builds are noticeably faster
- [ ] Build panel shows status + logs
- [ ] Play dropdown works

### Alpha Complete
- [ ] `logcat-tail` shellspec entry
- [ ] Toolchain profile displayed in UI
- [ ] Best install method auto-selected
- [ ] Launch app after install works
- [ ] Logcat tail available
- [ ] User can follow docs to set up a new Android project
