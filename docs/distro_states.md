# Distro Container State Model

The forthcoming Distro app will manage proot/chroot container environments using the
framework shell infrastructure. These are the working states we intend to model.

## States
- **Offline** – No filesystem mounted, no framework shell running.
- **Mounted** – Filesystem prepared (bind mounts or helper scripts executed) but no
  long-lived process active.
- **Starting** – Transition while the framework shell launches the container init
  command.
- **Running** – Framework shell is alive; use `/api/framework_shells` to report PID,
  uptime, and resource stats.
- **Stopping** – Graceful shutdown in progress before unmount/cleanup.
- **Paused** *(optional)* – Future suspension state when container processes can be
  frozen without tear-down.
- **Error** – Last lifecycle action failed; surface log tail and offer recovery.

## Transitions
```
Offline ↔ Mounted ↔ Running
   |         |          |
   +--> Error (recover via user action)
```

`Starting` and `Stopping` wrap the transitions to keep UI responsive while the
underlying processes complete. The Distro app will drive these transitions via the
framework shell API and supporting helper scripts.

## Session Hand-Off
Running containers can expose interactive shells by delegating to the Sessions &
Shortcuts extension: choose a Termux session and send an attach command
(e.g. `proot-distro login <name>`). This keeps the background framework shell and
front-end interactive shell decoupled.

These notes provide context for the upcoming app scaffolding and future agent work.
