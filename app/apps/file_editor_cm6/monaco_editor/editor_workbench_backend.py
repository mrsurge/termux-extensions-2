# pyright: strict
from __future__ import annotations

from .editor_backend_services.workbench_service import (
    handle_workbench_completions,
    handle_workbench_did_change,
    handle_workbench_folding_ranges,
    handle_workbench_grammars_list,
    handle_workbench_grammars_load,
    handle_workbench_hover,
    handle_workbench_open_file,
    handle_workbench_semantic_tokens,
    handle_workbench_semantic_tokens_legend,
    handle_workbench_semantic_tokens_range,
    handle_workbench_symbols,
)

__all__ = [
    "handle_workbench_completions",
    "handle_workbench_did_change",
    "handle_workbench_folding_ranges",
    "handle_workbench_grammars_list",
    "handle_workbench_grammars_load",
    "handle_workbench_hover",
    "handle_workbench_open_file",
    "handle_workbench_semantic_tokens",
    "handle_workbench_semantic_tokens_legend",
    "handle_workbench_semantic_tokens_range",
    "handle_workbench_symbols",
]
