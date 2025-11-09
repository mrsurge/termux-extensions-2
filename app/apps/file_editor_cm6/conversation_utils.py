"""Conversation history helpers for agent transport stacks."""

from __future__ import annotations

from typing import Iterable, Tuple

BASE_INSTRUCTIONS = (
    "Resume the prior conversation.\n"
    "You will receive the previous transcript followed by the user's latest message.\n"
    "Use that transcript to maintain continuity."
)


def build_transcript(messages: Iterable[dict]) -> Tuple[str, str]:
    """
    Build a normalized transcript payload from persisted session messages.

    Returns a tuple of (base_instructions, transcript_text). If there is no
    usable transcript, both strings are empty.
    """
    lines = []
    for entry in messages or []:
        if not isinstance(entry, dict):
            continue
        text = entry.get("text") or entry.get("output")
        if not text:
            continue
        msg_type = entry.get("type")
        if msg_type == "user":
            lines.append(f"User: {text}")
        elif msg_type in ("assistant", "final"):
            lines.append(f"Assistant: {text}")
        elif msg_type == "system":
            lines.append(f"System: {text}")

    if not lines:
        return "", ""

    return BASE_INSTRUCTIONS, "\n".join(lines)

