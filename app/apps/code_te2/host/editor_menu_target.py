"""Backend selection of one live renderer for a main page's menu intent."""
from __future__ import annotations
from collections.abc import Callable

from ..editor_renderer_bindings import (
    EditorRendererBinding,
    registered_editor_renderer_binding,
)
from ..monaco_editor.editor_client_registry import connected_editor_client_instance_ids

# Presentation focus, not durable opened-file authority. Renderer associations
# are already bounded; do not accept main-page/renderer claims in menu payloads.
class EditorMenuFocus:
    def __init__(self, binding: Callable[[str], EditorRendererBinding | None],
                 connected: Callable[[], tuple[str, ...]]) -> None:
        self._binding = binding
        self._connected = connected
        self._focused_by_main: dict[str, str] = {}

    def record(self, renderer_id: str) -> None:
        binding = self._binding(renderer_id)
        if binding is None or renderer_id not in self._connected():
            return
        self._focused_by_main[binding.main_page_id] = renderer_id

    def release(self, renderer_id: str) -> None:
        if renderer_id in self._connected():
            return
        binding = self._binding(renderer_id)
        if binding is not None and self._focused_by_main.get(binding.main_page_id) == renderer_id:
            self._focused_by_main.pop(binding.main_page_id, None)

    def select(self, requester_id: str) -> EditorRendererBinding:
        requester = self._binding(requester_id) or EditorRendererBinding(requester_id, requester_id, "primary")
        # A secondary's own menu remains local. Only its main page follows focus.
        if requester.area == "secondary":
            return requester
        selected_id = self._focused_by_main.get(requester.main_page_id)
        selected = self._binding(selected_id) if selected_id else None
        if (selected is not None and selected.main_page_id == requester.main_page_id
                and selected.renderer_id in self._connected()):
            return selected
        return requester

    def validate(self, requester_id: str, renderer_id: str) -> None:
        requester, renderer = self._binding(requester_id), self._binding(renderer_id)
        if (requester is None or renderer is None
                or requester.main_page_id != renderer.main_page_id
                or (requester.area == "secondary" and requester_id != renderer_id)):
            raise ValueError("editor menu target is not associated with this window")
        if renderer_id not in self._connected():
            raise ValueError("selected editor disconnected; reopen the menu")


_focus = EditorMenuFocus(registered_editor_renderer_binding, connected_editor_client_instance_ids)


def record_editor_menu_focus(renderer_id: str) -> None:
    _focus.record(renderer_id)


def release_editor_menu_focus(renderer_id: str) -> None:
    _focus.release(renderer_id)


def select_editor_menu_renderer(requester_id: str) -> EditorRendererBinding:
    return _focus.select(requester_id)


def capture_editor_menu_target(requester_id: str) -> dict[str, object]:
    from ..stores import get_history_store
    from ..open_state_backend import read_client_foreground, read_sidecar_open_state

    renderer = select_editor_menu_renderer(requester_id)
    project = get_history_store().get_active_project()
    target: dict[str, object] = {
        "rendererId": renderer.renderer_id,
        "mainPageId": renderer.main_page_id,
        "area": renderer.area,
        "projectPath": project or "",
        "path": None,
        "revision": 0,
        "projectGeneration": 0,
    }
    if project:
        foreground = read_client_foreground(project, renderer.renderer_id, reason="editor_menu_capture")
        state = read_sidecar_open_state(project, reason="editor_menu_capture")
        target.update(path=foreground["path"], revision=state["revision"],
                      projectGeneration=state["projectGeneration"])
    return target


def validate_editor_menu_context(data: dict[str, object], *, project: str | None,
                                 generation: int, path: str | None) -> None:
    if not project or project != data.get("menuProjectPath"):
        raise ValueError("editor project changed; reopen the menu")
    captured_generation = data.get("menuProjectGeneration")
    if type(captured_generation) is not int or captured_generation != generation:
        raise ValueError("editor project changed; reopen the menu")
    if path != data.get("menuPath"):
        raise ValueError("selected editor document changed; reopen the menu")


def validate_editor_menu_target(requester_id: str, data: dict[str, object]) -> str:
    """Revalidate a captured target; never retarget an already opened dialog."""
    from ..stores import get_history_store
    from ..open_state_backend import read_client_foreground, read_sidecar_open_state

    renderer_id = data.get("menuRendererId")
    if not isinstance(renderer_id, str):
        raise ValueError("missing editor menu target")
    _focus.validate(requester_id, renderer_id)
    project = get_history_store().get_active_project()
    if not project or project != data.get("menuProjectPath"):
        raise ValueError("editor project changed; reopen the menu")
    state = read_sidecar_open_state(project, reason="editor_menu_validate")
    foreground = read_client_foreground(project, renderer_id, reason="editor_menu_validate")
    validate_editor_menu_context(data, project=project, generation=state["projectGeneration"],
                                 path=foreground["path"])
    return renderer_id
