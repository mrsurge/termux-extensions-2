from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable


_INIT_SCRIPT = r"""
// TE2 init script: adds a task to print resolved classpath artifacts (jar/aar).

gradle.rootProject { root ->
  root.tasks.register('te2ResolveClasspath') {
    doLast {
      def preferred = []
      def appProj = root.findProject(':app')
      if (appProj != null) { preferred.add(appProj) }
      preferred.add(root)

      def cfgNames = [
        'debugCompileClasspath',
        'releaseCompileClasspath',
        'debugRuntimeClasspath',
        'releaseRuntimeClasspath'
      ]

      def seen = new LinkedHashSet<File>()

      preferred.each { prj ->
        cfgNames.each { name ->
          def cfg = prj.configurations.findByName(name)
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

    cmd = [str(gradlew), "-q", "-I", str(init_path), "te2ResolveClasspath", "--no-daemon"]
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
