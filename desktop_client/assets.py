from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import BinaryIO, cast
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen


ASSET_VERSION_PATH = "/api/editor_version"
ASSET_BUNDLE_PATH = "/api/editor_assets_bundle"
ASSET_CONNECT_TIMEOUT_SECONDS = 3
ASSET_DOWNLOAD_TIMEOUT_SECONDS = 120

DATA_HOME = Path(
    os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")
)
CACHE_HOME = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
ASSET_ROOT = DATA_HOME / "te2" / "desktop_assets"
BUILD_CACHE_ROOT = CACHE_HOME / "te2" / "desktop_shell" / "web_extensions"
WEB_EXTENSION_SOURCE = (
    Path(__file__).parent / "web_process_extension" / "asset_redirect.c"
)
ASSET_INVENTORY_PATH = Path(__file__).parent / "desktop_asset_inventory.json"

# WebKitGTK and Electrobun consume this same immutable-static boundary. Keep the
# routing contract in data so the two desktop shells cannot silently drift.
with ASSET_INVENTORY_PATH.open(encoding="utf-8") as _inventory_file:
    _asset_inventory = json.load(_inventory_file)

LOCAL_PREFIXES = tuple(_asset_inventory["localPrefixes"])
LOCAL_FILES = tuple(_asset_inventory["localFiles"])
LOCAL_MAPPINGS = tuple(
    (mapping["kind"], mapping["source"], mapping["destination"])
    for mapping in _asset_inventory["localMappings"]
)
REQUIRED_DESKTOP_ASSET_FILES = tuple(_asset_inventory["requiredFiles"])


def compare_asset_versions(left: str, right: str) -> int:
    def parts(value: str) -> list[int]:
        result: list[int] = []
        for part in value.split("."):
            try:
                result.append(int(part))
            except ValueError:
                result.append(0)
        return result

    left_parts = parts(left)
    right_parts = parts(right)
    length = max(len(left_parts), len(right_parts))
    left_parts.extend([0] * (length - len(left_parts)))
    right_parts.extend([0] * (length - len(right_parts)))
    return (left_parts > right_parts) - (left_parts < right_parts)


def map_local_asset_path(request_path: str) -> str | None:
    if request_path not in LOCAL_FILES and not any(
        request_path.startswith(prefix) for prefix in LOCAL_PREFIXES
    ):
        return None

    for kind, source, destination in LOCAL_MAPPINGS:
        if kind == "exact" and request_path == source:
            return destination
        if kind == "prefix" and request_path.startswith(source):
            return destination + request_path[len(source) :]
    return request_path


def _normalize_framework_base_url(base_url: str) -> str:
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Framework URL must be an HTTP or HTTPS origin")
    return f"{parsed.scheme}://{parsed.netloc}"


def _safe_zip_path(name: str) -> Path | None:
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or ".." in candidate.parts:
        return None
    parts = tuple(part for part in candidate.parts if part not in {"", "."})
    if not parts or parts[0] == "android-shell":
        return None
    return Path(*parts)


@dataclass(frozen=True)
class AssetUpdateResult:
    ok: bool
    updated: bool
    local_version: str | None
    server_version: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class WebExtensionBuild:
    available: bool
    directory: Path | None = None
    library: Path | None = None
    error: str | None = None


class DesktopAssetManager:
    def __init__(self, asset_root: Path = ASSET_ROOT) -> None:
        self.asset_root = asset_root
        self._lock = threading.RLock()

    @property
    def version_file(self) -> Path:
        return self.asset_root / "version.txt"

    def local_version(self) -> str | None:
        try:
            value = self.version_file.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return value or None

    def missing_required_asset(self, root: Path | None = None) -> str | None:
        target = root or self.asset_root
        return next(
            (
                relative
                for relative in REQUIRED_DESKTOP_ASSET_FILES
                if not (target / relative).is_file()
            ),
            None,
        )

    def has_valid_assets(self) -> bool:
        return self.missing_required_asset() is None

    def status(self) -> dict[str, object]:
        missing = self.missing_required_asset()
        return {
            "assetRoot": str(self.asset_root),
            "localVersion": self.local_version(),
            "valid": missing is None,
            "missingRequiredAsset": missing,
        }

    def fetch_server_version(self, base_url: str) -> str:
        request = Request(
            _normalize_framework_base_url(base_url) + ASSET_VERSION_PATH,
            headers={"Accept": "text/plain"},
        )
        try:
            with urlopen(
                request,
                timeout=ASSET_CONNECT_TIMEOUT_SECONDS,
            ) as response:
                version = response.read().decode("utf-8", "replace").strip()
        except HTTPError as error:
            raise RuntimeError(
                f"Asset version check returned HTTP {error.code}"
            ) from error
        except (URLError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise RuntimeError(f"Asset version check failed: {reason}") from error
        if not version:
            raise RuntimeError("Asset version check returned an empty version")
        return version

    def update_from_server(
        self,
        base_url: str,
        *,
        force: bool = False,
    ) -> AssetUpdateResult:
        with self._lock:
            local_version = self.local_version()
            try:
                server_version = self.fetch_server_version(base_url)
            except RuntimeError as error:
                return AssetUpdateResult(
                    ok=False,
                    updated=False,
                    local_version=local_version,
                    error=str(error),
                )

            if local_version is not None:
                comparison = compare_asset_versions(server_version, local_version)
                if comparison < 0:
                    return AssetUpdateResult(
                        ok=False,
                        updated=False,
                        local_version=local_version,
                        server_version=server_version,
                        error=(
                            "Refusing asset downgrade "
                            f"from {local_version} to {server_version}"
                        ),
                    )
                if comparison == 0 and self.has_valid_assets() and not force:
                    return AssetUpdateResult(
                        ok=True,
                        updated=False,
                        local_version=local_version,
                        server_version=server_version,
                    )

            try:
                installed_version = self._download_and_install(
                    base_url,
                    local_version=local_version,
                )
            except (OSError, RuntimeError, zipfile.BadZipFile) as error:
                return AssetUpdateResult(
                    ok=False,
                    updated=False,
                    local_version=self.local_version(),
                    server_version=server_version,
                    error=str(error),
                )

            return AssetUpdateResult(
                ok=True,
                updated=True,
                local_version=installed_version,
                server_version=server_version,
            )

    def _download_and_install(
        self,
        base_url: str,
        *,
        local_version: str | None,
    ) -> str:
        parent = self.asset_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        staging = parent / f".{self.asset_root.name}.staging"
        backup = parent / f".{self.asset_root.name}.backup"
        for path in (staging, backup):
            if path.exists():
                shutil.rmtree(path)

        bundle_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix=".desktop-assets-",
                suffix=".zip",
                dir=parent,
                delete=False,
            ) as bundle:
                bundle_path = Path(bundle.name)
                self._download_bundle(
                    base_url,
                    cast(BinaryIO, cast(object, bundle)),
                )

            staging.mkdir(parents=True)
            with zipfile.ZipFile(bundle_path) as archive:
                for info in archive.infolist():
                    mode = info.external_attr >> 16
                    if stat.S_ISLNK(mode):
                        raise RuntimeError(
                            f"Asset bundle contains a symbolic link: {info.filename}"
                        )
                    relative = _safe_zip_path(info.filename)
                    if relative is None:
                        continue
                    target = staging / relative
                    if info.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)

            staged_version_file = staging / "version.txt"
            try:
                staged_version = staged_version_file.read_text(
                    encoding="utf-8"
                ).strip()
            except OSError as error:
                raise RuntimeError(
                    "Asset bundle is missing version.txt"
                ) from error
            if not staged_version:
                raise RuntimeError("Asset bundle contains an empty version.txt")

            missing = self.missing_required_asset(staging)
            if missing is not None:
                raise RuntimeError(
                    f"Asset bundle is missing required file: {missing}"
                )
            if (
                local_version is not None
                and compare_asset_versions(staged_version, local_version) < 0
            ):
                raise RuntimeError(
                    "Refusing staged asset downgrade "
                    f"from {local_version} to {staged_version}"
                )

            if self.asset_root.exists():
                self.asset_root.rename(backup)
            try:
                staging.rename(self.asset_root)
            except OSError:
                if backup.exists() and not self.asset_root.exists():
                    backup.rename(self.asset_root)
                raise
            if backup.exists():
                shutil.rmtree(backup, ignore_errors=True)
            return staged_version
        finally:
            if bundle_path is not None:
                bundle_path.unlink(missing_ok=True)
            if staging.exists():
                shutil.rmtree(staging)

    def _download_bundle(self, base_url: str, output: BinaryIO) -> None:
        request = Request(
            _normalize_framework_base_url(base_url) + ASSET_BUNDLE_PATH,
            headers={"Accept": "application/zip"},
        )
        try:
            with urlopen(
                request,
                timeout=ASSET_DOWNLOAD_TIMEOUT_SECONDS,
            ) as response:
                shutil.copyfileobj(response, output)
        except HTTPError as error:
            raise RuntimeError(
                f"Asset download returned HTTP {error.code}"
            ) from error
        except (URLError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise RuntimeError(f"Asset download failed: {reason}") from error


class _AssetRequestHandler(BaseHTTPRequestHandler):
    server_version = "TE2DesktopAssets/1"

    def do_GET(self) -> None:
        self._serve(send_body=True)

    def do_HEAD(self) -> None:
        self._serve(send_body=False)

    def _serve(self, *, send_body: bool) -> None:
        server = self.server
        if not isinstance(server, _DesktopAssetHTTPServer):
            self.send_error(500)
            return
        raw_path = unquote(urlsplit(self.path).path)
        relative = _safe_zip_path(raw_path.lstrip("/"))
        if relative is None:
            self.send_error(403)
            return
        requested = (server.asset_root / relative).resolve()
        root = server.asset_root.resolve()
        try:
            requested.relative_to(root)
        except ValueError:
            self.send_error(403)
            return
        if not requested.is_file():
            self.send_error(404)
            return

        mime_type = mimetypes.guess_type(requested.name)[0]
        size = requested.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "max-age=31536000, immutable")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if send_body:
            with requested.open("rb") as source:
                shutil.copyfileobj(source, self.wfile)

    def log_message(self, format: str, *args: object) -> None:
        del format, args
        return


class _DesktopAssetHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, asset_root: Path) -> None:
        self.asset_root = asset_root
        super().__init__(("127.0.0.1", 0), _AssetRequestHandler)

    def handle_error(self, request, client_address) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class DesktopAssetServer:
    def __init__(self, asset_root: Path = ASSET_ROOT) -> None:
        self.asset_root = asset_root
        self._server: _DesktopAssetHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str | None:
        if self._server is None:
            return None
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> str:
        if self._server is not None:
            return self.base_url or ""
        self.asset_root.parent.mkdir(parents=True, exist_ok=True)
        server = _DesktopAssetHTTPServer(self.asset_root)
        thread = threading.Thread(
            target=server.serve_forever,
            name="te2-desktop-assets",
            daemon=True,
        )
        thread.start()
        self._server = server
        self._thread = thread
        return self.base_url or ""

    def stop(self) -> None:
        server = self._server
        thread = self._thread
        self._server = None
        self._thread = None
        if server is None:
            return
        server.shutdown()
        server.server_close()
        if thread is not None:
            thread.join(timeout=2)


def _prune_old_web_extension_builds(active_directory: Path) -> None:
    try:
        candidates = tuple(BUILD_CACHE_ROOT.iterdir())
    except OSError:
        return
    for candidate in candidates:
        if candidate != active_directory and candidate.is_dir():
            shutil.rmtree(candidate, ignore_errors=True)


def ensure_web_extension() -> WebExtensionBuild:
    if not WEB_EXTENSION_SOURCE.is_file():
        return WebExtensionBuild(
            available=False,
            error=f"Missing WebKit extension source: {WEB_EXTENSION_SOURCE}",
        )
    try:
        version = subprocess.run(
            ["pkg-config", "--modversion", "webkitgtk-web-process-extension-6.0"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        flags = subprocess.run(
            [
                "pkg-config",
                "--cflags",
                "--libs",
                "webkitgtk-web-process-extension-6.0",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.split()
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None) or str(error)
        return WebExtensionBuild(
            available=False,
            error=(
                "WebKit asset interception needs a C compiler and the "
                "WebKitGTK 6 development package: "
                f"{str(detail).strip()}"
            ),
        )

    digest = hashlib.sha256()
    digest.update(WEB_EXTENSION_SOURCE.read_bytes())
    digest.update(version.encode())
    digest.update(platform.machine().encode())
    fingerprint = digest.hexdigest()[:16]
    directory = BUILD_CACHE_ROOT / fingerprint
    library = directory / "te2_desktop_asset_redirect.so"
    metadata = directory / "build.json"
    if library.is_file() and metadata.is_file():
        _prune_old_web_extension_builds(directory)
        return WebExtensionBuild(True, directory, library)

    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / ".te2_desktop_asset_redirect.so.tmp"
    command = [
        os.environ.get("CC", "cc"),
        "-std=c11",
        "-shared",
        "-fPIC",
        "-O2",
        "-Wall",
        "-Wextra",
        "-o",
        str(temporary),
        str(WEB_EXTENSION_SOURCE),
        *flags,
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
        temporary.replace(library)
        metadata.write_text(
            json.dumps(
                {
                    "source": str(WEB_EXTENSION_SOURCE),
                    "webkitVersion": version,
                    "machine": platform.machine(),
                    "compilerOutput": completed.stderr.strip(),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except (OSError, subprocess.CalledProcessError) as error:
        temporary.unlink(missing_ok=True)
        detail = getattr(error, "stderr", None) or str(error)
        return WebExtensionBuild(
            available=False,
            error=f"Failed to build WebKit asset interceptor: {str(detail).strip()}",
        )
    _prune_old_web_extension_builds(directory)
    return WebExtensionBuild(True, directory, library)
