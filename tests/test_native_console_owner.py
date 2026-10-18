"""Owner API fixtures: no imports of the live console or MCP package."""
import asyncio
import unittest

import httpx
from starlette.applications import Starlette
from app.libs.native_console_owner import MAX_BODY, console_owner_routes


class ConsoleOwnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.calls: list[tuple[str, str, float]] = []

        async def evaluate(worker: str, code: str, timeout: float) -> dict[str, object]:
            self.calls.append((worker, code, timeout))
            if worker == "missing":
                raise LookupError("console worker not registered: missing")
            if worker == "timeout":
                raise asyncio.TimeoutError
            return {"ok": True, "result": code}

        app = Starlette(routes=console_owner_routes("private-fixture", lambda: ["live-fixture"], evaluate))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture")
        self.headers = {"x-te2-owner-key": "private-fixture"}

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    async def test_private_admission_precedes_body_and_callback(self) -> None:
        self.assertEqual((await self.client.post("/internal/console/eval", content=b"bad")).status_code, 401)
        self.assertEqual((await self.client.get("/internal/console/workers")).status_code, 401)
        self.assertEqual(self.calls, [])
        response = await self.client.get("/internal/console/workers", headers=self.headers)
        self.assertEqual(response.json(), {"workers": ["live-fixture"], "source": "te2_console.runtime"})

    async def test_exact_owner_and_results_once(self) -> None:
        response = await self.client.post("/internal/console/eval", headers=self.headers,
                                          json={"target_worker_id": "exact", "code": "'\\\"\né"})
        self.assertEqual(response.json(), {"ok": True, "result": "'\\\"\né"})
        self.assertEqual(self.calls, [("exact", "'\\\"\né", 20.0)])

    async def test_missing_worker_and_timeout_keep_existing_envelopes(self) -> None:
        for target, error in [("missing", "worker_not_registered"), ("timeout", "eval_timeout")]:
            response = await self.client.post("/internal/console/eval", headers=self.headers,
                                              json={"target_worker_id": target, "code": "1", "timeout_seconds": 3})
            self.assertEqual(response.json()["error_type"], error)
            self.assertEqual(response.json()["workers"], ["live-fixture"])
        self.assertEqual(len(self.calls), 2)

    async def test_bounded_typed_ingress(self) -> None:
        for payload in [{}, {"target_worker_id": "x", "code": 1},
                        {"target_worker_id": "x", "code": "1", "extra": True}]:
            response = await self.client.post("/internal/console/eval", headers=self.headers, json=payload)
            self.assertEqual(response.status_code, 400)
        response = await self.client.post("/internal/console/eval", headers=self.headers, content=b"x" * (MAX_BODY + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.calls, [])
