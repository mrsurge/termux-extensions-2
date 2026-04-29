# pyright: strict
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

import logging as _logging


EmitToSidFn = Callable[[str, dict[str, object]], Awaitable[None]]
ActiveProjectFn = Callable[[], str | None]
IsUnderProjectFn = Callable[[str, str], bool]
WorkbenchLockFn = Callable[[str], asyncio.Lock]
CoerceGenerationFn = Callable[[object], int | None]
HasOpenBaselineFn = Callable[[str, int | None], bool]
MarkOpenBaselineFn = Callable[[str, int | None], None]


class AdapterRpcFn(Protocol):
    async def __call__(self, method: str, params: dict[str, object]) -> object: ...


def _payload_dict(data: object) -> dict[str, object]:
    if not isinstance(data, dict):
        return {}
    typed_data = cast(dict[object, object], data)
    payload: dict[str, object] = {}
    for raw_key, raw_value in typed_data.items():
        if isinstance(raw_key, str):
            payload[raw_key] = raw_value
    return payload


def _payload_str(payload: dict[str, object], key: str, default: str = "") -> str:
    value = payload.get(key, default)
    return value if isinstance(value, str) else default


def _request_id(payload: dict[str, object], key: str, prefix: str) -> str:
    request_id = payload.get(key, f"{prefix}_{int(time.time() * 1000)}")
    if isinstance(request_id, str) and request_id:
        return request_id
    return f"{prefix}_{int(time.time() * 1000)}"


async def _adapter_rpc(method: str, params: dict[str, object]) -> dict[str, object]:
    from ... import workbench_adapter_shell_manager as _adapter_manager

    adapter_rpc = cast(AdapterRpcFn, getattr(_adapter_manager, "adapter_rpc"))
    raw_response: object = await adapter_rpc(method, params)
    if isinstance(raw_response, dict):
        typed_response = cast(dict[object, object], raw_response)
        response: dict[str, object] = {}
        for raw_key, raw_value in typed_response.items():
            if isinstance(raw_key, str):
                response[raw_key] = raw_value
        return response
    return {"result": raw_response}


async def _emit_result(emit_to_sid: EmitToSidFn, event_name: str, request_id: str, result: object) -> None:
    await emit_to_sid(event_name, {"request_id": request_id, "result": result})


async def _emit_error(emit_to_sid: EmitToSidFn, event_name: str, request_id: str, error: str) -> None:
    await emit_to_sid(event_name, {"request_id": request_id, "error": error})


async def handle_workbench_open_file(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    is_under_project: IsUnderProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    mark_open_baseline: MarkOpenBaselineFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    abs_path = _payload_str(payload, "path")
    request_id = _request_id(payload, "request_id", "wb")
    generation = coerce_generation(payload.get("generation"))

    project = active_project()
    if not project or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_open_file_response", request_id, "missing_path_or_project")
        return
    if not is_under_project(project, abs_path):
        await _emit_error(emit_to_sid, "editor:workbench_open_file_response", request_id, "outside_project")
        return

    lock = get_lock(abs_path)
    async with lock:
        try:
            response = await _adapter_rpc(
                "vscode.openFile",
                {
                    "path": abs_path,
                    "languageId": payload.get("languageId", ""),
                    "requestId": request_id,
                    "forceRefresh": payload.get("forceRefresh", False),
                    "generation": generation,
                    "workspaceFolder": project,
                },
            )
            mark_open_baseline(abs_path, generation)
            await _emit_result(
                emit_to_sid,
                "editor:workbench_open_file_response",
                request_id,
                response.get("result", response),
            )
        except Exception as exc:
            logger.error("[workbench] open_file failed: %s", exc)
            await _emit_error(emit_to_sid, "editor:workbench_open_file_response", request_id, str(exc))


async def handle_workbench_hover(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "hv")
    abs_path = _payload_str(payload, "path")
    print(
        f"[editor_ws] hover request_id={request_id} path={abs_path} line={payload.get('lineNumber')} "
        f"col={payload.get('column')} lang={payload.get('languageId')}",
        flush=True,
    )

    if not active_project() or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_hover_response", request_id, "missing_path_or_project")
        return

    try:
        response = await _adapter_rpc(
            "vscode.hover",
            {
                "path": abs_path,
                "lineNumber": payload.get("lineNumber", payload.get("line", 1)),
                "column": payload.get("column", payload.get("character", 1)),
                "languageId": payload.get("languageId", ""),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_hover_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] hover failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_hover_response", request_id, str(exc))


async def handle_workbench_completions(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "cmp")
    abs_path = _payload_str(payload, "path")
    print(
        f"[editor_ws] completions request_id={request_id} path={abs_path} line={payload.get('lineNumber')} "
        f"col={payload.get('column')} lang={payload.get('languageId')}",
        flush=True,
    )

    if not active_project() or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_completions_response", request_id, "missing_path_or_project")
        return

    try:
        response = await _adapter_rpc(
            "vscode.completions",
            {
                "path": abs_path,
                "lineNumber": payload.get("lineNumber", payload.get("line", 1)),
                "column": payload.get("column", payload.get("character", 1)),
                "languageId": payload.get("languageId", ""),
                "providerHandle": payload.get("providerHandle"),
                "triggerKind": payload.get("triggerKind", 0),
                "triggerCharacter": payload.get("triggerCharacter"),
                "text": payload.get("text"),
                "timeoutMs": payload.get("timeoutMs"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_completions_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] completions failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_completions_response", request_id, str(exc))


async def handle_workbench_inlay_hints(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "ih")
    abs_path = _payload_str(payload, "path")
    print(
        f"[editor_ws] inlayHints request_id={request_id} path={abs_path} "
        f"lang={payload.get('languageId')} handle={payload.get('providerHandle')} range={payload.get('range')}",
        flush=True,
    )

    if not active_project() or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_inlay_hints_response", request_id, "missing_path_or_project")
        return

    try:
        response = await _adapter_rpc(
            "vscode.inlayHints",
            {
                "path": abs_path,
                "languageId": payload.get("languageId", ""),
                "providerHandle": payload.get("providerHandle"),
                "range": payload.get("range"),
                "text": payload.get("text"),
                "modelVersionId": payload.get("modelVersionId"),
                "timeoutMs": payload.get("timeoutMs"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inlay_hints_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlayHints failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inlay_hints_response", request_id, str(exc))


async def handle_workbench_inlay_hints_resolve(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "ihr")

    try:
        response = await _adapter_rpc(
            "vscode.inlayHints.resolve",
            {
                "providerHandle": payload.get("providerHandle"),
                "cacheId": payload.get("cacheId"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inlay_hints_resolve_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlayHints.resolve failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inlay_hints_resolve_response", request_id, str(exc))


async def handle_workbench_inlay_hints_release(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "ihl")

    try:
        response = await _adapter_rpc(
            "vscode.inlayHints.release",
            {
                "providerHandle": payload.get("providerHandle"),
                "cacheId": payload.get("cacheId"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inlay_hints_release_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlayHints.release failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inlay_hints_release_response", request_id, str(exc))


async def handle_workbench_inline_completions(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "icmp")
    abs_path = _payload_str(payload, "path")
    print(
        f"[editor_ws] inlineCompletions request_id={request_id} path={abs_path} line={payload.get('lineNumber')} "
        f"col={payload.get('column')} lang={payload.get('languageId')} handle={payload.get('providerHandle')}",
        flush=True,
    )

    if not active_project() or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_inline_completions_response", request_id, "missing_path_or_project")
        return

    try:
        response = await _adapter_rpc(
            "vscode.inlineCompletions",
            {
                "path": abs_path,
                "lineNumber": payload.get("lineNumber", payload.get("line", 1)),
                "column": payload.get("column", payload.get("character", 1)),
                "languageId": payload.get("languageId", ""),
                "providerHandle": payload.get("providerHandle"),
                "context": payload.get("context"),
                "text": payload.get("text"),
                "modelVersionId": payload.get("modelVersionId"),
                "timeoutMs": payload.get("timeoutMs"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inline_completions_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlineCompletions failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inline_completions_response", request_id, str(exc))


async def handle_workbench_inline_completions_free(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "icf")

    try:
        response = await _adapter_rpc(
            "vscode.inlineCompletions.free",
            {
                "providerHandle": payload.get("providerHandle"),
                "pid": payload.get("pid"),
                "reason": payload.get("reason"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inline_completions_free_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlineCompletions.free failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inline_completions_free_response", request_id, str(exc))


async def handle_workbench_inline_completions_did_show(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "icds")

    try:
        response = await _adapter_rpc(
            "vscode.inlineCompletions.didShow",
            {
                "providerHandle": payload.get("providerHandle"),
                "pid": payload.get("pid"),
                "idx": payload.get("idx"),
                "updatedInsertText": payload.get("updatedInsertText", ""),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_inline_completions_did_show_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] inlineCompletions.didShow failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_inline_completions_did_show_response", request_id, str(exc))


async def handle_workbench_semantic_tokens(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "st")
    abs_path = _payload_str(payload, "path")
    print(
        f"[editor_ws] semanticTokens request_id={request_id} path={abs_path} "
        f"lang={payload.get('languageId')} prevResultId={payload.get('previousResultId')}",
        flush=True,
    )

    if not active_project() or not abs_path:
        await _emit_error(
            emit_to_sid,
            "editor:workbench_semantic_tokens_response",
            request_id,
            "missing_path_or_project",
        )
        return

    try:
        response = await _adapter_rpc(
            "vscode.semanticTokens",
            {
                "path": abs_path,
                "languageId": payload.get("languageId", ""),
                "previousResultId": payload.get("previousResultId", "0"),
                "text": payload.get("text"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_semantic_tokens_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] semanticTokens failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_semantic_tokens_response", request_id, str(exc))


async def handle_workbench_semantic_tokens_legend(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "stl")
    lang_id = _payload_str(payload, "languageId")

    try:
        response = await _adapter_rpc("vscode.semanticTokensLegend", {"languageId": lang_id})
        await _emit_result(
            emit_to_sid,
            "editor:workbench_semantic_tokens_legend_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] semanticTokensLegend failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_semantic_tokens_legend_response", request_id, str(exc))


async def handle_workbench_semantic_tokens_range(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "str")
    abs_path = _payload_str(payload, "path")
    range_obj = payload.get("range", None)
    print(
        f"[editor_ws] semanticTokensRange request_id={request_id} path={abs_path} "
        f"lang={payload.get('languageId')} range={range_obj}",
        flush=True,
    )

    if not active_project() or not abs_path or not range_obj:
        await _emit_error(
            emit_to_sid,
            "editor:workbench_semantic_tokens_range_response",
            request_id,
            "missing_path_or_project_or_range",
        )
        return

    try:
        response = await _adapter_rpc(
            "vscode.semanticTokensRange",
            {
                "path": abs_path,
                "languageId": payload.get("languageId", ""),
                "range": range_obj,
                "text": payload.get("text"),
            },
        )
        await _emit_result(
            emit_to_sid,
            "editor:workbench_semantic_tokens_range_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[workbench] semanticTokensRange failed: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_semantic_tokens_range_response", request_id, str(exc))


async def handle_workbench_symbols(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    has_open_baseline: HasOpenBaselineFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "sym")
    abs_path = _payload_str(payload, "path")
    generation = coerce_generation(payload.get("generation"))

    if not active_project() or not abs_path:
        await _emit_error(emit_to_sid, "editor:workbench_symbols_response", request_id, "missing_path_or_project")
        return

    lang_id = _payload_str(payload, "languageId")
    logger.info("[symbols] request path=%s lang=%s", abs_path, lang_id)

    lock = get_lock(abs_path)
    async with lock:
        if not has_open_baseline(abs_path, generation):
            await _emit_error(emit_to_sid, "editor:workbench_symbols_response", request_id, "document_not_ready")
            return

        try:
            response = await _adapter_rpc(
                "vscode.documentSymbols",
                {
                    "path": abs_path,
                    "languageId": lang_id,
                    "generation": generation,
                },
            )
            result: object = response["result"] if "result" in response else response
            if isinstance(result, list):
                result_list = cast(list[object], result)
                sym_count = len(result_list)
            else:
                sym_count = "non-list"
            logger.info("[symbols] response path=%s lang=%s count=%s ok=%s", abs_path, lang_id, sym_count, response.get("ok"))
            if not isinstance(result, list) or not result:
                logger.warning(
                    "[symbols] raw adapter resp keys=%s",
                    list(response.keys()),
                )
            await _emit_result(emit_to_sid, "editor:workbench_symbols_response", request_id, cast(object, result))
        except Exception as exc:
            logger.error("[symbols] FAILED path=%s lang=%s err=%s", abs_path, lang_id, exc)
            await _emit_error(emit_to_sid, "editor:workbench_symbols_response", request_id, str(exc))


async def handle_workbench_folding_ranges(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    active_project: ActiveProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    has_open_baseline: HasOpenBaselineFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "fold")
    abs_path = _payload_str(payload, "path")
    generation = coerce_generation(payload.get("generation"))
    lang_id = _payload_str(payload, "languageId")
    context_obj = payload.get("context", {})

    if not active_project() or not abs_path:
        await _emit_error(
            emit_to_sid,
            "editor:workbench_folding_ranges_response",
            request_id,
            "missing_path_or_project",
        )
        return

    lock = get_lock(abs_path)
    async with lock:
        if not has_open_baseline(abs_path, generation):
            await _emit_error(
                emit_to_sid,
                "editor:workbench_folding_ranges_response",
                request_id,
                "document_not_ready",
            )
            return

        try:
            response = await _adapter_rpc(
                "vscode.foldingRanges",
                {
                    "path": abs_path,
                    "languageId": lang_id,
                    "generation": generation,
                    "context": context_obj,
                    "timeoutMs": payload.get("timeoutMs"),
                },
            )
            result: object = response["result"] if "result" in response else response
            range_count = "null"
            if isinstance(result, dict):
                typed_result = cast(dict[str, object], result)
                inner = typed_result.get("result")
                if isinstance(inner, list):
                    inner_list = cast(list[object], inner)
                    range_count = str(len(inner_list))
            logger.info("[folding] response path=%s lang=%s count=%s ok=%s", abs_path, lang_id, range_count, response.get("ok"))
            await _emit_result(
                emit_to_sid,
                "editor:workbench_folding_ranges_response",
                request_id,
                cast(object, result),
            )
        except Exception as exc:
            logger.error("[folding] FAILED path=%s lang=%s err=%s", abs_path, lang_id, exc)
            await _emit_error(emit_to_sid, "editor:workbench_folding_ranges_response", request_id, str(exc))


async def handle_workbench_did_change(
    data: object,
    *,
    active_project: ActiveProjectFn,
    get_lock: WorkbenchLockFn,
    coerce_generation: CoerceGenerationFn,
    has_open_baseline: HasOpenBaselineFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    abs_path = _payload_str(payload, "path")
    text = _payload_str(payload, "text")
    language_id = _payload_str(payload, "languageId")
    generation = coerce_generation(payload.get("generation"))

    if not active_project() or not abs_path:
        return

    # didChange must stay on the hot path. Slow structure calls for the same file
    # can time out when no provider exists, and sharing their lock causes model
    # sync and diagnostics to lag far behind typing.
    if not has_open_baseline(abs_path, generation):
        logger.warning("[workbench] didChange dropped (no open baseline) path=%s gen=%s", abs_path, generation)
        return

    try:
        await _adapter_rpc(
            "vscode.didChange",
            {
                "path": abs_path,
                "text": text,
                "languageId": language_id,
                "generation": generation,
            },
        )
    except Exception as exc:
        logger.error("[workbench] didChange failed: %s", exc)


async def handle_workbench_grammars_list(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "gl")

    try:
        response = await _adapter_rpc("vscode.textmate.grammars.list", {})
        await _emit_result(
            emit_to_sid,
            "editor:workbench_grammars_list_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[grammars.list] FAILED: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_grammars_list_response", request_id, str(exc))


async def handle_workbench_grammars_load(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "gld")
    grammar_id = _payload_str(payload, "id")
    if not grammar_id:
        await _emit_error(emit_to_sid, "editor:workbench_grammars_load_response", request_id, "missing_grammar_id")
        return

    try:
        response = await _adapter_rpc("vscode.textmate.grammars.load", {"id": grammar_id})
        await _emit_result(
            emit_to_sid,
            "editor:workbench_grammars_load_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[grammars.load] FAILED id=%s: %s", grammar_id, exc)
        await _emit_error(emit_to_sid, "editor:workbench_grammars_load_response", request_id, str(exc))


async def handle_workbench_language_catalog(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "wblc")

    try:
        response = await _adapter_rpc("te2.language_catalog", {})
        await _emit_result(
            emit_to_sid,
            "editor:workbench_language_catalog_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[language_catalog] FAILED: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_language_catalog_response", request_id, str(exc))


async def handle_workbench_providers(
    data: object,
    *,
    emit_to_sid: EmitToSidFn,
    logger: _logging.Logger,
) -> None:
    payload = _payload_dict(data)
    request_id = _request_id(payload, "request_id", "wbp")

    try:
        response = await _adapter_rpc("adapter.providers", {})
        await _emit_result(
            emit_to_sid,
            "editor:workbench_providers_response",
            request_id,
            response.get("result", response),
        )
    except Exception as exc:
        logger.error("[providers] FAILED: %s", exc)
        await _emit_error(emit_to_sid, "editor:workbench_providers_response", request_id, str(exc))
