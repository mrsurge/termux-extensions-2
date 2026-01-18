# Patch Proposal — Sprint E (Live Dependency Resolution Diagnostics)

**Date:** 2025-12-26T04:44Z (revised)

## Goal
Deliver live "will it build" diagnostics while typing — without waiting for save/Gradle compile — by maintaining a **Compiled Tree** (SSOT) and a **Shadow Tree** (draft overlay) that reflects both source drafts and Gradle file drafts.

---

## Architecture

### Layer A: Compiled Tree (SSOT)
- **Built on:** LSP start + after any save that changes `repoFingerprint`
- **Process:** Gradle compiles → scan all JARs (android.jar + resolved deps + R.jar + generated) → build complete `dependencyIndex`
- **Contents:** Set of all known classes/packages from the compiled project
- **Persistence:** Stored in `te2_android_sidecar.json` as `dependencyIndex`; persists until next successful compile replaces it

### Layer B: Shadow Tree (Draft Overlay)
- **Purpose:** Reflect what the project *would* look like if all current drafts were saved and compiled
- **Two inputs:**
  1. **Source file drafts** → regex/tokenize imports + class references → check against index
  2. **Gradle file drafts** → trigger shadow Gradle resolution → rebuild shadow index
- **Diagnostics:** Generated against shadow tree state (debounced on keystroke)
- **Lifecycle:**
  - Drafts discarded → shadow tree = compiled tree (clean)
  - Drafts saved → triggers recompile → new compiled tree → new shadow tree

### Layer C: Diagnostics Pipeline (Thin Passthrough)
- Renders errors from shadow tree into Issues/squiggles via existing `publishDiagnostics`
- User already sees draft indicators (yellow bars) on changed lines — no additional markup needed
- Existing inline diff decorations show what's changed

---

## What Already Exists
- Draft system (write buffer capturing all user input at all times)
- Discard all drafts / Save all drafts / Review drafts UI
- Inline diff decorations showing changed lines
- `te2_android_sidecar.json` with minimal dependency model
- `publish_draft_diagnostics_to_client()` infrastructure

---

## Proposed Patches (Sprint E)

### E1) Compiled Tree: Dependency Index Builder

**File:** `app/apps/file_editor_cm6/android_lang/dependency_index.py` (new)

Build `dependencyIndex` by scanning JARs using Python stdlib `zipfile`:

```python
import zipfile
from pathlib import Path

def scan_jar_classes(jar_path: Path, max_classes: int = 50000) -> set[str]:
    """Extract class names from JAR without loading bytecode."""
    classes = set()
    try:
        with zipfile.ZipFile(jar_path, 'r') as jar:
            for entry in jar.namelist():
                if entry.endswith('.class') and not entry.startswith('META-INF/'):
                    # com/example/Foo.class → com.example.Foo
                    cls = entry[:-6].replace('/', '.')
                    classes.add(cls)
                    if len(classes) >= max_classes:
                        break
    except Exception:
        pass
    return classes

def build_dependency_index(
    *,
    android_jar: Path | None,
    resolved_jars: list[Path],
    r_jar: Path | None,
    max_jars: int = 15,
    max_total_classes: int = 150000,
) -> dict:
    """Build dependency index from JARs (bounded for on-device safety)."""
    all_classes: set[str] = set()
    scanned_jars: list[str] = []
    
    # Priority order: android.jar first, then R.jar, then resolved deps
    jars_to_scan = []
    if android_jar and android_jar.exists():
        jars_to_scan.append(android_jar)
    if r_jar and r_jar.exists():
        jars_to_scan.append(r_jar)
    jars_to_scan.extend([j for j in resolved_jars if j.exists()][:max_jars])
    
    for jar in jars_to_scan:
        if len(all_classes) >= max_total_classes:
            break
        remaining = max_total_classes - len(all_classes)
        classes = scan_jar_classes(jar, max_classes=remaining)
        all_classes.update(classes)
        scanned_jars.append(str(jar))
    
    return {
        "version": 1,
        "builtAtMs": int(time.time() * 1000),
        "scannedJars": scanned_jars,
        "classes": sorted(all_classes),  # sorted for stable JSON
    }
```

**Trigger:** After successful Gradle compile (detected via `publishDiagnostics` or explicit sync).

### E2) Gradle Artifact Resolution Task

**File:** Create a minimal Gradle task that prints resolved artifact paths without compiling.

Add to project or inject dynamically:

```groovy
// te2_resolve_classpath.gradle (injected or init script)
task te2ResolveClasspath {
    doLast {
        def config = configurations.findByName('debugCompileClasspath')
            ?: configurations.findByName('releaseCompileClasspath')
        if (config) {
            config.resolvedConfiguration.resolvedArtifacts.each {
                println "TE2_JAR:${it.file.absolutePath}"
            }
        }
    }
}
```

Run: `./gradlew te2ResolveClasspath` — resolves/downloads deps, does NOT compile.

Parse output for lines starting with `TE2_JAR:` to get jar paths.

### E3) Shadow Gradle Resolution (for Gradle file drafts)

**File:** `app/apps/file_editor_cm6/android_lang/shadow_gradle.py` (new)

When Gradle files have drafts, run shadow resolution:

```python
GRADLE_DRAFT_FILES = {
    'build.gradle', 'build.gradle.kts',
    'settings.gradle', 'settings.gradle.kts',
    'gradle.properties',
    'gradle/libs.versions.toml',
    'app/build.gradle', 'app/build.gradle.kts',
}

def has_gradle_drafts(drafts: list[dict], project_root: Path) -> bool:
    """Check if any drafts are Gradle configuration files."""
    for draft in drafts:
        rel = get_rel_path(draft.get('file_path'), project_root)
        if rel in GRADLE_DRAFT_FILES:
            return True
    return False

async def build_shadow_gradle_index(
    *,
    project_root: Path,
    effective_root: Path,
    drafts: list[dict],
    cache_dir: Path,
) -> dict | None:
    """Build dependency index from shadow Gradle resolution.
    
    1. Copy project skeleton to cache_dir/shadow_gradle/
    2. Write drafted Gradle files into shadow dir
    3. Run te2ResolveClasspath in shadow dir
    4. Scan resolved JARs → return index
    """
    shadow_dir = cache_dir / "shadow_gradle"
    # ... implementation: copy skeleton, apply drafts, run gradle, parse output, scan jars
    pass
```

**Trigger:** Only when `gradleDraftFingerprint` changes (Gradle file drafts modified).

### E4) Shadow Tree: Draft Import Checker

**File:** `app/apps/file_editor_cm6/android_lang/draft_diagnostics.py` (extend)

Add import/class extraction and checking:

```python
import re

IMPORT_PATTERN = re.compile(r'^import\s+([\w.]+(?:\.\*)?)\s*;?\s*$', re.MULTILINE)

def extract_imports(content: str) -> list[tuple[str, int]]:
    """Extract import statements with line numbers."""
    imports = []
    for i, line in enumerate(content.splitlines()):
        m = IMPORT_PATTERN.match(line.strip())
        if m:
            imports.append((m.group(1), i))
    return imports

def check_imports_against_index(
    imports: list[tuple[str, int]],
    class_index: set[str],
) -> list[dict]:
    """Check imports against dependency index, return diagnostics for unresolved."""
    diagnostics = []
    for import_str, line_no in imports:
        if import_str.endswith('.*'):
            # Package wildcard: check if any class starts with this package
            pkg = import_str[:-2]
            if not any(c.startswith(pkg + '.') for c in class_index):
                diagnostics.append(_make_unresolved_import_diag(import_str, line_no))
        else:
            # Specific class import
            if import_str not in class_index:
                diagnostics.append(_make_unresolved_import_diag(import_str, line_no))
    return diagnostics

def _make_unresolved_import_diag(import_str: str, line: int) -> dict:
    return {
        "range": {"start": {"line": line, "character": 0}, "end": {"line": line, "character": 999}},
        "severity": 1,  # Error
        "source": "te2-android:draft",
        "code": "DRAFT_UNRESOLVED_IMPORT",
        "message": f"Unresolved import: {import_str}",
    }
```

### E5) Integration: Hook into Draft SSOT Update Loop

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

In `_persist_to_cache_debounced()` (the existing draft update loop):

```python
# After updating session cache entry, for .kt/.kts files:
if is_kotlin_file(current_file):
    # 1. Load current dependency index from sidecar
    index = load_dependency_index(project_root)
    
    # 2. Check if Gradle drafts exist → use shadow index if needed
    drafts = sidecar.list_project_drafts()
    if has_gradle_drafts(drafts, project_root):
        shadow_index = get_or_build_shadow_index(...)
        if shadow_index:
            index = shadow_index
    
    # 3. Extract imports from current buffer content
    imports = extract_imports(content)
    
    # 4. Check against index
    diagnostics = check_imports_against_index(imports, index['classes'])
    
    # 5. Publish draft diagnostics
    await publish_draft_diagnostics_to_client(
        language_id='kotlin-android',
        project_root=effective_project_root,
        uri=uri,
        draft_diagnostics=diagnostics,
        has_drafts=True,
    )
```

### E6) Update Arbitration: Never Go Blind

**File:** `app/apps/file_editor_cm6/android_lang/diagnostic_arbitration.py`

Update suppression rule:
- Only suppress backend "Unresolved" diagnostics when `has_drafts=True` **AND** we have replacement draft diagnostics (any `code` starting with `DRAFT_UNRESOLVED_`)
- This prevents: drafts exist + suppression on + no replacement → no squiggles

---

## Sidecar Schema Update

Add to `te2_android_sidecar.json`:

```json
{
  "dependencyIndex": {
    "version": 1,
    "builtAtMs": 1703567890000,
    "scannedJars": ["/path/to/android.jar", "/path/to/R.jar", "..."],
    "classes": ["android.app.Activity", "android.webkit.WebView", "..."]
  },
  "gradleDraftFingerprint": "<20-hex or empty>",
  "shadowIndex": { ... }  // optional, only when Gradle drafts exist
}
```

---

## Acceptance Criteria

1. Open a Kotlin file with kotlin-android LSP running
2. Type a bogus import → squiggle + Issues entry appears within debounce window (no save required)
3. Type a valid import from android.jar or resolved deps → no error
4. Edit `build.gradle` draft to add a new dependency → shadow resolution runs → new dep's classes become valid
5. Save files → triggers Gradle compile → compiled tree rebuilds → shadow tree updates
6. Discard all drafts → shadow tree = compiled tree (clean state)

---

## Performance Caps (On-Device Safety)

- Max 15 JARs scanned per index build
- Max 150k class entries total
- android.jar + R.jar prioritized (most useful)
- Shadow Gradle resolution only on Gradle draft fingerprint change (not every keystroke)
- Class index stored as sorted array for stable JSON / fast lookup

---

## Out of Scope (Sprint E)

- Cross-file draft linking (diagnostics from other source files' drafts)
- Full semantic Kotlin resolution (overloads, generics, etc.)
- Bytecode parsing (we only read zip entry names)
- Full dependency graph UI
