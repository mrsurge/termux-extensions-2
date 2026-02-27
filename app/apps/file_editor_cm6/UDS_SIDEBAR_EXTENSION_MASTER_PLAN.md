# UDS Sidebar Extension Master Plan

## Objective
Replace legacy browser cross-origin sidebar/control paths with backend-to-backend JSON-RPC 2.0 over Unix domain socket (UDS), while preserving existing TE2 UI behavior.

## Transport and Identity Contract
- Transport: JSON-RPC 2.0 over UDS stream.
- Both sides must receive the same env contract:
  - `TE_BACKCHANNEL_ENABLED=1`
  - `TE_BACKCHANNEL_TRANSPORT=unix`
  - `TE_BACKCHANNEL_SOCKET=<abs path>`
  - `TE_BACKCHANNEL_APP_ID=<app_id>`
  - `TE_BACKCHANNEL_RUN_ID=<run_id>`
  - `TE_BACKCHANNEL_PROTOCOL_VERSION=1`
- Canonical identity derives from `realpath(project_root)`.
- Socket permissions:
  - directory mode `0700`
  - socket mode `0600`

## Handshake and Health
1. `session.hello` (request/response)
- req: `{app_id:string, run_id:string, protocol_version:number=1, pid:number, origin_role:"host"|"agent", capabilities:string[]}`
- res: `{ok:true, protocol_version:1, accepted_capabilities:string[]}`
- fail: `-32010 bad_identity`, `-32011 bad_version`

2. `health.ping`
- req: `{ts:number}`
- res: `{ts:number, now:number}`

## Final Method Table (v1)
3. `sidebar.open` (notification accepted, request optional)
- params: `{conversation_id?:string, source:string}`
- effect: open drawer in host UI.

4. `sidebar.close` (notification accepted, request optional)
- params: `{reason?:string, source:string}`
- effect: close drawer in host UI.

5. `sidebar.ui_hints.set`
- req: `{show_close_button?:boolean, ide_mode?:boolean, project_root?:string, source:string}`
- res: `{ok:true}`

6. `cwd.get`
- req: `{conversation_id?:string}`
- res: `{cwd:string, project_root?:string, source_of_truth:"conversation_meta"|"project_state"|"runtime"}`

7. `cwd.set`
- req: `{conversation_id:string, cwd:string, reason:string}`
- res: `{ok:true, cwd:string}`

8. `mention.resolve`
- req: `{query:string, cwd:string, limit?:number}`
- res: `{items:[{path:string, kind:"file"|"directory"}]}`

9. `mention.insert`
- req: `{conversation_id:string, path:string, absolute:boolean, source:string}`
- res: `{ok:true, rendered_token:string, normalized_path:string}`

10. `agent.open`
- req: `{rel?:string, path?:string, line?:number, column?:number, conversation_id?:string, source:string}`
- res: `{ok:true, resolved_path:string, line:number, column:number, close_drawer:boolean}`

11. `conversation.active.get`
- req: `{}`
- res: `{conversation_id?:string, drawer_open:boolean, mode:"ide"|"standalone"}`

12. `conversation.active.set`
- req: `{conversation_id:string, drawer_open?:boolean, source:string}`
- res: `{ok:true}`

13. `mcp.proxy.call` (phase 5 only; disabled earlier)
- req: `{tool:string, args:object}`
- res: `{result:any}`
- fail: `-32020 method_not_allowed`

## External UI Boundary (Close-Only)
- External codex/sidebar app integrations are limited to requesting drawer close.
- Visible drawer UI DOM is immutable to external integrations (including header/close-button replacement).
- Any drawer visual/chrome mutations must remain behind internal sidebar APIs owned by `file_editor_cm6`.
- Inbound iframe message handling remains allowlist-based and close-only.
- `sidebar.ui_hints.set` is internal transport/API scope, not an external iframe UI mutation channel.

## Migration Phases
### Phase 0: scaffolding
- Add UDS server/client, handshake, `health.ping`, and structured audit logs.

### Phase 1: mention + open path
- Move explorer mention path from HTTP `/api/appserver/mention` to `mention.resolve`/`mention.insert` via UDS backend.
- Move `/agent/open` + `explorer:event agent:open` flow to `agent.open` via UDS backend.

### Phase 2: drawer + UI hints
- Replace `/agent/drawer/open` and `codex_agent_close` postMessage with `sidebar.open`/`sidebar.close`.
- Replace `/agent/drawer/ui_hints` with `sidebar.ui_hints.set`.

### Phase 3: CWD control
- Replace `/agent/cwd` with `cwd.get`/`cwd.set`.

### Phase 4: conversation state sync
- Route active conversation + drawer state through `conversation.active.get`/`conversation.active.set`.

### Phase 5: optional MCP proxy subset
- Enable `mcp.proxy.call` with strict allowlist only.

### Phase 6: retire legacy bridge
- Remove `/agent/open_request` and `/agent/open_request/next` queue endpoints.
- Keep temporary HTTP adapters only behind `TE_BACKCHANNEL_REQUIRED=0` during cutover; set `TE_BACKCHANNEL_REQUIRED=1` to enforce UDS-only mode.

## Legacy-to-UDS Mapping
- `/agent/drawer/open` -> `sidebar.open`
- `/agent/drawer/ui_hints` -> `sidebar.ui_hints.set`
- `/agent/cwd` -> `cwd.get` / `cwd.set`
- `/api/appserver/mention` -> `mention.resolve` + `mention.insert`
- `/agent/open` + `explorer:event agent:open` -> `agent.open`
- `codex_agent_close` postMessage -> `sidebar.close`
- `/agent/open_request*` queue endpoints -> removed in Phase 6

## Reliability Requirements
- Default request timeout: `2500ms` (configurable).
- Retries: bounded retries on connect only.
- Structured logs include: `req_id`, `method`, `latency_ms`, `error_code`.
- Stale socket cleanup must validate path ownership before unlink.

## vNext Extension Stubs (Agnostic)
These stubs extend the protocol without breaking Phases 0-6. They are intentionally platform-agnostic so the same contract can back TE2, VS Code WebUI extension surfaces, and the headless node workbench adapter.

### A. Hierarchical Mention Package
Goal: support partial or full mention payloads in dependency order (`filePath` -> `lineNo` -> `textSelection`), where selecting a higher level includes required lower-level dependencies.

14. `mention.package.build`
- req:
`{conversation_id:string, target:{path:string, line?:number, column?:number, selection?:{startLine:number, startColumn:number, endLine:number, endColumn:number, text?:string}}, mode:"path"|"line"|"selection", absolute?:boolean, source:string}`
- rules:
  - `mode:"path"` returns a path mention package only.
  - `mode:"line"` requires/returns path + line (+ optional column).
  - `mode:"selection"` requires/returns path + line + selection range/text.
- res:
`{ok:true, rendered_token:string, markdown:string, components:{path:string, line?:number, column?:number, selection?:{startLine:number, startColumn:number, endLine:number, endColumn:number, text?:string}}}`
- render contract:
  - markdown output includes a backticked relative path line, newline, and fenced code snippet when selection is present.
  - output is represented as one DOM token in the mention engine.

### B. TE2_MCP Integration Path
Goal: unify agent-visible IDE signals and tool execution through a named MCP server: `TE2_MCP`.

15. `te2_mcp.console.subscribe`
- req: `{channels?:string[], include_iframes?:boolean=true, source:string}`
- res: `{ok:true, subscription_id:string}`
- notes:
  - subscribes agent-side consumers to vconsole bridge events from hosted iframes.

16. `te2_mcp.console.unsubscribe`
- req: `{subscription_id:string, source:string}`
- res: `{ok:true}`

17. `te2_mcp.call`
- req: `{tool:string, args:object, source:string}`
- res: `{ok:true, result:any}`
- fail: `-32020 method_not_allowed`
- notes:
  - strict allowlist.
  - this is the explicit `TE2_MCP` command execution path.

### C. MCP Reverse Mention and Focus
Goal: let agents perform mention-like navigation actions (document/console/explorer focus) instead of being limited to passive context consumption.

18. `te2_mcp.reverse_mention.open`
- req:
`{target:"document"|"console"|"explorer", path?:string, line?:number, column?:number, selection?:{startLine:number, startColumn:number, endLine:number, endColumn:number}, reveal?:boolean=true, source:string}`
- res: `{ok:true, target:string, focused:boolean}`
- notes:
  - intended for agent-triggered open/focus flows across IDE surfaces.

### D. Edit Tracker Source Hook
Goal: provide an alternate source of truth for last-edit location when complex diff history is ambiguous.

19. `edit_tracker.last_change.publish`
- req:
`{path:string, line:number, column?:number, commit?:string, editor_session_id?:string, reason:string, source:string, ts:number}`
- res: `{ok:true, accepted:boolean}`
- notes:
  - consumed as a secondary signal by edit-tracker logic.
  - does not replace diff-based tracker; augments it.

## vNext Migration Addendum
### Phase 7: mention package and reverse mention
- Implement `mention.package.build`.
- Implement `te2_mcp.reverse_mention.open`.

### Phase 8: TE2_MCP console + command bridge
- Implement `te2_mcp.console.subscribe` / `te2_mcp.console.unsubscribe`.
- Implement `te2_mcp.call` with explicit allowlist and audit logs.

### Phase 9: edit tracker integration hook
- Implement `edit_tracker.last_change.publish`.
- Wire tracker prioritization rules for conflicting signals (agent-provided vs diff-derived).
