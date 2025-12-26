from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable


_INIT_SCRIPT = r"""
// TE2 init script: adds a task to print resolved classpath artifacts (jar/aar).
// Supports flavor/variant classpaths via -Pte2Variant=GeckoDebug -Pte2Module=app.

gradle.rootProject { root ->
  root.tasks.register('te2ResolveClasspath') {
    doLast {
      def te2Module = (root.findProperty('te2Module') ?: 'app').toString()
      def te2Variant = (root.findProperty('te2Variant') ?: '').toString()
      def proj = root.findProject(":${te2Module}")
      if (proj == null) { proj = root.findProject(':app') }
      if (proj == null) { proj = root }

      def cfgNames = []
      if (te2Variant != null && te2Variant.trim()) {
        def v = te2Variant.trim()
        def vPrefix = v.substring(0, 1).toLowerCase() + v.substring(1)
        cfgNames.add(vPrefix + 'CompileClasspath')
        cfgNames.add(vPrefix + 'RuntimeClasspath')
      }
      // Fallbacks for non-flavored projects
      cfgNames.addAll([
        'debugCompileClasspath',
        'releaseCompileClasspath',
        'debugRuntimeClasspath',
        'releaseRuntimeClasspath'
      ])

      def seen = new LinkedHashSet<File>()

      cfgNames.each { name ->
        def cfg = proj.configurations.findByName(name)
        if (cfg != null && cfg.canBeResolved) {
          try {
            cfg.resolve().each { f ->
              if (f != null && (f.name.endsWith('.jar') || f.name.endsWith('.aar'))) {
                if (seen.add(f)) {
                  println "TE2_ART:${f.absolutePath}"
                }
              }
            }
          } catch (Exception e) {
            // ignore
          }
        }
      }
    }
  }
}
"""


def _find_gradlew(project_root: Path) -> Path | None:
    cand = project_root / "gradlew"
    if cand.is_file():
        return cand
    return None


def resolve_artifacts_via_gradle(
    *,
    project_root: Path,
    cache_dir: Path,
    module: str = "app",
    variant: str = "",
    timeout_s: int = 60,
    extra_args: Iterable[str] = (),
) -> list[str]:
    """Return absolute paths to resolved artifacts (jar/aar) via Gradle."""

    gradlew = _find_gradlew(project_root)
    if not gradlew:
        return []

    init_path = cache_dir / "te2_resolve_classpath.init.gradle"
    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        init_path.write_text(_INIT_SCRIPT, encoding="utf-8")
    except Exception:
        return []

    cmd = [
        str(gradlew),
        "-q",
        "-I",
        str(init_path),
        f"-Pte2Module={module or 'app'}",
    ]
    if variant:
        cmd.append(f"-Pte2Variant={variant}")
    cmd.extend(["te2ResolveClasspath", "--no-daemon"])
    cmd.extend(list(extra_args))

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except Exception:
        return []

    out = (proc.stdout or "") + "\n" + (proc.stderr or "")
    paths: list[str] = []
    seen: set[str] = set()
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("TE2_ART:"):
            continue
        p = line.split(":", 1)[1].strip()
        if not p or p in seen:
            continue
        seen.add(p)
        paths.append(p)

    return paths
