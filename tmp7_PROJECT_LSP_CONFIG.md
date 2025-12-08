# Per-Project LSP Configuration

**Created:** 2025-12-07  
**Status:** Not Started (Future Phase)  
**Depends On:** Full LSP pipeline working (tmp2-6)  
**Blocks:** Nothing

---

## Purpose

Allow users to enable/disable language servers on a per-project basis.

---

## Scope

- Add `languageServers` to ProjectSidecar schema
- Settings modal for toggling servers
- Backend logic to respect configuration
- Default: Python enabled, others disabled

---

## ProjectSidecar Schema Extension

```jsonc
// ~/.cache/cm6_editor/projects/<sha1>.json
{
  "recent_files": [...],
  "last_file": "...",
  "diff_base": "HEAD",
  "session_cache": {...},
  
  // NEW
  "languageServers": {
    "python": true,
    "typescript": false,
    "javascript": false,
    "go": false,
    "rust": false
  }
}
```

---

## Backend API

```python
# GET /editor/lsp/config
def get_lsp_config():
    sidecar = get_current_project_sidecar()
    return {"languageServers": sidecar.get("languageServers", DEFAULT_LS)}

# POST /editor/lsp/config
def set_lsp_config(data: dict):
    sidecar = get_current_project_sidecar()
    sidecar["languageServers"] = data.get("languageServers", {})
    save_sidecar(sidecar)
    return {"ok": True}
```

---

## Query Function

```python
def should_use_lsp(project_root: Path, language_id: str) -> bool:
    """Check if LSP is enabled for this project/language."""
    sidecar = get_project_sidecar(project_root)
    ls_config = sidecar.get("languageServers", DEFAULT_LS)
    return ls_config.get(language_id, False)

DEFAULT_LS = {
    "python": True,  # Enabled by default
    "typescript": False,
    "javascript": False,
    "go": False,
    "rust": False,
}
```

---

## UI Modal

Add to Editor menu:
- "Language Servers..." → Opens modal

Modal contents:
- List of available language servers
- Toggle switch for each
- Save/Cancel buttons
- Note: "Requires language server binary installed"

---

## Files to Create/Modify

- **MODIFY:** `app/apps/file_editor_cm6/history_store.py` (or sidecar module)
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (endpoints)
- **MODIFY:** `app/apps/file_editor_cm6/main.js` (modal UI)
- **MODIFY:** `app/apps/file_editor_cm6/template.html` (modal HTML)

---

## Notes

- This is Phase 3 - only implement after basic LSP working
- Start with defaults enabled, let users disable
- Consider auto-detecting available servers on system

---

## References

- **State Management (ProjectSidecar):** `docs/apps/code_cm6/TECHNICAL.md` (See State Management section)
- **Preference Store:** `app/apps/file_editor_cm6/preferences_store.py` (Reference implementation for stores)

---

*Last Updated: 2025-12-07*