import argparse
import asyncio
import os
import sys
import shutil
import hashlib
from pathlib import Path

from ..manager import FrameworkShellManager
from ..spec import load_specs
from ..orchestrator import Orchestrator

def compute_standalone_fingerprint() -> str:
    """Compute fingerprint based on current working directory (assuming repo root)."""
    # Try to find repo root markers
    cwd = Path.cwd().resolve()
    # If we are in cli/.. we might be deep.
    # Simple heuristic: hash the cwd path.
    # Ideally should match run_framework.sh logic: REPO_ROOT realpath.
    # Let's assume user runs fs from repo root.
    return hashlib.sha256(str(cwd).encode()).hexdigest()[:16]

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
    down_parser = subparsers.add_parser("down", help="Terminate all shells")
    
    # fs attach [id]
    attach_parser = subparsers.add_parser("attach", help="Attach to a shell (dtach)")
    attach_parser.add_argument("id", help="Shell ID or Label")

    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
        
    # Ensure secret for standalone usage
    if "FRAMEWORK_SHELLS_SECRET" not in os.environ:
        print("Warning: FRAMEWORK_SHELLS_SECRET not set. Using temporary secret (shells will be lost on exit).")
        os.environ["FRAMEWORK_SHELLS_SECRET"] = "temporary_secret_" + os.urandom(8).hex()

    if "TE_REPO_FINGERPRINT" not in os.environ:
        fp = compute_standalone_fingerprint()
        os.environ["TE_REPO_FINGERPRINT"] = fp
        # print(f"Computed standalone fingerprint: {fp}")

    try:
        asyncio.run(run_async(args))
    except KeyboardInterrupt:
        pass

async def run_async(args):
    manager = FrameworkShellManager()
    
    if args.command == "up":
        spec_path = Path(args.spec)
        if not spec_path.exists():
            print(f"Spec file not found: {spec_path}")
            sys.exit(1)
            
        print(f"Loading specs from {spec_path}...")
        specs = load_specs(spec_path)
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
        print(f"{'ID':<20} {'LABEL':<15} {'STATUS':<10} {'PID':<6} {'BACKEND'}")
        for s in shells:
            backend = "dtach" if getattr(s, "uses_dtach", False) else ("pty" if s.uses_pty else "proc")
            print(f"{s.id:<20} {s.label or '-':<15} {s.status:<10} {s.pid or '-':<6} {backend}")

    elif args.command == "down":
        shells = await manager.list_shells()
        for s in shells:
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
