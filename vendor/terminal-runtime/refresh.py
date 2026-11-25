"""Copy the runtime JS from a clean terminal npm ci --omit=dev --ignore-scripts."""
from pathlib import Path
import json
import shutil
import sys

root = Path(__file__).resolve().parent
modules = Path(sys.argv[1])
lock = json.loads((root.parents[1] / "app/apps/terminal/package-lock.json").read_text())["packages"]
files = {
    "node-pty": ["lib/index.js", "lib/unixTerminal.js", "lib/eventEmitter2.js", "lib/utils.js", "lib/terminal.js"],
    "@xterm/headless": ["lib-headless/xterm-headless.js"],
    "@xterm/addon-serialize": ["lib/addon-serialize.js"],
    "@msgpack/msgpack": ["dist.cjs/**/*.cjs"],
}
for name, patterns in files.items():
    src = modules / name
    assert json.loads((src / "package.json").read_text())["version"] == lock["node_modules/" + name]["version"]
    dst = root / "packages" / name
    if dst.exists():
        shutil.rmtree(dst)
    for pattern in ["package.json", *patterns]:
        paths = list(src.glob(pattern))
        if not paths:
            raise ValueError(f"Missing {name}/{pattern}")
        for path in paths:
            target = dst / path.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    license_file = src / "LICENSE"
    if name.startswith("@xterm/") and not license_file.exists():
        license_file = root / "XTERM-LICENSE"
    shutil.copyfile(license_file, dst / "LICENSE")
