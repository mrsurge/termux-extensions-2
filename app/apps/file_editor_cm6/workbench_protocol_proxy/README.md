# workbench_protocol_proxy (observe-only)

This is a transparent HTTP+WebSocket reverse proxy intended to sit in front of a stock
`code-server` instance. It decodes VS Code “workbench protocol” frames (Mgmt + ExtHost)
and emits TE2-friendly JSONL events to stdout.

Scope: lives under `app/apps/file_editor_cm6/` because the consumer is the Monaco
iframe / TE2 editor runtime, not a general tool.

## Run

Start upstream code-server on `127.0.0.1:8080`, then:

```sh
python -m app.apps.file_editor_cm6.workbench_protocol_proxy \
  --listen-host 127.0.0.1 --listen-port 8000 \
  --upstream http://127.0.0.1:8080
```

Defaults (override via args or env):
- `TE2_WPP_LISTEN_HOST` (default `127.0.0.1`)
- `TE2_WPP_LISTEN_PORT` (default `8000`)
- `TE2_WPP_UPSTREAM` (default `http://127.0.0.1:8080`)

## TE2 JSON-RPC side channel

The proxy also exposes a TE2-facing WebSocket endpoint:

- `ws://127.0.0.1:8000/te2/workbench-proxy`

It emits notifications as:

- `{"jsonrpc":"2.0","method":"te2.event","params":{...}}`

Supported JSON-RPC methods:
- `te2.ping`
- `te2.status` (returns the current active ExtHost `ws_id` + last seen hover hints)
- `vscode.hover` (best-effort injection; requires an active ExtHost stream + previously observed `$provideHover` to learn `rpcId` and `provider_handle`)

## Output (stdout JSONL)

Events currently emitted:
- `diagnostics/changeMany` from ExtHost method `$changeMany`
- `hover/request` + `hover/reply` from ExtHost method `$provideHover`
- `hover/provider_registration` (log-only heuristic; no handle mapping yet)

Notes:
- The proxy forwards WS frames byte-for-byte. Decoding is side-effect-only.
- Stream kind is determined by sniffing decoded Regular payloads (Mgmt vs ExtHost),
  with handshake `connectionType` used as a hint when present.

## Headless client (no browser)

You can also run a minimal “headless workbench client” that opens both Management + ExtensionHost
WebSockets and keeps them alive (Pause/Resume/Ack/KeepAlive), which is useful when running
the Go `vscode-protocol` decoder MITM proxy:

```sh
python -m app.apps.file_editor_cm6.workbench_protocol_proxy.headless_client \
  --http-base http://127.0.0.1:8000 \
  --folder /data/data/com.termux/files/home/mrselect6
```
