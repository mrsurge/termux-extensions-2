# Framework Shells Fork Walkthrough

This document demonstrates the new standalone [framework_shells](file:///home/mrsurge/Documents/framework_shells/app/libs/framework_shells.py#1248-1252) library features, including runtime isolation, dtach persistence, and declarative specs.

## 1. Standalone CLI Usage

You can now use the `fs` CLI to manage shells independently of TE2.

### Define a Spec
Create a `shells.yaml` file:

```yaml
shells:
  my-service:
    command: python3 -m http.server 8000
    autostart: true
    backend: dtach
```

### Apply Spec
```bash
# Set a secret for standalone usage (or let CLI generate ephemeral one)
export FRAMEWORK_SHELLS_SECRET="my-secret-key-123"

# Apply
fs up shells.yaml
```

### List Shells
```bash
fs list
```

## 2. Python API Usage

The Python API provides direct control with runtime isolation.

```python
import asyncio
from framework_shells.manager import FrameworkShellManager

async def demo():
    mgr = FrameworkShellManager()
    
    # Spawn a shell
    record = await mgr.spawn_shell_dtach(
        command=["top", "-b"],
        label="my-top"
    )
    print(f"Spawned {record.id} with PID {record.pid}")
    
    # List
    shells = await mgr.list_shells()
    for s in shells:
        print(s.id, s.status)

if __name__ == "__main__":
    asyncio.run(demo())
```

## 3. Dtach Persistence

Shells spawned with `backend=dtach` (or via [spawn_shell_dtach](file:///home/mrsurge/Documents/framework_shells/framework_shells/manager.py#676-701)) persist even if the manager process exits.

1.  Run `fs up shells.yaml` (with dtach backend).
2.  Kill the `fs` process (Ctrl+C).
3.  Run `fs list`. You will see the shell is still running (adopted).
4.  Run `fs up` again. It will adopt the existing shell instead of spawning a new one.

## 4. Replay and Events

-   **Replay**: `GET /api/framework_shells/{id}/replay` returns the full log history.
-   **Events**: WebSocket at `/ws/events` streams real-time lifecycle events (`shell.created`, `shell.spawned`, `shell.exited`, `shell.pty_chunk`).

## 5. TE2 Integration

The TE2 `sessions_and_shortcuts` extension has been updated to consume the global event bus, enabling real-time UI updates without polling overhead.
