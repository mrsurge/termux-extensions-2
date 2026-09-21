"""Application-owned terminal failures, independent of the network adapter."""
# pyright: strict
from typing import Literal

TerminalErrorKind = Literal["invalid", "missing", "conflict", "internal"]


class TerminalServiceError(Exception):
    kind: TerminalErrorKind
    detail: str

    def __init__(self, kind: TerminalErrorKind, detail: str) -> None:
        self.kind = kind
        self.detail = detail
        # Some socket consumers stringify errors, others send detail alone.
        # Preserve both existing wire forms without importing HTTP exceptions.
        legacy_code = {"invalid": 400, "missing": 404, "conflict": 409, "internal": 500}[kind]
        super().__init__(f"{legacy_code}: {detail}")
