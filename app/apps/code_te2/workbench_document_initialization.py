# pyright: strict
"""Backend-owned initial text; never a request to replace a live WBA buffer."""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from .logical_document_reconciler import (
    build_logical_document_snapshot,
    materialize_logical_document_hydration,
)
from .open_state_backend import read_sidecar_open_state
from .worker_services.event_bus import JsonObject, current_project_generation

logger = logging.getLogger(__name__)


def build_initial_documents(project: str) -> JsonObject:
    """Capture bounded opened documents with the existing draft/hash policy.

    Sent in adapter.connect/reconnect itself, not fetched from a browser later.
    A raced materialization fails preparation instead of seeding disk over draft.
    """
    project = str(Path(project).resolve())
    state = read_sidecar_open_state(project, reason="sidecar_replay")
    snapshot = build_logical_document_snapshot(
        state, current_project_generation(project) or 0,
    )
    documents: list[JsonObject] = []
    for descriptor in snapshot["background"]:
        materialized = materialize_logical_document_hydration(project, {
            **descriptor, "languageId": "plaintext", "reason": "initialization",
            "expectedActiveEpoch": 0,
        })
        if materialized is None:
            raise RuntimeError(f"initial_document_changed:{descriptor['path']}")
        text = materialized["text"]
        assert isinstance(text, str)
        materialized["contentSha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        documents.append(materialized)
    return {
        "projectPath": project,
        "projectGeneration": snapshot["projectGeneration"],
        "openStateRevision": snapshot["openStateRevision"],
        "documents": documents,
    }


async def prepare_open_document(project: str, payload: dict[str, object], revision: int) -> None:
    """Prepare a missing document before the existing editor-open notification.

    No language activation/diagnostic ACK is awaited. Unready adapters receive
    their opened set in connect instead. Visible opening remains independent of
    an unavailable intelligence process; the WBA never substitutes disk text.
    """
    from .workbench_adapter_shell_manager import adapter_rpc, get_adapter_state

    state = get_adapter_state()
    if state.get("status") != "ready" or state.get("project") != project:
        return
    text = payload.get("content")
    path = payload.get("path")
    if not isinstance(text, str) or not isinstance(path, str):
        return
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    try:
        response = await adapter_rpc("vscode.documents.initialize", {
            "projectPath": project,
            "projectGeneration": current_project_generation(project) or 0,
            "openStateRevision": revision,
            "documents": [{
                "path": path, "text": text, "contentSha256": sha,
                "contentIdentity": f"sha256:{sha}",
                "baseSha256": payload.get("base_sha256"),
                "dirty": payload.get("unsaved") is True,
            }],
        }, timeout=5.0)
        result = response.get("result")
        if response.get("error") is not None or not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeError("document_initialization_rejected")
    except Exception:
        logger.exception("[wba_documents] initial handoff failed path=%s", path)

