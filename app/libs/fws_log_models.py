"""Portable log-analysis DTOs, independent of Pydantic/FastMCP."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import cast
import msgspec

class Projection:
    def model_dump(self, *, mode: str = "json") -> dict[str, object]:
        del mode
        return cast(dict[str, object], msgspec.to_builtins(self))

@dataclass(kw_only=True)
class FwsLogStreamMeta(Projection):
    stream: str
    path: str = ""
    size: int = 0
    mtime: float | None = None
    age_seconds: float | None = None
    byte_window_start: int | None = None
    byte_window_end: int | None = None
    partial_head: bool = False
    truncated: bool = False
    event_count: int = 0

@dataclass(kw_only=True)
class FwsLogInspectFragment(Projection):
    format: str
    start: int = 0
    end: int = 0
    summary: str = ""
    parsed: object = None
    kinds: list[str] = field(default_factory=list)
    signature: str | None = None

@dataclass(kw_only=True)
class FwsLogInspectRecord(Projection):
    stream: str
    ordinal: int
    line_number: int | None = None
    prefix: str | None = None
    raw_length: int = 0
    text: str = ""
    body: str = ""
    text_truncated: bool = False
    byte_start: int | None = None
    byte_end: int | None = None
    partial_head: bool = False
    partial_tail: bool = False
    formats_detected: list[str] = field(default_factory=list)
    kinds: list[str] = field(default_factory=list)
    event_signature: str | None = None
    fragments: list[FwsLogInspectFragment] = field(default_factory=list)
    json_payloads: list[object] = field(default_factory=list)

@dataclass(kw_only=True)
class FwsLogInspectSummary(Projection):
    mode: str
    query: str | None = None
    format: str | None = None
    signature: str | None = None
    exclude_query: str | None = None
    exclude_signature: str | None = None
    total_records: int = 0
    stream_counts: dict[str, int] = field(default_factory=dict)
    format_counts: dict[str, int] = field(default_factory=dict)
    kind_counts: dict[str, int] = field(default_factory=dict)
    signature_counts: dict[str, int] = field(default_factory=dict)
    prefix_counts: dict[str, int] = field(default_factory=dict)
    top_signatures: list[dict[str, object]] = field(default_factory=list)

@dataclass(kw_only=True)
class FwsLogInspectResult(Projection):
    shell_id: str
    mode: str
    summary: FwsLogInspectSummary
    status: str = ""
    query: str | None = None
    format: str | None = None
    signature: str | None = None
    exclude_query: str | None = None
    exclude_signature: str | None = None
    records: list[FwsLogInspectRecord] = field(default_factory=list)
    total_returned: int = 0
    stream_meta: list[FwsLogStreamMeta] = field(default_factory=list)
    io_metadata: list[dict[str, object]] = field(default_factory=list)
