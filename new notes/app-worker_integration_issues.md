# Framework Shells Fork — App Worker Integration Plan

**Date:** December 14, 2025  
**Companion to:** framework_shells_execution_plan.md (main execution plan)  
**Focus:** How apps and their manifests fit into the shellspec ecosystem

---

## The Gap in framework_shells_execution_plan.md

The main plan covers:
- Secret plumbing & runtime isolation
- Event bus
- Shellspec + CLI
- Diagnostics
- Package extraction

**Missing:** How do TE2's **app workers** (which are themselves framework shells) and their **child shells** (terminals, LSP servers, agents) integrate with the new architecture?

---

## Current App Architecture Summary

### App Manifest Schema (Current)

```
app/apps/<app_id>/manifest.json
```

```json
{
  "id": "file_editor_cm6",
  "name": "Code Editor",
  "icon_emoji": "📝",
  "version": "1.0.0",
  "description": "CodeMirror 6 editor with LSP support",
  "fullscreen": true,
  
  "entrypoints": {
    "backend_blueprint": "main.py",
    "frontend_template": "template.html",
    "frontend_script": "main.js"
  },
  
  "framework_shell_ui": {
    "subgroup_styles": {
      "lsp": { "bg": "#1a1a2e", "border": "#6366f1" },
      "project:*": { "bg": "#1e293b", "border": "#22d3ee" }
    }
  }
}
```

### Process Hierarchy (Current)

```
Main Framework (app.main)
  └── App Worker: file_editor_cm6 (label="app-worker:file_editor_cm6")
      ├── LSP Server (label="lsp-pyright-<hash>", subgroups=["file_editor_cm6", "lsp"])
      ├── Terminal (label="editor-terminal-<n>", subgroups=["file_editor_cm6", "project:myapp:abc"])
      └── Agent (label="agent-codex-<session>", subgroups=["file_editor_cm6"])
```

### Key Relationships

| Entity | Spawned By | Tracked Via |
|--------|------------|-------------|
| App Worker | `app_manager.ensure_app_running()` | `label="app-worker:{app_id}"` |
| Child Shell | App's backend code | `subgroups[0]={app_id}`, `parent_pid` in IPC |
| Shell UI Hints | `manifest.json → framework_shell_ui` | Loaded live by Sessions & Shortcuts |

---

## Integration Requirements

### R1: App Manifests Must Coexist with Shellspec

Apps define their own process needs (entrypoints, child shells). These should NOT require migrating to shellspec YAML. Instead:

- **App manifests** = app-specific process definitions (entrypoints, UI hints)
- **Shellspec** = standalone service orchestration (aria2, MCP servers, etc.)

Both are "manifest-driven" but serve different purposes.

### R2: App Workers Are First-Class Framework Shells

App workers are spawned by `app_manager.py`, but they ARE framework shells. They should:
- Get runtime_id + signature (Phase 2)
- Emit lifecycle events (Phase 3)
- Be queryable via CLI (`fs ps` should show them)

### R3: Child Shells Inherit App Context

When an app spawns a child shell, it should:
- Automatically inherit `subgroups[0]` = app_id
- Be associated with parent app worker in shell trees
- Be terminable via group operations (`fs down --group file_editor_cm6`)

### R4: UI Hints Flow to Sessions & Shortcuts

`framework_shell_ui` from app manifests should continue to work:
- Live reload from disk (current behavior)
- Applied to shells via subgroup matching
- Compatible with event-driven UI updates

### R5: Shutdown Ordering Preserved

Current IPC registry handles: children terminate before parents. New architecture must preserve this via:
- Event bus propagation order
- `parent_pid` tracking in records

---

## Proposed Integration

### Part 1: Extend ShellRecord with App Context

```python
# framework_shells/record.py

@dataclass
class ShellRecord:
    # ... existing fields ...
    
    # NEW: App context fields
    app_id: Optional[str] = None           # Owning app (from subgroups[0] or label)
    parent_shell_id: Optional[str] = None  # Parent framework shell (if child)
    is_app_worker: bool = False            # True if label starts with "app-worker:"
    
    def derive_app_id(self) -> Optional[str]:
        """Extract app_id from label or subgroups."""
        if self.label and self.label.startswith("app-worker:"):
            return self.label.split(":", 1)[1]
        if self.subgroups:
            return self.subgroups[0]
        return None
```

### Part 2: Manager Tracks Parent-Child in Framework Shells

Currently, parent-child is only in IPC registry. Add to shell records:

```python
# framework_shells/manager.py

async def spawn_shell_pty(
    self,
    command: Iterable[str],
    *,
    parent_shell_id: Optional[str] = None,  # NEW
    # ... existing params ...
) -> ShellRecord:
    record = self._create_record(...)
    record.parent_shell_id = parent_shell_id
    record.app_id = record.derive_app_id()
    record.is_app_worker = (record.label or "").startswith("app-worker:")
    ...
```

**Auto-detection of parent:**

```python
def _infer_parent_shell_id(self) -> Optional[str]:
    """Find parent app-worker shell by matching current PID to launcher_pid."""
    my_pid = os.getpid()
    for shell_id, state in self._pty.items():
        record = await self._load_record(shell_id)
        if record and record.pid == my_pid:
            return shell_id
    return None
```

### Part 3: Shell Trees in Event Bus

Extend events to include hierarchy:

```python
# framework_shells/events.py

@dataclass
class ShellEvent:
    type: EventType
    shell_id: str
    timestamp: float
    data: Dict[str, Any]
    
    # NEW: Hierarchy context
    app_id: Optional[str] = None
    parent_shell_id: Optional[str] = None
    is_app_worker: bool = False
```

Sessions & Shortcuts can then build trees from events without polling.

### Part 4: App Manifest → Framework Shell UI Registry

Create a registry that loads UI hints from app manifests:

```python
# framework_shells/ui_hints.py (new file)

from pathlib import Path
from typing import Dict, Any
import json

class UIHintRegistry:
    """Loads and merges framework_shell_ui from app manifests."""
    
    def __init__(self, apps_dir: Path):
        self.apps_dir = apps_dir
        self._cache: Dict[str, Dict[str, Any]] = {}
    
    def load_all(self) -> Dict[str, Dict[str, Any]]:
        """Load framework_shell_ui from all app manifests."""
        hints = {}
        for manifest_path in self.apps_dir.glob("*/manifest.json"):
            try:
                with open(manifest_path) as f:
                    manifest = json.load(f)
                app_id = manifest.get("id") or manifest_path.parent.name
                ui = manifest.get("framework_shell_ui", {})
                if ui:
                    hints[app_id] = ui
            except Exception:
                continue
        self._cache = hints
        return hints
    
    def get_subgroup_style(self, subgroups: list) -> Dict[str, Any]:
        """Find matching style for subgroups using longest-prefix match."""
        if not subgroups:
            return {}
        
        app_id = subgroups[0]
        app_hints = self._cache.get(app_id, {}).get("subgroup_styles", {})
        
        # Try exact match on each subgroup, then prefix match
        for sg in subgroups:
            if sg in app_hints:
                return app_hints[sg]
        
        # Prefix matching (e.g., "project:*" matches "project:myapp:abc")
        for sg in subgroups:
            for pattern, style in app_hints.items():
                if pattern.endswith("*") and sg.startswith(pattern[:-1]):
                    return style
                if pattern.endswith(":") and sg.startswith(pattern):
                    return style
        
        return {}
```

### Part 5: Group Operations in Manager & CLI

```python
# framework_shells/manager.py

async def list_shells_by_app(self, app_id: str) -> List[ShellRecord]:
    """List all shells belonging to an app (app worker + children)."""
    shells = []
    async for record in self._aiter_records():
        if record.app_id == app_id:
            shells.append(record)
    return shells

async def terminate_app_shells(self, app_id: str, *, force: bool = False) -> int:
    """Terminate all shells belonging to an app (children first, then worker)."""
    shells = await self.list_shells_by_app(app_id)
    
    # Sort: non-workers first, then app-worker last
    shells.sort(key=lambda s: (s.is_app_worker, s.created_at))
    
    count = 0
    for shell in shells:
        try:
            await self.terminate_shell(shell.id, force=force)
            count += 1
        except Exception:
            continue
    return count
```

```bash
# CLI usage
fs ps --app file_editor_cm6        # List shells for app
fs down --app file_editor_cm6      # Terminate app + children
fs down --group lsp                # Terminate by subgroup
```

### Part 6: TE2 Adapter for App Manager

The app_manager.py stays in TE2 but uses the new framework_shells package:

```python
# app/libs/app_manager.py (updated)

from framework_shells import FrameworkShellManager, get_event_bus

async def ensure_app_running(app_id: str) -> dict:
    manager = await get_te2_manager()
    
    # Check if already running
    shells = await manager.list_shells_by_app(app_id)
    worker = next((s for s in shells if s.is_app_worker and s.status == "running"), None)
    if worker:
        return _running_app_info(worker)
    
    # Spawn app worker (as before, but now with app context)
    record = await manager.spawn_shell(
        command=[...],
        label=f"app-worker:{app_id}",
        subgroups=[app_id, "worker"],
        # app_id and is_app_worker auto-derived from label
    )
    
    # Event is automatically emitted
    return _running_app_info(record)
```

### Part 7: Sessions & Shortcuts Event-Driven Update

```python
# app/extensions/sessions_and_shortcuts/main.py (updated)

from framework_shells.events import get_event_bus, EventType
from framework_shells.ui_hints import UIHintRegistry

@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    await websocket.accept()
    bus = get_event_bus()
    q = bus.subscribe()
    
    # Load UI hints
    ui_registry = UIHintRegistry(Path(_app_root_path) / "apps")
    ui_hints = ui_registry.load_all()
    
    # Initial snapshot
    shells = await _list_framework_shells()
    trees = _build_shell_trees_from_records(shells)
    await websocket.send_json({
        "type": "snapshot",
        "shell_trees": trees,
        "framework_ui": ui_hints,
    })
    
    # Stream events
    try:
        while True:
            event = await q.get()
            
            # Enrich with UI hints
            if event.data.get("subgroups"):
                style = ui_registry.get_subgroup_style(event.data["subgroups"])
                event.data["ui_style"] = style
            
            await websocket.send_json({
                "type": "event",
                "event": event.to_dict(),
            })
    finally:
        bus.unsubscribe(q)

def _build_shell_trees_from_records(shells: List[dict]) -> List[dict]:
    """Build hierarchical trees with app_id and parent_shell_id."""
    # Group by app_id
    by_app = {}
    standalone = []
    
    for shell in shells:
        app_id = shell.get("app_id")
        if app_id and shell.get("is_app_worker"):
            by_app.setdefault(app_id, {"worker": None, "children": []})
            by_app[app_id]["worker"] = shell
        elif app_id:
            by_app.setdefault(app_id, {"worker": None, "children": []})
            by_app[app_id]["children"].append(shell)
        else:
            standalone.append(shell)
    
    trees = []
    for app_id, group in by_app.items():
        trees.append({
            "app_id": app_id,
            "shell": group["worker"],
            "children": group["children"],
            "is_app_worker": True,
        })
    
    for shell in standalone:
        trees.append({
            "shell": shell,
            "children": [],
            "is_app_worker": False,
        })
    
    return trees
```

---

## Implementation Steps

### Phase 2A: Add App Context to ShellRecord (with Phase 2)

| Change | File | Notes |
|--------|------|-------|
| Add `app_id`, `parent_shell_id`, `is_app_worker` | `record.py` | Additive fields; missing values default/derive on load |
| Add `derive_app_id()` | `record.py` | Auto-populate on load |
| Update `_create_record()` | `manager.py` | Set app context |

### Phase 3A: App Context in Events (with Phase 3)

| Change | File | Notes |
|--------|------|-------|
| Add app context fields to `ShellEvent` | `events.py` | Enriches events |
| Manager emits with app context | `manager.py` | Automatic from record |

### Phase 4A: App-Aware CLI (with Phase 4)

| Change | File | Notes |
|--------|------|-------|
| Add `--app` filter to `fs ps` | `cli/main.py` | `fs ps --app file_editor_cm6` |
| Add `--app` to `fs down` | `cli/main.py` | Terminate app + children |
| Add `list_shells_by_app()` | `manager.py` | Query helper |
| Add `terminate_app_shells()` | `manager.py` | Ordered termination |

### Phase 5A: UI Hints Registry (with Phase 5)

| Change | File | Notes |
|--------|------|-------|
| Create `ui_hints.py` | `framework_shells/` | Loads from app manifests |
| Sessions & Shortcuts uses registry | `sessions_and_shortcuts/main.py` | TE2 glue |

---

## Schema Comparison

### App Manifest (TE2-specific, stays in TE2)

```json
{
  "id": "file_editor_cm6",
  "name": "Code Editor",
  "entrypoints": { ... },
  "framework_shell_ui": { ... }
}
```

### Shellspec (New, standalone)

```yaml
version: "1"
shells:
  aria2:
    command: ["aria2c", "--enable-rpc"]
    subgroups: [download, service]
    readiness:
      type: tcp_port
      port: 6800
```

### ShellRecord (Unified, in framework_shells package)

```python
@dataclass
class ShellRecord:
    id: str
    command: List[str]
    label: Optional[str]
    subgroups: List[str]
    ui: Dict[str, Any]           # From manifest's framework_shell_ui
    
    # App context (auto-derived)
    app_id: Optional[str]
    parent_shell_id: Optional[str]
    is_app_worker: bool
    
    # Runtime isolation (Phase 2)
    runtime_id: Optional[str]
    signature: Optional[str]
```

---

## Interaction Matrix

| Component | Knows About Apps? | Uses Events? | Uses Shellspec? |
|-----------|-------------------|--------------|-----------------|
| `framework_shells` core | Yes (via `app_id` field) | Yes (emits) | Yes (orchestrator) |
| `app_manager.py` (TE2) | Yes (spawns workers) | Yes (subscribes) | No |
| `sessions_and_shortcuts` (TE2) | Yes (UI hints) | Yes (subscribes) | No |
| `fs` CLI | Yes (`--app` flag) | No | Yes |
| Shellspec YAML | No | No | Yes |

---

## Example Flows

### Flow 1: User Opens file_editor_cm6

1. User clicks app in launcher
2. `app_manager.ensure_app_running("file_editor_cm6")`
3. Manager spawns shell with `label="app-worker:file_editor_cm6"`
4. Record auto-derives: `app_id="file_editor_cm6"`, `is_app_worker=True`
5. Event emitted: `SHELL_SPAWNED` with `app_id`, `is_app_worker=True`
6. Sessions & Shortcuts receives event, updates tree

### Flow 2: Editor Spawns LSP Server

1. User opens Python file
2. Editor backend calls `spawn_shell_pipe(["pyright"], subgroups=["file_editor_cm6", "lsp"])`
3. Record auto-derives: `app_id="file_editor_cm6"`, `is_app_worker=False`
4. `parent_shell_id` set to app worker's shell_id
5. Event emitted: `SHELL_SPAWNED` with `app_id`, `parent_shell_id`
6. Sessions & Shortcuts adds to tree under app worker

### Flow 3: User Quits App

1. User clicks Quit in app toolbar
2. `app_manager.quit_app("file_editor_cm6")`
3. Calls `manager.terminate_app_shells("file_editor_cm6")`
4. Manager terminates children first (LSP, terminals), then app worker
5. Events emitted for each: `SHELL_EXITED`
6. Sessions & Shortcuts removes from tree

### Flow 4: CLI Lists App Shells

```bash
$ fs ps --app file_editor_cm6

● fs_1734185000_abc12345  app-worker:file_editor_cm6  pid=12345  running
  ├─ fs_1734185010_def678  lsp-pyright-abc  pid=12346  running
  └─ fs_1734185020_ghi901  editor-terminal-1  pid=12347  running
```

---

## Files Changed Summary

### New Files (in framework_shells package)

| File | Purpose |
|------|---------|
| `framework_shells/ui_hints.py` | Load `framework_shell_ui` from app manifests |

### Modified Files (in framework_shells package)

| File | Change |
|------|--------|
| `framework_shells/record.py` | Add `app_id`, `parent_shell_id`, `is_app_worker`, `derive_app_id()` |
| `framework_shells/manager.py` | Add `list_shells_by_app()`, `terminate_app_shells()`, auto-derive app context |
| `framework_shells/events.py` | Add app context to `ShellEvent` |
| `framework_shells/cli/main.py` | Add `--app` and `--group` filters |

### Modified Files (in TE2, stays in TE2)

| File | Change |
|------|--------|
| `app/libs/app_manager.py` | Use new manager methods, subscribe to events |
| `app/extensions/sessions_and_shortcuts/main.py` | Event-driven updates, use `UIHintRegistry` |

---

## Open Questions

1. **Should apps define child shell specs in manifest?**
   - Currently apps spawn shells imperatively in code
   - Could add `manifest.json → shells: [...]` for declarative child shells
   - If we do it, do it as a hard migration (no parallel systems)

2. **UI hints in standalone mode?**
   - When running without TE2, no app manifests exist
   - Should shellspec support `ui:` section?
   - Or just skip styling in standalone mode?

3. **Cross-app shell visibility?**
   - Can app A see app B's shells via `fs ps`?
   - Probably yes (same runtime_id), but should UI filter by app?
