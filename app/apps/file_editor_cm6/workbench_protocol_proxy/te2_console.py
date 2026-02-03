from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from aiohttp import ClientSession, WSMsgType, web


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _parse_value(s: str) -> Any:
    # allow raw json via @json: prefix
    if s.startswith("@json:"):
        return json.loads(s[len("@json:") :])
    # basic scalars
    if s.lower() in {"true", "false"}:
        return s.lower() == "true"
    if s.lower() in {"null", "none"}:
        return None
    # ints
    try:
        if s.startswith("0") and len(s) > 1 and s[1].isdigit():
            raise ValueError
        return int(s)
    except Exception:
        return s


def _apply_cast(v: Any, cast: str) -> Any:
    if cast == "int":
        return int(v)
    if cast == "str":
        return str(v)
    if cast == "bool":
        if isinstance(v, bool):
            return v
        if isinstance(v, str) and v.lower() in {"true", "false"}:
            return v.lower() == "true"
        return bool(v)
    return v


def _parse_kv_tokens(tokens: list[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for t in tokens:
        if "=" not in t:
            continue
        k, v = t.split("=", 1)
        out[k] = _parse_value(v)
    return out


@dataclass
class AliasSpec:
    method: str
    params: Dict[str, Any]
    params_from_args: Dict[str, int]
    casts: Dict[str, str]


def _load_aliases(path: str) -> Dict[str, AliasSpec]:
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        raise ValueError("aliases must be a JSON object")
    out: Dict[str, AliasSpec] = {}
    for name, spec in raw.items():
        if not isinstance(spec, dict) or not isinstance(spec.get("method"), str):
            continue
        out[name] = AliasSpec(
            method=spec["method"],
            params=spec.get("params") if isinstance(spec.get("params"), dict) else {},
            params_from_args=spec.get("params_from_args") if isinstance(spec.get("params_from_args"), dict) else {},
            casts=spec.get("casts") if isinstance(spec.get("casts"), dict) else {},
        )
    return out


DEFAULT_SHOW = {
    "proxy/start",
    "ws/open",
    "ws/close",
    "handshake",
    "hover/request",
    "hover/reply",
    "hover/provider_registration",
    "diagnostics/changeMany",
    "inject/sent",
    "inject/seen",
    "inject/acknowledged",
    "bootstrap/replay_start",
    "bootstrap/replay_done",
    "bootstrap/replay_error",
    "headless/close",
    "headless/text",
    "headless/pause",
    "headless/resume",
}


class Te2Console:
    def __init__(
        self,
        *,
        ws_url: str,
        aliases_path: str,
        show_all: bool,
        show_types: set[str],
        hide_types: set[str],
    ) -> None:
        self.ws_url = ws_url
        self.aliases_path = aliases_path
        self.aliases = _load_aliases(aliases_path)
        self.show_all = show_all
        self.show_types = show_types
        self.hide_types = hide_types
        self._id = 1
        self._pending: Dict[int, asyncio.Future] = {}
        self._ws = None
        self._session: Optional[ClientSession] = None

    def _next_id(self) -> int:
        i = self._id
        self._id += 1
        return i

    def _should_print_event(self, event: Dict[str, Any]) -> bool:
        t = event.get("type")
        if not isinstance(t, str):
            return False
        if t in self.hide_types:
            return False
        if self.show_all:
            return True
        if self.show_types:
            return t in self.show_types
        return t in DEFAULT_SHOW

    async def connect(self) -> None:
        self._session = ClientSession()
        self._ws = await self._session.ws_connect(self.ws_url)

    async def close(self) -> None:
        try:
            if self._ws is not None:
                await self._ws.close()
        finally:
            if self._session is not None:
                await self._session.close()

    async def call(self, method: str, params: Dict[str, Any]) -> Any:
        if self._ws is None:
            raise RuntimeError("WS not connected")
        mid = self._next_id()
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        await self._ws.send_str(_json_dumps({"jsonrpc": "2.0", "id": mid, "method": method, "params": params}))
        return await fut

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        if self._ws is None:
            raise RuntimeError("WS not connected")
        await self._ws.send_str(_json_dumps({"jsonrpc": "2.0", "method": method, "params": params}))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        async for msg in self._ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                obj = json.loads(msg.data)
            except Exception:
                continue
            if not isinstance(obj, dict) or obj.get("jsonrpc") != "2.0":
                continue

            # notifications
            if obj.get("method") == "te2.event" and isinstance(obj.get("params"), dict):
                ev = obj["params"]
                if self._should_print_event(ev):
                    print(_json_dumps(ev), flush=True)
                continue

            # responses
            if "id" in obj:
                mid = obj.get("id")
                fut = self._pending.pop(mid, None)
                if fut is not None and not fut.done():
                    if "result" in obj:
                        fut.set_result(obj["result"])
                    else:
                        fut.set_result(obj.get("error"))

    def _build_call_from_alias(self, alias: str, args: list[str]) -> tuple[str, Dict[str, Any]]:
        spec = self.aliases.get(alias)
        if spec is None:
            raise KeyError(f"Unknown alias: {alias}")

        # copy base params
        params: Dict[str, Any] = dict(spec.params)

        # allow extra key=value args
        params.update(_parse_kv_tokens(args))

        # positional arg mapping
        for k, idx_any in spec.params_from_args.items():
            try:
                idx = int(idx_any)
            except Exception:
                continue
            if 0 <= idx < len(args) and "=" not in args[idx]:
                params[k] = args[idx]

        # casts
        for k, cast in spec.casts.items():
            if k in params:
                params[k] = _apply_cast(params[k], str(cast))

        return spec.method, params

    async def run_repl(self) -> None:
        loop = asyncio.get_running_loop()
        recv_task = asyncio.create_task(self._recv_loop())

        def _prompt() -> str:
            return "te2> "

        print(f"Connected: {self.ws_url}")
        print(f"Aliases: {self.aliases_path} ({', '.join(sorted(self.aliases.keys()))})")
        print("Type: alias [args...], or /reload, /show-all, /hide wire/frame, /show handshake, /quit")

        try:
            while True:
                line = await loop.run_in_executor(None, lambda: input(_prompt()))
                line = line.strip()
                if not line:
                    continue

                if line in {"/q", "/quit", "quit", "exit"}:
                    return
                if line == "/reload":
                    self.aliases = _load_aliases(self.aliases_path)
                    print(f"Reloaded aliases: {self.aliases_path}")
                    continue
                if line == "/show-all":
                    self.show_all = True
                    print("show_all=1")
                    continue
                if line == "/show-default":
                    self.show_all = False
                    self.show_types = set()
                    self.hide_types = set()
                    print("show_all=0; using default filter")
                    continue
                if line.startswith("/hide "):
                    t = line[len("/hide ") :].strip()
                    if t:
                        self.hide_types.add(t)
                        print(f"hide: {t}")
                    continue
                if line.startswith("/show "):
                    t = line[len("/show ") :].strip()
                    if t:
                        self.show_types.add(t)
                        print(f"show: {t}")
                    continue

                try:
                    tokens = shlex.split(line)
                except Exception as e:
                    print(f"parse error: {e}")
                    continue
                alias = tokens[0]
                args = tokens[1:]

                try:
                    method, params = self._build_call_from_alias(alias, args)
                except Exception as e:
                    print(str(e))
                    continue

                res = await self.call(method, params)
                print(_json_dumps({"id": self._id - 1, "method": method, "result": res}), flush=True)
        finally:
            recv_task.cancel()


async def _run_http_server(console: Te2Console, host: str, port: int) -> None:
    routes = web.RouteTableDef()

    @routes.post("/cmd")
    async def cmd(request: web.Request) -> web.Response:
        body = await request.json()
        if not isinstance(body, dict):
            return web.json_response({"ok": False, "error": "invalid body"}, status=400)
        alias = body.get("cmd")
        if not isinstance(alias, str):
            return web.json_response({"ok": False, "error": "missing cmd"}, status=400)
        args = body.get("args") or []
        if not isinstance(args, list) or any(not isinstance(x, str) for x in args):
            return web.json_response({"ok": False, "error": "args must be list[str]"}, status=400)
        try:
            method, params = console._build_call_from_alias(alias, args)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        try:
            res = await console.call(method, params)
            return web.json_response({"ok": True, "method": method, "result": res})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    app = web.Application()
    app.add_routes(routes)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port)
    await site.start()
    print(f"http://{host}:{port}/cmd", flush=True)
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await runner.cleanup()


async def _main_async() -> int:
    p = argparse.ArgumentParser(prog="te2-console", add_help=True)
    p.add_argument("--ws", default=os.environ.get("TE2_WS", "ws://127.0.0.1:8000/te2/workbench-proxy"))
    p.add_argument(
        "--aliases",
        default=os.environ.get("TE2_ALIASES", os.path.join(os.path.dirname(__file__), "alias.json")),
    )
    p.add_argument("--show-all", action="store_true", default=False)
    p.add_argument("--show", action="append", default=[])
    p.add_argument("--hide", action="append", default=[])
    p.add_argument("--http", default=os.environ.get("TE2_HTTP", "127.0.0.1:8001"))
    args = p.parse_args()

    show_types = set(args.show or [])
    hide_types = set(args.hide or [])
    console = Te2Console(ws_url=args.ws, aliases_path=args.aliases, show_all=bool(args.show_all), show_types=show_types, hide_types=hide_types)
    await console.connect()

    http_host, http_port_s = args.http.rsplit(":", 1) if ":" in args.http else (args.http, "8001")
    http_task = asyncio.create_task(_run_http_server(console, http_host, int(http_port_s)))
    try:
        await console.run_repl()
    finally:
        http_task.cancel()
        await console.close()
    return 0


def main() -> int:
    return asyncio.run(_main_async())


if __name__ == "__main__":
    raise SystemExit(main())
