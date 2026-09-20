# pyright: strict
from __future__ import annotations

import sys
from app.libs.pipe_protocol import PipeEnvelope


def te2_pipe_dispatch(envelope: PipeEnvelope) -> object:
    return {"method": envelope.method, "web_imports_absent": not any(
        name.split(".")[0] in {"fastapi", "pydantic", "pydantic_core", "uvicorn", "starlette"}
        for name in sys.modules
    )}
