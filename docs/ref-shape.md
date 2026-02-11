═══════════════════════════════════════════════════════════════════════
 TE2 WORKBENCH RPC: THE DEFINITIVE CUT PLAN
 From Spaghetti to Pipeline — Zero HTTP in Editor Dataflow
═══════════════════════════════════════════════════════════════════════

INVARIANTS (non-negotiable):
  * STDIO framework shell for adapter &lt;-&gt; editor_ws.py communication
  * No HTTP polling/posting in ANY editor dataflow path
  * No fallbacks. Hard reroutes only.
  * Diagnostics bridge stays as-is (already clean: adapter WS -&gt; bridge -&gt; Socket.IO)
  * One frontend socket for all editor intelligence: editor_ws Socket.IO

═══════════════════════════════════════════════════════════════════════
 CURRENT TOPOLOGY (the mess)
═══════════════════════════════════════════════════════════════════════

  HOVER REQUEST (6 network hops):
  Browser -&gt; vscode_api_ws (raw WS)
    -&gt; vscode_api_transport.py (main proc WS proxy)
      -&gt; vscode_api_server.mjs (framework shell middleman)
        -&gt; workerApiPost('/workbench_adapter/cmd') (HTTP to worker)
          -&gt; main.py /workbench_adapter/cmd (HTTP proxy)
            -&gt; httpx POST adapter:18181/cmd (HTTP)
              -&gt; workbench_client.mjs -&gt; code-server (WS)

  DIAGNOSTICS (2 hops, clean -- DO NOT TOUCH):
  code-server -&gt; workbench_client.mjs -&gt; adapter /ws broadcast
    -&gt; diagnostics_bridge.py (WS client) -&gt; editor Socket.IO -&gt; Browser

  DIAGNOSTICS NUDGE (1 HTTP hop):
  editor_ws.py -&gt; httpx POST adapter:18181/cmd

═══════════════════════════════════════════════════════════════════════
 TARGET TOPOLOGY
═══════════════════════════════════════════════════════════════════════

  HOVER/SYMBOLS/OPENFILE (2 hops, zero HTTP):
  Browser -&gt; editor_ws Socket.IO
    -&gt; editor_ws.py (worker)
      -&gt; adapter stdin (pipe, same process group)
        -&gt; workbench_client.mjs -&gt; code-server (WS)
      &lt;- adapter stdout (pipe)
    &lt;- editor Socket.IO response

  DIAGNOSTICS (unchanged, 2 hops):
  code-server -&gt; workbench_client.mjs -&gt; adapter /ws broadcast
    -&gt; diagnostics_bridge.py -&gt; editor Socket.IO -&gt; Browser

  DIAGNOSTICS NUDGE (zero HTTP -- now also over stdio pipe):
  editor_ws.py -&gt; adapter stdin (pipe) -&gt; response on stdout

  BOOTSTRAP/CONNECT (zero HTTP -- stdio):
  editor_ws.py -&gt; adapter stdin: {"method":"adapter.connect",...}
    -&gt; adapter connects to code-server (WS)
    -&gt; stdout: {"result": ...}

═══════════════════════════════════════════════════════════════════════
 FRAMEWORK SHELLS PIPE BACKEND -- THE KEY
═══════════════════════════════════════════════════════════════════════

  framework_shells (pip package, v0.0.4) has backend: "pipe"

  shellspec YAML:
    backend: pipe
    -&gt; spawns with asyncio.subprocess.PIPE for stdin/stdout
    -&gt; PipeState holds live process handle
    -&gt; manager.get_pipe_state(shell_id) -&gt; PipeState.process.stdin/.stdout

  JSON-RPC over stdio protocol:
    Write to stdin:  {"jsonrpc":"2.0","id":1,"method":"vscode.hover","params":{...}}\n
    Read from stdout: {"jsonrpc":"2.0","id":1,"result":{...}}\n
    (newline-delimited JSON, one object per line)

  The adapter ALREADY has handleJsonRpc(obj) as its single dispatch.
  Adding a stdio listener is ~20 lines of Node.js.

═══════════════════════════════════════════════════════════════════════
 EXECUTION STAGES
═══════════════════════════════════════════════════════════════════════

----------------------------------------------------------------------
 STAGE 1: Adapter gains stdio JSON-RPC listener
 Scope: server.mjs only (Node side)
----------------------------------------------------------------------

  Add to server.mjs (alongside existing HTTP server):

  * Read lines from process.stdin
  * Parse each line as JSON
  * Call existing handleJsonRpc(obj)
  * Write JSON response + newline to process.stdout
  * Separate stdout for RPC responses vs console.log (use stderr
    for logs, or prefix RPC lines with a sentinel)

  Convention:
    RPC responses on stdout: &lt;&lt;&lt;RPC&gt;&gt;&gt; {json}\n
    All other stdout (logs, status) unchanged
    Python splits the stream trivially on the prefix

  The HTTP server stays alive for now (diagnostics_bridge WS).
  It gets removed in Stage 6.

  Behavior: adapter accepts commands from BOTH HTTP /cmd AND stdin.
  Same handleJsonRpc. Two transports. Zero behavior change.

----------------------------------------------------------------------
 STAGE 2: Adapter shell switches to pipe backend
 Scope: shellspec + shell manager (Python side)
----------------------------------------------------------------------

  workbench_adapter.yaml:
    backend: pipe          # was: proc
    readiness:
      type: stdout_regex   # was: tcp_port
      pattern: '"type":"adapter/start"'
      timeout: 20

  workbench_adapter_shell_manager.py:
    * After spawn, stash PipeState reference
    * Expose async helper: adapter_rpc(method, params) -&gt; result
      - Generates unique id
      - Writes JSON-RPC line to process.stdin
      - Reads lines from process.stdout until matching id
      - Returns result (or raises on error)
    * Multiplexed reader task:
      - Continuously reads stdout lines
      - RPC responses (&lt;&lt;&lt;RPC&gt;&gt;&gt; prefix) -&gt; routed to pending futures by id
      - Non-RPC lines -&gt; logged / forwarded to stdout_log

  This is the FOUNDATION. Once adapter_rpc() exists, everything
  else is just calling it.

----------------------------------------------------------------------
 STAGE 3: editor_ws.py gains workbench RPC handlers (over stdio)
 Scope: editor_ws.py, diagnostics_bridge.py (Python worker side)
----------------------------------------------------------------------

  New Socket.IO event handlers in /editor namespace:

  * on_editor_workbench_open_file(sid, data)
      -&gt; adapter_rpc("vscode.openFile", {...})
      -&gt; emit("editor:workbench_open_file_response", {request_id, result})

  * on_editor_workbench_hover(sid, data)
      -&gt; adapter_rpc("vscode.hover", {path, line, character, languageId})
      -&gt; emit("editor:workbench_hover_response", {request_id, result})

  * on_editor_workbench_symbols(sid, data)
      -&gt; adapter_rpc("vscode.documentSymbols", {path, languageId})
      -&gt; emit("editor:workbench_symbols_response", {request_id, result})

  Each handler:
    - Validates path under active project
    - Calls adapter_rpc (stdio, zero network)
    - Emits response ONLY to requesting sid
    - Passes through request_id for correlation

  ALSO: diagnostics nudge: httpx POST -&gt; adapter_rpc (stdio)

----------------------------------------------------------------------
 STAGE 4: Frontend swaps to editor socket for all workbench RPC
 Scope: m_editor_app.js (browser side)
----------------------------------------------------------------------

  New function:
    editorWorkbenchCall(method, params, opts)
      - Generates request_id
      - editorSocket.emit("editor:workbench_&lt;method&gt;", ...)
      - Returns promise resolved by matching response event
      - Respects existing stale/cancel guards

  Hard reroutes:

  4a. hover:
    _callVscodeApiGuarded("hover") -&gt; editorWorkbenchCall("hover")

  4b. symbols:
    _callVscodeApiGuarded("symbols") -&gt; editorWorkbenchCall("symbols")

  4c. openFile (2 call sites ~3194, ~3281):
    vscodeApiCall("vscode.openFile") -&gt; editorWorkbenchCall("open_file")

  CRITICAL: openFile triggers adapter.connect (bootstrap).
  Stage 3's handler calls adapter_rpc over stdio to the SAME
  handleJsonRpc. Bootstrap preserved. Zero behavior change.

----------------------------------------------------------------------
 STAGE 5: Strip dead middleman from workbench RPC
 Scope: vscode_api_server.mjs (worktree), main.py
----------------------------------------------------------------------

  vscode_api_server.mjs:
    * Remove: vscode.openFile, vscode.hover, vscode.documentSymbols
    * Remove: ensureWorkbenchConnected(), /workbench_adapter/* calls
    * Keep ONLY: themes, grammars, languages, bootstrap snapshot

  main.py:
    * /workbench_adapter/cmd -&gt; deprecate (admin/debug only)
    * /workbench_adapter/nudge -&gt; remove

----------------------------------------------------------------------
 STAGE 6: Kill adapter HTTP server
 Scope: server.mjs (final cleanup)
----------------------------------------------------------------------

  * Remove http.createServer, POST /cmd, GET /health
  * Keep ONLY: /ws for diagnostics bridge event stream
  * Adapter becomes pure: stdio + WS-to-code-server
  * No port allocation needed

  After Stage 6, the adapter has:
    IN:  stdin (JSON-RPC from editor_ws.py via pipe)
    OUT: stdout (JSON-RPC responses, &lt;&lt;&lt;RPC&gt;&gt;&gt; prefixed)
    OUT: WS to code-server (ext host protocol)
    OUT: WS /ws for diagnostics bridge (until future migration)

═══════════════════════════════════════════════════════════════════════
 BEHAVIOR PRESERVATION CHECKLIST (after each stage)
═══════════════════════════════════════════════════════════════════════

  [ ] Hover: request -&gt; provider -&gt; response -&gt; tooltip
  [ ] Symbols: outline populates
  [ ] Diagnostics: markers appear after file open
  [ ] Baton: pending spinner -&gt; matched -&gt; ready
  [ ] openFile triggers adapter bootstrap (adapter.connect)
  [ ] Multi-language providers (all languages, not just Python)
  [ ] File switching: no regressions

═══════════════════════════════════════════════════════════════════════
 FILE CHANGE MAP
═══════════════════════════════════════════════════════════════════════

  Stage 1: server.mjs (+stdin reader, +stdout RPC writer)
  Stage 2: workbench_adapter.yaml, workbench_adapter_shell_manager.py
  Stage 3: editor_ws.py, diagnostics_bridge.py
  Stage 4: m_editor_app.js
  Stage 5: vscode_api_server.mjs (worktree), main.py
  Stage 6: server.mjs (-HTTP server)

═══════════════════════════════════════════════════════════════════════
 NET RESULT
═══════════════════════════════════════════════════════════════════════

  BEFORE: 6 hops, 3 HTTP jumps, 2 WS proxies, 1 dead middleman
  AFTER:  1 stdio pipe + 1 WS (code-server). Zero HTTP in dataflow.

  Browser &lt;-Socket.IO-&gt; editor_ws.py &lt;-stdio pipe-&gt; adapter &lt;-WS-&gt; code-server

  Three processes. Two connections. One pipe. Done.
═══════════════════════════════════════════════════════════════════════