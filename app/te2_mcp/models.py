from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ConsoleLogEntry(BaseModel):
    workerId: str = Field(default="")
    level: str = Field(default="log")
    ts: Optional[int] = Field(default=None)
    args: list[Any] = Field(default_factory=list)


class ConsoleTailResult(BaseModel):
    entries: list[ConsoleLogEntry] = Field(default_factory=list)
    total_returned: int = 0
    log_path: str


class ConsoleSearchResult(BaseModel):
    query: str
    entries: list[ConsoleLogEntry] = Field(default_factory=list)
    total_returned: int = 0
    log_path: str


class FwsLogStreamMeta(BaseModel):
    stream: str
    path: str = ""
    size: int = 0
    mtime: Optional[float] = None
    age_seconds: Optional[float] = None
    byte_window_start: Optional[int] = None
    byte_window_end: Optional[int] = None
    partial_head: bool = False
    truncated: bool = False
    event_count: int = 0


class FwsLogInspectFragment(BaseModel):
    format: str
    start: int = 0
    end: int = 0
    summary: str = ""
    parsed: Any = None
    kinds: list[str] = Field(default_factory=list)
    signature: Optional[str] = None


class FwsLogInspectRecord(BaseModel):
    stream: str
    ordinal: int
    line_number: Optional[int] = None
    prefix: Optional[str] = None
    raw_length: int = 0
    text: str = ""
    body: str = ""
    text_truncated: bool = False
    byte_start: Optional[int] = None
    byte_end: Optional[int] = None
    partial_head: bool = False
    partial_tail: bool = False
    formats_detected: list[str] = Field(default_factory=list)
    kinds: list[str] = Field(default_factory=list)
    event_signature: Optional[str] = None
    fragments: list[FwsLogInspectFragment] = Field(default_factory=list)
    json_payloads: list[Any] = Field(default_factory=list)


class FwsLogInspectSummary(BaseModel):
    mode: str
    query: Optional[str] = None
    format: Optional[str] = None
    signature: Optional[str] = None
    exclude_query: Optional[str] = None
    exclude_signature: Optional[str] = None
    total_records: int = 0
    stream_counts: dict[str, int] = Field(default_factory=dict)
    format_counts: dict[str, int] = Field(default_factory=dict)
    kind_counts: dict[str, int] = Field(default_factory=dict)
    signature_counts: dict[str, int] = Field(default_factory=dict)
    prefix_counts: dict[str, int] = Field(default_factory=dict)
    top_signatures: list[dict[str, Any]] = Field(default_factory=list)


class FwsLogInspectResult(BaseModel):
    shell_id: str
    status: str = ""
    mode: str
    query: Optional[str] = None
    format: Optional[str] = None
    signature: Optional[str] = None
    exclude_query: Optional[str] = None
    exclude_signature: Optional[str] = None
    records: list[FwsLogInspectRecord] = Field(default_factory=list)
    total_returned: int = 0
    summary: FwsLogInspectSummary
    stream_meta: list[FwsLogStreamMeta] = Field(default_factory=list)
    io_metadata: list[dict[str, Any]] = Field(default_factory=list)


class FrameworkShellsConfig(BaseModel):
    base_url: str = "http://127.0.0.1:0"
    enabled: bool = False


class Te2McpStatus(BaseModel):
    server: str = "te2-mcp"
    console_log_path: str
    framework_shells_enabled: bool
