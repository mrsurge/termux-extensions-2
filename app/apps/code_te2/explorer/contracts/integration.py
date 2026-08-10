# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerIntegrationContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


def parse_mention_agent_params(payload: object) -> JsonObject:
    envelope = _as_object(payload)
    path = envelope.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ExplorerIntegrationContractError("Missing path for mention")
    envelope["path"] = path.strip()
    return envelope


def parse_pulse_alive_params(payload: object) -> JsonObject:
    return _as_object(payload)


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
