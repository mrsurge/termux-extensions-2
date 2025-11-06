# Extension: Sessions & Shortcuts

import json
import os
import subprocess
from fastapi import APIRouter, HTTPException, Body

# Create a APIRouter
sessions_bp = APIRouter()

# Determine the project root path to find the scripts directory
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_app_root_path = os.path.join(_project_root, 'app')

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
def kill_session(sid: str):
    try:
        os.kill(int(sid), 9)
        return {"ok": True}
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail='Invalid session ID')
    except ProcessLookupError:
        return {"ok": True, "data": {"message": 'Session already terminated.'}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
