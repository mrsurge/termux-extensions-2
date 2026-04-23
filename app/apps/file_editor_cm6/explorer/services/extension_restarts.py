# pyright: strict
from __future__ import annotations

from ..context import EmitPersonal


async def restart_adapter_only(emit_personal: EmitPersonal, reason: str) -> None:
    try:
        from ...workbench_adapter_shell_manager import terminate_adapter_shell

        killed = await terminate_adapter_shell()
        print(
            f"[ext_restart] adapter terminated (reason={reason}, was_running={killed})",
            flush=True,
        )
    except Exception as exc:
        print(f"[ext_restart] adapter terminate error: {exc}", flush=True)

    try:
        from ...diagnostics_bridge import stop_bridge

        stop_bridge()
    except Exception:
        pass

    await emit_personal("ext:adapter_restarting", {"reason": reason})


async def restart_code_server_and_adapter(
    emit_personal: EmitPersonal,
    reason: str,
) -> None:
    try:
        from ...workbench_adapter_shell_manager import terminate_adapter_shell

        await terminate_adapter_shell()
    except Exception as exc:
        print(f"[ext_restart] adapter terminate error: {exc}", flush=True)

    try:
        from ...diagnostics_bridge import stop_bridge

        stop_bridge()
    except Exception:
        pass

    try:
        from ...code_server_shell_manager import terminate_code_server_shell

        killed = await terminate_code_server_shell()
        print(
            f"[ext_restart] code-server terminated (reason={reason}, was_running={killed})",
            flush=True,
        )
    except Exception as exc:
        print(f"[ext_restart] code-server terminate error: {exc}", flush=True)

    await emit_personal(
        "ext:adapter_restarting",
        {"reason": reason, "full_restart": True},
    )
