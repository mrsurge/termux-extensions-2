# VS Code OSS Runtime Port (Node)

This directory contains a minimal **Node-compatible port** of the upstream VS Code OSS connection stack:

- `remoteAgentConnection` (handshake: `auth` → `sign` → `connectionType`)
- `browserSocketFactory` (WebSocket URL construction)
- `ipc.net` (wire framing: TYPE/ID/ACK/LEN + keepalive/ack)

Only the pieces required by TE2's headless workbench client are implemented.

