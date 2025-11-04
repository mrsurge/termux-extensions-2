"""Module discovery utilities."""

from __future__ import annotations

import importlib
import pkgutil
from typing import List, Sequence, Type

from .module import Module
from ..modules.native.editor import EditorModule


def _iter_module_classes(package_path: str, package_name: str) -> Sequence[Type[Module]]:
    classes: List[Type[Module]] = []
    package = importlib.import_module(package_name)

    for _, mod_name, _ in pkgutil.iter_modules(package.__path__):  # type: ignore[attr-defined]
        module = importlib.import_module(f"{package_name}.{mod_name}")
        for attr in vars(module).values():
            if isinstance(attr, type) and issubclass(attr, Module) and attr is not Module:
                classes.append(attr)
    return classes


def load_native_modules(
    *,
    layout_manager=None,
    project_root=None,
    state_store=None,
) -> List[Module]:
    """Instantiate all native modules shipped with the app."""
    modules: List[Module] = []
    for cls in _iter_module_classes(
        package_path="app.apps.nice_code_cm6.modules.native",
        package_name="app.apps.nice_code_cm6.modules.native",
    ):
        if cls.__name__ == "MenuHeaderModule":
            instance = cls(layout_manager=layout_manager, project_root=project_root)
        elif cls.__name__ == "ExplorerModule":
            instance = cls(
                layout_manager=layout_manager,
                project_root=project_root,
                state_store=state_store,
            )
        elif cls.__name__ == "EditorModule":
            instance = cls(project_root=project_root, state_store=state_store)
        else:
            instance = cls()
        modules.append(instance)

    editor_module = next((m for m in modules if isinstance(m, EditorModule)), None)
    explorer_module = next((m for m in modules if getattr(m, "key", None) == "explorer"), None)
    menu_module = next((m for m in modules if getattr(m, "key", None) == "menu_header"), None)

    if explorer_module and hasattr(explorer_module, "attach_editor"):
        explorer_module.attach_editor(editor_module)

    if menu_module:
        if hasattr(menu_module, "attach_explorer"):
            menu_module.attach_explorer(explorer_module)
        if hasattr(menu_module, "attach_editor"):
            menu_module.attach_editor(editor_module)
        if hasattr(menu_module, "attach_project_root"):
            menu_module.attach_project_root(project_root)

    for instance in modules:
        instance.on_mount()
    return modules
