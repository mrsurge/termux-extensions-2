# te2-mcp

TE2-owned MCP server for:
- TE2 console transcript search/tail
- TE2 live console eval through the in-process console relay
- direct framework-shells inspection through imported manager calls

Serving mode:
- worker-owned SSE/HTTP ASGI app
- intended to be mounted inside the `file_editor_cm6` worker

Current tools:
- `te2_mcp_status`
- `te2_console_workers`
- `te2_console_workers_live`
- `te2_console_tail`
- `te2_console_search`
- `te2_console_eval`
- `te2_fws_running`
- `te2_fws_shell_get`
- `te2_fws_log_tail`
- `te2_fws_log_search`
- `te2_apps_templates`
- `te2_scaffold_proxy_wrapper`
- `te2_validate_proxy_wrapper`
- `te2_apps_reload`
- `te2_app_start`
- `te2_app_open`
- `te2_sidebar_add_app_shortcut`

## Observed Workflow Wins

These tools have already proven useful in real TE2-hosted development loops.

Most valuable combinations:
- live worker-targeted console eval against the actual frontend worker, instead of guessing from static code
- console transcript tail/search to distinguish current failures from stale logs
- direct framework-shells visibility for the TE2-owned process/runtime
- using the sidebar-hosted app as the real development harness instead of a parallel ad hoc server

Practical effect:
- reproduce the bug in the hosted app
- patch the bridge or runtime code
- rebuild
- validate against the live worker and TE2-owned shell state in one loop

## Operational Caveat

The main recurring ambiguity is not the tool surface itself. It is runtime state drift:
- reload state
- current bundle state
- current process state

When debugging through TE2, be explicit about whether you are looking at the current bundle and the current worker/process. The tooling is strong, but it still depends on disciplined validation of what is actually live.
