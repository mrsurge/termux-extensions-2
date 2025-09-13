# SESSIONS_AGENT Votes: New Extension Agents

- First Pick: Process Manager (PROC_AGENT)
  - Provides a live process browser with CPU/memory sorting, one-tap signals (TERM/KILL), nice/renice, and per-process cwd/env inspection; it complements Sessions by managing what runs inside them. The agent focuses on safe operations and guidance, explaining effects of actions and suggesting least-disruptive remedies before termination.

- Second Pick: File Explorer (FS_AGENT)
  - Adds a dedicated file manager with directory tree navigation, quick actions (open, edit, chmod +x, move/copy), and integration hooks so other extensions can request a file via an event bus. The agent helps users perform common file tasks correctly, surfaces permission pitfalls, and offers context-aware tips (e.g., executable bit for scripts in ~/.shortcuts).

# Gemini's Vote

## First Pick: System Log Viewer
This extension would provide a real-time, filterable view of system logs (`logcat`, `dmesg`), which would be an invaluable tool for developers and power users to debug the Termux environment itself. The agent for this would specialize in handling streaming data and creating efficient, scrollable UI components.

## Second Pick: Network Tools
This extension would offer a simple graphical frontend for common network utilities like `ping`, `traceroute`, and `nmap`, making diagnostics much faster and more accessible on a touch device. The agent would focus on parsing the text output of these tools into a clean, user-friendly display.
Votes by SHORTCUT_WIZARD_AGENT

First Pick: Package Explorer & Updater (packages_agent)
- A touch-friendly package manager UI for Termux that searches, installs, upgrades, and removes APT packages with clear dependency and disk-usage previews. This empowers users to manage their environment quickly on mobile while the agent encapsulates safe script calls and consistent error handling.

Second Pick: Git Assistant (git_agent)
- A streamlined Git workflow for mobile: pick a repo, stage hunks, commit with templates, view diffs, and push/pull with credential helpers. The agent focuses on robust, low-risk wrappers over standard git commands and adds thoughtful UX like commit lint hints and stash safety nets.

Votes by SYSTEM_STATS_AGENT

1) Process & Service Manager Extension (Agent: PROCESS_MANAGER_AGENT)
Why: Gives users a focused view to find and act on runaway processes and manage termux-services (start/stop/restart) without a shell. The agent would enforce safe Core API usage, robustly parse ps/top/service outputs across BusyBox variants, and add guardrails for destructive actions.

2) Backup & Restore Extension (Agent: BACKUP_AGENT)
Why: Protects users from data loss by creating/restoring compressed snapshots of key Termux directories (e.g., $HOME, .shortcuts, configs) with selectable scopes. The agent would define safe include/exclude heuristics, verify archive integrity, and guide preview-based restores to avoid accidental overwrites.

