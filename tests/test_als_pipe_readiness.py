from pathlib import Path
import json
import yaml

ROOT = Path(__file__).parents[1]


def test_als_declares_pipe_only_serving_readiness() -> None:
    app = ROOT / "app/apps/als_rs"
    manifest = json.loads((app / "manifest.json").read_text())
    spec = yaml.safe_load((app / "shellspec/app_worker.yaml").read_text())
    worker = spec["shells"]["app-worker"]
    assert manifest["readiness_support"] == "pipe"
    assert worker["backend"] == "pipe"
    assert worker["pipe"]["mode"] == "native_pipe_testing"
    assert worker["log_codecs"] == {"stdout": "messagepack", "stderr": "text"}
    assert worker["command"] == ["als-rs", "--stdio", "--port", "12459"]
    assert "readiness" not in worker
    # These are separate diagnostic/UI contracts, not HTTP worker-ready fallbacks.
    assert manifest["proxy_shell"]["health_path"] == "/api/health"
    assert manifest["sidebar_state"]["readiness"]["callback"] is True
