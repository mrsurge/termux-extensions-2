"""Dependency-free console usage shared by CLI and bootstrap help."""

CONSOLE_USAGE = """Console commands:
  te2 console list-workers [--url URL]
  te2 console logging on|off|status [--url URL]
      Runtime-only logging default for new/reloaded built-in app pages.
      List live worker IDs; use an exact ID for evaluation.
  te2 console eval --worker ID [--code JAVASCRIPT] [--timeout SECONDS] [--url URL]
      Evaluate in one live worker; omit --code to read JavaScript from stdin.
  te2 console tail [--worker ID] [--limit N] [--level LEVEL]
      Read recent persisted console entries (works offline).
  te2 console search QUERY [--worker ID] [--limit N] [--level LEVEL]
      Search persisted console entries, case-insensitively (works offline).
  te2 console <command> --help
      Show command-specific options.
"""
