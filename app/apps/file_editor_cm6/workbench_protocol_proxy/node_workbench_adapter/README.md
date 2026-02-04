# Node workbench adapter (TE2)

This directory holds a Node.js “workbench adapter” process that will eventually:

- Connect to code-server through the Go decoder proxy (inline from byte 0)
- Perform mgmt+ext initialization (headless; no browser)
- Expose a stable TE2 control API (HTTP JSON-RPC; WebSocket JSON-RPC later)

## Run (current skeleton)

```sh
node app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs
```

Then:

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"te2.ping"}' \
  http://127.0.0.1:8001/cmd
```

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"adapter.status"}' \
  http://127.0.0.1:8001/cmd
```

## Connect + symbols (through Go proxy)

Start the Go decoder proxy separately (keep it inline for logging/decoding).

Then connect the adapter to code-server through the proxy:

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":10,"method":"adapter.connect","params":{"proxyHttp":"http://127.0.0.1:8000","folder":"/data/data/com.termux/files/home/mrselect6","authority":"localhost:8000"}}' \
  http://127.0.0.1:8001/cmd
```

Open a file:

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":11,"method":"vscode.openFile","params":{"path":"/data/data/com.termux/files/home/mrselect6/app/ipc/client.py","languageId":"python","authority":"localhost:8000"}}' \
  http://127.0.0.1:8001/cmd
```

Then request document symbols:

```sh
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":12,"method":"vscode.documentSymbols","params":{"path":"/data/data/com.termux/files/home/mrselect6/app/ipc/client.py","authority":"localhost:8000"}}' \
  http://127.0.0.1:8001/cmd
```
