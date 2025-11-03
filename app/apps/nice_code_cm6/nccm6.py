"""NiceGUI UI bootstrap for Code CM6."""

from nicegui import ui

from .core.layout_manager import LayoutManager
from .core.module_loader import load_native_modules
from .core.project_context import ProjectContext
from .helpers.explorer_backend import get_explorer_state
from .helpers.state_store import StateStore

# MAIN ENTRY POINT FOR NICE CODE CM6 UI SETUP.
# CENTRALIZE APP BOOTSTRAP, SERVICE WIRING, AND PROJECT CONTEXT HERE.


def build_ui(context) -> None:
    """Populate the shared shell container with the composed layout."""
    state_store = StateStore()
    project_context = ProjectContext(state_store)
    get_explorer_state().bind(project_context, state_store)

    manager = LayoutManager([])
    modules = load_native_modules(
        layout_manager=manager,
        project_context=project_context,
        state_store=state_store,
    )
    manager.modules = modules
    manager.render(
        header_container=context.header_app,
        body_container=context.body,
    )

