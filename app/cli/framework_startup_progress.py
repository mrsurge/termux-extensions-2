"""Optional bootstrap FD3 feedback; never readiness or build-cache authority."""
from __future__ import annotations

import codecs
import json
import os
import re
import subprocess
import sys
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from typing import TextIO

_stream: ContextVar[TextIO | None] = ContextVar("te2_startup_stream", default=None)
_ansi = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


@contextmanager
def reporting(stream: TextIO | None) -> Generator[None, None, None]:
    token = _stream.set(stream)
    try:
        emit("preparing")
        yield
    finally:
        _stream.reset(token)
        if stream is not None:
            stream.close()


def emit(phase: str, *, unit: str = "", output: str = "", exit_code: int | None = None) -> None:
    stream = _stream.get()
    if stream is None:
        return
    frame: dict[str, object] = {"version": 1, "type": "event", "event": "startup", "phase": phase}
    if unit:
        frame["unit"] = unit[:256]
    if output:
        frame["output"] = _ansi.sub("", output)[-2048:]
    if exit_code is not None:
        frame["exitCode"] = exit_code
    try:
        stream.write(json.dumps(frame, separators=(",", ":")) + "\n")
        stream.flush()
    except (BrokenPipeError, OSError, ValueError):
        pass


def run_build(command: Sequence[str], env: Mapping[str, str], *, unit: str) -> int:
    if _stream.get() is None:
        return subprocess.run(command, env=env, check=False).returncode
    # Cargo's own x/n progress is display-only. Do not parse it as readiness or
    # change compiler flags, source fingerprints, profiles or artifact selection.
    build_env = dict(env, CARGO_TERM_PROGRESS_WHEN="always", CARGO_TERM_PROGRESS_WIDTH="100",
                     CARGO_TERM_COLOR="never", CARGO_TERM_PROGRESS_TERM_INTEGRATION="false")
    emit("building", unit=unit)
    with subprocess.Popen(command, env=build_env, stderr=subprocess.PIPE) as child:
        assert child.stderr is not None
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        pending = ""
        latest = ""
        while chunk := os.read(child.stderr.fileno(), 4096):
            text = decoder.decode(chunk)
            sys.stderr.write(text)
            sys.stderr.flush()
            parts = re.split(r"[\r\n]", pending + text)
            pending = parts[-1][-2048:]
            line = next((part.strip() for part in reversed(parts) if part.strip()), "")
            if line and line != latest:
                latest = line
                emit("building", unit=unit, output=line)
        tail = decoder.decode(b"", final=True)
        if tail:
            sys.stderr.write(tail)
            sys.stderr.flush()
        code = child.wait()
    emit("build-finished", unit=unit, exit_code=code)
    return code
