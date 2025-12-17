from __future__ import annotations

import asyncio
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .manager import FrameworkShellManager
from .record import ShellRecord
from .shellspec import (
    ReadinessProbe,
    ShellSpec,
    load_shellspec,
    parse_shellspec_ref,
    render_shellspec,
)


def _deep_merge_dict(a: Optional[Dict[str, Any]], b: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not a and not b:
        return {}
    if not a:
        return dict(b or {})
    if not b:
        return dict(a)

    out: Dict[str, Any] = dict(a)
    for key, value in (b or {}).items():
        if isinstance(out.get(key), dict) and isinstance(value, dict):
            out[key] = _deep_merge_dict(out.get(key), value)
        else:
            out[key] = value
    return out


async def _wait_for_tcp_port(*, host: str, port: int, timeout: float, interval: float = 0.2) -> bool:
    deadline = time.monotonic() + float(timeout)
    while time.monotonic() < deadline:
        try:
            reader, writer = await asyncio.open_connection(host, port)
        except (OSError, ConnectionError):
            await asyncio.sleep(interval)
            continue
        else:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return True
    return False


async def _wait_for_stdout_regex(*, path: str, pattern: str, timeout: float, interval: float = 0.2) -> bool:
    compiled = re.compile(pattern)
    deadline = time.monotonic() + float(timeout)
    offset = 0
    while time.monotonic() < deadline:
        try:
            with open(path, "rb") as f:
                f.seek(offset)
                chunk = f.read()
                offset = f.tell()
            if chunk:
                text = chunk.decode("utf-8", errors="ignore")
                if compiled.search(text):
                    return True
        except FileNotFoundError:
            pass
        except Exception:
            pass
        await asyncio.sleep(interval)
    return False


async def _wait_for_http_ok(*, url: str, status_codes: List[int], timeout: float, interval: float = 0.5) -> bool:
    import urllib.request
    import urllib.error

    deadline = time.monotonic() + float(timeout)
    allowed = set(int(x) for x in (status_codes or [200]))
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as resp:
                if int(getattr(resp, "status", 0)) in allowed:
                    return True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            pass
        except Exception:
            pass
        await asyncio.sleep(interval)
    return False


async def wait_for_readiness(record: ShellRecord, probe: ReadinessProbe) -> bool:
    if probe.type == "tcp_port":
        if not probe.port:
            return False
        return await _wait_for_tcp_port(host=probe.host or "127.0.0.1", port=int(probe.port), timeout=probe.timeout)

    if probe.type == "stdout_regex":
        if not probe.pattern:
            return False
        return await _wait_for_stdout_regex(path=record.stdout_log, pattern=probe.pattern, timeout=probe.timeout)

    if probe.type == "http_ok":
        if not probe.url:
            return False
        return await _wait_for_http_ok(url=probe.url, status_codes=list(probe.status_codes or [200]), timeout=probe.timeout)

    return True


def _normalize_backend(value: str) -> str:
    v = (value or "").strip().lower()
    if v in ("proc", "process", "subprocess"):
        return "proc"
    if v in ("pty",):
        return "pty"
    if v in ("pipe", "pipes"):
        return "pipe"
    if v in ("dtach",):
        return "dtach"
    return "proc"


class Orchestrator:
    def __init__(self, manager: FrameworkShellManager):
        self.manager = manager

    async def start_spec(
        self,
        spec: ShellSpec,
        *,
        ctx: Optional[Mapping[str, Any]] = None,
        label: Optional[str] = None,
        record_spec_id: Optional[str] = None,
        ui: Optional[Dict[str, Any]] = None,
        env_overrides: Optional[Dict[str, str]] = None,
        subgroups_overrides: Optional[List[str]] = None,
        parent_shell_id: Optional[str] = None,
        wait_ready: bool = True,
    ) -> ShellRecord:
        rendered = render_shellspec(spec, ctx=ctx or {}, env=os.environ)
        stored_spec_id = record_spec_id or rendered.id

        env_final = dict(rendered.env or {})
        if env_overrides:
            env_final.update(env_overrides)

        subgroups = list(subgroups_overrides) if subgroups_overrides is not None else list(rendered.subgroups or [])
        ui_final = _deep_merge_dict(rendered.ui or {}, ui or {})
        label_final = label or rendered.id
        backend = _normalize_backend(rendered.backend)

        if backend == "dtach":
            record = await self.manager.spawn_shell_dtach(
                command=rendered.command,
                cwd=rendered.cwd,
                env=env_final,
                label=label_final,
                spec_id=stored_spec_id,
                subgroups=subgroups,
                ui=ui_final,
                autostart=rendered.autostart,
                parent_shell_id=parent_shell_id,
            )
        elif backend == "pty":
            record = await self.manager.spawn_shell_pty(
                command=rendered.command,
                cwd=rendered.cwd,
                env=env_final,
                label=label_final,
                spec_id=stored_spec_id,
                subgroups=subgroups,
                ui=ui_final,
                autostart=rendered.autostart,
                parent_shell_id=parent_shell_id,
            )
        elif backend == "pipe":
            record = await self.manager.spawn_shell_pipe(
                command=rendered.command,
                cwd=rendered.cwd,
                env=env_final,
                label=label_final,
                spec_id=stored_spec_id,
                subgroups=subgroups,
                ui=ui_final,
                autostart=rendered.autostart,
                parent_shell_id=parent_shell_id,
            )
        else:
            record = await self.manager.spawn_shell(
                command=rendered.command,
                cwd=rendered.cwd,
                env=env_final,
                label=label_final,
                spec_id=stored_spec_id,
                subgroups=subgroups,
                ui=ui_final,
                autostart=rendered.autostart,
            )

        if wait_ready and rendered.autostart and rendered.readiness:
            ok = await wait_for_readiness(record, rendered.readiness)
            if not ok:
                raise RuntimeError(f"shell '{rendered.id}' failed readiness ({rendered.readiness.type})")

        return record

    async def start_from_ref(
        self,
        ref: str,
        *,
        base_dir: Optional[Path] = None,
        ctx: Optional[Mapping[str, Any]] = None,
        label: Optional[str] = None,
        record_spec_id: Optional[str] = None,
        ui: Optional[Dict[str, Any]] = None,
        env_overrides: Optional[Dict[str, str]] = None,
        subgroups_overrides: Optional[List[str]] = None,
        parent_shell_id: Optional[str] = None,
        wait_ready: bool = True,
    ) -> ShellRecord:
        ref_path, shell_id = parse_shellspec_ref(ref)
        spec_path = Path(ref_path)
        if base_dir is not None:
            spec_path = (base_dir / spec_path).resolve()

        specs = load_shellspec(spec_path)
        if shell_id:
            spec = specs.get(shell_id)
            if not spec:
                raise ValueError(f"shellspec id '{shell_id}' not found in {spec_path}")
        else:
            if len(specs) != 1:
                raise ValueError(f"shellspec ref '{ref}' is ambiguous (found {len(specs)} shells)")
            spec = next(iter(specs.values()))

        return await self.start_spec(
            spec,
            ctx=ctx,
            label=label,
            record_spec_id=record_spec_id,
            ui=ui,
            env_overrides=env_overrides,
            subgroups_overrides=subgroups_overrides,
            parent_shell_id=parent_shell_id,
            wait_ready=wait_ready,
        )

    async def apply(self, specs: List[ShellSpec], prune: bool = False, *, ctx: Optional[Mapping[str, Any]] = None) -> None:
        """Reconcile specs with current runtime.

        This is intentionally conservative: it will start missing shells (if
        autostart=True) and optionally prune shells that have a `spec_id` that
        is no longer present in the spec set.
        """
        existing_records = await self.manager.list_shells()

        existing_by_spec_id: Dict[str, ShellRecord] = {}
        for record in existing_records:
            if record.spec_id:
                existing_by_spec_id[str(record.spec_id)] = record

        desired_ids = {spec.id for spec in specs}

        for spec in specs:
            if not spec.autostart:
                continue
            record = existing_by_spec_id.get(spec.id)
            if record and record.status == "running" and record.pid and await self.manager._is_pid_alive(record.pid):
                continue
            if record:
                await self.manager.terminate_shell(record.id, force=True)
            await self.start_spec(spec, ctx=ctx, label=spec.id, wait_ready=bool(spec.readiness))

        if prune:
            for spec_id, record in existing_by_spec_id.items():
                if spec_id not in desired_ids:
                    await self.manager.terminate_shell(record.id, force=True)
