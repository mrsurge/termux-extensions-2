# pyright: strict
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from queue import Empty, Queue
from typing import Literal, TypedDict, cast

from app.libs import pipe_runtime
from app.libs.pipe_protocol import PipeEnvelope

from ..context import EmitPersonal
from ..search import (
    SEARCH_SERVICE_ORIGIN_NAME,
    SEARCH_SERVICE_TARGET_NAME,
    SEARCH_SERVICE_TARGET_NID,
)
from ...worker_services.event_bus import current_project_generation, next_project_generation

JsonObject = dict[str, object]
BenchmarkMode = Literal["genericSuite", "oneShot"]
BenchmarkLane = Literal["fullStack", "pythonBridge", "rustOnly"]

PIPE_JOB_METHODS = {
    "search.job.progress",
    "search.job.result",
    "search.job.done",
    "search.job.error",
}
DEFAULT_LANES: tuple[BenchmarkLane, ...] = ("fullStack", "pythonBridge", "rustOnly")
BENCHMARK_TIMEOUT_SECONDS = 120.0


class SearchBenchmarkCase(TypedDict):
    caseId: str
    query: str
    isRegex: bool
    isCaseSensitive: bool
    isWholeWords: bool
    includePatterns: list[str]
    excludePatterns: list[str]
    useIgnoreFiles: bool
    resultBatching: JsonObject | None


class SearchBenchmarkRunParams(TypedDict):
    dto: str
    version: int
    mode: BenchmarkMode
    suiteId: str
    outputPath: str | None
    lanes: list[BenchmarkLane]
    cases: list[SearchBenchmarkCase]


PipeEventQueue = Queue[PipeEnvelope]


def parse_search_benchmark_run_params(payload: object) -> SearchBenchmarkRunParams:
    raw = _object(payload)
    mode = _benchmark_mode(raw.get("mode"))
    suite_id = _string(raw.get("suiteId")) or f"search-benchmark-{int(time.time() * 1000)}"
    cases = _benchmark_cases(mode, raw.get("cases"))
    return {
        "dto": "SearchBenchmarkRunRequest",
        "version": 1,
        "mode": mode,
        "suiteId": suite_id,
        "outputPath": _optional_string(raw.get("outputPath")),
        "lanes": _benchmark_lanes(raw.get("lanes")),
        "cases": cases,
    }


def parse_search_benchmark_frontend_result_params(payload: object) -> JsonObject:
    raw = _object(payload)
    suite_id = _required_string(raw.get("suiteId"), "search benchmark frontend suiteId")
    output_path = _required_string(raw.get("outputPath"), "search benchmark frontend outputPath")
    metrics = _object(raw.get("frontend"))
    return {
        "suiteId": suite_id,
        "outputPath": output_path,
        "frontend": metrics,
    }


async def run_search_benchmark(
    *,
    project_root: Path,
    payload: object,
    emit_personal: EmitPersonal,
) -> JsonObject:
    params = parse_search_benchmark_run_params(payload)
    project_generation = _ensure_project_generation(project_root)
    output_path = _resolve_output_path(project_root, params["suiteId"], params["outputPath"])
    started_at_ms = _epoch_ms()
    case_results: list[JsonObject] = []

    if "rustOnly" in params["lanes"]:
        rust_result = await _run_rust_benchmark(project_root, project_generation, params)
        case_results.extend(_json_object_list(rust_result.get("cases")))

    for lane in params["lanes"]:
        if lane != "pythonBridge":
            continue
        for case in params["cases"]:
            case_results.append(
                await _run_python_bridge_case(
                    project_root=project_root,
                    project_generation=project_generation,
                    suite_id=params["suiteId"],
                    lane=lane,
                    case=case,
                    emit_personal=emit_personal,
                )
            )

    case_results = [_decorate_case_result(result) for result in case_results]
    status = _suite_status(case_results)
    suite: JsonObject = {
        "dto": "SearchBenchmarkSuiteResult",
        "version": 1,
        "suiteId": params["suiteId"],
        "mode": params["mode"],
        "startedAtMs": started_at_ms,
        "finishedAtMs": _epoch_ms(),
        "status": status,
        "outputPath": str(output_path),
        "cases": case_results,
        "summary": _build_suite_summary(case_results),
    }
    _write_json(output_path, suite)
    return suite


async def record_search_benchmark_frontend_result(payload: object) -> JsonObject:
    params = parse_search_benchmark_frontend_result_params(payload)
    output_path = Path(str(params["outputPath"])).expanduser()
    raw = json.loads(output_path.read_text(encoding="utf-8"))
    suite = _object(raw)
    frontend_results = suite.get("frontendResults")
    if not isinstance(frontend_results, list):
        frontend_results = []
        suite["frontendResults"] = frontend_results
    frontend = _object(params["frontend"])
    cast(list[object], frontend_results).append(frontend)
    frontend_cases = frontend.get("cases")
    if isinstance(frontend_cases, list):
        cases = suite.get("cases")
        if not isinstance(cases, list):
            cases = []
            suite["cases"] = cases
        existing = [
            case
            for case in cast(list[object], cases)
            if _string(_object(case).get("lane")) != "fullStack"
        ]
        existing.extend(
            _decorate_case_result(_object(case))
            for case in cast(list[object], frontend_cases)
        )
        suite["cases"] = existing
        suite["summary"] = _build_suite_summary(_json_object_list(existing))
        suite["status"] = _suite_status(_json_object_list(existing))
    suite["frontendFinishedAtMs"] = _epoch_ms()
    _write_json(output_path, suite)
    return {
        "dto": "SearchBenchmarkFrontendResultRecorded",
        "version": 1,
        "suiteId": params["suiteId"],
        "outputPath": str(output_path),
        "status": "ok",
    }


async def _run_rust_benchmark(
    root: Path,
    project_generation: int,
    params: SearchBenchmarkRunParams,
) -> JsonObject:
    result = await pipe_runtime.call_async(
        "search.benchmark.run",
        {
            "dto": "SearchBenchmarkRunRequest",
            "version": 1,
            "root": str(root),
            "projectGeneration": project_generation,
            "mode": params["mode"],
            "suiteId": params["suiteId"],
            "cases": [_case_to_pipe(case) for case in params["cases"]],
            "lanes": ["rustOnly"],
        },
        target_nid=SEARCH_SERVICE_TARGET_NID,
        target_name=SEARCH_SERVICE_TARGET_NAME,
        workspace_root=str(root),
        project_generation=project_generation,
        origin_name=f"{SEARCH_SERVICE_ORIGIN_NAME}.benchmark",
        correlation_id=params["suiteId"],
        op_id=f"{params['suiteId']}:rustOnly",
        timeout_seconds=BENCHMARK_TIMEOUT_SECONDS,
    )
    return _object(result)


async def _run_python_bridge_case(
    *,
    project_root: Path,
    project_generation: int,
    suite_id: str,
    lane: BenchmarkLane,
    case: SearchBenchmarkCase,
    emit_personal: EmitPersonal,
) -> JsonObject:
    event_queue: PipeEventQueue = Queue()
    listener = pipe_runtime.add_notification_listener(event_queue, methods=PIPE_JOB_METHODS)
    started_at = time.perf_counter()
    first_result_ms: int | None = None
    result_batches = 0
    received_files = 0
    received_matches = 0
    emitted_events = 0
    pipe_request_ms: int | None = None
    status = "ok"
    error: str | None = None
    job_id = ""
    search_id = ""
    last_counts: JsonObject = {}
    done_counts: JsonObject | None = None
    try:
        started = await _start_content_benchmark_case(
            project_root,
            project_generation,
            suite_id,
            lane,
            case,
        )
        pipe_request_ms = _elapsed_ms(started_at)
        job_id = _string(started.get("jobId")) or _string(started.get("opId")) or ""
        search_id = _string(started.get("searchId")) or job_id
        if lane == "fullStack":
            await _emit_benchmark_event(
                emit_personal,
                "explorer.search.benchmark.progress",
                suite_id,
                lane,
                case,
                {
                    "status": "running",
                    "message": "benchmark case started",
                    "jobId": job_id,
                    "searchId": search_id,
                },
            )
        deadline = time.monotonic() + BENCHMARK_TIMEOUT_SECONDS
        done = False
        while not done:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("search benchmark case timed out")
            try:
                envelope = await asyncio.to_thread(event_queue.get, timeout=min(0.5, remaining))
            except Empty:
                continue
            params = _object(envelope.params)
            if not _matches_job(params, search_id, job_id, project_generation):
                continue
            method = str(envelope.method or "")
            if method == "search.job.progress":
                last_counts = _progress_counts(params)
                if lane == "fullStack":
                    emitted_events += 1
                    await _emit_benchmark_event(
                        emit_personal,
                        "explorer.search.benchmark.progress",
                        suite_id,
                        lane,
                        case,
                        last_counts,
                    )
                continue
            if method == "search.job.result":
                if first_result_ms is None:
                    first_result_ms = _elapsed_ms(started_at)
                result_batches += 1
                result = _object(params.get("result"))
                file_count = _int(result.get("fileCount")) or _int(result.get("file_count")) or 0
                match_count = _int(result.get("matchCount")) or _int(result.get("match_count")) or 0
                received_files += file_count
                received_matches += match_count
                if lane == "fullStack":
                    emitted_events += 1
                    await _emit_benchmark_event(
                        emit_personal,
                        "explorer.search.benchmark.result",
                        suite_id,
                        lane,
                        case,
                        {
                            "jobId": job_id,
                            "searchId": search_id,
                            "result": result,
                            "fileCount": file_count,
                            "matchCount": match_count,
                        },
                    )
                continue
            if method == "search.job.done":
                done = True
                done_counts = _done_counts(params)
                if lane == "fullStack":
                    emitted_events += 1
                    await _emit_benchmark_event(
                        emit_personal,
                        "explorer.search.benchmark.done",
                        suite_id,
                        lane,
                        case,
                        {
                            "jobId": job_id,
                            "searchId": search_id,
                            "cancelled": params.get("cancelled") is True,
                            "accumulatedFileCount": received_files,
                            "accumulatedMatchCount": received_matches,
                            "fileCount": _int(done_counts.get("filesMatched")) or received_files,
                            "matchCount": _int(done_counts.get("matchesFound")) or received_matches,
                            "filesScanned": _int(done_counts.get("filesScanned")) or 0,
                            "filesMatched": _int(done_counts.get("filesMatched")) or 0,
                            "matchesFound": _int(done_counts.get("matchesFound")) or 0,
                        },
                    )
                continue
            if method == "search.job.error":
                status = "error"
                error = _string(params.get("message")) or _string(params.get("code")) or "search benchmark failed"
                done = True
                if lane == "fullStack":
                    emitted_events += 1
                    await _emit_benchmark_event(
                        emit_personal,
                        "explorer.search.benchmark.error",
                        suite_id,
                        lane,
                        case,
                        {"jobId": job_id, "searchId": search_id, "error": error},
                    )
    except Exception as exc:
        status = "error"
        error = str(exc)
    finally:
        pipe_runtime.remove_notification_listener(listener)

    total_run_ms = _elapsed_ms(started_at)
    authoritative = _authoritative_counts(
        done_counts,
        received_files=received_files,
        received_matches=received_matches,
        result_batches=result_batches,
    )
    completion = _completion_summary(
        done_counts,
        received_files=received_files,
        received_matches=received_matches,
        status=status,
        error=error,
    )
    if status == "ok" and completion.get("complete") is not True:
        status = "partial" if done_counts is not None else "incomplete"
    return {
        "caseId": case["caseId"],
        "lane": lane,
        "query": case["query"],
        "includePatterns": list(case["includePatterns"]),
        "excludePatterns": list(case["excludePatterns"]),
        "python": {
            "pipeRequestMs": pipe_request_ms,
            "firstPipeResultMs": first_result_ms,
            "projectionMs": 0,
            "cacheInsertMs": 0,
            "emittedEvents": emitted_events,
            "receivedFiles": received_files,
            "receivedMatches": received_matches,
            "resultBatches": result_batches,
            "totalRunMs": total_run_ms,
            "lastProgress": last_counts,
            "done": done_counts or {},
            "authoritative": authoritative,
            "completion": completion,
            "rates": _rates_for_counts(
                duration_ms=total_run_ms,
                files_scanned=_int(authoritative.get("filesScanned")) or 0,
                files_matched=_int(authoritative.get("filesMatched")) or 0,
                matches_found=_int(authoritative.get("matchesFound")) or 0,
                result_batches=result_batches,
            ),
        },
        "status": status,
        "error": error,
    }


async def _start_content_benchmark_case(
    root: Path,
    project_generation: int,
    suite_id: str,
    lane: BenchmarkLane,
    case: SearchBenchmarkCase,
) -> JsonObject:
    data = await pipe_runtime.call_async(
        "search.content.start",
        {
            "dto": "SearchContentStartRequest",
            "version": 1,
            "root": str(root),
            "projectGeneration": project_generation,
            "correlationId": f"{suite_id}:{lane}:{case['caseId']}",
            "query": case["query"],
            "isRegex": case["isRegex"],
            "isCaseSensitive": case["isCaseSensitive"],
            "isWholeWords": case["isWholeWords"],
            "includePatterns": case["includePatterns"],
            "excludePatterns": case["excludePatterns"],
            "useIgnoreFiles": case["useIgnoreFiles"],
            "contextChars": 75,
            "resultBatching": case["resultBatching"],
        },
        target_nid=SEARCH_SERVICE_TARGET_NID,
        target_name=SEARCH_SERVICE_TARGET_NAME,
        workspace_root=str(root),
        project_generation=project_generation,
        origin_name=f"{SEARCH_SERVICE_ORIGIN_NAME}.benchmark",
        correlation_id=f"{suite_id}:{lane}:{case['caseId']}",
        timeout_seconds=BENCHMARK_TIMEOUT_SECONDS,
    )
    return _object(data)


async def _emit_benchmark_event(
    emit_personal: EmitPersonal,
    method: str,
    suite_id: str,
    lane: BenchmarkLane,
    case: SearchBenchmarkCase,
    extra: JsonObject,
) -> None:
    payload: JsonObject = {
        "dto": "SearchBenchmarkNotification",
        "version": 1,
        "suiteId": suite_id,
        "lane": lane,
        "caseId": case["caseId"],
        "query": case["query"],
        "includePatterns": list(case["includePatterns"]),
        "excludePatterns": list(case["excludePatterns"]),
    }
    payload.update(extra)
    await emit_personal(method, payload)


def _matches_job(params: JsonObject, search_id: str, job_id: str, project_generation: int) -> bool:
    event_search_id = _string(params.get("searchId"))
    event_job_id = _string(params.get("jobId")) or _string(params.get("opId"))
    if search_id and event_search_id and event_search_id != search_id:
        return False
    if job_id and event_job_id and event_job_id != job_id:
        return False
    generation = _int(params.get("projectGeneration"))
    return generation is None or generation == project_generation


def _progress_counts(params: JsonObject) -> JsonObject:
    return {
        "filesScanned": _int(params.get("filesScanned")) or 0,
        "filesMatched": _int(params.get("filesMatched")) or 0,
        "matchesFound": _int(params.get("matchesFound")) or 0,
        "message": _string(params.get("message")) or "",
        "status": _string(params.get("status")) or "running",
    }


def _done_counts(params: JsonObject) -> JsonObject:
    files_matched = _int(params.get("filesMatched"))
    matches_found = _int(params.get("matchesFound"))
    return {
        "filesScanned": _int(params.get("filesScanned")) or 0,
        "filesMatched": files_matched if files_matched is not None else _int(params.get("fileCount")) or 0,
        "matchesFound": matches_found if matches_found is not None else _int(params.get("matchCount")) or 0,
        "cancelled": params.get("cancelled") is True,
        "cancellationReason": _string(params.get("cancellationReason")),
        "optionalEventsDropped": _int(params.get("optionalEventsDropped")) or 0,
        "requiredEventBackpressureCount": _int(params.get("requiredEventBackpressureCount")) or 0,
        "requiredEventBackpressureMs": _int(params.get("requiredEventBackpressureMs")) or 0,
        "requiredEventFailures": _int(params.get("requiredEventFailures")) or 0,
        "status": _string(params.get("status")) or "done",
        "sequence": _int(params.get("sequence")),
    }


def _authoritative_counts(
    done_counts: JsonObject | None,
    *,
    received_files: int,
    received_matches: int,
    result_batches: int,
) -> JsonObject:
    if done_counts is not None:
        return {
            "source": "done",
            "filesScanned": _int(done_counts.get("filesScanned")) or 0,
            "filesMatched": _int(done_counts.get("filesMatched")) or 0,
            "matchesFound": _int(done_counts.get("matchesFound")) or 0,
            "resultBatches": result_batches,
        }
    return {
        "source": "accumulatedResults",
        "filesScanned": 0,
        "filesMatched": received_files,
        "matchesFound": received_matches,
        "resultBatches": result_batches,
    }


def _completion_summary(
    done_counts: JsonObject | None,
    *,
    received_files: int,
    received_matches: int,
    status: str,
    error: str | None,
) -> JsonObject:
    if status == "error":
        return {
            "complete": False,
            "reason": "error",
            "error": error or "",
        }
    if done_counts is None:
        return {
            "complete": False,
            "reason": "missingDone",
            "missingFiles": None,
            "missingMatches": None,
        }
    if done_counts.get("cancelled") is True:
        return {
            "complete": False,
            "reason": _string(done_counts.get("cancellationReason")) or "cancelled",
            "missingFiles": None,
            "missingMatches": None,
            "extraFiles": None,
            "extraMatches": None,
            "receivedFiles": received_files,
            "receivedMatches": received_matches,
            "doneFiles": _int(done_counts.get("filesMatched")) or 0,
            "doneMatches": _int(done_counts.get("matchesFound")) or 0,
        }
    done_files = _int(done_counts.get("filesMatched")) or 0
    done_matches = _int(done_counts.get("matchesFound")) or 0
    missing_files = max(0, done_files - received_files)
    missing_matches = max(0, done_matches - received_matches)
    extra_files = max(0, received_files - done_files)
    extra_matches = max(0, received_matches - done_matches)
    complete = missing_files == 0 and missing_matches == 0 and extra_files == 0 and extra_matches == 0
    return {
        "complete": complete,
        "reason": "complete" if complete else "resultFrameTotalsDifferFromDone",
        "missingFiles": missing_files,
        "missingMatches": missing_matches,
        "extraFiles": extra_files,
        "extraMatches": extra_matches,
        "receivedFiles": received_files,
        "receivedMatches": received_matches,
        "doneFiles": done_files,
        "doneMatches": done_matches,
    }


def _decorate_case_result(result: JsonObject) -> JsonObject:
    lane = _string(result.get("lane"))
    if lane == "rustOnly":
        rust = _object(result.get("rust"))
        rates = _rates_for_counts(
            duration_ms=_int(rust.get("durationMs")) or 0,
            files_scanned=_int(rust.get("filesScanned")) or 0,
            files_matched=_int(rust.get("filesMatched")) or 0,
            matches_found=_int(rust.get("matchesFound")) or 0,
            result_batches=_int(rust.get("resultBatches")) or 0,
        )
        rust["rates"] = rates
        result["rust"] = rust
        result["rates"] = rates
        return result

    if lane == "fullStack":
        frontend = _object(result.get("frontend"))
        authoritative = _object(frontend.get("authoritative"))
        rates = _rates_for_counts(
            duration_ms=_int(frontend.get("totalRunMs")) or 0,
            files_scanned=_int(authoritative.get("filesScanned")) or 0,
            files_matched=_int(authoritative.get("filesMatched")) or 0,
            matches_found=_int(authoritative.get("matchesFound")) or 0,
            result_batches=_int(authoritative.get("resultBatches"))
            or _int(frontend.get("resultFrames"))
            or 0,
        )
        frontend["rates"] = rates
        result["frontend"] = frontend
        result["rates"] = rates
        return result

    python = _object(result.get("python"))
    authoritative = _object(python.get("authoritative"))
    rates = _rates_for_counts(
        duration_ms=_int(python.get("totalRunMs")) or 0,
        files_scanned=_int(authoritative.get("filesScanned")) or 0,
        files_matched=_int(authoritative.get("filesMatched")) or 0,
        matches_found=_int(authoritative.get("matchesFound")) or 0,
        result_batches=_int(authoritative.get("resultBatches")) or _int(python.get("resultBatches")) or 0,
    )
    python["rates"] = rates
    result["python"] = python
    result["rates"] = rates
    return result


def _build_suite_summary(results: list[JsonObject]) -> JsonObject:
    lanes: dict[str, JsonObject] = {}
    for result in results:
        lane = _string(result.get("lane")) or "unknown"
        bucket = lanes.setdefault(
            lane,
            {
                "caseCount": 0,
                "statusCounts": {},
                "durationMs": 0,
                "filesScanned": 0,
                "filesMatched": 0,
                "matchesFound": 0,
                "resultBatches": 0,
            },
        )
        bucket["caseCount"] = (_int(bucket.get("caseCount")) or 0) + 1
        statuses = _object(bucket.get("statusCounts"))
        status = _string(result.get("status")) or "unknown"
        statuses[status] = (_int(statuses.get(status)) or 0) + 1
        bucket["statusCounts"] = statuses

        duration_ms, files_scanned, files_matched, matches_found, result_batches = _case_counts(result)
        bucket["durationMs"] = (_int(bucket.get("durationMs")) or 0) + duration_ms
        bucket["filesScanned"] = (_int(bucket.get("filesScanned")) or 0) + files_scanned
        bucket["filesMatched"] = (_int(bucket.get("filesMatched")) or 0) + files_matched
        bucket["matchesFound"] = (_int(bucket.get("matchesFound")) or 0) + matches_found
        bucket["resultBatches"] = (_int(bucket.get("resultBatches")) or 0) + result_batches

    for bucket in lanes.values():
        bucket["rates"] = _rates_for_counts(
            duration_ms=_int(bucket.get("durationMs")) or 0,
            files_scanned=_int(bucket.get("filesScanned")) or 0,
            files_matched=_int(bucket.get("filesMatched")) or 0,
            matches_found=_int(bucket.get("matchesFound")) or 0,
            result_batches=_int(bucket.get("resultBatches")) or 0,
        )
    return {"lanes": lanes}


def _suite_status(results: list[JsonObject]) -> str:
    statuses = {_string(result.get("status")) for result in results}
    if "error" in statuses:
        return "error"
    if "partial" in statuses:
        return "partial"
    if "incomplete" in statuses:
        return "incomplete"
    return "ok"


def _case_counts(result: JsonObject) -> tuple[int, int, int, int, int]:
    lane = _string(result.get("lane"))
    if lane == "rustOnly":
        rust = _object(result.get("rust"))
        return (
            _int(rust.get("durationMs")) or 0,
            _int(rust.get("filesScanned")) or 0,
            _int(rust.get("filesMatched")) or 0,
            _int(rust.get("matchesFound")) or 0,
            _int(rust.get("resultBatches")) or 0,
        )
    if lane == "fullStack":
        frontend = _object(result.get("frontend"))
        authoritative = _object(frontend.get("authoritative"))
        return (
            _int(frontend.get("totalRunMs")) or 0,
            _int(authoritative.get("filesScanned")) or 0,
            _int(authoritative.get("filesMatched")) or 0,
            _int(authoritative.get("matchesFound")) or 0,
            _int(authoritative.get("resultBatches"))
            or _int(frontend.get("resultFrames"))
            or 0,
        )

    python = _object(result.get("python"))
    authoritative = _object(python.get("authoritative"))
    return (
        _int(python.get("totalRunMs")) or 0,
        _int(authoritative.get("filesScanned")) or 0,
        _int(authoritative.get("filesMatched")) or 0,
        _int(authoritative.get("matchesFound")) or 0,
        _int(authoritative.get("resultBatches")) or _int(python.get("resultBatches")) or 0,
    )


def _rates_for_counts(
    *,
    duration_ms: int,
    files_scanned: int,
    files_matched: int,
    matches_found: int,
    result_batches: int,
) -> JsonObject:
    seconds = duration_ms / 1000 if duration_ms > 0 else 0.0
    return {
        "durationMs": duration_ms,
        "resultsPerSecond": _rate(result_batches, seconds),
        "matchesPerSecond": _rate(matches_found, seconds),
        "filesScannedPerSecond": _rate(files_scanned, seconds),
        "filesMatchedPerSecond": _rate(files_matched, seconds),
    }


def _rate(count: int, seconds: float) -> float:
    if seconds <= 0:
        return 0.0
    return round(count / seconds, 2)


def _case_to_pipe(case: SearchBenchmarkCase) -> JsonObject:
    return {
        "caseId": case["caseId"],
        "query": case["query"],
        "isRegex": case["isRegex"],
        "isCaseSensitive": case["isCaseSensitive"],
        "isWholeWords": case["isWholeWords"],
        "includePatterns": list(case["includePatterns"]),
        "excludePatterns": list(case["excludePatterns"]),
        "useIgnoreFiles": case["useIgnoreFiles"],
    }


def _benchmark_mode(value: object) -> BenchmarkMode:
    if value in (None, "genericSuite"):
        return "genericSuite"
    if value == "oneShot":
        return "oneShot"
    raise ValueError("search benchmark mode must be genericSuite or oneShot")


def _benchmark_lanes(value: object) -> list[BenchmarkLane]:
    if not isinstance(value, list) or not value:
        return list(DEFAULT_LANES)
    lanes: list[BenchmarkLane] = []
    for item in cast(list[object], value):
        if item in {"fullStack", "pythonBridge", "rustOnly"}:
            lanes.append(cast(BenchmarkLane, item))
    if not lanes:
        raise ValueError("search benchmark lanes did not contain a supported lane")
    return lanes


def _benchmark_cases(mode: BenchmarkMode, value: object) -> list[SearchBenchmarkCase]:
    if isinstance(value, list) and value:
        return [_benchmark_case(item, index) for index, item in enumerate(cast(list[object], value))]
    if mode == "oneShot":
        raise ValueError("oneShot search benchmark requires cases")
    return [
        _make_case("raw-import", "import", [], []),
        _make_case("include-py", "import", ["*.py"], []),
        _make_case("exclude-ts", "import", [], ["*.ts"]),
        _make_case("include-under-exclude-ts", "import", ["*_*"], ["*.ts"]),
        _make_case("te2-search-canary", "te2_search_canary", [], []),
    ]


def _benchmark_case(value: object, index: int) -> SearchBenchmarkCase:
    raw = _object(value)
    query = _required_string(raw.get("query"), "search benchmark case query")
    return _make_case(
        _string(raw.get("caseId")) or f"case-{index + 1}",
        query,
        _string_list(raw.get("includePatterns")),
        _string_list(raw.get("excludePatterns")),
        is_regex=_bool(raw.get("isRegex")),
        is_case_sensitive=_bool(raw.get("isCaseSensitive")),
        is_whole_words=_bool(raw.get("isWholeWords")),
        use_ignore_files=_bool(raw.get("useIgnoreFiles"), default=True),
        result_batching=_optional_object(raw.get("resultBatching")),
    )


def _make_case(
    case_id: str,
    query: str,
    include_patterns: list[str],
    exclude_patterns: list[str],
    *,
    is_regex: bool = False,
    is_case_sensitive: bool = False,
    is_whole_words: bool = False,
    use_ignore_files: bool = True,
    result_batching: JsonObject | None = None,
) -> SearchBenchmarkCase:
    return {
        "caseId": case_id,
        "query": query,
        "isRegex": is_regex,
        "isCaseSensitive": is_case_sensitive,
        "isWholeWords": is_whole_words,
        "includePatterns": include_patterns,
        "excludePatterns": exclude_patterns,
        "useIgnoreFiles": use_ignore_files,
        "resultBatching": result_batching,
    }


def _resolve_output_path(root: Path, suite_id: str, requested: str | None) -> Path:
    if requested:
        path = Path(requested).expanduser()
    else:
        tempdir = os.environ.get("TEMPDIR")
        base = Path(tempdir).expanduser() if tempdir else root / ".te2-search-benchmarks"
        path = base / f"te2-search-benchmark-{suite_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, payload: JsonObject) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _ensure_project_generation(root: Path) -> int:
    generation = current_project_generation(root)
    if generation is not None:
        return generation
    return next_project_generation(root)


def _elapsed_ms(started_at: float) -> int:
    return int((time.perf_counter() - started_at) * 1000)


def _epoch_ms() -> int:
    return int(time.time() * 1000)


def _object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _optional_object(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _json_object_list(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    result: list[JsonObject] = []
    for item in cast(list[object], value):
        if isinstance(item, dict):
            result.append(_object(cast(object, item)))
    return result


def _string(value: object) -> str:
    return value if isinstance(value, str) else ""


def _optional_string(value: object) -> str | None:
    text = _string(value).strip()
    return text or None


def _required_string(value: object, label: str) -> str:
    text = _string(value).strip()
    if not text:
        raise ValueError(f"{label} must be a non-empty string")
    return text


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str) and item]


def _bool(value: object, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None
