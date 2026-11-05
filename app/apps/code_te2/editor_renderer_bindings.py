"""Connection-bound renderer association, independent of connection lifetime.

Uses the app's existing client-identity trust boundary, not RPC payload claims.
The primary ID is explicit; secondary IDs are never parsed or guessed into it.
"""
from __future__ import annotations

from dataclasses import dataclass

from .client_presentation import ClientRole, normalize_client_instance_id


@dataclass(frozen=True)
class EditorRendererBinding:
    renderer_id: str
    main_page_id: str
    area: ClientRole


_bindings: dict[str, EditorRendererBinding] = {}


def bind_editor_renderer(renderer_id: str, main_page_id: str, area: ClientRole) -> EditorRendererBinding:
    if (normalize_client_instance_id(renderer_id) != renderer_id
            or normalize_client_instance_id(main_page_id) != main_page_id):
        raise ValueError("invalid_editor_client_identity")
    if area not in ("primary", "secondary") or (area == "primary" and main_page_id != renderer_id):
        raise ValueError("invalid_editor_renderer_association")
    binding = EditorRendererBinding(renderer_id, main_page_id, area)
    previous = _bindings.get(renderer_id)
    if previous is not None and previous != binding:
        raise ValueError("editor_renderer_identity_already_bound")
    if previous is None and len(_bindings) >= 64:
        raise ValueError("editor_renderer_capacity_reached")
    _bindings[renderer_id] = binding
    return binding


def editor_renderer_binding(renderer_id: str) -> EditorRendererBinding:
    # Internal primary calls and older primary clients retain their identity.
    # Secondary UI connections must explicitly bind before any boot/open RPC.
    return _bindings.get(renderer_id, EditorRendererBinding(renderer_id, renderer_id, "primary"))


def registered_editor_renderer_binding(renderer_id: str) -> EditorRendererBinding | None:
    return _bindings.get(renderer_id)


def editor_renderer_bindings() -> tuple[EditorRendererBinding, ...]:
    return tuple(_bindings.values())
