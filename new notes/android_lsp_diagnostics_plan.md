# Android LSP Live Diagnostics Plan

**Created:** 2025-12-25  
**Status:** Draft  
**Goal:** Transform "save and see if I have errors" into "stop errors while editing"

---

## Executive Summary

We have a working POC: Gradle compiles on file open, errors become squiggles. But this is just a fancy CLI wrapper. To make it useful, we need:

1. **Save-Time Gradle Truth** — Compile when repo state changes, not on every keystroke
2. **Draft Mode Heuristics** — Predict errors while typing using a dependency index
3. **Android Sidecar** — Separate cache for Android-specific state (not polluting ProjectSidecar)

All diagnostics flow through the existing LSP → Issues Overlay pipeline. No new UI surfaces.

---

## Part 1: Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Editing                                 │
│                                                                      │
│   Types → Lezer syntax lint (instant)                               │
│   Types → Draft Mode heuristics (debounced, from index)             │
│   Saves → Repo fingerprint check                                     │
│           → If changed: Gradle compile → update index + diagnostics │
│           → If unchanged: serve cached diagnostics                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    android_lsp_bridge.py                            │
│                                                                      │
│   - Manages AndroidSidecar (dependency index, cached diagnostics)   │
│   - Computes repo fingerprint                                        │
│   - Triggers Gradle on fingerprint change                           │
│   - Parses Gradle errors → updates index                            │
│   - Draft mode: compares session cache against index                │
│   - Emits publishDiagnostics to existing LSP bridge                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Existing: lsp_ws.py → codemirror.js                    │
│                                                                      │
│   publishDiagnostics → squiggles + Issues Overlay                   │
│   (No changes needed to rendering pipeline)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### File Locations

```
app/apps/file_editor_cm6/
├── android_lsp_bridge.py      # NEW: orchestrates diagnostics
├── android_sidecar.py         # NEW: per-project Android state
├── lsp_shell_manager.py       # existing (spawns LSP)
├── lsp_ws.py                  # existing (websocket bridge)
└── shellspec/
    └── android_lsp.yaml       # existing

~/.cache/te2_android_lsp/
└── <project_hash>/
    └── sidecar.json           # AndroidSidecar persistent state
```

---

## Part 2: AndroidSidecar Schema

Separate from ProjectSidecar. Created when Android LSP is enabled for a project.

```jsonc
{
  "version": 1,
  "project_path": "/path/to/android/project",
  "project_hash": "a1b2c3d4",
  
  // Repo state fingerprint (triggers recompile when changed)
  "repo_fingerprint": {
    "hash": "sha256:...",
    "computed_at": "2025-12-25T12:00:00Z",
    "source_files_count": 42,
    "gradle_files_hash": "sha256:..."  // build.gradle.kts, settings.gradle.kts
  },
  
  // Last successful compile metadata
  "last_compile": {
    "at": "2025-12-25T12:00:00Z",
    "task": ":app:compileGeckoDebugKotlin",
    "duration_ms": 21000,
    "exit_code": 0,
    "repo_fingerprint_hash": "sha256:..."
  },
  
  // Dependency index (built from source + compile errors)
  "dependency_index": {
    // Symbols defined in this project
    "definitions": {
      "com.example.FooHelper": {
        "kind": "class",
        "file": "app/src/main/java/com/example/FooHelper.kt",
        "line": 5
      },
      "com.example.FooHelper.doThing": {
        "kind": "method",
        "file": "app/src/main/java/com/example/FooHelper.kt",
        "line": 12,
        "signature": "(String) -> Unit"
      }
    },
    
    // Symbols used (imports + references)
    "usages": {
      "com.example.FooHelper": [
        {"file": "app/src/main/java/com/example/Bar.kt", "line": 3, "kind": "import"},
        {"file": "app/src/main/java/com/example/Bar.kt", "line": 15, "kind": "reference"}
      ]
    },
    
    // Packages known to exist (from classpath + sources)
    "packages": {
      "com.example": {"source": "project"},
      "com.example.utils": {"source": "project"},
      "android.webkit": {"source": "android.jar"},
      "org.mozilla.gecko": {"source": "geckoview.aar"}
    }
  },
  
  // Cached diagnostics from last Gradle run
  "cached_diagnostics": {
    "by_file": {
      "app/src/main/java/com/example/Bar.kt": {
        "repo_fingerprint_hash": "sha256:...",
        "items": [
          {
            "line": 15,
            "column": 10,
            "severity": 1,
            "message": "Unresolved reference: FooHelper",
            "symbol": "FooHelper",
            "error_kind": "unresolved_reference"
          }
        ]
      }
    },
    "summary": {
      "errors": 2,
      "warnings": 1,
      "files_with_errors": ["Bar.kt", "Baz.kt"]
    }
  },
  
  // Draft mode state (ephemeral, not persisted across restarts)
  "draft_overlay": null  // runtime only
}
```

---

## Part 3: Repo Fingerprint

### What It Captures

The fingerprint must detect any change that could affect compilation:

```python
def compute_repo_fingerprint(project_root: Path) -> str:
    """
    Fingerprint = hash of:
    1. Git status (staged + unstaged changes)
    2. Gradle config files (build.gradle.kts, settings.gradle.kts, gradle.properties)
    3. Source file manifest (list of .kt/.java files + their mtimes)
    """
    parts = []
    
    # Git status hash (fast, catches most changes)
    git_status = run("git status --porcelain")
    parts.append(sha256(git_status))
    
    # Gradle config hash (catches dependency changes)
    for f in ["build.gradle.kts", "settings.gradle.kts", "gradle.properties",
              "app/build.gradle.kts"]:
        if (project_root / f).exists():
            parts.append(sha256((project_root / f).read_bytes()))
    
    # Source manifest (file list + mtimes, not content - too slow)
    source_files = sorted(project_root.glob("**/src/**/*.kt"))
    manifest = "\n".join(f"{f.relative_to(project_root)}:{f.stat().st_mtime}" 
                         for f in source_files)
    parts.append(sha256(manifest))
    
    return sha256("\n".join(parts))
```

### When To Check

- After every file save (with 20s debounce when autosave is on)
- On project open
- On explicit "refresh" action

### When To Trigger Gradle

```python
if new_fingerprint != sidecar.repo_fingerprint.hash:
    trigger_gradle_compile()
    sidecar.repo_fingerprint.hash = new_fingerprint
else:
    serve_cached_diagnostics()
```

---

## Part 4: Error Parsing → Dependency Index

### Gradle Error Patterns

From Gradle/Kotlin compiler output, we extract structured data:

| Error Pattern | Regex | Extracted Data |
|---------------|-------|----------------|
| Unresolved reference | `e: file://(.+):(\d+):(\d+): Unresolved reference: (\w+)` | file, line, col, symbol |
| Cannot find symbol (class) | `error: cannot find symbol.*symbol:\s+class (\w+)` | symbol, kind=class |
| Cannot find symbol (method) | `error: cannot find symbol.*symbol:\s+method (\w+)\(` | symbol, kind=method |
| Package does not exist | `error: package (.+) does not exist` | package |
| Duplicate class | `Duplicate class (.+) found in` | class, conflict info |

### Index Update Flow

```python
async def update_index_from_gradle_output(output: str, sidecar: AndroidSidecar):
    errors = parse_gradle_errors(output)
    
    for error in errors:
        if error.kind == "unresolved_reference":
            # Record: this file needs this symbol
            sidecar.dependency_index.usages.setdefault(error.symbol, []).append({
                "file": error.file,
                "line": error.line,
                "kind": "reference"
            })
        
        # Store the diagnostic for cache
        sidecar.cached_diagnostics.by_file.setdefault(error.file, {
            "repo_fingerprint_hash": sidecar.repo_fingerprint.hash,
            "items": []
        })["items"].append(error.to_diagnostic())
```

### Source Scanning for Definitions

After Gradle runs (or on project open), scan source files for definitions:

```python
async def scan_source_definitions(project_root: Path, sidecar: AndroidSidecar):
    """
    Simple regex-based extraction of class/function definitions.
    Not a full parser - just enough to know what's defined where.
    """
    for kt_file in project_root.glob("**/src/**/*.kt"):
        content = kt_file.read_text()
        rel_path = str(kt_file.relative_to(project_root))
        
        # Package declaration
        pkg_match = re.search(r'^package\s+([\w.]+)', content, re.MULTILINE)
        pkg = pkg_match.group(1) if pkg_match else ""
        
        # Class definitions
        for match in re.finditer(r'^(?:class|object|interface)\s+(\w+)', content, re.MULTILINE):
            fqn = f"{pkg}.{match.group(1)}" if pkg else match.group(1)
            line = content[:match.start()].count('\n') + 1
            sidecar.dependency_index.definitions[fqn] = {
                "kind": "class",
                "file": rel_path,
                "line": line
            }
        
        # Function definitions (top-level)
        for match in re.finditer(r'^fun\s+(\w+)\s*\(', content, re.MULTILINE):
            fqn = f"{pkg}.{match.group(1)}" if pkg else match.group(1)
            line = content[:match.start()].count('\n') + 1
            sidecar.dependency_index.definitions[fqn] = {
                "kind": "function",
                "file": rel_path,
                "line": line
            }
        
        # Import statements → usages
        for match in re.finditer(r'^import\s+([\w.]+)', content, re.MULTILINE):
            imported = match.group(1)
            line = content[:match.start()].count('\n') + 1
            sidecar.dependency_index.usages.setdefault(imported, []).append({
                "file": rel_path,
                "line": line,
                "kind": "import"
            })
```

---

## Part 5: Draft Mode Engine

### Goal

While user is typing (before save triggers Gradle), provide heuristic diagnostics based on the dependency index.

### Inputs

1. **Session cache** — current unsaved content
2. **Dependency index** — what symbols exist and who uses them
3. **Cached diagnostics** — last known Gradle truth

### Heuristics

```python
async def compute_draft_diagnostics(
    file_path: str,
    draft_content: str,
    sidecar: AndroidSidecar
) -> list[Diagnostic]:
    """
    Compare draft content against dependency index to predict errors.
    """
    diagnostics = []
    
    # 1. Check if draft REMOVES a symbol that others depend on
    disk_definitions = get_definitions_in_file(file_path, sidecar)
    draft_definitions = extract_definitions_from_content(draft_content)
    
    removed = disk_definitions - draft_definitions
    for symbol in removed:
        usages = sidecar.dependency_index.usages.get(symbol, [])
        if usages:
            # This symbol is used elsewhere - warn about breakage
            diagnostics.append(Diagnostic(
                line=1,  # top of file
                severity=DiagnosticSeverity.Warning,
                message=f"Removing '{symbol}' will break {len(usages)} file(s)",
                source="draft"
            ))
    
    # 2. Check if draft ADDS a symbol that was previously missing
    # (This could resolve existing cached errors)
    added = draft_definitions - disk_definitions
    for symbol in added:
        # Check if any cached error was "unresolved reference: {symbol}"
        for file, data in sidecar.cached_diagnostics.by_file.items():
            for item in data.get("items", []):
                if item.get("symbol") == symbol and item.get("error_kind") == "unresolved_reference":
                    # Don't emit - the cached error for that file might be fixed
                    # But we could emit an info: "This may fix error in {file}"
                    pass
    
    # 3. Check imports against known packages/symbols
    imports = extract_imports_from_content(draft_content)
    for imp in imports:
        if not symbol_or_package_exists(imp, sidecar):
            # Find the line number
            line = find_import_line(draft_content, imp)
            diagnostics.append(Diagnostic(
                line=line,
                severity=DiagnosticSeverity.Error,
                message=f"Unresolved import: {imp}",
                source="draft"
            ))
    
    return diagnostics
```

### Provenance Tagging

All diagnostics include a `source` field:

- `"source": "gradle"` — from actual Gradle compile
- `"source": "cached"` — from stored Gradle results (repo unchanged)
- `"source": "draft"` — heuristic while editing

The Issues Overlay can optionally display this subtly.

---

## Part 6: Diagnostic Arbitration

### Priority Order

When multiple sources have diagnostics for the same file:

1. **Gradle (fresh)** — if repo fingerprint matches current state
2. **Cached** — if repo fingerprint matches cached compile
3. **Draft** — heuristics from dependency index

### Merge Strategy

```python
async def get_diagnostics_for_file(
    file_path: str,
    sidecar: AndroidSidecar,
    session_cache: dict
) -> tuple[list[Diagnostic], str]:
    """
    Returns (diagnostics, source) where source is the provenance.
    """
    current_fingerprint = compute_repo_fingerprint(project_root)
    
    # Check if we have fresh Gradle results
    if sidecar.repo_fingerprint.hash == current_fingerprint:
        cached = sidecar.cached_diagnostics.by_file.get(file_path)
        if cached and cached.get("repo_fingerprint_hash") == current_fingerprint:
            return (cached["items"], "gradle")
    
    # Check if file has unsaved changes (draft mode)
    draft = session_cache.get(file_path)
    if draft and draft.get("content"):
        draft_diags = await compute_draft_diagnostics(file_path, draft["content"], sidecar)
        # Merge with stale cached if available
        cached = sidecar.cached_diagnostics.by_file.get(file_path, {}).get("items", [])
        return (merge_diagnostics(cached, draft_diags), "draft")
    
    # Fall back to stale cache with warning
    cached = sidecar.cached_diagnostics.by_file.get(file_path, {}).get("items", [])
    return (cached, "cached")
```

---

## Part 7: Integration Points

### 7.1 android_lsp_bridge.py

New file that orchestrates everything:

```python
"""
Android LSP Bridge - Orchestrates live diagnostics for Android projects.

Responsibilities:
- Manages AndroidSidecar lifecycle
- Computes and monitors repo fingerprint
- Triggers Gradle compiles on fingerprint change
- Runs draft mode heuristics
- Publishes diagnostics to the LSP websocket bridge
"""

class AndroidLspBridge:
    def __init__(self, project_root: Path, lsp_ws: LspWebsocket):
        self.project_root = project_root
        self.lsp_ws = lsp_ws
        self.sidecar = AndroidSidecar.load_or_create(project_root)
        self._compile_lock = asyncio.Lock()
        self._fingerprint_debounce = None
    
    async def on_file_saved(self, file_path: str):
        """Called when a file is saved to disk."""
        # Debounce fingerprint check (20s for autosave)
        if self._fingerprint_debounce:
            self._fingerprint_debounce.cancel()
        self._fingerprint_debounce = asyncio.create_task(
            self._debounced_fingerprint_check()
        )
    
    async def _debounced_fingerprint_check(self):
        await asyncio.sleep(20.0)  # 20s debounce
        await self._check_and_maybe_compile()
    
    async def _check_and_maybe_compile(self):
        new_fp = compute_repo_fingerprint(self.project_root)
        if new_fp != self.sidecar.repo_fingerprint.hash:
            await self._run_gradle_compile()
    
    async def _run_gradle_compile(self):
        async with self._compile_lock:
            # Run Gradle, parse errors, update sidecar
            ...
            # Publish diagnostics
            await self._publish_all_diagnostics()
    
    async def on_draft_change(self, file_path: str, content: str):
        """Called when user edits (before save)."""
        draft_diags = await compute_draft_diagnostics(file_path, content, self.sidecar)
        await self._publish_diagnostics(file_path, draft_diags, source="draft")
    
    async def _publish_diagnostics(self, file_path: str, diags: list, source: str):
        """Emit publishDiagnostics through existing LSP bridge."""
        uri = f"file://{self.project_root / file_path}"
        await self.lsp_ws.emit_diagnostics(uri, diags, source=source)
```

### 7.2 Hooking Into Existing Systems

**Session cache changes** (for draft mode):
```python
# In editor_app.py or wherever session cache is updated
async def on_document_change(file_path: str, content: str):
    # existing session cache update...
    
    # NEW: notify Android bridge for draft diagnostics
    if android_bridge and is_android_file(file_path):
        await android_bridge.on_draft_change(file_path, content)
```

**File save events** (for fingerprint check):
```python
# In file save handler
async def on_file_saved(file_path: str):
    # existing save logic...
    
    # NEW: notify Android bridge
    if android_bridge:
        await android_bridge.on_file_saved(file_path)
```

### 7.3 LSP Websocket Integration

The bridge publishes diagnostics through the existing `lsp_ws.py`:

```python
# In lsp_ws.py - add method for bridge to call
async def emit_diagnostics(self, uri: str, diagnostics: list, source: str = "gradle"):
    """
    Emit publishDiagnostics notification to connected clients.
    Called by AndroidLspBridge (not just from LSP server stdout).
    """
    message = {
        "jsonrpc": "2.0",
        "method": "textDocument/publishDiagnostics",
        "params": {
            "uri": uri,
            "diagnostics": diagnostics,
            # Optional: include provenance for UI hint
            "_source": source
        }
    }
    await self.broadcast_to_clients(message)
```

---

## Part 8: Implementation Phases

### Phase 1: AndroidSidecar + Fingerprint (Foundation)

**Files:** `android_sidecar.py`

- [ ] AndroidSidecar class with schema
- [ ] `load_or_create()` from `~/.cache/te2_android_lsp/<hash>/`
- [ ] `compute_repo_fingerprint()` function
- [ ] Basic persistence (JSON save/load)

**Deliverable:** Can detect when repo state changes

### Phase 2: Save-Time Gradle Integration

**Files:** `android_lsp_bridge.py`, modify `lsp_ws.py`

- [ ] AndroidLspBridge class skeleton
- [ ] Hook `on_file_saved()` into existing save flow
- [ ] 20s debounce for autosave
- [ ] Trigger Gradle on fingerprint change
- [ ] Parse errors into `cached_diagnostics`
- [ ] Publish through LSP bridge

**Deliverable:** Gradle runs on save, errors appear as squiggles

### Phase 3: Dependency Index Building

**Files:** `android_sidecar.py`, `android_lsp_bridge.py`

- [ ] `scan_source_definitions()` — extract classes/functions from source
- [ ] `update_index_from_gradle_output()` — extract usages from errors
- [ ] Index stored in sidecar
- [ ] Rebuild index after each successful compile

**Deliverable:** Sidecar knows what symbols exist and who uses them

### Phase 4: Draft Mode Heuristics

**Files:** `android_lsp_bridge.py`

- [ ] `compute_draft_diagnostics()` function
- [ ] Hook into session cache updates
- [ ] Heuristics: removed symbols, unresolved imports
- [ ] Merge draft + cached diagnostics
- [ ] Provenance tagging (`source: draft/cached/gradle`)

**Deliverable:** Squiggles appear while typing, before save

### Phase 5: UI Polish (Optional)

**Files:** `codemirror.js`, `template.html`

- [ ] Show provenance hint in Issues Overlay header
- [ ] "Diagnostics: gradle (12s ago)" or "draft (heuristic)"
- [ ] Subtle, not noisy

**Deliverable:** Users can tell if diagnostics are authoritative or hints

---

## Part 9: Open Questions

1. **Classpath packages** — How do we know `android.webkit` exists without parsing every JAR? 
   - Option A: Just track project-defined packages, assume external imports are valid
   - Option B: Parse Gradle dependency tree once, extract package list from JARs
   - Option C: Only flag imports that previously caused errors

2. **Multi-module projects** — GeckoView has `:app` and potentially other modules
   - Do we track cross-module dependencies?
   - Or just compile the "main" module and let Gradle figure it out?

3. **Generated sources** — R.java, ViewBinding, etc.
   - These don't exist until Gradle runs
   - Draft mode can't know about them
   - Accept this limitation? Or scan `build/generated/`?

4. **Performance** — Source scanning on large projects
   - Incremental scanning (only changed files)?
   - Background thread?
   - How big is GeckoView's source tree?

---

## Part 10: Success Criteria

### Minimum Viable

- [ ] Gradle compiles on save (not on every keystroke)
- [ ] Errors from Gradle appear as squiggles within 30s of save
- [ ] Cached diagnostics persist across editor restarts
- [ ] AndroidSidecar doesn't pollute ProjectSidecar

### Full Feature

- [ ] Draft mode shows likely errors while typing
- [ ] Dependency index tracks what symbols exist
- [ ] Removing a class warns "this will break X files"
- [ ] Adding a missing class suggests "this may fix error in Y"
- [ ] Provenance hint shows "gradle" vs "draft" vs "cached"

### Stretch

- [ ] Incremental source scanning
- [ ] Cross-module dependency tracking
- [ ] Integration with Play Button for build+install
