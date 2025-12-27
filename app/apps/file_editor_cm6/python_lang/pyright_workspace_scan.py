from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

from framework_shells import get_manager
import asyncio
import hashlib
from framework_shells.orchestrator import Orchestrator


@dataclass(frozen=True)
class PyrightScanResult:
    summary_by_rel: Dict[str, Dict[str, int]]
    exit_code: int
    stdout: str
    stderr_tail: str


def _pyright_bin() -> Path:
    # app/apps/file_editor_cm6/python_lang/... -> app/
    return (
        Path(__file__).resolve(strict=False).parents[3]
        / "static"
        / "vendor"
        / "lsp_servers"
        / "node_modules"
        / ".bin"
        / "pyright"
    )


def _best_effort_json_parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:
        # Some tools can emit non-JSON noise; salvage first {...} block if present.
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _summarize_pyright_output(*, data: dict, base_project_root: Path) -> Dict[str, Dict[str, int]]:
    """Return {rel_path: {errors, warnings}} for diagnostics."""
    result: Dict[str, Dict[str, int]] = {}

    diags = data.get("generalDiagnostics")
    if not isinstance(diags, list):
        return result

    for d in diags:
        if not isinstance(d, dict):
            continue
        file_path = d.get("file")
        if not isinstance(file_path, str) or not file_path:
            continue
        severity = str(d.get("severity") or "").lower()

        try:
            abs_p = Path(file_path).expanduser().resolve(strict=False)
            rel = str(abs_p.relative_to(base_project_root))
        except Exception:
            continue

        bucket = result.get(rel)
        if not bucket:
            bucket = {"errors": 0, "warnings": 0}
            result[rel] = bucket

        if severity == "error":
            bucket["errors"] += 1
        elif severity in {"warning", "information", "hint"}:
            bucket["warnings"] += 1

    # Drop empty
    result = {k: v for k, v in result.items() if int(v.get("errors") or 0) > 0 or int(v.get("warnings") or 0) > 0}
    return result


async def run_pyright_workspace_scan(
    *,
    base_project_root: Path,
    effective_project_root: Path,
    timeout_s: float = 180.0,
) -> PyrightScanResult:
    """Run pyright (CLI) across effective_project_root and summarize per-file counts.

    Runs as a temporary Framework Shell (pipe) so it can be cancelled/superseded.
    """

    pyright = _pyright_bin()
    if not pyright.exists():
        raise RuntimeError(f"pyright binary not found at {pyright}")

    mgr = await get_manager()
    orch = Orchestrator(mgr)
    project_hash = hashlib.sha1(str(base_project_root).encode()).hexdigest()[:8]
    label = f"pyright-scan:{project_hash}"

    record = await orch.start_from_ref(
        "pyright_scan.yaml#pyright-scan",
        base_dir=(Path(__file__).resolve(strict=False).parents[1] / "shellspec"),
        ctx={
            "PYRIGHT_BIN": str(pyright),
            "EFFECTIVE_ROOT": str(effective_project_root),
            "PROJECT_HASH": project_hash,
        },
        label=label,
    )

    pipe_state = mgr.get_pipe_state(record.id)
    if not pipe_state or not pipe_state.process:
        raise RuntimeError("pyright scan: missing pipe state")

    proc = pipe_state.process
    stdout_b: bytes = b""
    try:
        stdout_b, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        try:
            await mgr.terminate_shell(record.id, force=True)
        except Exception:
            pass
        raise RuntimeError(f"pyright scan timed out after {timeout_s}s")
    except Exception:
        # Ensure process is not left around.
        try:
            await mgr.terminate_shell(record.id, force=True)
        except Exception:
            pass
        raise

    rc = int(getattr(proc, "returncode", 0) or 0)
    stdout = (stdout_b or b"").decode("utf-8", errors="replace")

    stderr_tail = ""
    try:
        # stderr is logged to file by framework_shells for pipe shells
        stderr_path = Path(getattr(record, "stderr_log", "") or "")
        if stderr_path.exists():
            raw = stderr_path.read_text(encoding="utf-8", errors="replace")
            stderr_tail = raw[-4000:]
    except Exception:
        stderr_tail = ""

    # Cleanup best-effort: process should be exited already, but terminate clears records/pipes.
    try:
        await mgr.terminate_shell(record.id, force=True)
    except Exception:
        pass

    data = _best_effort_json_parse(stdout)
    summary = _summarize_pyright_output(data=data, base_project_root=base_project_root)
    return PyrightScanResult(
        summary_by_rel=summary,
        exit_code=rc,
        stdout=stdout,
        stderr_tail=stderr_tail,
    )
