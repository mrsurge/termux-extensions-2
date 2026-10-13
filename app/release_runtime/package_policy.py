"""Release-only file policy; editable source and runtime dependencies stay intact."""
from pathlib import Path

MAX_WHEEL_BYTES = 100_000_000


def development_asset(path: Path) -> bool:
    retired_highlightjs = any(
        path.parts[index:index + 4] == ('apps', 'code_te2', 'vendor', 'highlightjs')
        for index in range(max(0, len(path.parts) - 3))
    )
    return (path.suffix in {".map", ".bak", ".bak2", ".save"}
            or ("monaco-editor-core" in path.parts and "_deprecated" in path.parts)
            or retired_highlightjs)


def validate_wheel_size(wheel: Path) -> None:
    size = wheel.stat().st_size
    if size >= MAX_WHEEL_BYTES:
        raise RuntimeError(f"Wheel exceeds release size budget: {size} bytes (limit {MAX_WHEEL_BYTES}): {wheel}")
