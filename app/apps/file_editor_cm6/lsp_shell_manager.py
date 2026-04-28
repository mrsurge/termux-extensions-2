"""LSP shell lifecycle helper.

Dex • 2025-12-08

Spawns and tracks language servers as framework shells, reusing them
across file switches. Designed to stay lightweight and stateless beyond
an in-memory cache of shell IDs.
"""
# comme
from __future__ import annotations

import asyncio
import hashlib
import os
import shlex
import shutil
from pathlib import Path
from typing import Dict, Optional, Tuple

from framework_shells import ShellRecord, get_manager
from framework_shells.orchestrator import Orchestrator


# --- Command mapping (extend as new servers become available) ---
LSP_COMMANDS: Dict[str, list[str]] = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "typescriptreact": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "javascriptreact": ["typescript-language-server", "--stdio"],
    # JetBrains Kotlin LSP (zip distro); defaults to stdio.
    "kotlin": ["kotlin-lsp.sh"],
    # C/C++ via clangd (Termux package works on Android).
    "c": ["clangd"],
    "cpp": ["clangd"],
    # TODO: add go (gopls), rust (rust-analyzer) when ready.
    # NOTE: "kotlin-android" is handled separately via shellspec (see _spawn_android_kotlin_lsp)
}

# Vendor bin directory (npm-installed servers live here when vendored)
VENDOR_BIN = Path(__file__).parents[2] / "static" / "vendor" / "lsp_servers" / "node_modules" / ".bin"

# Android Kotlin LSP vendor path (app/static/vendor/lsp_servers/android-kotlin-lsp/)
ANDROID_KOTLIN_LSP_BIN = Path(__file__).parents[2] / "static" / "vendor" / "lsp_servers" / "android-kotlin-lsp" / "server" / "bin" / "kotlin-language-server"

# Shellspec directory for this app
SHELLSPEC_DIR = Path(__file__).parent / "shellspec"


# Minimal in-memory tracking; avoids persisting state outside manager.
_language_shell_ids: Dict[Tuple[str, str], str] = {}
_active_shell_key: Optional[Tuple[str, str]] = None


def _root_key(project_root: Path) -> str:
    try:
        return str(project_root.expanduser().resolve(strict=False))
    except Exception:
        return str(project_root)


def _cache_key(language_id: str, project_root: Path) -> Tuple[str, str]:
    return (language_id, _root_key(project_root))


def _label(language_id: str, project_root: Optional[Path] = None) -> str:
    if project_root is None:
        return f"lsp:{language_id}"
    root_str = _root_key(project_root)
    digest = hashlib.sha1(root_str.encode("utf-8")).hexdigest()[:8]
    return f"lsp:{language_id}:{digest}"


def _label_for_key(language_id: str, root_key: str) -> str:
    digest = hashlib.sha1(root_key.encode("utf-8")).hexdigest()[:8]
    return f"lsp:{language_id}:{digest}"


def _is_termux_android() -> bool:
    """Best-effort Termux/Android detection for runtime compatibility tweaks."""

    # Termux always sets PREFIX to /data/data/com.termux/files/usr
    prefix = os.getenv("PREFIX", "")
    if prefix.startswith("/data/data/com.termux/"):
        return True

    # Android environment variables commonly present for app processes
    if os.getenv("ANDROID_ROOT") or os.getenv("ANDROID_DATA"):
        return True

    return False


def _resolve_kotlin_lsp_sh() -> Optional[str]:
    """Resolve JetBrains kotlin-lsp.sh from env or preferences.

    Kotlin LSP can be vendored under:
      app/static/vendor/lsp_servers/kotlin-lsp/kotlin-lsp.sh
    or overridden via preference/env vars for custom installs.
    """

    # 1) Script path via editor preferences (explicit config wins)
    try:
        from app.apps.file_editor_cm6.stores import _preferences_store  # local import avoids cycles at import time

        prefs = _preferences_store.get_preferences().get("editor", {})
        raw = prefs.get("kotlinLspPath")
        if raw:
            p = Path(raw).expanduser()
            if p.exists() and p.is_file():
                return str(p)
    except Exception:
        pass

    # 2) Direct script path via env
    for key in ("TE2_KOTLIN_LSP_SH", "KOTLIN_LSP_SH"):
        raw = os.getenv(key)
        if not raw:
            continue
        p = Path(raw).expanduser()
        if p.exists() and p.is_file():
            return str(p)

    # 3) Vendored distro path (repo-local)
    vendor_sh = Path(__file__).parents[2] / "static" / "vendor" / "lsp_servers" / "kotlin-lsp" / "kotlin-lsp.sh"
    if vendor_sh.exists() and vendor_sh.is_file():
        return str(vendor_sh)

    # 4) Extracted distribution directory via env
    for key in ("TE2_KOTLIN_LSP_HOME", "KOTLIN_LSP_HOME"):
        raw = os.getenv(key)
        if not raw:
            continue
        p = (Path(raw).expanduser() / "kotlin-lsp.sh")
        if p.exists() and p.is_file():
            return str(p)

    return None


def _kotlin_lsp_has_bundled_jre(kotlin_lsp_sh: str) -> bool:
    """Return True if the Kotlin LSP distro includes a bundled JRE next to the script."""

    try:
        base_dir = Path(kotlin_lsp_sh).expanduser().resolve(strict=False).parent
    except Exception:
        base_dir = Path(kotlin_lsp_sh).expanduser().parent

    # Linux packages typically ship "jre/bin/java".
    if (base_dir / "jre" / "bin" / "java").is_file():
        return True

    # macOS packages ship "jre/Contents/Home/bin/java".
    if (base_dir / "jre" / "Contents" / "Home" / "bin" / "java").is_file():
        return True

    return False


def _kotlin_lsp_base_dir(kotlin_lsp_sh: str) -> Path:
    try:
        return Path(kotlin_lsp_sh).expanduser().resolve(strict=False).parent
    except Exception:
        return Path(kotlin_lsp_sh).expanduser().parent


def _kotlin_lsp_java_bin(kotlin_lsp_sh: str) -> Optional[str]:
    base_dir = _kotlin_lsp_base_dir(kotlin_lsp_sh)

    # Linux packages ship "jre/bin/java".
    linux_java = base_dir / "jre" / "bin" / "java"
    if linux_java.is_file():
        return str(linux_java)

    # macOS packages ship "jre/Contents/Home/bin/java".
    mac_java = base_dir / "jre" / "Contents" / "Home" / "bin" / "java"
    if mac_java.is_file():
        return str(mac_java)

    return None


def _kotlin_cache_root(project_root: Path) -> Path:
    """Per-project Kotlin LSP cache root to avoid cross-workspace contention."""

    try:
        root_str = str(project_root.expanduser().resolve(strict=False))
    except Exception:
        root_str = str(project_root)
    digest = hashlib.sha1(root_str.encode("utf-8")).hexdigest()[:12]
    return Path.home() / ".cache" / "te2_kotlin_lsp" / digest


def _resolve_grun() -> Optional[str]:
    for name in ("grun", "glibc-runner"):
        found = shutil.which(name)
        if found:
            return found

    # Hard fallback for Termux installations.
    for candidate in (
        "/data/data/com.termux/files/usr/bin/grun",
        "/data/data/com.termux/files/usr/bin/glibc-runner",
    ):
        if Path(candidate).is_file():
            return candidate

    return None


def _resolve_binary(binary: str) -> Optional[str]:
    """Prefer vendored binary, then PATH."""

    if binary in ("kotlin-lsp.sh", "kotlin-lsp"):
        resolved = _resolve_kotlin_lsp_sh()
        if resolved:
            return resolved

    # Prefer vendored npm bin (Dex vendor note)
    for candidate in (
        VENDOR_BIN / binary,
        VENDOR_BIN / f"{binary}.cmd",  # Windows npm shim if ever present
    ):
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    found = shutil.which(binary)
    return found


async def _get_alive_shell(shell_id: str) -> Optional[ShellRecord]:
    mgr = await get_manager()
    record = await mgr.get_shell(shell_id)
    if record and record.pid and record.status == "running":
        return record
    return None


async def _spawn_android_kotlin_lsp(project_root: Path) -> Optional[ShellRecord]:
    """Spawn Android Kotlin LSP via shellspec.
    
    This LSP delegates diagnostics to Gradle compilation instead of using
    the Kotlin compiler directly. It only provides diagnostics, not
    completion/hover/go-to-definition.
    """

    global _active_shell_key

    # Check if the Android LSP binary exists
    if not ANDROID_KOTLIN_LSP_BIN.exists():
        print(f"[LSP shells] Android Kotlin LSP not found at: {ANDROID_KOTLIN_LSP_BIN}")
        print("[LSP shells] Build it with: cd app/static/vendor/ignored/kotlin-language-server && ./gradlew :server:distZip")
        return None
    
    mgr = await get_manager()
    orch = Orchestrator(mgr)
    
    project_hash = hashlib.sha1(str(project_root).encode()).hexdigest()[:8]
    cache_key = _cache_key("kotlin-android", project_root)
    label = _label("kotlin-android", project_root)
    
    # Check for existing running shell
    cached_id = _language_shell_ids.get(cache_key)
    if cached_id:
        cached = await _get_alive_shell(cached_id)
        if cached and mgr.get_pipe_state(cached.id):
            _active_shell_key = cache_key
            return cached
        _language_shell_ids.pop(cache_key, None)

    # Check by label
    existing = await mgr.find_shell_by_label(label, status="running")
    if not existing:
        legacy_label = _label("kotlin-android")
        if legacy_label != label:
            has_any = any(lang == "kotlin-android" for lang, _ in _language_shell_ids.keys())
            if not has_any:
                existing = await mgr.find_shell_by_label(legacy_label, status="running")
    if existing:
        if mgr.get_pipe_state(existing.id):
            _language_shell_ids[cache_key] = existing.id
            _active_shell_key = cache_key
            return existing
        # Stale - terminate and respawn
        try:
            await mgr.terminate_shell(existing.id, force=True)
        except Exception:
            pass
    
    # Spawn via shellspec
    try:
        shell = await orch.start_from_ref(
            "android_lsp.yaml#android-kotlin-lsp",
            base_dir=SHELLSPEC_DIR,
            ctx={
                "PROJECT_ROOT": str(project_root),
                "PROJECT_HASH": project_hash,
                "ANDROID_LSP_BIN": str(ANDROID_KOTLIN_LSP_BIN),
            },
            label=label,
        )
    except Exception as exc:
        print(f"[LSP shells] Failed to spawn Android Kotlin LSP: {exc}")
        return None

    _language_shell_ids[cache_key] = shell.id
    _active_shell_key = cache_key
    return shell


async def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Fetch existing shell by language or spawn a new one.

    Returns None if the language isn't supported or required binary is missing.
    """

    global _active_shell_key

    print(f"[LSP shells] get_or_spawn_lsp_shell called: language_id={language_id}, project_root={project_root}")

    # Handle Android Kotlin LSP via shellspec (separate from regular Kotlin LSP)
    if language_id == "kotlin-android":
        print(f"[LSP shells] Routing to Android Kotlin LSP spawn")
        return await _spawn_android_kotlin_lsp(project_root)

    cmd = LSP_COMMANDS.get(language_id)
    if not cmd:
        print(f"[LSP shells] No command mapping for language_id={language_id}")
        return None

    resolved_binary = _resolve_binary(cmd[0])
    if not resolved_binary:
        if language_id == "kotlin":
            print(
                "[LSP shells] Missing Kotlin LSP; run scripts/vendor_kotlin_lsp.sh or set editor.kotlinLspPath / TE2_KOTLIN_LSP_HOME / TE2_KOTLIN_LSP_SH"
            )
        else:
            print(f"[LSP shells] Missing binary for {language_id}: {cmd[0]}")
        return None

    # Kotlin zip distro ships a bash script, but on Termux (bionic) the official
    # Kotlin LSP uses glibc-linked native components (filewatcher JNI) and may
    # also assume a writable /tmp. For the platform zip (bundled jre/), run the
    # bundled java via glibc-runner (ld.so) and provide idea/tmp paths.
    if language_id == "kotlin":
        is_android = _is_termux_android()
        grun = _resolve_grun()

        # Prefer bundled JRE when present (stable across distros/JDK versions).
        java_bin = _kotlin_lsp_java_bin(resolved_binary) or shutil.which("java")

        # Prefer direct Java launch (lets us control cache dirs + system-path on all platforms).
        base_dir = _kotlin_lsp_base_dir(resolved_binary)
        lib_dir = base_dir / "lib"
        try:
            jars = sorted(str(p) for p in lib_dir.glob("*.jar") if p.is_file())
        except Exception:
            jars = []

        if java_bin and jars:
            classpath = ":".join(jars)

            # Cache paths must be writable; keep them per-project to avoid collisions
            # when multiple workspaces are open (or when servers restart).
            cache_root = _kotlin_cache_root(project_root)
            tmp_dir = cache_root / "tmp"
            system_dir = cache_root / "idea-system"
            config_dir = cache_root / "idea-config"
            lsp_system_dir = cache_root / "kotlin-lsp-system"
            for d in (tmp_dir, system_dir, config_dir, lsp_system_dir):
                d.mkdir(parents=True, exist_ok=True)

            # Ensure executable bit in case unzip didn't preserve it.
            try:
                Path(java_bin).chmod(0o755)
            except Exception:
                pass

            # Keep the opens list aligned with JetBrains launcher scripts.
            add_opens = [
                "--add-opens", "java.base/java.io=ALL-UNNAMED",
                "--add-opens", "java.base/java.lang=ALL-UNNAMED",
                "--add-opens", "java.base/java.lang.ref=ALL-UNNAMED",
                "--add-opens", "java.base/java.lang.reflect=ALL-UNNAMED",
                "--add-opens", "java.base/java.net=ALL-UNNAMED",
                "--add-opens", "java.base/java.nio=ALL-UNNAMED",
                "--add-opens", "java.base/java.nio.charset=ALL-UNNAMED",
                "--add-opens", "java.base/java.text=ALL-UNNAMED",
                "--add-opens", "java.base/java.time=ALL-UNNAMED",
                "--add-opens", "java.base/java.util=ALL-UNNAMED",
                "--add-opens", "java.base/java.util.concurrent=ALL-UNNAMED",
                "--add-opens", "java.base/java.util.concurrent.atomic=ALL-UNNAMED",
                "--add-opens", "java.base/java.util.concurrent.locks=ALL-UNNAMED",
                "--add-opens", "java.base/jdk.internal.vm=ALL-UNNAMED",
                "--add-opens", "java.base/sun.net.dns=ALL-UNNAMED",
                "--add-opens", "java.base/sun.nio.ch=ALL-UNNAMED",
                "--add-opens", "java.base/sun.nio.fs=ALL-UNNAMED",
                "--add-opens", "java.base/sun.security.ssl=ALL-UNNAMED",
                "--add-opens", "java.base/sun.security.util=ALL-UNNAMED",
                "--add-opens", "java.desktop/java.awt=ALL-UNNAMED",
                "--add-opens", "java.management/sun.management=ALL-UNNAMED",
                "--add-opens", "jdk.attach/sun.tools.attach=ALL-UNNAMED",
                "--add-opens", "jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
                "--add-opens", "jdk.internal.jvmstat/sun.jvmstat.monitor=ALL-UNNAMED",
                "--add-opens", "jdk.jdi/com.sun.tools.jdi=ALL-UNNAMED",
            ]

            java_argv = [
                f"-Djava.io.tmpdir={tmp_dir}",
                f"-Didea.system.path={system_dir}",
                f"-Didea.config.path={config_dir}",
                "--enable-native-access=ALL-UNNAMED",
                "-Djdk.lang.Process.launchMechanism=FORK",
                "-Djava.awt.headless=true",
                *add_opens,
                "-cp", classpath,
                "com.jetbrains.ls.kotlinLsp.KotlinLspServerKt",
                "--stdio",
                "--system-path",
                str(lsp_system_dir),
                *cmd[1:],
            ]

            if is_android and grun and _kotlin_lsp_java_bin(resolved_binary):
                kotlin_args = [grun, java_bin, *java_argv]

                # Android-only SELinux step. Use `sudo -n` to avoid hanging on password prompts.
                # UI opt-in happens when the user enables LSP; once enabled, Kotlin LSP auto-applies this workaround.
                joined = " ".join(shlex.quote(x) for x in kotlin_args)
                prelude = (
                    "if uname -a 2>/dev/null | grep -qi Android; then "
                    "if command -v sudo >/dev/null 2>&1; then sudo -n setenforce 0 >/dev/null 2>&1 || true; fi; "
                    "fi; "
                )
                full_cmd = ["bash", "-lc", prelude + "exec " + joined]
            else:
                # Desktop Linux/macOS (and Termux when not using bundled java): run java directly.
                full_cmd = [java_bin, *java_argv]
        else:
            if is_android:
                if not grun:
                    print("[LSP shells] Kotlin LSP: glibc-runner (grun) not found; launch will fail on Termux")
                if not _kotlin_lsp_java_bin(resolved_binary):
                    print("[LSP shells] Kotlin LSP: no bundled jre/ found; vendor the platform zip (linux-aarch64)")
            if not jars:
                print(f"[LSP shells] Kotlin LSP: no jars found under {lib_dir}")
            if not java_bin:
                print("[LSP shells] Kotlin LSP: java not found (no bundled JRE and no system java on PATH)")
            # Final fallback: run the vendor script directly.
            full_cmd = [resolved_binary, "--stdio", *cmd[1:]]
    else:
        full_cmd = [resolved_binary, *cmd[1:]]

    mgr = await get_manager()
    cache_key = _cache_key(language_id, project_root)
    label = _label(language_id, project_root)

    # Prefer cached shell if still alive.
    cached_id = _language_shell_ids.get(cache_key)
    if cached_id:
        cached = await _get_alive_shell(cached_id)
        if cached and mgr.get_pipe_state(cached.id):
            _active_shell_key = cache_key
            return cached
        # Cached record exists but we have no live pipe handles (e.g. adopted across restart).
        _language_shell_ids.pop(cache_key, None)

    # Fallback to label lookup (covers adopted shells across restarts).
    existing = await mgr.find_shell_by_label(label, status="running")
    if not existing:
        legacy_label = _label(language_id)
        if legacy_label != label:
            has_any = any(lang == language_id for lang, _ in _language_shell_ids.keys())
            if not has_any:
                existing = await mgr.find_shell_by_label(legacy_label, status="running")
    if existing:
        if mgr.get_pipe_state(existing.id):
            _language_shell_ids[cache_key] = existing.id
            _active_shell_key = cache_key
            return existing
        # Pipe shells can't be reused without live handles; terminate and respawn.
        try:
            await mgr.terminate_shell(existing.id, force=True)
        except Exception:
            pass

    # Build environment for LSP process
    # Include Android SDK paths for Kotlin/Android projects
    lsp_env = None
    if language_id == "kotlin":
        lsp_env = dict(os.environ)
        # Ensure ANDROID_HOME is set (preferred by Gradle/Android tools)
        android_sdk = os.getenv("ANDROID_SDK_ROOT") or os.getenv("ANDROID_HOME")
        if android_sdk:
            lsp_env["ANDROID_HOME"] = android_sdk
            lsp_env["ANDROID_SDK_ROOT"] = android_sdk
    elif language_id == "python":
        # Ensure pyright-langserver sees the repo modules similarly to the CLI scan.
        lsp_env = dict(os.environ)
        try:
            repo_root = str(project_root.expanduser().resolve(strict=False).parent)
        except Exception:
            repo_root = str(project_root)
        existing = (lsp_env.get("PYTHONPATH") or "").strip()
        parts = [repo_root, str(project_root)]
        if existing:
            parts.append(existing)
        lsp_env["PYTHONPATH"] = ":".join([p for p in parts if p])

    # Spawn fresh shell with live pipes for LSP bidirectional communication.
    try:
        record = await mgr.spawn_shell_pipe(
            full_cmd,
            cwd=str(project_root),
            env=lsp_env,
            label=label,
            subgroups=["file_editor_cm6", "lsp"],
            autostart=True,
        )
    except Exception as exc:  # Keep failure silent-ish; editor shouldn't crash.
        print(f"[LSP shells] Failed to spawn {language_id}: {exc}")
        return None

    _language_shell_ids[cache_key] = record.id
    _active_shell_key = cache_key
    return record


async def get_active_lsp_shell() -> Optional[ShellRecord]:
    """Return the currently active shell if it is still running."""

    if not _active_shell_key:
        return None
    cached_id = _language_shell_ids.get(_active_shell_key)
    if not cached_id:
        return None
    record = await _get_alive_shell(cached_id)
    if record:
        return record

    # Clean stale cache
    _language_shell_ids.pop(_active_shell_key, None)
    return None


async def switch_lsp_shell(new_language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Switch active shell to the requested language, spawning if needed."""

    global _active_shell_key

    record = await get_or_spawn_lsp_shell(new_language_id, project_root)
    if record:
        _active_shell_key = _cache_key(new_language_id, project_root)
    return record


async def shutdown_lsp_shell(language_id: str) -> None:
    """Gracefully terminate a language shell if running."""

    global _active_shell_key

    mgr = await get_manager()

    shell_ids: set[str] = set()
    for (lang, _root_key_val), shell_id in list(_language_shell_ids.items()):
        if lang == language_id:
            shell_ids.add(shell_id)

    try:
        shells = await mgr.list_shells()
    except Exception:
        shells = []

    label_prefix = f"lsp:{language_id}"
    for rec in shells:
        try:
            if rec.label and rec.label.startswith(label_prefix):
                shell_ids.add(rec.id)
        except Exception:
            continue

    for shell_id in shell_ids:
        try:
            await mgr.terminate_shell(shell_id)
        except Exception as exc:
            print(f"[LSP shells] Terminate failed for {language_id}: {exc}")

    # Remove cached entries for this language.
    for key in [k for k in _language_shell_ids.keys() if k[0] == language_id]:
        _language_shell_ids.pop(key, None)

    if _active_shell_key and _active_shell_key[0] == language_id:
        _active_shell_key = None


# Small helper for tests/debugging.
async def list_lsp_shells() -> Dict[str, Optional[ShellRecord]]:
    """Return a snapshot of language→shell mapping for debug output."""

    snapshot: Dict[str, Optional[ShellRecord]] = {}
    for (lang, root_key), shell_id in _language_shell_ids.items():
        key = _label_for_key(lang, root_key)
        snapshot[key] = await _get_alive_shell(shell_id)
    return snapshot
