# pyright: strict
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import cast


JsonObject = dict[str, object]
TerminalFactsChanged = Callable[[], Awaitable[None]]
TERMINAL_LABEL_PREFIX = "code-editor-terminal"


@dataclass(frozen=True, slots=True)
class TerminalShellFact:
    shell_id: str
    label: str
    status: str
    pid: int | None
    exit_code: int | None
    stdout_log: str


_facts: dict[str, TerminalShellFact] = {}
_facts_changed: TerminalFactsChanged | None = None


def _mapping(value: object) -> Mapping[str, object] | None:
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else None


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _integer(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)


def terminal_shell_fact_from_payload(payload: object) -> TerminalShellFact | None:
    shell = _mapping(payload)
    if shell is None:
        return None
    shell_id = _text(shell.get("id"))
    label = _text(shell.get("label"))
    if not shell_id or not label.startswith(TERMINAL_LABEL_PREFIX):
        return None
    return TerminalShellFact(
        shell_id=shell_id,
        label=label,
        status=_text(shell.get("status")) or "unknown",
        pid=_integer(shell.get("pid")),
        exit_code=_integer(shell.get("exit_code")),
        stdout_log=_text(shell.get("stdout_log")),
    )


def replace_terminal_shell_facts(shells: object) -> bool:
    next_facts: dict[str, TerminalShellFact] = {}
    if isinstance(shells, list):
        for item in cast(list[object], shells):
            fact = terminal_shell_fact_from_payload(item)
            if fact is not None:
                next_facts[fact.shell_id] = fact
    changed = next_facts != _facts
    if changed:
        _facts.clear()
        _facts.update(next_facts)
    return changed


def record_terminal_shell_fact(payload: object) -> bool:
    fact = terminal_shell_fact_from_payload(payload)
    if fact is None or _facts.get(fact.shell_id) == fact:
        return False
    _facts[fact.shell_id] = fact
    return True


def remove_terminal_shell_fact(shell_id: str) -> bool:
    return _facts.pop(shell_id.strip(), None) is not None


def get_terminal_shell_fact(shell_id: str) -> TerminalShellFact | None:
    return _facts.get(shell_id.strip())


def configure_terminal_facts_changed(callback: TerminalFactsChanged) -> None:
    global _facts_changed
    _facts_changed = callback


async def notify_terminal_facts_changed() -> None:
    callback = _facts_changed
    if callback is not None:
        await callback()


__all__ = [
    "TerminalShellFact",
    "configure_terminal_facts_changed",
    "get_terminal_shell_fact",
    "notify_terminal_facts_changed",
    "record_terminal_shell_fact",
    "remove_terminal_shell_fact",
    "replace_terminal_shell_facts",
    "terminal_shell_fact_from_payload",
]
