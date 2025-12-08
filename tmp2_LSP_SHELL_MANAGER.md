# LSP Shell Manager

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Framework Shells infrastructure (already exists)  
**Blocks:** WebSocket Bridge (tmp4)

---

## Purpose

Create a module to spawn and manage language server processes as framework shells.

---

## Scope

- Spawn `lsp-{language}` framework shells on demand
- Map `languageId` → language server command
- Track active LSP shells
- `didClose`/`didOpen` lifecycle on file switch
- Graceful shutdown integration

---

## Key Functions

```python
# app/apps/file_editor_cm6/lsp_shell_manager.py

LSP_COMMANDS = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    # Future: go, rust, etc.
}

def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> ShellRecord | None:
    """Get existing or spawn new LSP shell for language."""
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

---

## Testing

1. Manually spawn shell: `get_or_spawn_lsp_shell("python", Path("/project"))`
2. Verify shell appears in framework shell list
3. Switch languages, verify old shell handling
4. Kill shell, verify clean shutdown

---

## Notes

- Uses existing `get_framework_shell_manager()` from `app/libs/framework_shells.py`
- Shell label format: `lsp-python`, `lsp-typescript`, etc.
- Only one active LSP shell at a time (single document model)

---

*Last Updated: 2025-12-07*
