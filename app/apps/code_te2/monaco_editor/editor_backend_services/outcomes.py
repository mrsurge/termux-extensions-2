# pyright: strict
"""Application-owned outcomes shared by HTTP and socket callers."""
from dataclasses import dataclass
from typing import Literal


class EditorServiceError(Exception):
    def __init__(self, *, kind: Literal["invalid", "internal"], detail: str) -> None:
        self.kind: Literal["invalid", "internal"] = kind
        self.detail: str = detail
        # Existing RPC adapters stringify failures. Preserve their published text
        # during extraction without importing an HTTP exception into services.
        super().__init__(f"{400 if kind == 'invalid' else 500}: {detail}")


@dataclass(frozen=True)
class SaveConflict:
    current: dict[str, object]
