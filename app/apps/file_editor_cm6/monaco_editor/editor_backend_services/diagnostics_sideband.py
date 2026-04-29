# pyright: strict
from __future__ import annotations

from typing import Protocol, cast

_consumer_expected_path: str | None = None
_consumer_expected_request_id: str = ""
_consumer_ready: bool = False
_pending_entries: list[dict[str, object]] = []


class EditorDiagnosticsSocket(Protocol):
    async def emit(
        self,
        event_name: str,
        payload: dict[str, object],
        *,
        room: str,
        namespace: str,
    ) -> object: ...


def _payload_owner(payload: dict[str, object]) -> str:
    args = payload.get("args")
    if not isinstance(args, list) or not args:
        return "unknown"
    typed_args = cast(list[object], args)
    first = typed_args[0]
    return first if isinstance(first, str) and first else "unknown"


def _payload_pair_count(payload: dict[str, object]) -> int:
    args = payload.get("args")
    if not isinstance(args, list):
        return 0
    typed_args = cast(list[object], args)
    if len(typed_args) < 2:
        return 0
    pairs = typed_args[1]
    return len(cast(list[object], pairs)) if isinstance(pairs, list) else 0


def raw_diagnostics_sideband_payloads(event: dict[str, object]) -> list[dict[str, object]]:
    args = event.get("args")
    if not isinstance(args, list):
        return []
    typed_args = cast(list[object], args)
    if len(typed_args) < 2:
        return []
    # Preserve the raw VS Code/WBA DTO shape for the editor sideband.
    return [dict(event)]


async def emit_or_buffer_editor_diagnostics_sideband(
    sio: EditorDiagnosticsSocket,
    payload: dict[str, object],
) -> None:
    global _pending_entries

    owner = _payload_owner(payload)
    pair_count = _payload_pair_count(payload)
    if _consumer_ready:
        await sio.emit(
            "editor:diagnostics_sideband",
            payload,
            room="file_editor_cm6",
            namespace="/editor",
        )
        print(
            f"[diag_sideband] emit OK owner={owner} pairs={pair_count}",
            flush=True,
        )
        return

    _pending_entries.append(payload)
    print(
        f"[diag_sideband] buffered owner={owner} pairs={pair_count} buffered={len(_pending_entries)}",
        flush=True,
    )


def set_consumer_pending(abs_path: str, request_id: str = "") -> None:
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    _consumer_expected_path = abs_path or None
    _consumer_expected_request_id = str(request_id or "")
    _consumer_ready = False
    _pending_entries = []
    try:
        print(
            f"[diag_sideband] consumer_pending path={_consumer_expected_path or '?'} request_id={_consumer_expected_request_id or '-'}",
            flush=True,
        )
    except Exception:
        pass


async def set_consumer_ready(sio: EditorDiagnosticsSocket, abs_path: str, request_id: str = "") -> None:
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    _consumer_expected_path = abs_path or None
    _consumer_expected_request_id = str(request_id or "")
    _consumer_ready = True
    try:
        print(
            f"[diag_sideband] consumer_ready path={_consumer_expected_path or '?'} request_id={_consumer_expected_request_id or '-'} pending={len(_pending_entries)}",
            flush=True,
        )
    except Exception:
        pass

    if not _pending_entries:
        return

    for pending in _pending_entries:
        try:
            await sio.emit(
                "editor:diagnostics_sideband",
                pending,
                room="file_editor_cm6",
                namespace="/editor",
            )
            print(
                f"[diag_sideband] flush OK owner={_payload_owner(pending)} pairs={_payload_pair_count(pending)}",
                flush=True,
            )
        except Exception as exc:
            print(f"[diag_sideband] flush FAIL: {exc}", flush=True)
    _pending_entries = []


def clear_editor_diagnostics_sideband_state() -> None:
    global _consumer_expected_path, _consumer_expected_request_id, _consumer_ready, _pending_entries
    _consumer_expected_path = None
    _consumer_expected_request_id = ""
    _consumer_ready = False
    _pending_entries = []
