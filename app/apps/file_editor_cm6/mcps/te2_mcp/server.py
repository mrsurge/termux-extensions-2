from __future__ import annotations

from fastmcp import FastMCP

from app.extensions.apps import loader as apps_loader
from app.extensions.apps.scaffold import (
    list_templates as list_app_templates,
    scaffold_proxy_shell_wrapper,
    validate_proxy_shell_wrapper,
)

from .console_store import ConsoleStore
from .framework_apps_client import FrameworkAppsClient
from .framework_shells_client import FrameworkShellsClient
from .models import ConsoleSearchResult, ConsoleTailResult, Te2McpStatus
from .sidebar_shortcuts_client import SidebarShortcutsClient
from .te2_console_client import Te2ConsoleClient


def build_server() -> FastMCP:
    server = FastMCP(
        name="te2-mcp",
        instructions=(
            "TE2-owned MCP server for Code TE2 console access and framework-shells integration. "
            "This server runs inside the TE2 worker and prefers direct Python access to worker-owned state."
        ),
    )

    console_store = ConsoleStore()
    te2_console = Te2ConsoleClient()
    framework_apps = FrameworkAppsClient()
    framework_shells = FrameworkShellsClient()
    sidebar_shortcuts = SidebarShortcutsClient(framework_apps=framework_apps)

    @server.tool(description="Return te2-mcp status, active local paths, and serving mode.")
    def te2_mcp_status() -> dict:
        status = Te2McpStatus(
            console_log_path=str(console_store.log_path),
            framework_shells_enabled=True,
        )
        payload = status.model_dump(mode="json")
        payload["mode"] = "worker_owned_sse"
        return payload

    @server.tool(description="List worker IDs seen in the persisted TE2 console transcript.")
    def te2_console_workers() -> dict:
        return {
            "workers": console_store.list_workers(),
            "source": "console_log_jsonl",
            "log_path": str(console_store.log_path),
        }

    @server.tool(description="List currently registered live TE2 console workers from the in-process worker runtime.")
    async def te2_console_workers_live() -> dict:
        return {
            "workers": await te2_console.list_workers(),
            "source": "console_ws.runtime",
        }

    @server.tool(description="Return the last N TE2 console log entries from the persisted transcript.")
    def te2_console_tail(limit: int = 100, worker_id: str | None = None, level: str | None = None) -> dict:
        result = ConsoleTailResult(
            entries=console_store.tail(limit=limit, worker_id=worker_id, level=level),
            total_returned=0,
            log_path=str(console_store.log_path),
        )
        result.total_returned = len(result.entries)
        return result.model_dump(mode="json")

    @server.tool(description="Search the persisted TE2 console transcript for plain-text matches.")
    def te2_console_search(query: str, limit: int = 100, worker_id: str | None = None, level: str | None = None) -> dict:
        result = ConsoleSearchResult(
            query=query,
            entries=console_store.search(query=query, limit=limit, worker_id=worker_id, level=level),
            total_returned=0,
            log_path=str(console_store.log_path),
        )
        result.total_returned = len(result.entries)
        return result.model_dump(mode="json")

    @server.tool(description="Execute JavaScript in a live TE2 console worker through the in-process console relay.")
    async def te2_console_eval(target_worker_id: str, code: str) -> dict:
        return await te2_console.eval_in_worker(target_worker_id=target_worker_id, code=code)

    @server.tool(description="List framework-shells records directly from the shared runtime store.")
    async def te2_fws_running() -> dict:
        return await framework_shells.get_running()

    @server.tool(description="Return framework-shell detail directly from framework_shells manager.")
    async def te2_fws_shell_get(shell_id: str) -> dict:
        return await framework_shells.get_shell(shell_id=shell_id)

    @server.tool(description="Tail framework shell logs directly via framework_shells manager.")
    async def te2_fws_log_tail(shell_id: str, stream: str = "both", lines: int = 200) -> dict:
        return await framework_shells.get_log_tail(shell_id=shell_id, stream=stream, lines=lines)

    @server.tool(description="Search framework shell logs directly via framework_shells manager.")
    async def te2_fws_log_search(
        shell_id: str,
        query: str,
        stream: str = "both",
        limit: int = 100,
        regex: bool = False,
        ignore_case: bool = False,
    ) -> dict:
        return await framework_shells.search_logs(
            shell_id=shell_id,
            stream=stream,
            query=query,
            limit=limit,
            regex=regex,
            ignore_case=ignore_case,
        )

    @server.tool(description="List available local TE2 app templates from the user-local templates directory.")
    def te2_apps_templates() -> dict:
        return {
            "templates": list_app_templates(),
        }

    @server.tool(description="Scaffold a thin TE2 proxy-shell wrapper app in the user-local TE2 apps directory.")
    def te2_scaffold_proxy_wrapper(
        app_id: str,
        project_root: str,
        command: str,
        port: int,
        name: str = "",
        description: str = "",
        start_path: str = "/",
        health_path: str = "/api/health",
        icon_src: str = "",
        icon_text: str = "",
        icon_emoji: str = "",
        readiness_timeout: float = 20.0,
        socketio_enabled: bool = False,
        socketio_inject_path: bool = False,
        socketio_namespace_marker: str = "",
        env: dict[str, str] | None = None,
        overwrite: bool = False,
    ) -> dict:
        return scaffold_proxy_shell_wrapper(
            {
                "app_id": app_id,
                "project_root": project_root,
                "command": command,
                "port": port,
                "name": name,
                "description": description,
                "start_path": start_path,
                "health_path": health_path,
                "icon_src": icon_src,
                "icon_text": icon_text,
                "icon_emoji": icon_emoji,
                "readiness_timeout": readiness_timeout,
                "socketio_enabled": socketio_enabled,
                "socketio_inject_path": socketio_inject_path,
                "socketio_namespace_marker": socketio_namespace_marker,
                "env": env or {},
                "overwrite": overwrite,
            }
        )

    @server.tool(description="Validate a local TE2 proxy-shell wrapper app before reloading the registry or starting the app.")
    def te2_validate_proxy_wrapper(app_id: str) -> dict:
        return validate_proxy_shell_wrapper(app_id)

    @server.tool(description="Reload the TE2 app registry from disk without starting any apps.")
    async def te2_apps_reload() -> dict:
        data = await framework_apps.reload_apps()
        return {"ok": True, "data": data}

    @server.tool(description="Start a TE2 framework app by app_id.")
    async def te2_app_start(app_id: str) -> dict:
        data = await framework_apps.start_app(app_id)
        return {"ok": True, "data": data}

    @server.tool(description="Return the launch and embed URLs for a TE2 framework app, starting it first if needed.")
    async def te2_app_open(app_id: str) -> dict:
        data = await framework_apps.open_app(app_id)
        return {"ok": True, "data": data}

    @server.tool(description="Add a TE2 framework app as a persistent sidebar shortcut using the existing framework_app shortcut model.")
    async def te2_sidebar_add_app_shortcut(
        app_id: str,
        label: str = "",
        load: str = "lazy",
        header: bool = True,
        activate: bool = True,
    ) -> dict:
        return await sidebar_shortcuts.add_framework_app_shortcut(
            app_id=app_id,
            label=label,
            load=load,
            header=header,
            activate=activate,
        )

    return server


def build_http_app():
    server = build_server()
    return server.http_app(path="/", transport="sse")


def build_streamable_http_app():
    server = build_server()
    return server.http_app(path="/", transport="streamable-http")
