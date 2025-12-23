"""LSP shell lifecycle helper.

Dex • 2025-12-08

Spawns and tracks language servers as framework shells, reusing them
across file switches. Designed to stay lightweight and stateless beyond
an in-memory cache of shell IDs.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shlex
import shutil
from pathlib import Path
from typing import Dict, Optional

from framework_shells import ShellRecord, get_manager


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
}

# Vendor bin directory (npm-installed servers live here when vendored)
VENDOR_BIN = Path(__file__).parents[2] / "static" / "vendor" / "lsp_servers" / "node_modules" / ".bin"


# Minimal in-memory tracking; avoids persisting state outside manager.
_language_shell_ids: Dict[str, str] = {}
_active_language_id: Optional[str] = None


def _label(language_id: str) -> str:
    return f"lsp:{language_id}"


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


async def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Fetch existing shell by language or spawn a new one.

    Returns None if the language isn't supported or required binary is missing.
    """

    cmd = LSP_COMMANDS.get(language_id)
    if not cmd:
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
    label = _label(language_id)

    # Prefer cached shell if still alive.
    cached_id = _language_shell_ids.get(language_id)
    if cached_id:
        cached = await _get_alive_shell(cached_id)
        if cached and mgr.get_pipe_state(cached.id):
            return cached
        # Cached record exists but we have no live pipe handles (e.g. adopted across restart).
        _language_shell_ids.pop(language_id, None)

    # Fallback to label lookup (covers adopted shells across restarts).
    existing = await mgr.find_shell_by_label(label, status="running")
    if existing:
        if mgr.get_pipe_state(existing.id):
            _language_shell_ids[language_id] = existing.id
            return existing
        # Pipe shells can't be reused without live handles; terminate and respawn.
        try:
            await mgr.terminate_shell(existing.id, force=True)
        except Exception:
            pass

    # Spawn fresh shell with live pipes for LSP bidirectional communication.
    try:
        record = await mgr.spawn_shell_pipe(
            full_cmd,
            cwd=str(project_root),
            label=label,
            subgroups=["file_editor_cm6", "lsp"],
            autostart=True,
        )
    except Exception as exc:  # Keep failure silent-ish; editor shouldn't crash.
        print(f"[LSP shells] Failed to spawn {language_id}: {exc}")
        return None

    _language_shell_ids[language_id] = record.id
    global _active_language_id
    _active_language_id = language_id
    return record


async def get_active_lsp_shell() -> Optional[ShellRecord]:
    """Return the currently active shell if it is still running."""

    if not _active_language_id:
        return None
    cached_id = _language_shell_ids.get(_active_language_id)
    if not cached_id:
        return None
    record = await _get_alive_shell(cached_id)
    if record:
        return record

    # Clean stale cache
    _language_shell_ids.pop(_active_language_id, None)
    return None


async def switch_lsp_shell(new_language_id: str, project_root: Path) -> Optional[ShellRecord]:
    """Switch active shell to the requested language, spawning if needed."""

    record = await get_or_spawn_lsp_shell(new_language_id, project_root)
    if record:
        global _active_language_id
        _active_language_id = new_language_id
    return record


async def shutdown_lsp_shell(language_id: str) -> None:
    """Gracefully terminate a language shell if running."""

    mgr = await get_manager()
    label = _label(language_id)

    shell_id = _language_shell_ids.get(language_id)
    target: Optional[ShellRecord] = None

    if shell_id:
        target = await mgr.get_shell(shell_id)
    if not target:
        target = await mgr.find_shell_by_label(label, status=None)

    if not target:
        return

    try:
        await mgr.terminate_shell(target.id)
    except Exception as exc:
        print(f"[LSP shells] Terminate failed for {language_id}: {exc}")

    _language_shell_ids.pop(language_id, None)
    global _active_language_id
    if _active_language_id == language_id:
        _active_language_id = None


# Small helper for tests/debugging.
async def list_lsp_shells() -> Dict[str, Optional[ShellRecord]]:
    """Return a snapshot of language→shell mapping for debug output."""

    snapshot: Dict[str, Optional[ShellRecord]] = {}
    for lang, shell_id in _language_shell_ids.items():
        snapshot[lang] = await _get_alive_shell(shell_id)
    return snapshot
