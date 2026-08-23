# pyright: strict
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict, cast

JsonObject = dict[str, object]


@dataclass(frozen=True)
class ExplorerFileTreeContractError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


class ExplorerCreateEntryParams(TypedDict):
    parent_rel: str
    name: str


class ExplorerRenameEntryParams(TypedDict):
    rel: str
    new_name: str


class ExplorerRelParams(TypedDict):
    rel: str


class ExplorerBatchRelsParams(TypedDict):
    rels: list[str]


class ExplorerBatchDestinationParams(TypedDict):
    rels: list[str]
    dest_path: str


class ExplorerMoveCopyParams(TypedDict):
    rel: str
    dest_path: str


class ExplorerInboundTransferParams(TypedDict):
    source_path: str
    dest_rel: str


class ExplorerEditorOpenRequiredParams(TypedDict):
    raw_path: str
    source: str


class ExplorerEditorOpenParams(ExplorerEditorOpenRequiredParams, total=False):
    project_root: str
    line: int
    column: int
    focus: bool
    scroll_y: str
    scroll_to_top: bool


def parse_create_file_params(payload: object) -> ExplorerCreateEntryParams:
    return _parse_create_entry_params(payload, missing_name_message="File name required")


def parse_create_dir_params(payload: object) -> ExplorerCreateEntryParams:
    return _parse_create_entry_params(
        payload,
        missing_name_message="Directory name required",
    )


def parse_rename_entry_params(payload: object) -> ExplorerRenameEntryParams:
    envelope = _as_object(payload)
    rel = _parse_required_string(
        envelope.get("rel"),
        missing_message="Rename requires rel and new_name",
    )
    new_name = _parse_required_string(
        envelope.get("new_name"),
        missing_message="Rename requires rel and new_name",
    )
    return {
        "rel": rel,
        "new_name": new_name,
    }


def parse_delete_entry_params(payload: object) -> ExplorerRelParams:
    envelope = _as_object(payload)
    rel = _parse_required_string(
        envelope.get("rel"),
        missing_message="Delete requires rel",
    )
    return {"rel": rel}


def parse_open_second_window_params(payload: object) -> ExplorerRelParams:
    envelope = _as_object(payload)
    rel = _parse_required_string(
        envelope.get("rel"),
        missing_message="Open in a Second Window requires rel",
    )
    return {"rel": rel}


def parse_batch_delete_params(payload: object) -> ExplorerBatchRelsParams:
    envelope = _as_object(payload)
    return {"rels": _parse_string_list(envelope.get("rels"))}


def parse_batch_copy_params(payload: object) -> ExplorerBatchDestinationParams:
    return _parse_batch_destination_params(
        payload,
        missing_message="Batch copy requires dest_path",
    )


def parse_batch_move_params(payload: object) -> ExplorerBatchDestinationParams:
    return _parse_batch_destination_params(
        payload,
        missing_message="Batch move requires dest_path",
    )


def parse_editor_open_params(payload: object) -> ExplorerEditorOpenParams:
    envelope = _as_object(payload)
    raw_path = _first_nonempty_string(envelope, ("path", "abs", "file", "rel"))
    if raw_path is None:
        raise ExplorerFileTreeContractError("Open requires path")

    params: ExplorerEditorOpenParams = {
        "raw_path": raw_path,
        "source": _parse_optional_string(envelope.get("source")) or "explorer_rpc",
    }

    project_root = _parse_optional_string(envelope.get("projectRoot")) or _parse_optional_string(
        envelope.get("project_root")
    )
    if project_root is not None:
        params["project_root"] = project_root

    line = _coerce_optional_positive_int(envelope.get("line"))
    if line is not None:
        params["line"] = line

    column = _coerce_optional_positive_int(envelope.get("column"))
    if column is not None:
        params["column"] = column

    focus = envelope.get("focus")
    if isinstance(focus, bool):
        params["focus"] = focus

    scroll_y_legacy = envelope.get("scrollY")
    if isinstance(scroll_y_legacy, str):
        params["scroll_y"] = scroll_y_legacy

    scroll_y = envelope.get("scroll_y")
    if isinstance(scroll_y, str):
        params["scroll_y"] = scroll_y

    scroll_top_legacy = envelope.get("scrollToTop")
    if isinstance(scroll_top_legacy, bool):
        params["scroll_to_top"] = scroll_top_legacy

    scroll_top = envelope.get("scroll_to_top")
    if isinstance(scroll_top, bool):
        params["scroll_to_top"] = scroll_top

    return params


def parse_entry_move_params(payload: object) -> ExplorerMoveCopyParams:
    return _parse_move_copy_params(
        payload,
        missing_message="Move requires rel and dest_path",
    )


def parse_entry_copy_params(payload: object) -> ExplorerMoveCopyParams:
    return _parse_move_copy_params(
        payload,
        missing_message="Copy requires rel and dest_path",
    )


def parse_entry_copy_from_params(payload: object) -> ExplorerInboundTransferParams:
    return _parse_inbound_transfer_params(
        payload,
        missing_message="Copy-from requires source_path and dest_rel",
    )


def parse_entry_move_from_params(payload: object) -> ExplorerInboundTransferParams:
    return _parse_inbound_transfer_params(
        payload,
        missing_message="Move-from requires source_path and dest_rel",
    )


def _parse_create_entry_params(
    payload: object,
    *,
    missing_name_message: str,
) -> ExplorerCreateEntryParams:
    envelope = _as_object(payload)
    parent_rel = _parse_optional_string(envelope.get("parent_rel")) or "."
    name = _parse_required_string(
        envelope.get("name"),
        missing_message=missing_name_message,
    )
    return {
        "parent_rel": parent_rel,
        "name": name,
    }


def _parse_batch_destination_params(
    payload: object,
    *,
    missing_message: str,
) -> ExplorerBatchDestinationParams:
    envelope = _as_object(payload)
    dest_path = _parse_required_string(
        envelope.get("dest_path"),
        missing_message=missing_message,
    )
    return {
        "rels": _parse_string_list(envelope.get("rels")),
        "dest_path": dest_path,
    }


def _parse_move_copy_params(
    payload: object,
    *,
    missing_message: str,
) -> ExplorerMoveCopyParams:
    envelope = _as_object(payload)
    rel = _parse_required_string(
        envelope.get("rel"),
        missing_message=missing_message,
    )
    dest_path = _parse_required_string(
        envelope.get("dest_path"),
        missing_message=missing_message,
    )
    return {
        "rel": rel,
        "dest_path": dest_path,
    }


def _parse_inbound_transfer_params(
    payload: object,
    *,
    missing_message: str,
) -> ExplorerInboundTransferParams:
    envelope = _as_object(payload)
    source_path = _parse_required_string(
        envelope.get("source_path"),
        missing_message=missing_message,
    )
    dest_rel = _parse_required_string(
        envelope.get("dest_rel"),
        missing_message=missing_message,
    )
    return {
        "source_path": source_path,
        "dest_rel": dest_rel,
    }


def _first_nonempty_string(
    envelope: JsonObject,
    keys: tuple[str, ...],
) -> str | None:
    for key in keys:
        value = envelope.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _parse_required_string(
    value: object,
    *,
    missing_message: str,
) -> str:
    if isinstance(value, str) and value:
        return value
    raise ExplorerFileTreeContractError(missing_message)


def _parse_optional_string(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _parse_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in cast(list[object], value):
        if isinstance(item, str):
            result.append(item)
    return result


def _coerce_optional_positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 1 else None
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed >= 1 else None
    return None


def _as_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    normalized: JsonObject = {}
    for key, item in cast(dict[object, object], value).items():
        if isinstance(key, str):
            normalized[key] = item
    return normalized
