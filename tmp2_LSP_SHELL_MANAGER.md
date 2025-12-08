# LSP Shell Manager

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Framework Shells infrastructure (already exists)  
**Blocks:** WebSocket Bridge (tmp4)

---

## Purpose

Create a module to spawn and manage language server processes as framework shells.

---

## Dependencies

- **Python:** `pyright` (vendored via npm in `app/static/vendor/lsp_servers`)
- **JavaScript/TypeScript:** `typescript-language-server` + `typescript` (vendored in `app/static/vendor/lsp_servers`)
- **Other:** `gopls`, `rust-analyzer` (future expansion)

---

## Scope

- Spawn `lsp-{language}` framework shells on demand
- Map `languageId` → language server command (prefer vendored binaries under `app/static/vendor/lsp_servers/node_modules/.bin`)
- Track active LSP shells
- `didClose`/`didOpen` lifecycle on file switch
- Graceful shutdown integration
- **Verify:** Ensure `pyright` AND `typescript-language-server` binaries are available (vendored path first, PATH fallback)

---

## Key Functions

```python
# app/apps/file_editor_cm6/lsp_shell_manager.py

import shutil

LSP_COMMANDS = {
    # Ensure these binaries are in the system PATH
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"], # Uses the same server
    # Future: go, rust, etc.
}

def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> ShellRecord | None:
    """Get existing or spawn new LSP shell for language."""
    cmd = LSP_COMMANDS.get(language_id)
    if not cmd:
        return None
        
    # Check if binary exists
    if not shutil.which(cmd[0]):
        print(f"LSP binary {cmd[0]} not found")
        return None
        
    pass

def get_active_lsp_shell() -> ShellRecord | None:
    """Return currently active LSP shell (if any)."""
    pass

def switch_lsp_shell(new_language_id: str, project_root: Path) -> ShellRecord | None:
    """Switch from current to new language server."""
    pass

def shutdown_lsp_shell(language_id: str) -> None:
    """Gracefully terminate LSP shell."""
    pass
```

---

## Files to Create/Modify

- **NEW:** `app/apps/file_editor_cm6/lsp_shell_manager.py`
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (import, expose endpoints?)
- **MODIFY:** `requirements.txt` (add `pyright`)

---

## Testing

1. Manually spawn shell: `get_or_spawn_lsp_shell("python", Path("/project"))`
2. Verify shell appears in framework shell list
3. Switch languages, verify old shell handling
4. Kill shell, verify clean shutdown

---

## References

- **Framework Shells Architecture:** `docs/core/framework_shells.md`
- **Settings/Timeouts:** See `FrameworkShellManager` in `app/libs/framework_shells.py`

---

*Last Updated: 2025-12-08 (Dex)*
