**OBSOLETE PLEASE DISREGARD.**

# Step 5 — Shell Groups, Roles & Breadcrumbs

**New file:** `app/utils/shell_groups.py`

```python
from __future__ import annotations
from typing import Dict, Optional, Any, List

def _merge_env(base: Optional[Dict[str, str]], extra: Optional[Dict[str, str]]) -> Dict[str, str]:
    out = dict(base or {})
    out.update(extra or {})
    return out

def spawn_scoped_shell(manager, *, command: List[str], label: str,
                       role: str, group: str, parent: Optional[str] = None,
                       cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None,
                       autostart: bool = True, **kwargs: Any):
    env_markers = { "TE_ROLE": role, "TE_GROUP": group }
    if parent: env_markers["TE_PARENT"] = parent
    env_final = _merge_env(env, env_markers)
    return manager.spawn_shell(command, cwd=cwd, label=label, env=env_final, autostart=autostart, **kwargs)

def terminate_group(manager, group: str, *, force: bool = True) -> int:
    count = 0
    for record in manager.list_shells():
        desc = manager.describe(record) or {}
        env = desc.get("env") or {}
        if env.get("TE_GROUP") == group:
            try:
                manager.terminate_shell(desc.get("id"), force=force)
                count += 1
            except Exception:
                pass
    return count
```

**Optional admin route** — expose POST `/api/framework_shells/terminate_group` that calls `terminate_group()`.

Next → `STEP06_GENERIC_APPS_EXTENSION.md`