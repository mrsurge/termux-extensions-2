# Extension: Sessions & Shortcuts

import asyncio
import json
import os
import subprocess
from pathlib import Path

import aiofiles
from fastapi import APIRouter, HTTPException, Body, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse


async def _safe_ws_close(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except RuntimeError:
        # Starlette raises if close already sent.
        pass
    except Exception:
        pass

# Create a APIRouter
sessions_bp = APIRouter()

# Root-mounted router for framework_shells log viewing (mounted via apps extension).
shell_logs_bp = APIRouter()

# Determine the project root path to find the scripts directory
# Go up 4 levels: main.py -> sessions_and_shortcuts -> extensions -> app -> project_root
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_app_root_path = os.path.join(_project_root, 'app')

def _load_framework_shell_ui_by_app() -> dict:
    """Load app-defined framework shell UI hints from manifests on disk.

    This is a dev affordance: it lets you tweak subgroup colors without
    restarting the framework or re-spawning shells.
    """
    apps_dir = os.path.join(_app_root_path, 'apps')
    out: dict = {}
    try:
        entries = os.listdir(apps_dir)
    except Exception:
        return out

    for entry in entries:
        manifest_path = os.path.join(apps_dir, entry, 'manifest.json')
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, 'r', encoding='utf-8') as fh:
                manifest = json.load(fh)
        except Exception:
            continue

        app_id = manifest.get('id') or entry
        if not isinstance(app_id, str) or not app_id:
            continue

        ui = manifest.get('framework_shell_ui')
        if isinstance(ui, dict) and ui:
            out[app_id] = ui

    return out

def run_script(script_name, app_root_path, args=None):
    """Helper function to run a shell script and return its output."""
    project_root = os.path.dirname(app_root_path)
    scripts_dir = os.path.join(project_root, 'scripts')
    if args is None: args = []
    script_path = os.path.join(scripts_dir, script_name)
    try:
        subprocess.run(['chmod', '+x', script_path], check=True)
        result = subprocess.run([script_path] + args, capture_output=True, text=True, check=True)
        return result.stdout, None
    except Exception as e:
        return None, str(e)

# --- Root routes (framework_shells log viewer) ---

@shell_logs_bp.get("/shell-logs/{shell_id}", response_class=HTMLResponse)
async def shell_logs_viewer(shell_id: str):
    template_path = os.path.join(_project_root, 'app', 'templates', 'shell_log_viewer.html')
    async with aiofiles.open(template_path, "r", encoding="utf-8", errors="replace") as f:
        content = await f.read()
    content = content.replace("{{ shell_id }}", shell_id)
    return HTMLResponse(content=content)


@shell_logs_bp.websocket("/ws/shell-logs/{shell_id}")
async def shell_logs_ws(websocket: WebSocket, shell_id: str):
    await websocket.accept()

    try:
        from framework_shells import get_manager as get_framework_shell_manager
        mgr = await get_framework_shell_manager()
        rec = await mgr.get_shell(shell_id)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"Failed to load shell record: {e}"})
        await _safe_ws_close(websocket)
        return

    if not rec:
        await websocket.send_json({"type": "error", "message": f"Shell not found: {shell_id}"})
        await _safe_ws_close(websocket)
        return

    stdout_path = Path(rec.stdout_log)
    stderr_path = Path(rec.stderr_log)

    if not await asyncio.to_thread(stdout_path.exists) and not await asyncio.to_thread(stderr_path.exists):
        await websocket.send_json({"type": "error", "message": f"No log files found for {shell_id}"})
        await _safe_ws_close(websocket)
        return

    try:
        stdout_lines = []
        if await asyncio.to_thread(stdout_path.exists):
            async with aiofiles.open(stdout_path, 'r', encoding='utf-8', errors='replace') as f:
                stdout_lines = (await f.read()).splitlines()

        stderr_lines = []
        if await asyncio.to_thread(stderr_path.exists):
            async with aiofiles.open(stderr_path, 'r', encoding='utf-8', errors='replace') as f:
                stderr_lines = (await f.read()).splitlines()

        await websocket.send_json({
            "type": "initial",
            "stdout": "\n".join(stdout_lines[-200:]),
            "stderr": "\n".join(stderr_lines[-200:]),
        })

        stdout_size = (await asyncio.to_thread(stdout_path.stat)).st_size if await asyncio.to_thread(stdout_path.exists) else 0
        stderr_size = (await asyncio.to_thread(stderr_path.stat)).st_size if await asyncio.to_thread(stderr_path.exists) else 0

        while True:
            await asyncio.sleep(1)

            if await asyncio.to_thread(stdout_path.exists):
                current_stdout = (await asyncio.to_thread(stdout_path.stat)).st_size
                if current_stdout > stdout_size:
                    async with aiofiles.open(stdout_path, 'r', encoding='utf-8', errors='replace') as f:
                        await f.seek(stdout_size)
                        new_content = await f.read()
                        await websocket.send_json({"type": "update", "stream": "stdout", "data": new_content})
                    stdout_size = current_stdout
                elif current_stdout < stdout_size:
                    stdout_size = 0

            if await asyncio.to_thread(stderr_path.exists):
                current_stderr = (await asyncio.to_thread(stderr_path.stat)).st_size
                if current_stderr > stderr_size:
                    async with aiofiles.open(stderr_path, 'r', encoding='utf-8', errors='replace') as f:
                        await f.seek(stderr_size)
                        new_content = await f.read()
                        await websocket.send_json({"type": "update", "stream": "stderr", "data": new_content})
                    stderr_size = current_stderr
                elif current_stderr < stderr_size:
                    stderr_size = 0

    except Exception as e:
        print(f"[sessions_and_shortcuts] Log tail error: {e}")
    finally:
        await _safe_ws_close(websocket)


# --- API Endpoints for this extension ---

@sessions_bp.get('/sessions')
def get_sessions():
    output, error = run_script('list_sessions.sh', _app_root_path)
    if error:
        raise HTTPException(status_code=500, detail=error)

    def _parse_stat_fields(stat_content: str):
        """Return tuple (state, ppid, pgrp, session, tty_nr, tpgid) from a /proc/<pid>/stat line."""
        rparen = stat_content.rfind(')')
        if rparen == -1:
            raise ValueError('bad stat format')
        fields = stat_content[rparen + 2 :].split()
        state = fields[0]
        ppid = int(fields[1])
        pgrp = int(fields[2])
        session = int(fields[3])
        tty_nr = int(fields[4])
        tpgid = int(fields[5])
        return state, ppid, pgrp, session, tty_nr, tpgid

    def _read_stat(pid: int):
        try:
            with open(f"/proc/{pid}/stat", 'r') as f:
                return f.read()
        except Exception:
            return None

    def _children_of(pid: int):
        # Try /proc/<pid>/task/<pid>/children first
        try:
            with open(f"/proc/{pid}/task/{pid}/children", 'r') as f:
                txt = f.read().strip()
                return [int(x) for x in txt.split()] if txt else []
        except Exception:
            pass
        # Fallback: scan /proc for processes with this ppid
        kids = []
        try:
            for entry in os.listdir('/proc'):
                if not entry.isdigit():
                    continue
                sp = _read_stat(int(entry))
                if not sp:
                    continue
                try:
                    _, ppid, *_rest = _parse_stat_fields(sp)
                except Exception:
                    continue
                if ppid == pid:
                    kids.append(int(entry))
        except Exception:
            pass
        return kids

    def _read_comm(pid: int):
        try:
            with open(f"/proc/{pid}/comm", 'r') as f:
                return f.read().strip()
        except Exception:
            return None

    def _read_cmdline(pid: int):
        try:
            with open(f"/proc/{pid}/cmdline", 'rb') as f:
                raw = f.read()
            parts = [p.decode('utf-8', 'ignore') for p in raw.split(b'\x00') if p]
            return ' '.join(parts) if parts else None
        except Exception:
            return None

    def _detect_state(sid_str: str):
        """Detect whether a foreground job is running in this session.
        Strategy: Walk all descendants; collect TTY-bearing processes whose
        pgid == tpgid (i.e., they are the foreground process group). Exclude
        known shells/wrappers. Pick the deepest matching candidate and report
        its comm/cmdline. If none, report idle (bash).
        """
        try:
            root_pid = int(sid_str)
        except Exception:
            return {"busy": False, "fg_pid": None, "fg_comm": None, "fg_cmdline": None}

        # BFS through descendants to find candidates
        queue = [(root_pid, 0)]
        visited = set()
        candidates = []  # dicts: pid, depth, pgrp, tpgid, comm, cmdline
        while queue:
            pid, depth = queue.pop(0)
            if pid in visited:
                continue
            visited.add(pid)
            sp = _read_stat(pid)
            if not sp:
                for c in _children_of(pid):
                    queue.append((c, depth + 1))
                continue
            try:
                _state, _ppid, pgrp, _session, tty_nr, tpgid = _parse_stat_fields(sp)
            except Exception:
                for c in _children_of(pid):
                    queue.append((c, depth + 1))
                continue
            # Only consider TTY-bearing processes
            if tpgid > 0:
                comm = _read_comm(pid) or ''
                cmdline = _read_cmdline(pid) or ''
                candidates.append({
                    'pid': pid,
                    'depth': depth,
                    'pgrp': pgrp,
                    'tpgid': tpgid,
                    'comm': comm,
                    'cmdline': cmdline,
                })
            for c in _children_of(pid):
                queue.append((c, depth + 1))

        if not candidates:
            return {"busy": False, "fg_pid": None, "fg_comm": None, "fg_cmdline": None}

        # Prefer a foreground group leader that is not a shell/wrapper
        shell_names = {"bash", "zsh", "fish", "sh", "dash"}
        ignore_names = shell_names | {"dtach", "login", "agetty", "termux-login", "sshd"}

        fg_group_members = [
            c for c in candidates
            if c['pgrp'] == c['tpgid']
        ]

        non_shell_fg = [c for c in fg_group_members if c['comm'] not in ignore_names and not any(
            f"/{name}" in c['cmdline'] or c['cmdline'].startswith(name + ' ')
            for name in ignore_names
        )]

        chosen = None
        if non_shell_fg:
            # Deepest non-shell foreground member
            chosen = max(non_shell_fg, key=lambda c: c['depth'])
        else:
            # No obvious foreground job; treat as idle
            return {"busy": False, "fg_pid": None, "fg_comm": None, "fg_cmdline": None}

        return {
            "busy": True,
            "fg_pid": chosen['pid'],
            "fg_comm": chosen['comm'] or None,
            "fg_cmdline": chosen['cmdline'] or None,
        }

    try:
        sessions = json.loads(output)
        # Augment with process state info (best-effort; failures default to idle)
        for s in sessions:
            sid = s.get('sid')
            state = _detect_state(sid)
            s.update(state)
        return {"ok": True, "data": sessions}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail='Failed to decode JSON from script.')

@sessions_bp.get('/shortcuts')
def get_shortcuts():
    output, error = run_script('list_shortcuts.sh', _app_root_path)
    if error:
        raise HTTPException(status_code=500, detail=error)
    try:
        return {"ok": True, "data": json.loads(output)}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail='Failed to decode JSON from script.')


@sessions_bp.get('/framework_ui')
def get_framework_ui():
    """Return app-defined framework shell UI hints (live from disk)."""
    return {"ok": True, "data": _load_framework_shell_ui_by_app()}


async def _list_framework_shells():
    try:
        from framework_shells import get_manager
        manager = await get_manager()
        shells = await manager.list_shells()
        return [await manager.describe(s) for s in shells]
    except Exception as e:
        print(f"[sessions_and_shortcuts] _list_framework_shells error: {e}")
        import traceback
        traceback.print_exc()
        return []


async def _list_ipc_processes():
    """Fetch all processes from the IPC registry."""
    import httpx
    ipc_url = f"http://{os.environ.get('TE_IPC_HOST', '127.0.0.1')}:{os.environ.get('TE_IPC_PORT', '9099')}"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{ipc_url}/processes/list")
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("processes", [])
    except Exception:
        pass
    return []


def _build_shell_trees(shells, ipc_processes):
    """Build hierarchical trees grouping app-workers with their children.
    
    Returns list of trees where each tree is:
    {
        'shell': ShellRecord payload (the app-worker),
        'children': [
            {'process': IPC process record, 'shell': optional matching ShellRecord}
        ]
    }
    
    Non-app-worker shells are returned as standalone trees with no children.
    """
    # Index shells by PID for fast lookup
    shell_by_pid = {s.get('pid'): s for s in shells if s.get('pid')}
    
    # Find app-worker shells (these are the "parents" we care about)
    app_workers = [s for s in shells if (s.get('label') or '').startswith('app-worker:')]
    app_worker_pids = {s.get('pid') for s in app_workers if s.get('pid')}
    
    # Find child processes from IPC (processes whose parent_pid is an app-worker)
    children_by_parent = {}
    for proc in ipc_processes:
        parent_pid = proc.get('parent_pid')
        if parent_pid and parent_pid in app_worker_pids:
            children_by_parent.setdefault(parent_pid, []).append(proc)
    
    trees = []
    
    # Build trees for app-workers
    for shell in app_workers:
        pid = shell.get('pid')
        children = []
        for proc in children_by_parent.get(pid, []):
            child_pid = proc.get('pid')
            # Check if this child process also has a framework shell record
            matching_shell = shell_by_pid.get(child_pid)
            children.append({
                'process': proc,
                'shell': matching_shell,
            })
        trees.append({
            'shell': shell,
            'children': children,
            'is_app_worker': True,
        })
    
    # Add standalone shells (non-app-workers that aren't children of app-workers)
    child_pids = set()
    for procs in children_by_parent.values():
        child_pids.update(p.get('pid') for p in procs)
    
    for shell in shells:
        if shell in app_workers:
            continue
        pid = shell.get('pid')
        if pid in child_pids:
            continue  # Already included as a child
        trees.append({
            'shell': shell,
            'children': [],
            'is_app_worker': False,
        })
    
    return trees


@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    await websocket.accept()
    
    # Get event bus from framework_shells
    from framework_shells.events import get_event_bus
    from framework_shells import get_manager
    bus = get_event_bus()
    q = bus.subscribe()

    async def send_full_snapshot():
        """Send complete state snapshot."""
        try:
            sessions_resp = get_sessions()
            sessions_data = sessions_resp.get('data', []) if isinstance(sessions_resp, dict) else []
        except Exception:
            sessions_data = []

        frameworks = await _list_framework_shells()
        ipc_processes = await _list_ipc_processes()
        shell_trees = _build_shell_trees(frameworks, ipc_processes)
        framework_ui = _load_framework_shell_ui_by_app()
        
        await websocket.send_json({
            "type": "snapshot",
            "sessions": sessions_data,
            "frameworks": frameworks,
            "shell_trees": shell_trees,
            "containers": [],
            "framework_ui": framework_ui,
        })

    async def send_shell_event(event):
        """Send a single shell event with updated shell data."""
        mgr = await get_manager()
        shell_data = None
        
        # Get current shell state if shell still exists
        if event.type.value not in ("shell.removed",):
            try:
                rec = await mgr.get_shell(event.shell_id)
                if rec:
                    shell_data = await mgr.describe(rec)
            except Exception:
                pass
        
        await websocket.send_json({
            "type": "shell_event",
            "event": event.to_dict(),
            "shell": shell_data,
        })

    try:
        # Send initial snapshot
        await send_full_snapshot()
        
        # Event-driven loop with periodic session polling
        last_session_poll = asyncio.get_event_loop().time()
        SESSION_POLL_INTERVAL = 10.0  # Poll sessions every 10s (they don't have events)
        
        while True:
            try:
                # Wait for event with timeout
                event = await asyncio.wait_for(q.get(), timeout=2.0)
                # Send the event immediately
                await send_shell_event(event)
            except asyncio.TimeoutError:
                pass
            
            # Periodic session poll (non-framework shells don't emit events)
            now = asyncio.get_event_loop().time()
            if now - last_session_poll > SESSION_POLL_INTERVAL:
                last_session_poll = now
                try:
                    sessions_resp = get_sessions()
                    sessions_data = sessions_resp.get('data', []) if isinstance(sessions_resp, dict) else []
                    await websocket.send_json({
                        "type": "sessions_update",
                        "sessions": sessions_data,
                    })
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[sessions_and_shortcuts] WebSocket error: {exc}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
        finally:
            await _safe_ws_close(websocket)
    finally:
        if bus and q:
            bus.unsubscribe(q)

@sessions_bp.post('/sessions/{sid}/command')
def run_command(sid: str, data: dict = Body(...)):
    if not data or 'command' not in data:
        raise HTTPException(status_code=400, detail='Missing \'command\' in request body')
    _, error = run_script('run_in_session.sh', _app_root_path, [sid, data['command']])
    if error:
        raise HTTPException(status_code=500, detail=error)
    return {"ok": True}

@sessions_bp.post('/sessions/{sid}/shortcut')
def run_shortcut(sid: str, data: dict = Body(...)):
    if not data or 'path' not in data:
        raise HTTPException(status_code=400, detail='Missing \'path\' in request body')
    _, error = run_script('run_in_session.sh', _app_root_path, [sid, data['path']])
    if error:
        raise HTTPException(status_code=500, detail=error)
    return {"ok": True}

@sessions_bp.delete('/sessions/{sid}')
async def kill_session(sid: str):
    """Kill a session by PID.
    
    First attempts to find and terminate via framework shell manager
    (which handles IPC unregistration). Falls back to direct kill if not found.
    """
    try:
        pid = int(sid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail='Invalid session ID')
    
    # Try to find this PID in framework shells
    try:
        from framework_shells import get_manager
        manager = await get_manager()
        shells = await manager.list_shells()
        
        # Find shell by PID
        for shell in shells:
            if shell.pid == pid:
                # Use framework shell termination (handles IPC unregistration)
                await manager.terminate_shell(shell.id, force=True)
                return {"ok": True, "data": {"message": "Session terminated via framework shell manager"}}
    except Exception:
        pass  # Fall through to direct kill
    
    # Not a framework shell, kill directly
    try:
        # Unregister from IPC first (in case it was registered outside framework shells)
        from app.ipc.client import unregister_process
        unregister_process(pid)
        
        os.kill(pid, 9)
        return {"ok": True}
    except ProcessLookupError:
        return {"ok": True, "data": {"message": 'Session already terminated.'}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@sessions_bp.delete('/process/{pid}')
async def kill_process(pid: str, kill_children: bool = Query(False)):
    """Kill a process by PID.
    
    If kill_children=True, also kills all child processes registered in IPC.
    Used for both framework shells and their child processes (LSP servers, etc.).
    """
    try:
        target_pid = int(pid)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail='Invalid PID')
    
    killed_pids = []
    
    # If killing children, find them first via IPC
    if kill_children:
        ipc_processes = await _list_ipc_processes()
        child_pids = [p.get('pid') for p in ipc_processes if p.get('parent_pid') == target_pid]
        
        # Kill children first (in reverse order - deepest first if nested)
        for child_pid in reversed(child_pids):
            try:
                from app.ipc.client import unregister_process
                unregister_process(child_pid)
                os.kill(child_pid, 9)
                killed_pids.append(child_pid)
            except (ProcessLookupError, OSError):
                pass
    
    # Try framework shell manager first
    try:
        from framework_shells import get_manager
        manager = await get_manager()
        shells = await manager.list_shells()
        
        for shell in shells:
            if shell.pid == target_pid:
                await manager.terminate_shell(shell.id, force=True)
                killed_pids.append(target_pid)
                return {"ok": True, "data": {"killed_pids": killed_pids}}
    except Exception:
        pass
    
    # Direct kill
    try:
        from app.ipc.client import unregister_process
        unregister_process(target_pid)
        os.kill(target_pid, 9)
        killed_pids.append(target_pid)
        return {"ok": True, "data": {"killed_pids": killed_pids}}
    except ProcessLookupError:
        return {"ok": True, "data": {"message": 'Process already terminated.', "killed_pids": killed_pids}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
