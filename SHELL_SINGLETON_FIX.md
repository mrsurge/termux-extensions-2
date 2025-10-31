# Shell Singleton Enforcement - Implementation Summary

**Date:** 2025-10-31  
**Issue:** Multiple framework shell instances running for same app/agent

## Problem Statement

The framework was spawning multiple instances of:
1. Code CM6 app workers (`app-worker:file_editor_cm6`)
2. Codex agent shells (`codex mcp-server`)

### Root Causes

1. **App Worker Duplication** - `app_manager.py` didn't check for existing shells by label before spawning
2. **Agent Shell Duplication** - `agent_ws.py` used in-memory `_shared_shells` dict that was isolated per worker instance
3. **Race Conditions** - Users could click app icons multiple times during launch lag
4. **Cross-Tab Issues** - Multiple browser tabs/PWAs could launch same app simultaneously

## Implementation

### Phase 1: Framework Shell Singleton Enforcement

**File:** `app/libs/framework_shells.py`

Added `find_shell_by_label()` method:
```python
def find_shell_by_label(self, label: str, status: Optional[str] = 'running') -> Optional[ShellRecord]:
    """Find a shell by its label with optional status filter."""
```

Modified `spawn_shell()` and `spawn_shell_pty()`:
- Check for existing shell with matching label before spawning
- Return existing shell if alive
- Only spawn new if no match found

### Phase 2: App Worker Singleton

**File:** `app/libs/app_manager.py`

Enhanced `ensure_app_running()`:
- Added `LAUNCHING_APPS` set to track in-progress launches
- Check `find_shell_by_label()` before spawning
- Extract port from existing shell command args if found
- Use try/finally to ensure launching state is cleared

### Phase 3: App Launch UI Protection

**File:** `app/extensions/apps/main.js`

Added launch state tracking:
- Local `launchingApps` Set for current tab
- Cross-tab coordination via `localStorage` with `te_launching_apps` key
- Storage event listener for cross-tab sync
- Visual feedback: spinner icon + disabled state

**File:** `app/extensions/apps/template.html`

Added CSS:
- `.app-card-launching` - dim and disable card
- `.app-spinner` - rotating border animation
- Smooth transitions

### Phase 4: Agent Shell Persistence

**File:** `app/apps/file_editor_cm6/agent_ws.py`

Removed in-memory `_shared_shells` registry:
- Now uses `bridge.find_or_spawn_agent()` method
- Label-based lookup works across all app worker instances

**File:** `app/apps/file_editor_cm6/agent_bridge.py`

Added singleton enforcement:
- `_get_agent_label()` - consistent label: `agent-{type}-shared`
- `find_or_spawn_agent()` - finds existing or spawns new
- Updated `spawn_agent()` to use consistent label pattern

## Label Conventions

| Component | Label Pattern | Example |
|-----------|---------------|---------|
| App Worker | `app-worker:{app_id}` | `app-worker:file_editor_cm6` |
| Codex Agent | `agent-codex-shared` | `agent-codex-shared` |
| Gemini Agent | `agent-gemini-shared` | `agent-gemini-shared` |

## Benefits

1. **Resource Efficiency** - Only one instance per app/agent
2. **Consistent State** - All tabs/workers connect to same shell
3. **Session Persistence** - Agent conversations survive across reconnections
4. **Better UX** - Visual feedback prevents accidental duplicate launches
5. **Cross-Tab Safety** - Multiple browsers/PWAs won't spawn duplicates

## Testing Checklist

- [ ] Launch Code CM6 app multiple times - verify only one worker spawned
- [ ] Rapid-click app icon - verify only one launch occurs
- [ ] Open app in multiple browser tabs - verify singleton behavior
- [ ] Connect to Codex agent from multiple sessions - verify shared shell
- [ ] Kill agent shell and reconnect - verify new shell spawned
- [ ] Check framework shells API - verify no duplicate labels

## Migration Notes

- Existing shells will be reused if labels match
- Old shells with non-standard labels will be orphaned (cleaned up on next framework restart)
- No data loss - all functionality preserved

## Future Enhancements

- Add shell health monitoring with automatic restart
- Implement shell usage metrics (connection count, last activity)
- Add admin UI to view/manage singleton shells
- Consider process pooling for faster app launches
