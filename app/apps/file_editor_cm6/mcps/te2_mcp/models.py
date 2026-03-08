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


class FrameworkShellsConfig(BaseModel):
    base_url: str = "http://127.0.0.1:0"
    enabled: bool = False


class Te2McpStatus(BaseModel):
    server: str = "te2-mcp"
    console_log_path: str
    framework_shells_enabled: bool
