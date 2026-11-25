"""Prepare installer-only GitHub prerelease assets against an already published wheel."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil


def stage(tag: str, version: str, output: Path) -> None:
    if not re.fullmatch(r"termux-installer-[0-9.]+-preview\.[0-9]+", tag):
        raise ValueError("Expected a versioned Termux installer preview tag")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Expected an existing three-part release manifest version")
    source = Path(__file__).resolve().parent
    bootstrap = (source / "install-te2").read_text()
    for marker, replacement in [
        ('release_tag=${TE2_RELEASE_TAG:-latest}', f'release_tag=${{TE2_RELEASE_TAG:-{version}}}'),
        ('installer_base_url=$release_base_url', f'installer_base_url="https://github.com/mrsurge/termux-extensions-2/releases/download/{tag}"'),
    ]:
        if bootstrap.count(marker) != 1:
            raise ValueError(f"Bootstrap template changed at {marker}")
        bootstrap = bootstrap.replace(marker, replacement)
    output.mkdir(parents=True, exist_ok=False)
    (output / "install-te2").write_text(bootstrap)
    (output / "install-te2").chmod(0o755)
    shutil.copyfile(source / "install_te2.py", output / "install_te2.py")
    sums = [f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n"
            for name in ("install-te2", "install_te2.py")]
    (output / "SHA256SUMS").write_text("".join(sums))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag")
    parser.add_argument("wheel_release")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    stage(args.tag, args.wheel_release, args.output)
