import argparse
import asyncio
import os
import sys
import shutil
import hashlib
from pathlib import Path
from typing import Any, Dict, List

from ..manager import FrameworkShellManager
from ..process_snapshot import ProcfsProcessProvider, ProcessSnapshot
from ..shellspec import load_shellspec
from ..orchestrator import Orchestrator

def compute_standalone_fingerprint() -> str:
    """Compute fingerprint based on current working directory (assuming repo root)."""
    cwd = Path.cwd().resolve()
    return hashlib.sha256(str(cwd).encode()).hexdigest()[:16]

def load_stored_secret(fingerprint: str) -> str | None:
    """Try to load secret from stored file for this fingerprint."""
    secret_file = Path.home() / ".cache" / "te_framework" / "runtimes" / fingerprint / "secret"
    if secret_file.exists():
        try:
            return secret_file.read_text().strip()
        except Exception:
            pass
    return None

def setup_environment():
    """Auto-detect fingerprint and secret if not set."""
    # Compute fingerprint from cwd if not set
    if "FRAMEWORK_SHELLS_REPO_FINGERPRINT" not in os.environ:
        fp = compute_standalone_fingerprint()
        os.environ["FRAMEWORK_SHELLS_REPO_FINGERPRINT"] = fp
    else:
        fp = os.environ["FRAMEWORK_SHELLS_REPO_FINGERPRINT"]
    
    # Try to load stored secret if not set
    if "FRAMEWORK_SHELLS_SECRET" not in os.environ:
        secret = load_stored_secret(fp)
        if secret:
            os.environ["FRAMEWORK_SHELLS_SECRET"] = secret
        else:
            print(
                "Warning: No stored secret found. Using a temporary secret "
                "(dtach shells may keep running, but you won't be able to recover/attach to this runtime after restart)."
            )
            os.environ["FRAMEWORK_SHELLS_SECRET"] = "temporary_secret_" + os.urandom(8).hex()

def main():
    parser = argparse.ArgumentParser(description="Framework Shells CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # fs up [spec.yaml]
    up_parser = subparsers.add_parser("up", help="Apply a shell specification")
    up_parser.add_argument("spec", nargs="?", default="shells.yaml", help="Path to spec file")
    up_parser.add_argument("--prune", action="store_true", help="Remove shells not in spec")
    
    # fs list
    list_parser = subparsers.add_parser("list", help="List running shells")
    
    # fs down
    down_parser = subparsers.add_parser("down", help="Terminate shells")
    down_parser.add_argument("spec", nargs="?", help="Optional spec file/dir; if provided, only those specs are terminated")
    
    # fs attach [id]
    attach_parser = subparsers.add_parser("attach", help="Attach to a shell (dtach)")
    attach_parser.add_argument("id", help="Shell ID or Label")

    # fs tree
    tree_parser = subparsers.add_parser("tree", help="Show shell process trees (includes procfs descendants)")
    tree_parser.add_argument("--all", action="store_true", help="Include exited shells (if pid still known)")
    tree_parser.add_argument("--depth", type=int, default=8, help="Max procfs discovery depth (default: 8)")

    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    setup_environment()

    try:
        asyncio.run(run_async(args))
    except KeyboardInterrupt:
        pass

async def run_async(args):
    manager = FrameworkShellManager()

    if getattr(args, "command", None) == "tree":
        depth = int(getattr(args, "depth", 8) or 8)
        if depth < 1:
            depth = 1
        # CLI convenience: allow deeper/shallower procfs scanning.
        try:
            manager._procfs_provider = ProcfsProcessProvider(max_depth=depth)  # type: ignore[attr-defined]
        except Exception:
            pass

        shells = await manager.list_shells()
        if not getattr(args, "all", False):
            shells = [s for s in shells if (getattr(s, "status", None) or "") == "running"]

        described: List[Dict[str, Any]] = []
        for rec in shells:
            try:
                described.append(await manager.describe(rec))
            except Exception:
                described.append(rec.to_payload())

        snapshot: ProcessSnapshot = await manager.build_process_snapshot(shells=shells, include_procfs_descendants=True)
        processes = snapshot.processes

        children_by_parent: Dict[int, List[int]] = {}
        for pid, proc in processes.items():
            if proc.parent_pid is None:
                continue
            try:
                children_by_parent.setdefault(int(proc.parent_pid), []).append(int(pid))
            except Exception:
                continue

        def backend_for(info: Dict[str, Any]) -> str:
            if info.get("uses_dtach"):
                return "dtach"
            if info.get("uses_pipes"):
                return "pipe"
            if info.get("uses_pty"):
                return "pty"
            return "proc"

        def render_node(pid: int, *, indent: str, shell_pid_set: set[int]) -> None:
            proc = processes.get(pid)
            if not proc:
                return
            kind = proc.type or "process"
            label = proc.label or str(pid)
            marker = "[shell]" if pid in shell_pid_set else "[proc] "
            print(f"{indent}{marker} {pid:<6} {kind:<7} {label}")

            kids = children_by_parent.get(pid, [])
            for child_pid in sorted(kids):
                # Avoid duplicating shell roots under other shells in the listing.
                if child_pid in shell_pid_set and child_pid != pid:
                    continue
                render_node(child_pid, indent=indent + "  ", shell_pid_set=shell_pid_set)

        shell_pid_set = {int(x.get("pid")) for x in described if x.get("pid")}
        for info in sorted(described, key=lambda x: (str(x.get("label") or ""), str(x.get("id") or ""))):
            sid = str(info.get("id") or "")
            label = str(info.get("label") or sid)
            status = str(info.get("status") or "")
            pid = info.get("pid")
            if not pid:
                print(f"{sid}  {label}  status={status}  pid=-  backend={backend_for(info)}")
                continue
            print(f"{sid}  {label}  status={status}  pid={pid}  backend={backend_for(info)}")
            render_node(int(pid), indent="  ", shell_pid_set=shell_pid_set)
        return
    
    if args.command == "up":
        spec_path = Path(args.spec)
        if not spec_path.exists():
            print(f"Spec file not found: {spec_path}")
            sys.exit(1)
            
        print(f"Loading specs from {spec_path}...")
        specs_map = load_shellspec(spec_path)
        specs = list(specs_map.values())
        orch = Orchestrator(manager)
        await orch.apply(specs, prune=args.prune)
        print(f"Applied {len(specs)} specs.")
        
        # Keep alive for managing PTYs?
        # If we exit, the manager exits, PTYs die (unless dtach).
        # If backend=dtach, we can exit.
        # If backend=pty, we must stay running.
        # Check backend of shells.
        # For now, simplistic: wait forever if any non-dtach?
        # Or just wait forever to act as the daemon.
        print("Manager running. Press Ctrl+C to stop.")
        while True:
            await asyncio.sleep(1)

    elif args.command == "list":
        shells = await manager.list_shells()
        print(f"{'ID':<20} {'SPEC':<14} {'LABEL':<15} {'STATUS':<10} {'PID':<6} {'BACKEND'}")
        for s in shells:
            backend = (
                "dtach"
                if getattr(s, "uses_dtach", False)
                else ("pipe" if getattr(s, "uses_pipes", False) else ("pty" if s.uses_pty else "proc"))
            )
            print(f"{s.id:<20} {(getattr(s, 'spec_id', None) or '-'): <14} {s.label or '-':<15} {s.status:<10} {s.pid or '-':<6} {backend}")

    elif args.command == "down":
        spec_ids = None
        if getattr(args, "spec", None):
            spec_path = Path(args.spec)
            specs_map = load_shellspec(spec_path)
            spec_ids = set(specs_map.keys())

        shells = await manager.list_shells()
        for s in shells:
            if spec_ids is not None and getattr(s, "spec_id", None) not in spec_ids:
                continue
            print(f"Terminating {s.id}...")
            await manager.terminate_shell(s.id)
            
    elif args.command == "attach":
        # Check specific shell
        record = await manager.find_shell_by_label(args.id) or await manager.get_shell(args.id)
        if not record:
             print("Shell not found")
             sys.exit(1)
        
        if not getattr(record, "uses_dtach", False):
             print("Shell is not using dtach backend. Cannot attach client.")
             sys.exit(1)
             
        socket_path = manager.sockets_dir / f"{record.id}.sock"
        if not socket_path.exists():
             print("Socket not found")
             sys.exit(1)
             
        # Exec dtach -a
        # This replaces the CLI process with dtach
        dtach_bin = shutil.which("dtach") or "dtach"
        os.execvp(dtach_bin, [dtach_bin, "-a", str(socket_path)])

if __name__ == "__main__":
    main()
