# pyright: strict
from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import NotRequired, TypedDict

from .document_open_policy import validate_editor_document


class MaterializedDocumentPayload(TypedDict):
    content: str
    state: str
    unsaved: bool
    has_draft: bool
    reason: str
    base_sha256: NotRequired[str]
    content_sha256: NotRequired[str]


def materialize_document_payload(
    abs_path: str,
    cached_document: Mapping[str, object] | None,
    *,
    strict_disk_errors: bool = False,
) -> MaterializedDocumentPayload:
    """Materialize one document using the sidecar draft as the first authority."""
    validate_editor_document(abs_path, cached_document)

    if cached_document and cached_document.get("unsaved"):
        cached_content = cached_document.get("content", "")
        cached_base_sha = cached_document.get("base_sha256")
        cached_content_sha = cached_document.get("content_sha256")
        payload: MaterializedDocumentPayload = {
            "has_draft": True,
            "content": cached_content if isinstance(cached_content, str) else "",
            "state": "mid_session",
            "unsaved": True,
            "reason": "restore",
        }
        if isinstance(cached_base_sha, str):
            payload["base_sha256"] = cached_base_sha
        if isinstance(cached_content_sha, str):
            payload["content_sha256"] = cached_content_sha
        return payload

    try:
        content_bytes = Path(abs_path).read_bytes()
        content = content_bytes.decode("utf-8", errors="replace")
    except Exception:
        if strict_disk_errors:
            raise
        content = ""
    sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return {
        "has_draft": False,
        "content": content,
        "base_sha256": sha256,
        "content_sha256": sha256,
        "state": "clean",
        "unsaved": False,
        "reason": "disk",
    }


async def materialize_document_payload_async(
    abs_path: str,
    cached_document: Mapping[str, object] | None,
    *,
    strict_disk_errors: bool = False,
) -> MaterializedDocumentPayload:
    """Materialize background content without occupying the app asyncio loop."""
    return await asyncio.to_thread(
        materialize_document_payload,
        abs_path,
        cached_document,
        strict_disk_errors=strict_disk_errors,
    )


__all__ = [
    "MaterializedDocumentPayload",
    "materialize_document_payload",
    "materialize_document_payload_async",
]
