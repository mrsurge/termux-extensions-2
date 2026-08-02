# pyright: strict
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path


MAX_EDITOR_DOCUMENT_BYTES = 375 * 1024

# Keep this deny-based so new source and text formats remain editor-compatible.
_BINARY_EXTENSIONS = frozenset(
    {
        ".7z",
        ".a",
        ".apk",
        ".avi",
        ".bin",
        ".bmp",
        ".bz2",
        ".class",
        ".db",
        ".deb",
        ".dex",
        ".dll",
        ".dylib",
        ".eot",
        ".exe",
        ".flac",
        ".gif",
        ".gz",
        ".ico",
        ".jar",
        ".jpeg",
        ".jpg",
        ".m4a",
        ".mkv",
        ".mov",
        ".mp3",
        ".mp4",
        ".o",
        ".ogg",
        ".otf",
        ".out",
        ".pdf",
        ".png",
        ".pyc",
        ".rar",
        ".so",
        ".sqlite",
        ".sqlite3",
        ".tar",
        ".tgz",
        ".ttf",
        ".wasm",
        ".webm",
        ".webp",
        ".woff",
        ".woff2",
        ".xz",
        ".zip",
    }
)


class DocumentOpenRejectedError(ValueError):
    """A file is intentionally outside the editor's text-document contract."""

    def __init__(self, path: str, reason: str) -> None:
        self.path: str = path
        self.reason: str = reason
        super().__init__(f"editor_document_rejected:{reason}:{path}")


def validate_editor_document(
    abs_path: str,
    cached_document: Mapping[str, object] | None,
) -> None:
    """Reject known binary, executable-without-extension, and oversized inputs."""

    path = Path(abs_path)
    extension = path.suffix.lower()
    if extension in _BINARY_EXTENSIONS:
        raise DocumentOpenRejectedError(abs_path, f"binary_extension:{extension}")

    try:
        file_stat = path.stat()
    except OSError:
        file_stat = None

    if not extension and file_stat is not None and file_stat.st_mode & 0o111:
        raise DocumentOpenRejectedError(abs_path, "extensionless_executable")

    cached_content = cached_document.get("content") if cached_document else None
    if (
        cached_document
        and cached_document.get("unsaved")
        and isinstance(cached_content, str)
    ):
        content_size = len(cached_content.encode("utf-8"))
        if content_size > MAX_EDITOR_DOCUMENT_BYTES:
            raise DocumentOpenRejectedError(
                abs_path,
                f"draft_too_large:{content_size}:{MAX_EDITOR_DOCUMENT_BYTES}",
            )
        return

    if file_stat is not None and file_stat.st_size > MAX_EDITOR_DOCUMENT_BYTES:
        raise DocumentOpenRejectedError(
            abs_path,
            f"file_too_large:{file_stat.st_size}:{MAX_EDITOR_DOCUMENT_BYTES}",
        )


__all__ = [
    "DocumentOpenRejectedError",
    "MAX_EDITOR_DOCUMENT_BYTES",
    "validate_editor_document",
]
