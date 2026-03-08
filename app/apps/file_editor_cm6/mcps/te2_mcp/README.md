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
