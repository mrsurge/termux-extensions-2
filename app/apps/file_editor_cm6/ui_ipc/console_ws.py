"""Console event handlers for the ui_ipc Socket.IO namespace.

Routes ``console:*`` events between worker frontends and console drawer(s).
Workers emit ``console:log`` events; drawers receive them.
Drawers can send ``console:eval`` to a specific worker; workers reply with
``console:evalResult``.

Disk-backed log: every ``console:log`` event is appended as a JSON line to
``~/.codex/console_log.jsonl``.  The file is **wiped on import** (i.e. server
boot) so each Python process gets a fresh session.  New drawer connections
receive a replay of the file before switching to live.

Room layout (all on the ``/ui_ipc`` namespace):
  - ``ui_ipc``            — everyone (existing; used for generic UI relay)
  - ``console:drawers``   — console drawer clients only
  - ``console:<workerId>``— per-worker room for targeted eval
"""

import json
import time
from pathlib import Path

_LOG_DIR = Path.home() / ".cache" / "cm6_editor"
_LOG_FILE = _LOG_DIR / "console_log.jsonl"

# ---------- boot-time wipe ----------
_LOG_DIR.mkdir(parents=True, exist_ok=True)
if _LOG_FILE.exists():
    _LOG_FILE.unlink()
# pre-create empty file so appends never fail
_LOG_FILE.touch()

# keep a file handle open for fast appends
_log_fh = open(_LOG_FILE, "a", encoding="utf-8")


def _append_log(data: dict):
    """Append a single JSON line to the session log file."""
    try:
        line = json.dumps(data, separators=(",", ":"), default=str)
        _log_fh.write(line + "\n")
        _log_fh.flush()
    except Exception:
        pass  # never crash the relay over a write failure


async def _replay_to_sid(ns, sid):
    """Stream the entire disk log to a single drawer sid."""
    try:
        with open(_LOG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                await ns.emit("console:log", entry, to=sid)
    except FileNotFoundError:
        pass


# ---------- worker registry ----------
_registered_workers: set[str] = set()


async def _broadcast_workers(ns):
    """Emit the current worker list to all drawers."""
    await ns.emit("console:workers", sorted(_registered_workers), room="console:drawers")


# ---------- event handlers ----------

async def on_console_register(ns, sid, data):
    """Worker or drawer announces itself.

    Workers join a per-worker room for targeted eval routing.
    Drawers join the shared drawers room and receive a full replay.
    """
    if not isinstance(data, dict):
        return
    role = data.get("role", "worker")
    worker_id = data.get("workerId")

    if role == "drawer":
        await ns.enter_room(sid, "console:drawers")
        print(f"[console] drawer registered sid={sid} — replaying log", flush=True)
        # Send current worker list first, then replay logs
        await ns.emit("console:workers", sorted(_registered_workers), to=sid)
        await _replay_to_sid(ns, sid)
    elif worker_id:
        await ns.enter_room(sid, f"console:{worker_id}")
        await ns.save_session(sid, {"consoleWorkerId": worker_id})
        _registered_workers.add(worker_id)
        print(f"[console] worker registered sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_disconnect(ns, sid):
    """Remove worker from registry on disconnect and notify drawers."""
    try:
        session = await ns.get_session(sid)
        worker_id = session.get("consoleWorkerId") if session else None
    except Exception:
        worker_id = None
    if worker_id and worker_id in _registered_workers:
        _registered_workers.discard(worker_id)
        print(f"[console] worker disconnected sid={sid} workerId={worker_id}", flush=True)
        await _broadcast_workers(ns)


async def on_console_log(ns, sid, data):
    """Fan-out a log entry from a worker to all drawers + persist to disk."""
    if not isinstance(data, dict):
        return
    _append_log(data)
    await ns.emit("console:log", data, room="console:drawers", skip_sid=sid)


async def on_console_replay(ns, sid, data):
    """Drawer requests a full transcript replay (e.g. after filter change)."""
    await _replay_to_sid(ns, sid)


async def on_console_eval(ns, sid, data):
    """Route an eval request from a drawer to a specific worker."""
    if not isinstance(data, dict):
        return
    target = data.get("targetWorkerId")
    if not target:
        return
    await ns.emit("console:eval", data, room=f"console:{target}", skip_sid=sid)


async def on_console_eval_result(ns, sid, data):
    """Forward an eval result from a worker back to all drawers."""
    if not isinstance(data, dict):
        return
    await ns.emit("console:evalResult", data, room="console:drawers", skip_sid=sid)


async def on_console_clear(ns, sid, data):
    """Drawer requests to clear the log file."""
    global _log_fh
    try:
        _log_fh.close()
        _LOG_FILE.write_text("")
        _log_fh = open(_LOG_FILE, "a", encoding="utf-8")
    except Exception:
        pass
    # Broadcast to all drawers so they sync their UI
    await ns.emit("console:cleared", {}, room="console:drawers")
