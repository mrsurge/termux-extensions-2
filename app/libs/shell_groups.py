from __future__ import annotations
from typing import Dict, Optional, Any, List

def _merge_env(base: Optional[Dict[str, str]], extra: Optional[Dict[str, str]]) -> Dict[str, str]:
    out = dict(base or {})
    out.update(extra or {})
    return out

async def spawn_scoped_shell(manager, *, command: List[str], label: str,
                             role: str, group: str, parent: Optional[str] = None,
                             cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None,
                             autostart: bool = True, **kwargs: Any):
    env_markers = { "TE_ROLE": role, "TE_GROUP": group }
    if parent: env_markers["TE_PARENT"] = parent
    env_final = _merge_env(env, env_markers)
    return await manager.spawn_shell(command, cwd=cwd, label=label, env=env_final, autostart=autostart, **kwargs)

async def terminate_group(manager, group: str, *, force: bool = True) -> int:
    count = 0
    shells = await manager.list_shells()
    for record in shells:
        desc = await manager.describe(record) or {}
        env = desc.get("env") or {}
        if env.get("TE_GROUP") == group:
            try:
                await manager.terminate_shell(desc.get("id"), force=force)
                count += 1
            except Exception:
                pass
    return count
