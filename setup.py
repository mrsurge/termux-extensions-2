from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from setuptools import Distribution, setup
from setuptools.command.build_py import build_py
from setuptools.errors import SetupError
from wheel.bdist_wheel import bdist_wheel

# PEP 517 executes setup.py without necessarily placing its checkout on the
# import path. Resolve the build-owned validator from this source tree.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.release_runtime.code_te2 import validate_runtime


_RELEASE_ENVIRONMENT = (
    "TE2_RELEASE_SERVER_BIN",
    "TE2_RELEASE_PLATFORM_TAG",
    "TE2_RELEASE_MINIMUM_GLIBC",
    "TE2_RELEASE_TAG",
    "TE2_RELEASE_COMMIT",
    "TE2_RELEASE_CODE_TE2_RUNTIME",
)


@dataclass(frozen=True)
class ReleaseWheelConfig:
    server: Path
    code_te2: Path
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
    component_version = os.environ.get("TE2_RELEASE_SERVER_VERSION")
    if component_version is not None and not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?", component_version):
        raise SetupError("TE2_RELEASE_SERVER_VERSION must be an explicit Rust semantic version")

    server = Path(values["TE2_RELEASE_SERVER_BIN"]).expanduser().resolve()
    if not server.is_file():
        raise SetupError(f"TE2 release server is missing: {server}")
    code_te2 = Path(values["TE2_RELEASE_CODE_TE2_RUNTIME"]).expanduser().absolute()
    try:
        native_runtime = validate_runtime(code_te2)
    except RuntimeError as exc:
        raise SetupError(f"Invalid TE2 native editor release payload: {exc}") from exc
    platform_tag = values["TE2_RELEASE_PLATFORM_TAG"]
    android = platform_tag == "android_24_arm64_v8a"
    if android and (sys.platform != "android" or os.uname().machine != "aarch64"
                    or native_runtime.python_home is not None):
        raise SetupError("Android release wheels require the Termux system-Python native payload")
    if not android and sys.platform != "linux":
        raise SetupError("Manylinux release wheels require a Linux native payload")
    if not android and not re.fullmatch(r"manylinux_[0-9]+_[0-9]+_x86_64", platform_tag):
        raise SetupError(f"Unsupported TE2 release wheel platform tag: {platform_tag}")
    minimum_glibc = values["TE2_RELEASE_MINIMUM_GLIBC"]
    if not (android and minimum_glibc == "none") and not re.fullmatch(r"[0-9]+\.[0-9]+", minimum_glibc):
        raise SetupError(f"Invalid TE2 release minimum glibc: {minimum_glibc}")
    commit = values["TE2_RELEASE_COMMIT"].lower()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SetupError("TE2_RELEASE_COMMIT must be a full lowercase Git commit id")
    return ReleaseWheelConfig(
        server=server,
        code_te2=code_te2,
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
            shutil.rmtree(package_root / "code_te2", ignore_errors=True)
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
        try:
            validate_runtime(config.code_te2, package_version=package_version)
        except RuntimeError as exc:
            raise SetupError(f"Invalid TE2 native editor release payload: {exc}") from exc
        native_target = package_root / "code_te2"
        shutil.rmtree(native_target, ignore_errors=True)
        shutil.copytree(config.code_te2, native_target, symlinks=False)
        validate_runtime(native_target, package_version=package_version)
        manifest = {
            "serverVersion": os.environ.get("TE2_RELEASE_SERVER_VERSION", package_version),
            "architecture": "aarch64" if config.platform_tag == "android_24_arm64_v8a" else "x86_64",
            "commit": config.commit,
            "distributionMode": "binary-release",
            "libc": "bionic" if config.platform_tag == "android_24_arm64_v8a" else "glibc",
            "minimumGlibc": config.minimum_glibc,
            "packageVersion": package_version,
            "platform": "android" if config.platform_tag == "android_24_arm64_v8a" else "linux",
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
        if validate_runtime(config.code_te2).python_home is not None:
            # CPython extensions are private to the embedded app, never imported
            # by the hosting interpreter. Its ABI stays in runtime.json.
            return ("py3", "none", config.platform_tag)
        python_tag, abi_tag, _ = super().get_tag()
        if not python_tag.startswith("cp") or abi_tag == "none":
            raise SetupError("Native Code TE2 release wheels require an exact CPython ABI tag")
        return (python_tag, abi_tag, config.platform_tag)


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
