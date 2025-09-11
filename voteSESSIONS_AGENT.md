# SESSIONS_AGENT Votes: New Extension Agents

- First Pick: Process Manager (PROC_AGENT)
  - Provides a live process browser with CPU/memory sorting, one-tap signals (TERM/KILL), nice/renice, and per-process cwd/env inspection; it complements Sessions by managing what runs inside them. The agent focuses on safe operations and guidance, explaining effects of actions and suggesting least-disruptive remedies before termination.

- Second Pick: File Explorer (FS_AGENT)
  - Adds a dedicated file manager with directory tree navigation, quick actions (open, edit, chmod +x, move/copy), and integration hooks so other extensions can request a file via an event bus. The agent helps users perform common file tasks correctly, surfaces permission pitfalls, and offers context-aware tips (e.g., executable bit for scripts in ~/.shortcuts).

