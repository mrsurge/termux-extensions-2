from __future__ import annotations

from fnmatch import fnmatchcase
import json
import re
from typing import Any

from .models import (
    FwsLogInspectFragment,
    FwsLogInspectRecord,
    FwsLogInspectResult,
    FwsLogInspectSummary,
    FwsLogStreamMeta,
)

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_BRACKET_PREFIX_RE = re.compile(r"^\[(?P<prefix>[^\]]+)\]\s*(?P<body>.*)$")
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
    format_filter: str | None = None,
    signature_filter: str | None = None,
    regex: bool = False,
    ignore_case: bool = False,
    exclude_query: str | None = None,
    exclude_signature: str | None = None,
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

        meta = FwsLogStreamMeta(
            stream=stream_name,
            path=str(stream_payload.get("path") or ""),
            size=_coerce_int(stream_payload.get("size")),
            mtime=_coerce_float(stream_payload.get("mtime")),
            age_seconds=_coerce_float(stream_payload.get("age_seconds")),
            byte_window_start=_coerce_optional_int(stream_payload.get("byte_window_start")),
            byte_window_end=_coerce_optional_int(stream_payload.get("byte_window_end")),
            partial_head=bool(stream_payload.get("partial_head")),
            truncated=bool(stream_payload.get("truncated")),
            event_count=_coerce_int(stream_payload.get("event_count")),
        )
        stream_meta.append(meta)

        inspected_items = stream_payload.get("records")
        if isinstance(inspected_items, list):
            for item in inspected_items:
                if not isinstance(item, dict):
                    continue
                ordinal += 1
                records.append(
                    _analyze_inspected_record(
                        raw_record=item,
                        stream=stream_name,
                        ordinal=ordinal,
                        text_limit=text_limit,
                        json_limit=json_limit,
                    )
                )
            continue

        source_items = stream_payload.get("matches") if mode == "search" else stream_payload.get("lines")
        if not isinstance(source_items, list):
            continue

        for index, item in enumerate(source_items):
            if mode == "search" and isinstance(item, dict):
                line_text = str(item.get("text") or "")
                line_number = _coerce_optional_int(item.get("line_number"))
            else:
                line_text = str(item)
                line_number = None

            record = _analyze_line(
                line_text=line_text,
                stream=stream_name,
                ordinal=0,
                line_number=line_number,
                text_limit=text_limit,
                json_limit=json_limit,
            )
            if not _record_matches(
                record,
                raw_text=line_text,
                format_filter=format_filter,
                signature_filter=signature_filter,
                regex=regex,
                ignore_case=ignore_case,
                exclude_query=exclude_query,
                exclude_signature=exclude_signature,
            ):
                continue
            ordinal += 1
            if not meta.event_count:
                meta.event_count += 1
            record.ordinal = ordinal
            if mode == "tail" and index == 0 and meta.partial_head:
                record.partial_head = True
            records.append(record)

    summary = _build_summary(
        mode=mode,
        query=query,
        format_filter=format_filter,
        signature_filter=signature_filter,
        exclude_query=exclude_query,
        exclude_signature=exclude_signature,
        records=records,
    )
    return FwsLogInspectResult(
        shell_id=shell_id,
        status=status,
        mode=mode,
        query=query,
        format=format_filter,
        signature=signature_filter,
        exclude_query=exclude_query,
        exclude_signature=exclude_signature,
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

    fragments = _extract_fragments(text_no_ansi, json_limit=json_limit)
    formats_detected = _collect_formats_detected(fragments)
    kinds = _collect_kinds(fragments)
    event_signature = _select_event_signature(fragments)
    json_payloads = [fragment.parsed for fragment in fragments if fragment.format in {"json", "jsonrpc"}]
    plain_signature = _plain_signature(prefix)

    if not formats_detected:
        formats_detected = ["plain"]
    if not kinds:
        kinds = [plain_signature] if plain_signature else ["plain"]
    if event_signature is None:
        event_signature = plain_signature or "plain"

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
        byte_start=None,
        byte_end=None,
        partial_head=False,
        partial_tail=False,
        formats_detected=formats_detected,
        kinds=kinds,
        event_signature=event_signature,
        fragments=fragments,
        json_payloads=json_payloads,
    )


def _analyze_inspected_record(
    *,
    raw_record: dict[str, Any],
    stream: str,
    ordinal: int,
    text_limit: int,
    json_limit: int,
) -> FwsLogInspectRecord:
    raw_text = str(raw_record.get("text") or "").rstrip("\n")
    text_no_ansi = _ANSI_RE.sub("", raw_text)

    prefix = str(raw_record.get("prefix") or "").strip() or None
    body = text_no_ansi
    if prefix:
        prefix_match = _BRACKET_PREFIX_RE.match(text_no_ansi)
        if prefix_match:
            body = prefix_match.group("body")
    else:
        prefix_match = _BRACKET_PREFIX_RE.match(text_no_ansi)
        if prefix_match:
            prefix = prefix_match.group("prefix").strip() or None
            body = prefix_match.group("body")

    fragments = _extract_fragments(text_no_ansi, json_limit=json_limit)
    formats_detected = _coerce_string_list(raw_record.get("formats_detected"))
    if not formats_detected:
        formats_detected = _collect_formats_detected(fragments)
    kinds = _coerce_string_list(raw_record.get("kinds"))
    if not kinds:
        kinds = _collect_kinds(fragments)
    event_signature = str(raw_record.get("event_signature") or "").strip() or _select_event_signature(fragments)
    json_payloads = [fragment.parsed for fragment in fragments if fragment.format in {"json", "jsonrpc"}]
    if not json_payloads:
        json_payloads = _sanitize_list(raw_record.get("json_payloads"), json_limit=json_limit)
    plain_signature = _plain_signature(prefix)

    if not formats_detected:
        formats_detected = ["plain"]
    if not kinds:
        kinds = [plain_signature] if plain_signature else ["plain"]
    if not event_signature:
        event_signature = plain_signature or "plain"

    clipped_text, text_truncated = _clip_text(text_no_ansi, text_limit)
    clipped_body, body_truncated = _clip_text(body, text_limit)

    return FwsLogInspectRecord(
        stream=stream,
        ordinal=ordinal,
        line_number=_coerce_optional_int(raw_record.get("line_number")),
        prefix=prefix,
        raw_length=_coerce_int(raw_record.get("raw_length")) or len(raw_text),
        text=clipped_text,
        body=clipped_body,
        text_truncated=text_truncated or body_truncated or bool(raw_record.get("text_truncated")),
        byte_start=_coerce_optional_int(raw_record.get("byte_start")),
        byte_end=_coerce_optional_int(raw_record.get("byte_end")),
        partial_head=bool(raw_record.get("partial_head")),
        partial_tail=bool(raw_record.get("partial_tail")),
        formats_detected=formats_detected,
        kinds=kinds,
        event_signature=event_signature,
        fragments=fragments,
        json_payloads=json_payloads,
    )


def _extract_fragments(text: str, *, json_limit: int) -> list[FwsLogInspectFragment]:
    fragments: list[FwsLogInspectFragment] = []
    seen_spans: set[tuple[int, int]] = set()

    for start, raw_fragment in _find_json_fragments(text):
        parsed = _try_parse_json(raw_fragment)
        if parsed is None:
            continue
        end = start + len(raw_fragment)
        if (start, end) in seen_spans:
            continue
        seen_spans.add((start, end))
        fragments.append(
            _build_fragment(
                parsed=parsed,
                start=start,
                end=end,
                json_limit=json_limit,
            )
        )
        if len(fragments) >= _MAX_JSON_FRAGMENTS:
            break

    return fragments


def _build_fragment(*, parsed: Any, start: int, end: int, json_limit: int) -> FwsLogInspectFragment:
    sanitized = _sanitize_value(parsed, json_limit=json_limit)
    if _looks_like_jsonrpc(parsed):
        kind = _jsonrpc_kind(parsed)
        signature = _jsonrpc_signature(parsed, kind)
        kinds = [f"jsonrpc:{kind}"] if kind else ["jsonrpc"]
        summary = _jsonrpc_summary(parsed, kind)
        return FwsLogInspectFragment(
            format="jsonrpc",
            start=start,
            end=end,
            summary=summary,
            parsed=sanitized,
            kinds=kinds,
            signature=signature,
        )

    return FwsLogInspectFragment(
        format="json",
        start=start,
        end=end,
        summary=_json_summary(parsed),
        parsed=sanitized,
        kinds=["json"],
        signature="json",
    )


def _find_json_fragments(text: str) -> list[tuple[int, str]]:
    fragments: list[tuple[int, str]] = []
    for idx, ch in enumerate(text):
        if ch not in "[{":
            continue
        fragment = _balanced_fragment(text, idx)
        if fragment:
            fragments.append((idx, fragment))
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
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
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


def _record_matches(
    record: FwsLogInspectRecord,
    *,
    raw_text: str,
    format_filter: str | None,
    signature_filter: str | None,
    regex: bool,
    ignore_case: bool,
    exclude_query: str | None,
    exclude_signature: str | None,
) -> bool:
    normalized_format = _normalize_filter(format_filter)
    if normalized_format and normalized_format not in {item.lower() for item in record.formats_detected}:
        return False

    normalized_signature = (signature_filter or "").strip()
    if normalized_signature:
        signature = record.event_signature or ""
        if not signature:
            return False
        if "*" in normalized_signature:
            if not fnmatchcase(signature, normalized_signature):
                return False
        elif signature != normalized_signature:
            return False

    normalized_exclude_signature = (exclude_signature or "").strip()
    if normalized_exclude_signature:
        signature = record.event_signature or ""
        if signature:
            if "*" in normalized_exclude_signature:
                if fnmatchcase(signature, normalized_exclude_signature):
                    return False
            elif signature == normalized_exclude_signature:
                return False

    if _text_matches_query(raw_text, exclude_query, regex=regex, ignore_case=ignore_case):
        return False
    return True


def _collect_formats_detected(fragments: list[FwsLogInspectFragment]) -> list[str]:
    formats: set[str] = set()
    for fragment in fragments:
        if fragment.format == "jsonrpc":
            formats.add("json")
            formats.add("jsonrpc")
        else:
            formats.add(fragment.format)
    return sorted(formats)


def _collect_kinds(fragments: list[FwsLogInspectFragment]) -> list[str]:
    kinds: set[str] = set()
    for fragment in fragments:
        for kind in fragment.kinds:
            kinds.add(kind)
    return sorted(kinds)


def _select_event_signature(fragments: list[FwsLogInspectFragment]) -> str | None:
    for fragment in fragments:
        if fragment.format == "jsonrpc" and fragment.signature:
            return fragment.signature
    for fragment in fragments:
        if fragment.signature:
            return fragment.signature
    return None


def _build_summary(
    *,
    mode: str,
    query: str | None,
    format_filter: str | None,
    signature_filter: str | None,
    exclude_query: str | None,
    exclude_signature: str | None,
    records: list[FwsLogInspectRecord],
) -> FwsLogInspectSummary:
    kind_counts: dict[str, int] = {}
    prefix_counts: dict[str, int] = {}
    stream_counts: dict[str, int] = {}
    format_counts: dict[str, int] = {}
    signature_counts: dict[str, int] = {}

    for record in records:
        stream_counts[record.stream] = stream_counts.get(record.stream, 0) + 1
        if record.prefix:
            prefix_counts[record.prefix] = prefix_counts.get(record.prefix, 0) + 1
        for fmt in record.formats_detected:
            format_counts[fmt] = format_counts.get(fmt, 0) + 1
        for kind in record.kinds:
            kind_counts[kind] = kind_counts.get(kind, 0) + 1
        if record.event_signature:
            signature_counts[record.event_signature] = signature_counts.get(record.event_signature, 0) + 1

    top_signatures = sorted(signature_counts.items(), key=lambda item: (-item[1], item[0]))

    return FwsLogInspectSummary(
        mode=mode,
        query=query,
        format=format_filter,
        signature=signature_filter,
        exclude_query=exclude_query,
        exclude_signature=exclude_signature,
        total_records=len(records),
        stream_counts=dict(sorted(stream_counts.items())),
        format_counts=dict(sorted(format_counts.items())),
        kind_counts=dict(sorted(kind_counts.items())),
        signature_counts=dict(sorted(signature_counts.items())),
        prefix_counts=dict(sorted(prefix_counts.items())),
        top_signatures=[
            {"signature": signature, "count": count}
            for signature, count in top_signatures[:10]
        ],
    )


def _plain_signature(prefix: str | None) -> str | None:
    normalized = _normalize_prefix(prefix)
    if not normalized:
        return None
    return f"plain:{normalized}"


def _normalize_prefix(prefix: str | None) -> str:
    if not prefix:
        return ""
    text = prefix.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _text_matches_query(
    text: str,
    query: str | None,
    *,
    regex: bool,
    ignore_case: bool,
) -> bool:
    normalized_query = str(query or "")
    if not normalized_query:
        return False
    if regex:
        flags = re.IGNORECASE if ignore_case else 0
        return bool(re.search(normalized_query, text, flags))
    haystack = text.lower() if ignore_case else text
    needle = normalized_query.lower() if ignore_case else normalized_query
    return needle in haystack


def _looks_like_jsonrpc(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    keys = set(value.keys())
    if "jsonrpc" in keys:
        return True
    if "method" in keys and ("params" in keys or "id" in keys):
        return True
    if "error" in keys or "result" in keys:
        return "id" in keys
    return False


def _jsonrpc_kind(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    has_method = "method" in value
    has_id = "id" in value
    has_error = "error" in value
    has_result = "result" in value

    if has_error:
        return "error"
    if has_method and has_id:
        return "request"
    if has_method and not has_id:
        return "notification"
    if has_result and has_id:
        return "response"
    return None


def _jsonrpc_signature(value: Any, kind: str | None) -> str:
    if kind in {"request", "notification"} and isinstance(value, dict):
        method = str(value.get("method") or "").strip()
        if method:
            return f"jsonrpc:method={method}"
        return f"jsonrpc:{kind}"
    if kind == "error":
        return "jsonrpc:error"
    if kind == "response":
        return "jsonrpc:result"
    return "jsonrpc"


def _jsonrpc_summary(value: Any, kind: str | None) -> str:
    if not isinstance(value, dict):
        return "jsonrpc fragment"
    if kind in {"request", "notification"}:
        method = str(value.get("method") or "").strip()
        if method:
            return f"jsonrpc {kind} method={method}"
        return f"jsonrpc {kind}"
    if kind == "error":
        error_obj = value.get("error")
        if isinstance(error_obj, dict) and "code" in error_obj:
            return f"jsonrpc error code={error_obj.get('code')}"
        return "jsonrpc error"
    if kind == "response":
        return "jsonrpc result"
    return "jsonrpc fragment"


def _json_summary(value: Any) -> str:
    if isinstance(value, dict):
        keys = [str(key) for key in list(value.keys())[:5]]
        return f"json object keys={','.join(keys)}" if keys else "json object"
    if isinstance(value, list):
        return f"json array len={len(value)}"
    return "json fragment"


def _try_parse_json(text: str) -> Any | None:
    if not text:
        return None
    if text[0] not in "[{":
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


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


def _clip_text(text: str, limit: int) -> tuple[str, bool]:
    if limit <= 0 or len(text) <= limit:
        return text, False
    return f"{text[:limit]}... <{len(text) - limit} more chars>", True


def _normalize_filter(value: str | None) -> str:
    return str(value or "").strip().lower()


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


def _coerce_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            result.append(text)
    return result


def _sanitize_list(value: Any, *, json_limit: int) -> list[Any]:
    if not isinstance(value, list):
        return []
    return [_sanitize_value(item, json_limit=json_limit) for item in value]
