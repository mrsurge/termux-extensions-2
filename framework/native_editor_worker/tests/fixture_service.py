"""Isolated service fixture, not a production Code TE2 backend."""
import sys
import threading
import time

print("fixture imported: stderr only")
owner = threading.get_ident()
events = []
retained_bridge = None


def te2_native_dispatch(envelope, bridge):
    global retained_bridge
    assert threading.get_ident() == owner
    method = envelope.get("method")
    params = envelope.get("params")
    if method == "echo":
        return params
    if method == "retain":
        retained_bridge = bridge
        return True
    if method == "inspect":
        return {
            "thread": threading.get_ident(),
            "python": sys.version,
            "forbiddenImports": sorted(set(sys.modules) & {
                "socketio", "engineio", "msgspec", "msgpack", "uvicorn", "starlette",
            }),
            "events": list(events),
        }
    if method == "nested":
        return bridge.call("service.test", params, timeout=2.0)
    if method == "timeout":
        return bridge.call("service.test", params, timeout=0.05)
    if method == "notify":
        events.append(params)
        return None
    if method == "raise":
        raise ValueError("fixture failure")
    if method == "hang":
        time.sleep(30)
    if method == "unsupported":
        return {"not": {1, 2}}
    if method == "cycle":
        value = []
        value.append(value)
        return value
    if method == "oversized":
        return b"x" * (33 * 1024 * 1024)
    raise ValueError(f"unknown fixture method {method}")
