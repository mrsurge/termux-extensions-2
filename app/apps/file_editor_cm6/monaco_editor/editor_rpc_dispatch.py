# pyright: strict
from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging as _logging

from .editor_rpc_contract import (
    EDITOR_RPC_METHOD_WORKBENCH_COMPLETIONS,
    EDITOR_RPC_METHOD_WORKBENCH_DID_CHANGE,
    EDITOR_RPC_METHOD_WORKBENCH_FOLDING_RANGES,
    EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LIST,
    EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LOAD,
    EDITOR_RPC_METHOD_WORKBENCH_HOVER,
    EDITOR_RPC_METHOD_WORKBENCH_OPEN_FILE,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_LEGEND,
    EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_RANGE,
    EDITOR_RPC_METHOD_WORKBENCH_SYMBOLS,
    JSONRPC_APPLICATION_ERROR,
    JSONRPC_METHOD_NOT_FOUND,
    EditorRpcDispatchError,
)
from .editor_workbench_backend import (
    handle_workbench_completions,
    handle_workbench_did_change,
    handle_workbench_folding_ranges,
    handle_workbench_grammars_list,
    handle_workbench_grammars_load,
    handle_workbench_hover,
    handle_workbench_open_file,
    handle_workbench_semantic_tokens,
    handle_workbench_semantic_tokens_legend,
    handle_workbench_semantic_tokens_range,
    handle_workbench_symbols,
)

ActiveProjectFn = Callable[[], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
WorkbenchLockFn = Callable[[str], asyncio.Lock]
CoerceGenerationFn = Callable[[object], int | None]
MarkOpenBaselineFn = Callable[[str, int | None], None]
HasOpenBaselineFn = Callable[[str, int | None], bool]


class _CapturedEmit:
    def __init__(self) -> None:
        self.event_name: str | None = None
        self.payload: dict[str, object] | None = None

    async def __call__(self, event_name: str, payload: dict[str, object]) -> None:
        self.event_name = event_name
        self.payload = payload


def _unwrap_captured_result(capture: _CapturedEmit, *, method: str) -> object:
    payload = capture.payload or {}
    if "error" in payload:
        error_obj = payload.get("error")
        error_message = str(error_obj) if error_obj is not None else f"{method}_failed"
        raise EditorRpcDispatchError(
            JSONRPC_APPLICATION_ERROR,
            error_message,
            data={
                "method": method,
                "legacy_event": capture.event_name or "",
            },
        )
    return payload.get("result")


async def dispatch_editor_rpc_request(
    method: str,
    params: dict[str, object],
    *,
    active_project: ActiveProjectFn,
    is_under_project: IsUnderProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    mark_open_baseline: MarkOpenBaselineFn,
    has_open_baseline: HasOpenBaselineFn,
    logger: _logging.Logger,
) -> object:
    if method == EDITOR_RPC_METHOD_WORKBENCH_OPEN_FILE:
        capture = _CapturedEmit()
        await handle_workbench_open_file(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            is_under_project=is_under_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            mark_open_baseline=mark_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_HOVER:
        capture = _CapturedEmit()
        await handle_workbench_hover(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_COMPLETIONS:
        capture = _CapturedEmit()
        await handle_workbench_completions(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_LEGEND:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens_legend(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SEMANTIC_TOKENS_RANGE:
        capture = _CapturedEmit()
        await handle_workbench_semantic_tokens_range(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_SYMBOLS:
        capture = _CapturedEmit()
        await handle_workbench_symbols(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_FOLDING_RANGES:
        capture = _CapturedEmit()
        await handle_workbench_folding_ranges(
            params,
            emit_to_sid=capture,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_DID_CHANGE:
        await handle_workbench_did_change(
            params,
            active_project=active_project,
            get_lock=get_lock,
            coerce_generation=coerce_generation,
            has_open_baseline=has_open_baseline,
            logger=logger,
        )
        return {"ok": True}

    if method == EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LIST:
        capture = _CapturedEmit()
        await handle_workbench_grammars_list(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    if method == EDITOR_RPC_METHOD_WORKBENCH_GRAMMARS_LOAD:
        capture = _CapturedEmit()
        await handle_workbench_grammars_load(
            params,
            emit_to_sid=capture,
            logger=logger,
        )
        return _unwrap_captured_result(capture, method=method)

    raise EditorRpcDispatchError(
        JSONRPC_METHOD_NOT_FOUND,
        "method_not_found",
        data={"method": method},
    )
