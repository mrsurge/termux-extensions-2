"""Terminal request shapes shared by HTTP and binary lifecycle admission."""
from __future__ import annotations

from typing import TypeVar

import msgspec


class CreateShellRequest(msgspec.Struct, kw_only=True):
    shell: str | list[str] | None = None
    cwd: str = "~"
    cols: int = 80
    rows: int = 24
    launch_id: str = ""


class ShellInputRequest(msgspec.Struct, kw_only=True):
    data: str
    newline: bool = True


class ShellResizeRequest(msgspec.Struct, kw_only=True):
    cols: int = 80
    rows: int = 24


class ShellActionRequest(msgspec.Struct, kw_only=True):
    action: str


RequestT = TypeVar("RequestT", bound=msgspec.Struct)


def decode_request(value: object, shape: type[RequestT]) -> RequestT:
    # Retain JSON form numeric/bool coercion and ignored extra fields without
    # introspection/schema generation. Invalid remote values never reach domain
    # mutation handlers. The binary lane validates through this same boundary.
    return msgspec.convert(value, type=shape, strict=False)
