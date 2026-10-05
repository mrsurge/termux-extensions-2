# pyright: strict
from __future__ import annotations

import asyncio

from ..context import EmitPersonal
from .project_root_state import get_project_root
from ...code_server_runtime_hooks import prime_code_server_runtime
from ...intelligence_state import IntelligenceStateStore
from ...extension_contribution_events import publish_extension_contributions_changed
from ...worker_services.event_bus import current_project_generation

_restart_lock = asyncio.Lock()
_restart_tasks: set[asyncio.Task[None]] = set()


def schedule_code_server_and_adapter_restart(emit_personal: EmitPersonal, reason: str) -> None:
    """Retain recovery after the successful mutation reply; never replay it."""
    async def recover() -> None:
        try:
            await restart_code_server_and_adapter(emit_personal, reason)
        except Exception as exc:
            print(f"[ext_restart] recovery failed (reason={reason}): {exc}", flush=True)
            try:
                await emit_personal("explorer.error", {
                    "error": f"Extension change succeeded, but intelligence restart failed: {exc}",
                    "reason": reason,
                })
            except Exception as notify_exc:
                print(f"[ext_restart] failure notification error: {notify_exc}", flush=True)

    task = asyncio.create_task(recover(), name=f"extension_restart:{reason}")
    _restart_tasks.add(task)
    task.add_done_callback(_restart_tasks.discard)


async def restart_adapter_only(emit_personal: EmitPersonal, reason: str) -> None:
    async with _restart_lock:
        await _restart_runtime(emit_personal, reason, full_restart=False)


async def restart_code_server_and_adapter(
    emit_personal: EmitPersonal,
    reason: str,
) -> None:
    async with _restart_lock:
        await _restart_runtime(emit_personal, reason, full_restart=True)


async def _restart_runtime(
    emit_personal: EmitPersonal, reason: str, *, full_restart: bool,
) -> None:
    # Registry/settings mutation is already complete, including in web-worker
    # mode. Each client refreshes contributions over its own existing lane.
    await publish_extension_contributions_changed(reason)
    if IntelligenceStateStore().read().web_workers_enabled:
        return
    try:
        from ...workbench_adapter_shell_manager import terminate_adapter_shell

        killed = await terminate_adapter_shell()
        print(
            f"[ext_restart] adapter terminated (reason={reason}, was_running={killed})",
            flush=True,
        )
    except Exception as exc:
        print(f"[ext_restart] adapter terminate error: {exc}", flush=True)
        raise

    try:
        from ...wba_event_bridge import reset_wba_project_event_state

        reset_wba_project_event_state()
    except Exception as exc:
        print(f"[ext_restart] adapter state reset error: {exc}", flush=True)
        raise

    if full_restart:
        try:
            from ...code_server_shell_manager import terminate_code_server_shell

            killed = await terminate_code_server_shell()
            print(
                f"[ext_restart] code-server terminated (reason={reason}, was_running={killed})",
                flush=True,
            )
        except Exception as exc:
            print(f"[ext_restart] code-server terminate error: {exc}", flush=True)
            raise

    await emit_personal(
        "explorer.extensions.adapter.restarting",
        {"reason": reason, "full_restart": full_restart},
    )
    # Page boot is no longer responsible for bringing the stopped runtime back.
    # Mode/project may change while termination or notification is awaited.
    if IntelligenceStateStore().read().web_workers_enabled:
        return
    project_root = get_project_root()
    generation = current_project_generation(project_root)
    await prime_code_server_runtime(str(project_root))
    if (
        IntelligenceStateStore().read().web_workers_enabled
        or get_project_root() != project_root
        or current_project_generation(project_root) != generation
    ):
        raise RuntimeError("Intelligence mode or project changed during extension runtime restart")
