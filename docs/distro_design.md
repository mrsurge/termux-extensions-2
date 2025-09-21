# Distro App Design Notes

This document captures the intended architecture for the upcoming "Distro" app,
which manages chroot/proot style containers using the shared framework shell
infrastructure.

## 1. Container Model

Each container entry will be described by a configuration object with the
following properties:

```json
{
  "id": "ubuntu",
  "type": "chroot-distro",         // future: proot, docker, etc.
  "label": "Ubuntu 22.04",
  "rootfs": "/data/.../rootfs/ubuntu",
  "environment": {
    "CHROOT_DISTRO_PATH": "/data/.../rootfs"
  },
  "mounts": [
    {
      "device": "/dev/block/mmcblk1p1",
      "target": "/data/data/com.termux/files/chroot-exec-mnt",
      "filesystem": "auto",
      "options": "rw"
    }
  ],
  "auto_start": false,
  "notes": "SD card rootfs"
}
```

The `mounts` array allows custom block-device or bind mounts. The `environment`
block populates the framework shell before invoking container commands.

## 2. State Machine

Containers move through the states outlined in `docs/distro_states.md`:

Offline ↔ Mounted ↔ Running (with transient Starting/Stopping and an Error state).

- **Offline → Mounted:** execute mount plan for each entry in `mounts`.
- **Mounted → Running:** launch a framework shell running the distro login command.
- **Running → Mounted:** terminate the framework shell gracefully.
- **Mounted → Offline:** unmount the defined targets.

## 3. chroot-distro Plugin

A dedicated backend helper will wrap the chroot-distro CLI:

- `mount(container)` — ensure `CHROOT_DISTRO_PATH` parent exists, call `mount`
  commands via `sudo` or prepared script, optionally run `chroot-distro mount`.
- `start(container)` — spawn framework shell with command:
  ```
  env {...} chroot-distro login <id>
  ```
- `stop(container)` — terminate the framework shell; optionally run
  `chroot-distro unmount <id>` when appropriate.
- `command(container, cmd)` — execute `chroot-distro command <id> "cmd"` either
  via framework shell or a short-lived subprocess.

## 4. Framework Shell Usage

- Each running container corresponds to a unique framework shell (`fs_*` id).
- Metadata links shell id back to container id for state reporting.
- Logs from the framework shell feed the app’s log viewer.

## 5. Session Hand-Off

When the user requests an interactive shell:
1. List interactive sessions via Sessions & Shortcuts API.
2. Inject `chroot-distro login <id>` into the chosen session (or spawn a new one).
3. Keep framework shell alive so the container continues running in the background.

## 6. UI Outline

- **Overview screen:** cards per container showing state, uptime, and quick action
  button (Start/Stop/Open). Status badges reflect the state machine.
- **Details view:** segmented sections for Overview, Resources (CPU/RAM from
  framework shell stats), Advanced (mounts, env vars, auto-start toggle).
- **Settings:** global defaults (default mount base path, tokens, developer mode).
- **Logs:** slide-over panel fetching log tails via framework shell API.

## 7. Implementation Roadmap

1. Encode container config loader + validation (default JSON/YAML file under
   `app/apps/distro/config/containers.json`).
2. Implement backend plugin for `chroot-distro` type using the config above.
3. Wire UI state machine + actions (mount, start, stop, restart) using framework
   shell endpoints.
4. Integrate Sessions & Shortcuts API for interactive shell hand-off.
5. Iterate to add proot-distro support and additional container types.

These notes guide the remaining scaffolding tasks and agent instructions for the
Distro app.

## 10. Import Workflow

The app exposes an "Add Container" modal that captures existing chroot-distro
installations. Users provide:

- Container ID and label
- Rootfs path (selectable via the shared file picker)
- Optional `CHROOT_DISTRO_PATH` (defaults to the parent of the rootfs)
- Optional mount device/target/options
- Auto-start toggle

Submitting writes an entry to `app/apps/distro/config/containers.json` through the
new `/api/app/distro/containers` endpoints (POST/PUT/DELETE). The same surface can
be extended to import proot-distro definitions once that plugin lands.
