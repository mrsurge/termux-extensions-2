from __future__ import annotations

import asyncio
import threading

import pytest

from app.apps.code_te2 import workbench_runtime_debug as owner
from app.libs.pipe_protocol import PipeEnvelope, PipeIdentity
from app.libs.runtime_debug_eval import DebugEvalError
from app.libs.runtime_debug_pipe import RuntimeDebugPipe


def test_structured_operation_retains_exact_data_and_off_loop_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[object, ...]] = []

    async def invoke(operation: str, shell_id: str | None = None,
                     instance_id: str | None = None, code: str | None = None,
                     timeout_seconds: int = 20) -> dict[str, object]:
        calls.append((operation, shell_id, instance_id, code, timeout_seconds))
        return {"child": shell_id}

    monkeypatch.setattr(owner, "request_wba", invoke)

    async def run() -> None:
        loop = asyncio.get_running_loop()
        thread = threading.get_ident()
        ready = asyncio.Event()
        replies: list[PipeEnvelope] = []

        def reply(envelope: PipeEnvelope, before_write: object = None) -> None:
            assert threading.get_ident() != thread
            if callable(before_write):
                before_write()
            replies.append(envelope)
            loop.call_soon_threadsafe(ready.set)

        request = PipeEnvelope(kind="request", id="request", correlation_id="request",
            method="runtime.debug.workbench", origin_nid=1, origin_name="framework.rust",
            params={"operation":"eval", "shell_id":"child", "instance_id":"generation",
                    "code":"'\\\"\n; é", "timeout_seconds":12})
        adapter = RuntimeDebugPipe(enabled=True, identity=PipeIdentity(2100,"receiver"),
            reply=reply, operations={"runtime.debug.workbench":owner.dispatch_workbench_debug})
        adapter.bind(loop)
        assert adapter.submit(request)
        await asyncio.wait_for(ready.wait(), 2)
        assert replies[0].result == {"child":"child"}
        assert calls == [("eval", "child", "generation", "'\\\"\n; é", 12)]
        adapter.close()
        disabled: list[PipeEnvelope] = []
        def deny(envelope: PipeEnvelope, before_write: object = None) -> None:
            disabled.append(envelope)
        adapter = RuntimeDebugPipe(enabled=False, identity=PipeIdentity(2100,"receiver"),
            reply=deny, operations={"runtime.debug.workbench":owner.dispatch_workbench_debug})
        assert adapter.submit(request)
        assert disabled[0].error is not None
        assert disabled[0].error.code == "runtimeDebug.disabled"
        assert len(calls) == 1

    asyncio.run(run())


@pytest.mark.parametrize("params", [None, [], {"operation":1}, {"operation":"status","timeout_seconds":True},
    {"operation":"eval","shell_id":[]}, {"operation":"status","extra":1}])
def test_malformed_operation_never_calls_owner(params: object, monkeypatch: pytest.MonkeyPatch) -> None:
    async def unexpected(operation: str, shell_id: str | None = None,
                         instance_id: str | None = None, code: str | None = None,
                         timeout_seconds: int = 20) -> dict[str, object]:
        pytest.fail("malformed operation reached owner")
    monkeypatch.setattr(owner, "request_wba", unexpected)
    with pytest.raises(DebugEvalError):
        asyncio.run(owner.dispatch_workbench_debug(PipeEnvelope(kind="request", params=params)))
