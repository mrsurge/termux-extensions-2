from __future__ import annotations

import json
import re
from typing import Any

from .models import FwsLogInspectRecord, FwsLogInspectResult, FwsLogInspectSummary, FwsLogStreamMeta

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_BRACKET_PREFIX_RE = re.compile(r"^\[(?P<prefix>[^\]]+)\]\s*(?P<body>.*)$")
_HTTP_RE = re.compile(r"(?:^|[\s\"])(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP/\d(?:\.\d)?")
_URL_RE = re.compile(r"https?://[^\s\"'<>]+")
_KV_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_.:-]*)=(?:\"([^\"]*)\"|'([^']*)'|([^\s]+))")

_DEFAULT_TEXT_LIMIT = 1200
_DEFAULT_JSON_LIMIT = 2000
_MAX_JSON_FRAGMENTS = 4


def build_inspect_result(
    *,
    shell_id: str,
    status: str,
    payload: dict[str, Any],
    mode: str,
    query: str | None,
    text_limit: int = _DEFAULT_TEXT_LIMIT,
    json_limit: int = _DEFAULT_JSON_LIMIT,
) -> FwsLogInspectResult:
    records: list[FwsLogInspectRecord] = []
    stream_meta: list[FwsLogStreamMeta] = []
    ordinal = 0

    for stream_name in ("stdout", "stderr"):
        stream_payload = payload.get(stream_name)
        if not isinstance(stream_payload, dict):
            continue

        stream_meta.append(
            FwsLogStreamMeta(
                stream=stream_name,
                path=str(stream_payload.get("path") or ""),
                size=_coerce_int(stream_payload.get("size")),
                mtime=_coerce_float(stream_payload.get("mtime")),
                age_seconds=_coerce_float(stream_payload.get("age_seconds")),
            )
        )

        source_items = stream_payload.get("matches") if mode == "search" else stream_payload.get("lines")
        if not isinstance(source_items, list):
            continue

        for item in source_items:
            if mode == "search" and isinstance(item, dict):
                line_text = str(item.get("text") or "")
                line_number = _coerce_optional_int(item.get("line_number"))
            else:
                line_text = str(item)
                line_number = None
            ordinal += 1
            records.append(
                _analyze_line(
                    line_text=line_text,
                    stream=stream_name,
                    ordinal=ordinal,
                    line_number=line_number,
                    text_limit=text_limit,
                    json_limit=json_limit,
                )
            )

    summary = _build_summary(mode=mode, query=query, records=records)
    return FwsLogInspectResult(
        shell_id=shell_id,
        status=status,
        mode=mode,
        query=query,
        records=records,
        total_returned=len(records),
        summary=summary,
        stream_meta=stream_meta,
    )


def _analyze_line(
    *,
    line_text: str,
    stream: str,
    ordinal: int,
    line_number: int | None,
    text_limit: int,
    json_limit: int,
) -> FwsLogInspectRecord:
    raw_text = line_text.rstrip("\n")
    text_no_ansi = _ANSI_RE.sub("", raw_text)

    prefix: str | None = None
    body = text_no_ansi
    prefix_match = _BRACKET_PREFIX_RE.match(text_no_ansi)
    if prefix_match:
        prefix = prefix_match.group("prefix").strip() or None
        body = prefix_match.group("body")

    urls = list(dict.fromkeys(_URL_RE.findall(text_no_ansi)))
    key_values = _extract_key_values(text_no_ansi, text_limit=text_limit)
    json_payloads = _extract_json_payloads(text_no_ansi, body, json_limit=json_limit)
    kinds = _classify_line(
        raw_text=raw_text,
        prefix=prefix,
        body=body,
        urls=urls,
        key_values=key_values,
        json_payloads=json_payloads,
        text_limit=text_limit,
    )

    clipped_text, text_truncated = _clip_text(text_no_ansi, text_limit)
    clipped_body, body_truncated = _clip_text(body, text_limit)

    return FwsLogInspectRecord(
        stream=stream,
        ordinal=ordinal,
        line_number=line_number,
        prefix=prefix,
        raw_length=len(raw_text),
        text=clipped_text,
        body=clipped_body,
        text_truncated=text_truncated or body_truncated,
        kinds=kinds,
        urls=urls,
        key_values=key_values,
        json_payloads=json_payloads,
    )


def _extract_key_values(text: str, *, text_limit: int) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for key, quoted, single_quoted, bare in _KV_RE.findall(text):
        value = quoted or single_quoted or bare
        clipped, _ = _clip_text(value, text_limit // 2)
        pairs[key] = clipped
        if len(pairs) >= 20:
            break
    return pairs


def _extract_json_payloads(text: str, body: str, *, json_limit: int) -> list[Any]:
    seen: set[str] = set()
    payloads: list[Any] = []

    for candidate in (body.strip(), text.strip()):
        parsed = _try_parse_json(candidate)
        if parsed is not None:
            _append_unique_payload(payloads, seen, parsed, json_limit=json_limit)
            if payloads:
                return payloads

    for fragment in _find_json_fragments(text):
        parsed = _try_parse_json(fragment)
        if parsed is not None:
            _append_unique_payload(payloads, seen, parsed, json_limit=json_limit)
        if len(payloads) >= _MAX_JSON_FRAGMENTS:
            break
    return payloads


def _find_json_fragments(text: str) -> list[str]:
    fragments: list[str] = []
    for idx, ch in enumerate(text):
        if ch not in "{[":
            continue
        fragment = _balanced_fragment(text, idx)
        if fragment:
            fragments.append(fragment)
        if len(fragments) >= _MAX_JSON_FRAGMENTS:
            break
    return fragments


def _balanced_fragment(text: str, start: int) -> str | None:
    stack: list[str] = []
    in_string = False
    escaping = False

    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escaping:
                escaping = False
            elif ch == "\\":
                escaping = True
            elif ch == "\"":
                in_string = False
            continue

        if ch == "\"":
            in_string = True
            continue
        if ch == "{":
            stack.append("}")
            continue
        if ch == "[":
            stack.append("]")
            continue
        if ch in "}]":
            if not stack or ch != stack[-1]:
                return None
            stack.pop()
            if not stack:
                return text[start : idx + 1]
    return None


def _append_unique_payload(payloads: list[Any], seen: set[str], payload: Any, *, json_limit: int) -> None:
    sanitized = _sanitize_value(payload, json_limit=json_limit)
    try:
        fingerprint = json.dumps(sanitized, sort_keys=True, default=str)
    except TypeError:
        fingerprint = repr(sanitized)
    if fingerprint in seen:
        return
    seen.add(fingerprint)
    payloads.append(sanitized)


def _sanitize_value(value: Any, *, json_limit: int) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        clipped, _ = _clip_text(value, json_limit)
        return clipped
    if isinstance(value, list):
        return [_sanitize_value(item, json_limit=json_limit) for item in value[:100]]
    if isinstance(value, dict):
        return {
            str(key): _sanitize_value(item, json_limit=json_limit)
            for key, item in list(value.items())[:100]
        }
    return repr(value)


def _classify_line(
    *,
    raw_text: str,
    prefix: str | None,
    body: str,
    urls: list[str],
    key_values: dict[str, str],
    json_payloads: list[Any],
    text_limit: int,
) -> list[str]:
    kinds: set[str] = set()
    lower_prefix = (prefix or "").lower()
    lower_text = raw_text.lower()

    if prefix:
        kinds.add("prefixed")
    if _ANSI_RE.search(raw_text):
        kinds.add("ansi")
    if len(raw_text) > text_limit:
        kinds.add("long")
    if urls:
        kinds.add("url")
    if key_values:
        kinds.add("key_value")
    if json_payloads:
        kinds.add("json")
        if any(isinstance(item, dict) for item in json_payloads):
            kinds.add("json_object")
        if any(isinstance(item, list) for item in json_payloads):
            kinds.add("json_array")
    if "rpc in" in lower_prefix or "rpc out" in lower_prefix or any(_looks_like_rpc(item) for item in json_payloads):
        kinds.add("rpc")
    if _HTTP_RE.search(raw_text) or "http/" in lower_text:
        kinds.add("http")
    if lower_text.startswith("traceback") or lower_text.startswith("error:") or "exception in asgi application" in lower_text:
        kinds.add("traceback")
    if not kinds and body.strip():
        kinds.add("plain")
    return sorted(kinds)


def _looks_like_rpc(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    keys = set(value.keys())
    return bool({"id", "method", "params"} & keys) or bool({"id", "result"} & keys) or "error" in keys


def _build_summary(*, mode: str, query: str | None, records: list[FwsLogInspectRecord]) -> FwsLogInspectSummary:
    kind_counts: dict[str, int] = {}
    prefix_counts: dict[str, int] = {}
    stream_counts: dict[str, int] = {}

    for record in records:
        stream_counts[record.stream] = stream_counts.get(record.stream, 0) + 1
        if record.prefix:
            prefix_counts[record.prefix] = prefix_counts.get(record.prefix, 0) + 1
        for kind in record.kinds:
            kind_counts[kind] = kind_counts.get(kind, 0) + 1

    return FwsLogInspectSummary(
        mode=mode,
        query=query,
        total_records=len(records),
        stream_counts=dict(sorted(stream_counts.items())),
        kind_counts=dict(sorted(kind_counts.items())),
        prefix_counts=dict(sorted(prefix_counts.items())),
    )


def _try_parse_json(text: str) -> Any | None:
    if not text:
        return None
    if text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _clip_text(text: str, limit: int) -> tuple[str, bool]:
    if limit <= 0 or len(text) <= limit:
        return text, False
    return f"{text[:limit]}... <{len(text) - limit} more chars>", True


def _coerce_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _coerce_optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except Exception:
        return None
