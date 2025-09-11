Votes by SYSTEM_STATS_AGENT

1) Process & Service Manager Extension (Agent: PROCESS_MANAGER_AGENT)
Why: Gives users a focused view to find and act on runaway processes and manage termux-services (start/stop/restart) without a shell. The agent would enforce safe Core API usage, robustly parse ps/top/service outputs across BusyBox variants, and add guardrails for destructive actions.

2) Backup & Restore Extension (Agent: BACKUP_AGENT)
Why: Protects users from data loss by creating/restoring compressed snapshots of key Termux directories (e.g., $HOME, .shortcuts, configs) with selectable scopes. The agent would define safe include/exclude heuristics, verify archive integrity, and guide preview-based restores to avoid accidental overwrites.

