from __future__ import annotations

import json
import urllib.request
from typing import Any, Dict, List, Optional

DEFAULT_RPC = "http://127.0.0.1:6800/jsonrpc"


class AriaRPC:
    """Minimal JSON-RPC client for aria2."""

    def __init__(self, url: str = DEFAULT_RPC, secret: Optional[str] = None) -> None:
        self.url = url
        self.secret = secret

    def _call(self, method: str, params: List[Any]) -> Dict[str, Any]:
        call_params = params
        if self.secret:
            call_params = [f"token:{self.secret}", *params]
        payload = {
            "jsonrpc": "2.0",
            "id": "termux-lm",
            "method": method,
            "params": call_params,
        }
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.load(response)
        if "error" in body:
            message = body["error"].get("message") or str(body["error"])
            raise RuntimeError(message)
        return body

    def add_uri(self, uris: List[str], options: Optional[Dict[str, Any]] = None) -> str:
        result = self._call("aria2.addUri", [uris, options or {}])
        return str(result.get("result", ""))

    def tell_status(self, gid: str) -> Dict[str, Any]:
        result = self._call("aria2.tellStatus", [gid])
        return result.get("result", {})

    def get_downloads(self) -> List[Dict[str, Any]]:
        active = self._call("aria2.tellActive", []).get("result", [])
        try:
            stopped = self._call("aria2.tellStopped", [0, 100]).get("result", [])
        except Exception:
            stopped = []
        return [*active, *stopped]
