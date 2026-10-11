"""Code TE2's native-log adapter for the shared terminal projection core."""
from app.libs.terminal_runtime.screen_projection import (
    DEFAULT_COLUMNS as DEFAULT_COLUMNS,
    DEFAULT_LINES as DEFAULT_LINES,
    MAX_HISTORY_LINES as MAX_HISTORY_LINES,
    MAX_PROJECTIONS,
    TerminalOutputDelta as TerminalOutputDelta,
    TerminalProjectionGrowth as TerminalProjectionGrowth,
    TerminalScreenCheckpoint as TerminalScreenCheckpoint,
    TerminalScreenProjectionRegistry as SharedProjectionRegistry,
)
from .terminal_log_io import open_log


class TerminalScreenProjectionRegistry(SharedProjectionRegistry):
    def __init__(self, capacity: int = MAX_PROJECTIONS) -> None:
        super().__init__(capacity, log_opener=open_log)


terminal_screen_projections = TerminalScreenProjectionRegistry()
