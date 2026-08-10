# Vendored VS Code OSS Sources (Reference)

This folder contains **verbatim copies** of selected upstream VS Code OSS TypeScript sources used to implement the workbench<->remote agent WebSocket connection and wire framing.

These files are copied from a code-server build output (VS Code OSS) captured in `mrselect6-2/localhost8080/.../lib/vscode/src/...`.

We keep these as an **authoritative reference** for protocol details while implementing a **Node-compatible runtime port** in `../vscode_oss_runtime/`.

Currently vendored:

- `vs/platform/remote/common/remoteAgentConnection.ts`
- `vs/platform/remote/browser/browserSocketFactory.ts`
- `vs/base/parts/ipc/common/ipc.net.ts`

