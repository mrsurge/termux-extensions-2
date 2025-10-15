**Subject:** Feedback on “Code‑Server Mobile Bridge MVP — Document Mirror & Live Agent Edits”

Hi there,

We’ve been working through the plan you outlined and wanted to capture where things stand, what’s blocking us, and how we might plug the remaining holes—especially around the focused document view, explorer data, and agent panel.

---

### Where We’re Stuck (Web/`code-server` build)

- **Bridge worker sandbox**: Running inside the browser limits the web extension to fetch-only requests subject to strict CORS and prevents it from posting to the parent frame. Practically, that means:
  - `doc_state` / `doc_changes` events never make it back to our wrapper, so the Monaco mirror has nothing to render.
  - Explorer events (`explorerTree`, `workspaceFolders`) stall for the same reason, leaving the drawer empty.
  - Chat/assistant content can’t reach the wrapper either, so the panel stays blank.
- **Backend is ready but idle**: We already expose `/api/app/code_oss/state` with a ring buffer and summary, but without inbound events the wrapper keeps polling “nothing new.”
- **Fall back to “list files manually”** isn’t viable: polling directories from the backend can fake an explorer, but it breaks the goal of mirroring the actual Code OSS state and adds dead code that never worked in the desired flow.

---

### Why X-backed Code OSS Looks Appealing

- Running the Electron build under Termux:X11 (or similar) gives the extension host full Node APIs and a relaxed security model. That immediately solves the sandbox issue:
  - The bridge can stream document/selection updates and explorer trees directly to our backend without CORS gymnastics.
  - Monaco mirror stays in the wrapper, but the data feed becomes reliable—no more “None selected” placeholders.
  - Chat extensions can push structured payloads to the mobile UI.
- We don’t ship binaries. The user installs their own Code OSS / X components; our app supplies wrapper scripts and detection so we can launch their runtime safely.
- Complexity is contained: a helper script to start/stop Code OSS within a framework shell, plus environment checks to warn if X isn’t running. The rest of the stack (bridge, wrapper, `/state` endpoint) stays exactly as designed.

---

### What We Need to Decide Together

1. **Dual runtime strategy**  
   Do we officially support both runtimes?
   - *Web (`code-server`)* for environments without X. Works today only at the “full IDE iframe” level; document mirroring and explorer remain blocked until we crack the web sandbox.
   - *Desktop/X Code OSS* for users who can install it. Unlocks the full bridge feature set (doc mirror, explorer, chat).
   - If that’s our plan, we need a capability matrix so users understand what requires the X-backed setup.

2. **Bridge transport contract**  
   Regardless of runtime, we need the bridge emitting `doc_state`, `doc_changes`, `apply_edits`, etc., over HTTP (or a future WebSocket). Are you comfortable baking in a REST polling loop for now, knowing we might upgrade to a push channel later?

3. **Backend responsibilities**  
   - Accept edits (`/edits`), store full text per `doc_id`, attempt server-side rebases, fall back to `replace_full`.
   - Filter `/state` responses by `types` so the bridge can poll only for relevant commands.
   - Log/state retention: how many events/text snapshots should we keep to avoid memory issues on large workspaces?

4. **Security & detection**  
   - We must allow `Authorization` headers in CORS for web clients.
   - For the X path, we need a clean way to detect “Code OSS isn’t installed” or “X server not running” and surface that to the user.

5. **Monaco document view in the wrapper**  
   - Are we still planning to vendor Monaco and replay the bridge events there? Any specific concerns about large diff volume, latency, or formatting?
   - Should we implement the mirror first (outbound-only) and defer inbound agent edits until we prove the stream is stable?

---

### Concrete Questions for You

| Area | Question |
| --- | --- |
| Runtime support | Should the app officially support both the web build and the X-backed desktop build, with feature parity only on the latter? |
| Bridge payloads | Any objection to committing to the `doc_state` / `doc_changes` schema as-is? Do we want a binary/CRDT format eventually, or is JSON fine for v1? |
| Conflict handling | Are you expecting backend-driven rebases or is a “replace full” fallback acceptable for the MVP? |
| Explorer population | Can we rely solely on bridge events, or should we add a backend directory crawl as an optional diagnostic (not a user-facing fallback)? |
| Chat panel | What minimum data should the bridge supply so we can render an extension’s UI (e.g., text, markdown, HTML snippet)? |
| Testing priorities | If we go X-first, do we need to invest in automated detection for missing dependencies, or is manual setup acceptable for now? |
| Security | How do you want to handle auth tokens for the bridge? Shared secret stored via state-store? Anything stronger? |

---

### Suggested Path Forward

1. **Prototype on X-backed Code OSS**  
   Confirm the bridge can stream `doc_state`/`doc_changes` and explorer data when the sandbox restrictions are gone. This validates the message model and Monaco wiring regardless of web limitations.

2. **Implement document mirror**  
   - Bridge: emit `doc_state` on activation/editor switch; debounce `doc_changes`; include `rev` and `dirty` flags.
    - Wrapper: consume the stream, apply edits in Monaco, show accurate filename/status.

3. **Add `/edits` endpoint + ACK path**  
   Even if we ship outbound-only first, having the endpoint spec’d allows us to build simple agent-edit flows once the mirror is stable.

4. **Feature detection + docs**  
   - If Code OSS (desktop) binary isn’t found, show actionable instructions.
   - If X isn’t active, warn the user before launching the app.

5. **Revisit web build later**  
   Once the mirror works on desktop, we can circle back to code-server and see whether there’s any feasible way to re-create the channel (service worker, SSE tunnel, etc.). If not, we document the limitation.

---

### Snippets We Found Useful (for clarity)

```ts
// bridge_extension: emit doc_state + doc_changes with revision tracking
let revCounter = 0;
const docRevs = new Map<string, number>();

function nextRev(docId: string): number {
  const next = (docRevs.get(docId) ?? 0) + 1;
  docRevs.set(docId, next);
  return next;
}

function emitDocState(editor: vscode.TextEditor | undefined) {
  if (!editor) return;
  const doc = editor.document;
  const docId = doc.uri.toString();
  const rev = nextRev(docId);

  queueBridgeEvent({
    type: 'doc_state',
    doc_id: docId,
    rev,
    text: doc.getText(),
    languageId: doc.languageId,
    eol: doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    dirty: doc.isDirty,
  });
}

function emitDocChanges(event: vscode.TextDocumentChangeEvent) {
  const docId = event.document.uri.toString();
  const baseRev = docRevs.get(docId) ?? 0;
  const nextRevValue = nextRev(docId);

  queueBridgeEvent({
    type: 'doc_changes',
    doc_id: docId,
    base_rev: baseRev,
    next_rev: nextRevValue,
    changes: event.contentChanges.map((change) => ({
      start: { l: change.range.start.line, c: change.range.start.character },
      end: { l: change.range.end.line, c: change.range.end.character },
      text: change.text,
    })),
  });
}
```

```py
# backend: filter /state responses by requested types
@code_oss_bp.get("/state")
def bridge_state_get():
    types = set(request.args.get("types", "").split(",")) - {""}
    since = int(request.args.get("since", 0))

    events = [
        event
        for event in list(_BRIDGE_EVENTS)
        if event.get("seq", 0) > since
        and (not types or event.get("type") in types)
    ]

    payload = _bridge_state_payload(events)
    return _corsify_response(jsonify({"ok": True, "data": payload}))
```

```ts
// wrapper: apply doc_changes to Monaco
function applyDocChanges(editor: monaco.editor.IStandaloneCodeEditor, payload) {
  const model = editor.getModel();
  if (!model) return;

  const edits = payload.changes.map((change) => ({
    range: new monaco.Range(
      change.start.l + 1,
      change.start.c + 1,
      change.end.l + 1,
      change.end.c + 1
    ),
    text: change.text,
    forceMoveMarkers: true,
  }));

  editor.pushUndoStop();
  model.pushEditOperations([], edits, () => null);
  editor.pushUndoStop();
}
```

These snippets helped us confirm the message model and highlight the gaps that appear when the bridge can’t reach the backend.

---

Let us know your thoughts, especially on the runtime split and the bridge payload contract. We’re happy to sync on implementation details or pair on the desktop prototype—just want to make sure we’re aligned before we start cutting new code.

Thanks!
