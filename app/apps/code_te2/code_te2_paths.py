from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from app.te2_paths import resolve_te2_paths


@dataclass(frozen=True)
class CodeTe2Paths:
    te2_cache_root: Path
    data_root: Path
    config_root: Path
    cache_root: Path
    runtime_root: Path

    @property
    def project_sidecars_dir(self) -> Path:
        return self.data_root / "projects"

    @property
    def history_path(self) -> Path:
        return self.data_root / "history.json"

    @property
    def preferences_path(self) -> Path:
        return self.config_root / "preferences.json"

    @property
    def agent_icons_dir(self) -> Path:
        return self.data_root / "agent_icons"

    @property
    def sidebar_backchannel_socket_path(self) -> Path:
        return self.runtime_root / "sidebar_backchannel.sock"

    @property
    def browser_console_log_path(self) -> Path:
        return self.cache_root / "browser_console.log"

    @property
    def code_server_data_dir(self) -> Path:
        return self.data_root / "code_server"

    @property
    def code_server_extensions_dir(self) -> Path:
        return self.code_server_data_dir / "extensions"

    @property
    def code_server_extensions_manifest_path(self) -> Path:
        return self.code_server_extensions_dir / "extensions.json"

    @property
    def code_server_user_settings_path(self) -> Path:
        return self.code_server_data_dir / "User" / "settings.json"

    @property
    def code_server_registry_path(self) -> Path:
        return self.code_server_data_dir / "te2_extension_registry.json"

    @property
    def code_server_socket_path(self) -> Path:
        return self.runtime_root / "code_server.sock"

    @property
    def code_server_probe_output_path(self) -> Path:
        return self.te2_cache_root / "code_server" / "probes" / "te2-probe.jsonl"

    @property
    def code_server_rpc_config_path(self) -> Path:
        return self.te2_cache_root / "code_server" / "probes" / "te2_rpc_config.json"


def resolve_code_te2_paths(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
    uid: int | None = None,
    platform_temp: Path | None = None,
) -> CodeTe2Paths:
    roots = resolve_te2_paths(
        environ,
        home=home,
        uid=uid,
        platform_temp=platform_temp,
    )
    return CodeTe2Paths(
        te2_cache_root=roots.cache_home,
        data_root=roots.data_home / "code_te2",
        config_root=roots.config_home / "code_te2",
        cache_root=roots.cache_home / "code_te2",
        runtime_root=roots.runtime_home / "code_te2",
    )


def code_te2_paths() -> CodeTe2Paths:
    return resolve_code_te2_paths()
