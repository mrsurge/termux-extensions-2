"""Module discovery utilities."""

from __future__ import annotations

import importlib
import pkgutil
from typing import List, Sequence, Type

from .module import Module


def _iter_module_classes(package_path: str, package_name: str) -> Sequence[Type[Module]]:
    classes: List[Type[Module]] = []
    package = importlib.import_module(package_name)

    for _, mod_name, _ in pkgutil.iter_modules(package.__path__):  # type: ignore[attr-defined]
        module = importlib.import_module(f"{package_name}.{mod_name}")
        for attr in vars(module).values():
            if isinstance(attr, type) and issubclass(attr, Module) and attr is not Module:
                classes.append(attr)
    return classes


def load_native_modules(layout_manager=None) -> List[Module]:
    """Instantiate all native modules shipped with the app."""
    modules: List[Module] = []
    for cls in _iter_module_classes(
        package_path="app.apps.nice_code_cm6.modules.native",
        package_name="app.apps.nice_code_cm6.modules.native",
    ):
        # Pass layout_manager to MenuHeaderModule
        if cls.__name__ == "MenuHeaderModule" and layout_manager:
            instance = cls(layout_manager=layout_manager)
        else:
            instance = cls()
        instance.on_mount()
        modules.append(instance)
    return modules
