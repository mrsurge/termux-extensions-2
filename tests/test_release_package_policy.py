from pathlib import Path

import pytest

from app.release_runtime.package_policy import development_asset, validate_wheel_size


@pytest.mark.parametrize("name", ["app/a.js.map", "app/a.js.bak", "app/a.js.bak2",
                                  "app/a.save", "app/static/vendor/monaco-editor-core/_deprecated/a.js"])
def test_development_assets(name: str) -> None:
    assert development_asset(Path(name))


@pytest.mark.parametrize("name", ["app/a.js", "vendor/node_modules/engine.io/build/engine.io.js",
                                  "app/a.wasm", "app/font.woff2", "app/grammar.json"])
def test_runtime_assets_remain(name: str) -> None:
    assert not development_asset(Path(name))


def test_wheel_budget(tmp_path: Path) -> None:
    wheel = tmp_path / "candidate.whl"
    wheel.touch()
    validate_wheel_size(wheel)
    with wheel.open("wb") as handle:
        handle.truncate(100_000_000)
    with pytest.raises(RuntimeError, match="size budget"):
        validate_wheel_size(wheel)
