from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from setuptools import Distribution, setup
from setuptools.command.build_py import build_py
from setuptools.errors import SetupError
from wheel.bdist_wheel import bdist_wheel


_RELEASE_ENVIRONMENT = (
    "TE2_RELEASE_SERVER_BIN",
    "TE2_RELEASE_PLATFORM_TAG",
    "TE2_RELEASE_MINIMUM_GLIBC",
    "TE2_RELEASE_TAG",
    "TE2_RELEASE_COMMIT",
)


@dataclass(frozen=True)
class ReleaseWheelConfig:
    server: Path
    platform_tag: str
    minimum_glibc: str
    release_tag: str
    commit: str


def _release_wheel_config() -> ReleaseWheelConfig | None:
    values = {name: os.environ.get(name, "").strip() for name in _RELEASE_ENVIRONMENT}
    populated = {name for name, value in values.items() if value}
    if not populated:
        return None
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise SetupError(
            "Incomplete TE2 binary-release build environment; missing " + ", ".join(missing)
        )

    server = Path(values["TE2_RELEASE_SERVER_BIN"]).expanduser().resolve()
    if not server.is_file():
        raise SetupError(f"TE2 release server is missing: {server}")
    platform_tag = values["TE2_RELEASE_PLATFORM_TAG"]
    if not re.fullmatch(r"manylinux_[0-9]+_[0-9]+_x86_64", platform_tag):
        raise SetupError(f"Unsupported TE2 release wheel platform tag: {platform_tag}")
    minimum_glibc = values["TE2_RELEASE_MINIMUM_GLIBC"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+", minimum_glibc):
        raise SetupError(f"Invalid TE2 release minimum glibc: {minimum_glibc}")
    commit = values["TE2_RELEASE_COMMIT"].lower()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SetupError("TE2_RELEASE_COMMIT must be a full lowercase Git commit id")
    return ReleaseWheelConfig(
        server=server,
        platform_tag=platform_tag,
        minimum_glibc=minimum_glibc,
        release_tag=values["TE2_RELEASE_TAG"],
        commit=commit,
    )


class Te2BuildPy(build_py):
    def run(self) -> None:
        super().run()
        config = _release_wheel_config()
        package_root = Path(self.build_lib) / "app" / "release_runtime"
        if config is None:
            shutil.rmtree(package_root / "bin", ignore_errors=True)
            (package_root / "provenance.json").write_text(
                json.dumps(
                    {
                        "distributionMode": "source-build",
                        "schemaVersion": 1,
                    },
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            return
        binary_dir = package_root / "bin"
        binary_dir.mkdir(parents=True, exist_ok=True)
        target = binary_dir / "te2-server"
        shutil.copy2(config.server, target)
        target.chmod(0o755)
        package_version = str(self.distribution.metadata.version or "").strip()
        if not package_version:
            raise SetupError("TE2 package version is unavailable during release wheel assembly")
        manifest = {
            "architecture": "x86_64",
            "commit": config.commit,
            "distributionMode": "binary-release",
            "libc": "glibc",
            "minimumGlibc": config.minimum_glibc,
            "packageVersion": package_version,
            "platform": "linux",
            "platformTag": config.platform_tag,
            "releaseTag": config.release_tag,
            "schemaVersion": 1,
            "serverRelativePath": "bin/te2-server",
            "serverSha256": _sha256_file(target),
        }
        (package_root / "provenance.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


class Te2BdistWheel(bdist_wheel):
    def finalize_options(self) -> None:
        super().finalize_options()
        if _release_wheel_config() is not None:
            self.root_is_pure = False

    def get_tag(self) -> tuple[str, str, str]:
        config = _release_wheel_config()
        if config is None:
            return super().get_tag()
        return ("py3", "none", config.platform_tag)


class Te2Distribution(Distribution):
    def has_ext_modules(self) -> bool:
        # The release server is an ELF executable rather than a Python extension,
        # but binary wheels must still install the package into platlib.  Merely
        # changing bdist_wheel.root_is_pure is too late for setuptools' install
        # scheme selection and leaves the executable under purelib, which
        # auditwheel correctly rejects.
        return _release_wheel_config() is not None or super().has_ext_modules()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


setup(
    cmdclass={"build_py": Te2BuildPy, "bdist_wheel": Te2BdistWheel},
    distclass=Te2Distribution,
)
