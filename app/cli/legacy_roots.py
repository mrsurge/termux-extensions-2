from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import stat
import sys
import time
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, TypeAlias, cast

from app.te2_paths import ensure_runtime_home, resolve_te2_paths, te2_app_data_home


MIGRATION_ID = "legacy-roots-v1"
MIGRATION_VERSION = 1
_STAGE_MARKER = f".te2-{MIGRATION_ID}"
_COPY_BUFFER_SIZE = 1024 * 1024
_MIN_FREE_MARGIN_BYTES = 64 * 1024 * 1024

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
ActionKind = Literal["migrate_file", "migrate_tree", "delete", "report"]
ActionStatus = Literal["absent", "migrate", "overwrite", "delete", "report"]
Validator = Callable[[Path], None]


class MigrationError(RuntimeError):
    pass


class ActiveFrameworkError(MigrationError):
    pass


class MigrationAlreadyAppliedError(MigrationError):
    pass


@dataclass(frozen=True)
class LegacyRoots:
    home: Path
    legacy_cache_base: Path
    legacy_data_base: Path
    legacy_config_base: Path
    legacy_runtime_base: Path
    cache_home: Path
    data_home: Path
    config_home: Path
    runtime_home: Path

    @property
    def receipt_path(self) -> Path:
        return self.data_home / "migrations" / f"{MIGRATION_ID}.json"

    @property
    def framework_guard_path(self) -> Path:
        return self.runtime_home / "framework" / "migration.guard"

    @property
    def migration_lock_path(self) -> Path:
        return self.runtime_home / "migrations" / f"{MIGRATION_ID}.lock"


@dataclass(frozen=True)
class MigrationSpec:
    action_id: str
    kind: ActionKind
    source: Path
    destination: Path | None = None
    validator: Validator | None = None
    note: str = ""
    ignored_children: frozenset[str] = frozenset()


@dataclass(frozen=True)
class MigrationPlanItem:
    action_id: str
    kind: ActionKind
    status: ActionStatus
    source: str
    destination: str | None
    note: str
    unknown_children: tuple[str, ...] = ()


@dataclass(frozen=True)
class MigrationResult:
    migration_id: str
    applied: bool
    receipt_path: str
    receipt_exists: bool
    changed: tuple[str, ...]
    items: tuple[MigrationPlanItem, ...]

    def to_json(self) -> dict[str, object]:
        return {
            "migrationId": self.migration_id,
            "applied": self.applied,
            "receiptPath": self.receipt_path,
            "receiptExists": self.receipt_exists,
            "changed": list(self.changed),
            "items": [asdict(item) for item in self.items],
        }


def resolve_legacy_roots(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
    uid: int | None = None,
    platform_temp: Path | None = None,
) -> LegacyRoots:
    source = environ if environ is not None else os.environ
    resolved_home = home or _absolute_optional(source.get("HOME"), "HOME") or Path.home()
    if not resolved_home.is_absolute():
        raise ValueError(f"HOME must be an absolute path: {resolved_home}")

    cache_base = _xdg_base(source, "XDG_CACHE_HOME", resolved_home / ".cache")
    data_base = _xdg_base(source, "XDG_DATA_HOME", resolved_home / ".local" / "share")
    config_base = _xdg_base(source, "XDG_CONFIG_HOME", resolved_home / ".config")
    runtime_base = _xdg_base(source, "XDG_RUNTIME_DIR", resolved_home / ".local" / "run")
    canonical = resolve_te2_paths(
        source,
        home=resolved_home,
        uid=uid,
        platform_temp=platform_temp,
    )
    return LegacyRoots(
        home=resolved_home,
        legacy_cache_base=cache_base,
        legacy_data_base=data_base,
        legacy_config_base=config_base,
        legacy_runtime_base=runtime_base,
        cache_home=canonical.cache_home,
        data_home=canonical.data_home,
        config_home=canonical.config_home,
        runtime_home=canonical.runtime_home,
    )


def migration_specs(roots: LegacyRoots) -> tuple[MigrationSpec, ...]:
    old_framework = roots.legacy_cache_base / "termux_extensions"
    old_code_te2_cache = roots.home / ".cache" / "cm6_editor"
    old_code_te2_data = roots.home / ".local" / "share" / "termux-extensions-2"
    old_code_server = roots.home / ".config" / "code-server"
    old_build = roots.legacy_cache_base / "te2-rust-spike"
    old_app_server = roots.home / ".cache" / "app_server"

    code_te2_data = roots.data_home / "code_te2"
    code_te2_config = roots.config_home / "code_te2"
    code_server_data = code_te2_data / "code_server"

    specs: list[MigrationSpec] = [
        _file("framework-settings", old_framework / "settings.json", roots.config_home / "framework" / "settings.json", _json_object),
        _file("framework-state", old_framework / "state_store.json", roots.data_home / "framework" / "state_store.json", _json_object),
        _file("framework-jobs", old_framework / "jobs.json", roots.data_home / "framework" / "jobs.json", _json_object),
        _file(
            "framework-bookmarks",
            old_framework / "file_explorer" / "bookmarks" / "bookmarks.json",
            roots.data_home / "framework" / "bookmarks.json",
            _json_array,
        ),
        _tree("code-te2-projects", old_code_te2_cache / "projects", code_te2_data / "projects", _project_sidecar_tree),
        _file(
            "code-te2-browser-console",
            old_code_te2_cache / "console_log.jsonl",
            roots.cache_home / "code_te2" / "browser_console.log",
            _regular_file,
        ),
        _file("code-te2-history", old_code_te2_data / "code_oss_history.json", code_te2_data / "history.json", _json_object),
        _file("code-te2-preferences", old_code_te2_data / "code_oss_prefs.json", code_te2_config / "preferences.json", _json_object),
        _tree("code-te2-agent-icons", old_code_te2_data / "agent_icons", code_te2_data / "agent_icons", _plain_tree),
        _tree("code-server-user", old_code_server / "User", code_server_data / "User", _plain_tree),
        _tree("code-server-machine", old_code_server / "Machine", code_server_data / "Machine", _plain_tree),
        _tree(
            "code-server-profiles",
            old_code_server / "CachedProfilesData",
            code_server_data / "CachedProfilesData",
            _plain_tree,
        ),
        _tree(
            "code-server-cached-vsix",
            old_code_server / "CachedExtensionVSIXs",
            code_server_data / "CachedExtensionVSIXs",
            _plain_tree,
        ),
        _tree("code-server-extensions", old_code_server / "extensions", code_server_data / "extensions", _extension_tree),
        _file("code-server-coder-state", old_code_server / "coder.json", code_server_data / "coder.json", _json_value),
        _file(
            "code-server-extension-registry",
            old_code_server / "te2_extension_registry.json",
            code_server_data / "te2_extension_registry.json",
            _json_object,
        ),
        _file(
            "code-server-rpc-config",
            old_code_server / "te2_rpc_config.json",
            roots.cache_home / "code_server" / "probes" / "te2_rpc_config.json",
            _json_object,
        ),
        _file(
            "aria-downloader-state",
            roots.home / ".cache" / "aria_downloader" / "framework_shell.json",
            te2_app_data_home(
                "aria_downloader",
                {
                    "TE2_DATA_HOME": str(roots.data_home),
                    "HOME": str(roots.home),
                },
                home=roots.home,
            )
            / "framework_shell.json",
            _aria_state,
        ),
        _tree(
            "framework-shells-cache",
            roots.legacy_cache_base / "framework_shells",
            roots.cache_home / "framework_shells",
            _plain_tree,
        ),
        _tree(
            "framework-cargo-target",
            old_build / "cargo-target",
            roots.cache_home / "framework" / "build" / "cargo-target",
            _plain_tree,
        ),
        _file(
            "framework-console-log",
            old_app_server / "te2_console_log.jsonl",
            roots.cache_home / "console" / "te2_console_log.jsonl",
            _regular_file,
        ),
        _delete("obsolete-framework-binaries", old_build / "bin", "Obsolete fingerprinted final binaries are not imported."),
        _delete("obsolete-cm6-sessions", roots.home / ".cache" / "cm6_sessions", "The retired session cache has no current owner."),
        _delete("obsolete-code-server-logs", old_code_server / "logs", "Historical code-server logs are rebuildable."),
        _delete("obsolete-android-install-cache", roots.legacy_cache_base / "te2-android-install", "Old Android install APKs are rebuildable publication scratch."),
        _delete("obsolete-electrobun-cache", roots.legacy_cache_base / "dev.te2.desktop", "Retired Electrobun cache."),
        _delete(
            "obsolete-electrobun-cef-cache",
            roots.legacy_cache_base / "dev.te2.desktop.cef-spike",
            "Retired Electrobun CEF cache.",
        ),
        _delete("obsolete-python-framework-cache", roots.home / ".cache" / "te_framework", "Retired Python framework runtime state."),
        _delete("obsolete-dtach-session-cache", roots.home / ".cache" / "te", "Retired dtach session metadata."),
        _delete("obsolete-dtach-runtime", roots.legacy_runtime_base / "te", "Retired dtach runtime sockets."),
        _report(
            "unowned-kotlin-lsp-cache",
            roots.legacy_cache_base / "te2_kotlin_lsp",
            "No current in-repository producer is proven; leave untouched.",
        ),
        _report(
            "unrecognized-app-server-cache",
            old_app_server,
            "Only the legacy TE2 console transcript is owned by this migration.",
            {"te2_console_log.jsonl"},
        ),
        _report(
            "external-code-server-config",
            old_code_server,
            "Standalone code-server configuration and unrecognized entries remain external.",
            {
                "User",
                "Machine",
                "CachedProfilesData",
                "CachedExtensionVSIXs",
                "extensions",
                "coder.json",
                "te2_extension_registry.json",
                "te2_rpc_config.json",
                "logs",
            },
        ),
    ]
    return tuple(specs)


def build_plan(roots: LegacyRoots) -> tuple[MigrationPlanItem, ...]:
    items: list[MigrationPlanItem] = []
    for spec in migration_specs(roots):
        if spec.kind == "report":
            unknown = _unknown_children(spec.source, spec.ignored_children)
            status: ActionStatus = "report" if unknown else "absent"
            items.append(
                MigrationPlanItem(
                    action_id=spec.action_id,
                    kind=spec.kind,
                    status=status,
                    source=str(spec.source),
                    destination=None,
                    note=spec.note,
                    unknown_children=unknown,
                )
            )
            continue

        if not spec.source.exists() and not spec.source.is_symlink():
            status = "absent"
        elif spec.kind == "delete":
            status = "delete"
        elif spec.destination is not None and spec.destination.exists():
            status = "overwrite"
        else:
            status = "migrate"
        items.append(
            MigrationPlanItem(
                action_id=spec.action_id,
                kind=spec.kind,
                status=status,
                source=str(spec.source),
                destination=str(spec.destination) if spec.destination is not None else None,
                note=spec.note,
            )
        )
    return tuple(items)


def run_migration(roots: LegacyRoots, *, apply: bool = False) -> MigrationResult:
    items = build_plan(roots)
    receipt_exists = roots.receipt_path.is_file()
    if not apply:
        return MigrationResult(
            migration_id=MIGRATION_ID,
            applied=False,
            receipt_path=str(roots.receipt_path),
            receipt_exists=receipt_exists,
            changed=(),
            items=items,
        )
    if receipt_exists:
        raise MigrationAlreadyAppliedError(
            f"migration receipt already exists: {roots.receipt_path}"
        )

    specs = migration_specs(roots)
    changed: list[str] = []
    with _exclusive_apply_locks(roots):
        if roots.receipt_path.exists():
            raise MigrationAlreadyAppliedError(
                f"migration receipt already exists: {roots.receipt_path}"
            )
        _validate_apply_sources(specs)
        _validate_disk_space(specs)
        for spec in specs:
            if spec.kind == "report":
                continue
            _recover_interrupted_destination(spec)
            if not spec.source.exists() and not spec.source.is_symlink():
                continue
            if spec.kind == "migrate_file":
                _migrate_file(spec)
            elif spec.kind == "migrate_tree":
                _migrate_tree(spec)
            elif spec.kind == "delete":
                _delete_allowlisted_path(spec.source)
            changed.append(spec.action_id)

        _prune_empty_legacy_roots(roots)
        _write_receipt(roots, changed)

    return MigrationResult(
        migration_id=MIGRATION_ID,
        applied=True,
        receipt_path=str(roots.receipt_path),
        receipt_exists=True,
        changed=tuple(changed),
        items=items,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="te2 migrate-legacy-roots",
        description=(
            "Inspect or apply the one-time migration from allowlisted legacy TE2 roots. "
            "Dry-run is the default."
        ),
    )
    _ = parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the printed migration and cleanup actions. Legacy source files overwrite matching canonical files.",
    )
    _ = parser.add_argument("--json", action="store_true", help="Print structured JSON output.")
    args = parser.parse_args(argv)
    try:
        result = run_migration(resolve_legacy_roots(), apply=cast(bool, args.apply))
    except (MigrationError, OSError) as exc:
        if cast(bool, args.json):
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        else:
            print(f"Migration refused: {exc}", file=sys.stderr)
        return 2

    if cast(bool, args.json):
        print(json.dumps({"ok": True, **result.to_json()}, indent=2, sort_keys=True))
    else:
        _print_human_result(result)
    return 0


def _file(action_id: str, source: Path, destination: Path, validator: Validator) -> MigrationSpec:
    return MigrationSpec(action_id, "migrate_file", source, destination, validator)


def _tree(action_id: str, source: Path, destination: Path, validator: Validator) -> MigrationSpec:
    return MigrationSpec(action_id, "migrate_tree", source, destination, validator)


def _delete(action_id: str, source: Path, note: str) -> MigrationSpec:
    return MigrationSpec(action_id, "delete", source, note=note)


def _report(
    action_id: str,
    source: Path,
    note: str,
    ignored_children: set[str] | None = None,
) -> MigrationSpec:
    return MigrationSpec(
        action_id,
        "report",
        source,
        note=note,
        ignored_children=frozenset(ignored_children or set()),
    )


def _validate_apply_sources(specs: Sequence[MigrationSpec]) -> None:
    for spec in specs:
        if spec.kind == "report" or (not spec.source.exists() and not spec.source.is_symlink()):
            continue
        if spec.source.is_symlink():
            raise MigrationError(f"allowlisted source must not be a symbolic link: {spec.source}")
        if spec.kind == "delete":
            _validate_plain_path(spec.source)
            continue
        if spec.destination is None or spec.validator is None:
            raise MigrationError(f"invalid migration specification: {spec.action_id}")
        spec.validator(spec.source)
        if spec.destination.exists() or spec.destination.is_symlink():
            if spec.destination.is_symlink():
                raise MigrationError(
                    f"canonical destination must not be a symbolic link: {spec.destination}"
                )
            if spec.kind == "migrate_file" and not spec.destination.is_file():
                raise MigrationError(f"canonical destination is not a file: {spec.destination}")
            if spec.kind == "migrate_tree" and not spec.destination.is_dir():
                raise MigrationError(f"canonical destination is not a directory: {spec.destination}")
            spec.validator(spec.destination)


def _validate_disk_space(specs: Sequence[MigrationSpec]) -> None:
    required_by_device: dict[int, tuple[Path, int]] = {}
    for spec in specs:
        if spec.kind not in {"migrate_file", "migrate_tree"} or not spec.source.exists():
            continue
        assert spec.destination is not None
        ancestor = _existing_ancestor(spec.destination.parent)
        device = ancestor.stat().st_dev
        required = _path_size(spec.source)
        if spec.kind == "migrate_tree" and spec.destination.exists():
            required += _path_size(spec.destination)
        previous = required_by_device.get(device)
        required_by_device[device] = (ancestor, required + (previous[1] if previous else 0))

    for ancestor, required in required_by_device.values():
        free = shutil.disk_usage(ancestor).free
        minimum = required + _MIN_FREE_MARGIN_BYTES
        if free < minimum:
            raise MigrationError(
                f"insufficient free space near {ancestor}: need {minimum} bytes, have {free}"
            )


@contextmanager
def _exclusive_apply_locks(roots: LegacyRoots) -> Generator[None, None, None]:
    _ = ensure_runtime_home(roots.runtime_home)
    framework_dir = ensure_runtime_home(roots.framework_guard_path.parent)
    migration_dir = ensure_runtime_home(roots.migration_lock_path.parent)
    guard_path = framework_dir / roots.framework_guard_path.name
    lock_path = migration_dir / roots.migration_lock_path.name
    with guard_path.open("a+b") as guard_file:
        try:
            fcntl.flock(guard_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ActiveFrameworkError(
                "the TE2 framework is active; stop it before applying legacy migration"
            ) from exc
        with lock_path.open("a+b") as migration_file:
            try:
                fcntl.flock(migration_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise MigrationError("another legacy-root migration is active") from exc
            try:
                yield
            finally:
                fcntl.flock(migration_file.fileno(), fcntl.LOCK_UN)
        fcntl.flock(guard_file.fileno(), fcntl.LOCK_UN)


def _migrate_file(spec: MigrationSpec) -> None:
    assert spec.destination is not None and spec.validator is not None
    source = spec.source
    destination = spec.destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage, _backup = _transaction_paths(spec)
    _remove_internal_path(stage)
    with source.open("rb") as reader, stage.open("xb") as writer:
        shutil.copyfileobj(reader, writer, length=_COPY_BUFFER_SIZE)
        writer.flush()
        os.fsync(writer.fileno())
    shutil.copystat(source, stage, follow_symlinks=False)
    with stage.open("rb") as staged_file:
        os.fsync(staged_file.fileno())
    spec.validator(stage)
    os.replace(stage, destination)
    _fsync_dir(destination.parent)
    source.unlink()
    _fsync_dir(source.parent)


def _migrate_tree(spec: MigrationSpec) -> None:
    assert spec.destination is not None and spec.validator is not None
    source = spec.source
    destination = spec.destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage, backup = _transaction_paths(spec)
    _remove_internal_path(stage)
    _remove_internal_path(backup)

    if destination.exists():
        _ = shutil.copytree(destination, stage, copy_function=shutil.copy2)
        _ = shutil.copytree(source, stage, dirs_exist_ok=True, copy_function=shutil.copy2)
    else:
        _ = shutil.copytree(source, stage, copy_function=shutil.copy2)
    spec.validator(stage)
    _fsync_tree(stage)

    moved_destination = False
    try:
        if destination.exists():
            os.replace(destination, backup)
            moved_destination = True
        os.replace(stage, destination)
        _fsync_dir(destination.parent)
    except BaseException:
        if moved_destination and not destination.exists() and backup.exists():
            os.replace(backup, destination)
            _fsync_dir(destination.parent)
        raise

    shutil.rmtree(source)
    _fsync_dir(source.parent)
    _remove_internal_path(backup)
    _fsync_dir(destination.parent)


def _recover_interrupted_destination(spec: MigrationSpec) -> None:
    if spec.destination is None:
        return
    stage, backup = _transaction_paths(spec)
    if backup.exists() and not spec.destination.exists():
        spec.destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(backup, spec.destination)
        _fsync_dir(spec.destination.parent)
    elif backup.exists():
        _remove_internal_path(backup)
    if stage.exists():
        _remove_internal_path(stage)


def _transaction_paths(spec: MigrationSpec) -> tuple[Path, Path]:
    assert spec.destination is not None
    digest = hashlib.sha256(spec.action_id.encode("utf-8")).hexdigest()[:12]
    prefix = f"{_STAGE_MARKER}-{digest}"
    return (
        spec.destination.parent / f"{prefix}.stage",
        spec.destination.parent / f"{prefix}.backup",
    )


def _delete_allowlisted_path(path: Path) -> None:
    _validate_plain_path(path)
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)
    _fsync_dir(path.parent)


def _remove_internal_path(path: Path) -> None:
    if path.is_symlink():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _prune_empty_legacy_roots(roots: LegacyRoots) -> None:
    candidates = (
        roots.legacy_cache_base / "termux_extensions",
        roots.home / ".cache" / "cm6_editor",
        roots.legacy_data_base / "termux-extensions-2",
        roots.home / ".cache" / "aria_downloader",
        roots.legacy_cache_base / "te2-rust-spike",
    )
    for root in candidates:
        if not root.exists() or root.is_symlink() or not root.is_dir():
            continue
        directories = sorted(
            (path for path in root.rglob("*") if path.is_dir() and not path.is_symlink()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for path in directories:
            try:
                path.rmdir()
            except OSError:
                pass
        try:
            root.rmdir()
            _fsync_dir(root.parent)
        except OSError:
            pass


def _write_receipt(roots: LegacyRoots, changed: Sequence[str]) -> None:
    receipt = {
        "version": MIGRATION_VERSION,
        "migrationId": MIGRATION_ID,
        "completedAt": time.time(),
        "collisionPolicy": "legacy-source-overwrites-matching-canonical-files",
        "changed": list(changed),
    }
    roots.receipt_path.parent.mkdir(parents=True, exist_ok=True)
    temp = roots.receipt_path.with_name(f".{roots.receipt_path.name}.{os.getpid()}.tmp")
    payload = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    with temp.open("x", encoding="utf-8") as file_obj:
        _ = file_obj.write(payload)
        file_obj.flush()
        os.fsync(file_obj.fileno())
    os.replace(temp, roots.receipt_path)
    _fsync_dir(roots.receipt_path.parent)


def _validate_plain_path(path: Path) -> None:
    if path.is_symlink():
        raise MigrationError(f"allowlisted cleanup path must not be a symbolic link: {path}")
    if path.is_dir():
        return
    if path.is_file():
        return
    raise MigrationError(f"allowlisted path has unsupported file type: {path}")


def _regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise MigrationError(f"expected a regular file: {path}")


def _json_value(path: Path) -> None:
    _regular_file(path)
    try:
        _ = cast(JsonValue, json.loads(path.read_text("utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MigrationError(f"invalid JSON file {path}: {exc}") from exc


def _json_object(path: Path) -> None:
    _json_value(path)
    value = cast(JsonValue, json.loads(path.read_text("utf-8")))
    if not isinstance(value, dict):
        raise MigrationError(f"expected a JSON object: {path}")


def _json_array(path: Path) -> None:
    _json_value(path)
    value = cast(JsonValue, json.loads(path.read_text("utf-8")))
    if not isinstance(value, list):
        raise MigrationError(f"expected a JSON array: {path}")


def _aria_state(path: Path) -> None:
    _json_object(path)
    value = cast(dict[str, JsonValue], json.loads(path.read_text("utf-8")))
    if not isinstance(value.get("id"), str) or not str(value["id"]).strip():
        raise MigrationError(f"Aria Downloader state has no shell id: {path}")


def _plain_tree(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise MigrationError(f"expected a directory: {path}")
    for child in path.rglob("*"):
        if child.is_symlink():
            raise MigrationError(f"migration trees must not contain symbolic links: {child}")
        mode = child.stat().st_mode
        if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise MigrationError(f"migration trees must contain only files and directories: {child}")


def _project_sidecar_tree(path: Path) -> None:
    _plain_tree(path)
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        if child.suffix != ".json":
            raise MigrationError(f"unexpected project-sidecar file: {child}")
        _json_object(child)
        payload = cast(dict[str, JsonValue], json.loads(child.read_text("utf-8")))
        if not isinstance(payload.get("project_path"), str):
            raise MigrationError(f"project sidecar has no project_path: {child}")
        if child.name.endswith(".draft_index.json"):
            if not isinstance(payload.get("draft_files"), list):
                raise MigrationError(f"draft index has no draft_files array: {child}")
        elif not isinstance(payload.get("version"), int):
            raise MigrationError(f"project sidecar has no integer version: {child}")


def _extension_tree(path: Path) -> None:
    _plain_tree(path)
    manifest = path / "extensions.json"
    if manifest.exists():
        _json_array(manifest)


def _unknown_children(path: Path, ignored: frozenset[str]) -> tuple[str, ...]:
    if not path.exists() or path.is_symlink() or not path.is_dir():
        return ()
    names = sorted(child.name for child in path.iterdir() if child.name not in ignored)
    return tuple(names[:64])


def _path_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for child in path.rglob("*"):
        if child.is_file() and not child.is_symlink():
            total += child.stat().st_size
    return total


def _existing_ancestor(path: Path) -> Path:
    current = path
    while not current.exists():
        parent = current.parent
        if parent == current:
            raise MigrationError(f"no existing ancestor for destination: {path}")
        current = parent
    return current


def _fsync_tree(root: Path) -> None:
    files: list[Path] = []
    directories: list[Path] = [root]
    for child in root.rglob("*"):
        if child.is_file():
            files.append(child)
        elif child.is_dir():
            directories.append(child)
    for path in files:
        with path.open("rb") as file_obj:
            os.fsync(file_obj.fileno())
    for path in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        _fsync_dir(path)


def _fsync_dir(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _xdg_base(environ: Mapping[str, str], key: str, fallback: Path) -> Path:
    explicit = _absolute_optional(environ.get(key), key)
    return explicit or fallback


def _absolute_optional(raw: str | None, key: str) -> Path | None:
    text = str(raw or "").strip()
    if not text:
        return None
    path = Path(text)
    if not path.is_absolute():
        raise ValueError(f"{key} must be an absolute path: {text!r}")
    return path


def _print_human_result(result: MigrationResult) -> None:
    mode = "APPLY" if result.applied else "DRY RUN"
    print(f"TE2 legacy-root migration {MIGRATION_ID} ({mode})")
    print(f"Receipt: {result.receipt_path} ({'present' if result.receipt_exists else 'absent'})")
    for item in result.items:
        if item.status == "absent":
            continue
        destination = f" -> {item.destination}" if item.destination else ""
        print(f"[{item.status}] {item.action_id}: {item.source}{destination}")
        if item.note:
            print(f"  {item.note}")
        if item.unknown_children:
            print(f"  retained: {', '.join(item.unknown_children)}")
    if not result.applied:
        print("No files were changed. Re-run with --apply to execute this exact policy.")
    else:
        print(f"Applied {len(result.changed)} actions and wrote the one-time receipt.")


if __name__ == "__main__":
    raise SystemExit(main())
