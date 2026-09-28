"""Replaceable byte I/O and JSON codec; stores own schema, locks and recovery.

Atomic replacement is not a transaction or a durability guarantee. Callers keep
their existing locking and parent-directory policy; no cache is maintained here.
"""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
from typing import cast

JsonDecodeError = json.JSONDecodeError


def read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def decode_utf8(payload: bytes) -> str:
    # Match Path.read_text's UTF-8/universal-newline behavior, including strict
    # decoding and no implicit BOM stripping.
    return payload.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def decode_json(text: str) -> object:
    return cast(object, json.loads(text))


def encode_json(
    value: object,
    *,
    ensure_ascii: bool = True,
    indent: int | None = None,
    trailing_newline: bool = False,
) -> bytes:
    text = json.dumps(value, ensure_ascii=ensure_ascii, indent=indent)
    return (text + ("\n" if trailing_newline else "")).encode("utf-8")


def write_bytes_atomic(
    path: Path,
    payload: bytes,
    *,
    temporary_path: Path | None = None,
    temporary_prefix: str | None = None,
    temporary_suffix: str = "",
) -> None:
    """Replace a file using its store's fixed or unique sibling temporary file.

    Fixed paths retain ordinary creation permissions; unique paths retain
    NamedTemporaryFile's private permissions. No fsync or directory creation is
    added. Store-level locking must cover the complete read/modify/write cycle.
    """
    temporary = temporary_path
    try:
        if temporary is None:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=path.parent,
                prefix=temporary_prefix or path.name + ".",
                suffix=temporary_suffix, delete=False,
            ) as stream:
                temporary = Path(stream.name)
                _ = stream.write(payload)
        else:
            _ = temporary.write_bytes(payload)
        _ = temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
