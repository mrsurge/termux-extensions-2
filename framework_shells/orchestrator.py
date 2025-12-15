import asyncio
from typing import List, Dict, Set, Optional
from .spec import ShellSpec
from .manager import FrameworkShellManager
from .record import ShellRecord

class Orchestrator:
    def __init__(self, manager: FrameworkShellManager):
        self.manager = manager

    async def apply(self, specs: List[ShellSpec], prune: bool = False) -> None:
        """Reconcile specs with running state."""
        existing_records = await self.manager.list_shells()
        
        # Index existing by label. NOTE: We use label to store the spec name (stable ID).
        # existing_id is the random runtime ID.
        existing_by_name: Dict[str, ShellRecord] = {}
        for r in existing_records:
            if r.label: # We treat label as the spec name
                existing_by_name[r.label] = r
                
        spec_names = set()
        
        for spec in specs:
            spec_names.add(spec.name)
            record = existing_by_name.get(spec.name)
            
            if not record:
                # Create new
                await self._spawn_from_spec(spec)
            else:
                # Update? For now, we assume immutable shells unless config changes significantly?
                # If command differs, maybe restart?
                # For simplicity in V1, we leave running shells alone unless they are dead.
                # Check status
                if spec.autostart and (not record.pid or not await self.manager._is_pid_alive(record.pid)):
                     # Restart dead shell if policy allows
                     # But we can't "restart" a record easily, we usually spawn a new one.
                     # Prune old, spawn new.
                     await self.manager.terminate_shell(record.id)
                     await self._spawn_from_spec(spec)

        if prune:
            for name, r in existing_by_name.items():
                if name not in spec_names:
                    # Determine if this is a managed shell?
                    # We might assume any shell with a label matching a known pattern is managed.
                    # Or just prune everything that isn't in specs if prune=True.
                    await self.manager.terminate_shell(r.id)

    async def _spawn_from_spec(self, spec: ShellSpec) -> None:
        # Map backend to args
        use_pty = False
        use_dtach = False
        if spec.backend == "pty":
            use_pty = True
        elif spec.backend == "dtach":
            use_pty = True
            use_dtach = True
            
        # Spawn
        if use_dtach:
            await self.manager.spawn_shell_dtach(
                command=spec.command,
                cwd=spec.cwd,
                env=spec.env,
                label=spec.name,
                ui=spec.ui,
                autostart=spec.autostart
            )
        elif use_pty:
            await self.manager.spawn_shell_pty(
                command=spec.command,
                cwd=spec.cwd,
                env=spec.env,
                label=spec.name,
                ui=spec.ui,
                autostart=spec.autostart
            )
        else:
            await self.manager.spawn_shell(
                command=spec.command,
                cwd=spec.cwd,
                env=spec.env,
                label=spec.name,
                ui=spec.ui,
                autostart=spec.autostart
            )
