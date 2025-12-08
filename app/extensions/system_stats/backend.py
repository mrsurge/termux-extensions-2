import asyncio
import json
import platform
import socket
import psutil
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

# Create the router - variable name MUST match the one expected by the loader
# The loader usually expects 'bp' or looks for an APIRouter instance.
# Based on standard extensions, we'll name it `bp`.
bp = APIRouter()

async def get_system_info():
    """Get static system info."""
    uname = platform.uname()
    return {
        "system": uname.system,
        "node": uname.node,
        "release": uname.release,
        "version": uname.version,
        "machine": uname.machine,
        "processor": uname.processor,
    }

def get_ip_address():
    """Best-effort IP detection - returns primary IP."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_all_ips():
    """Get all network interface IPs."""
    import psutil
    ips = []
    try:
        addrs = psutil.net_if_addrs()
        for iface, addr_list in addrs.items():
            for addr in addr_list:
                # AF_INET = IPv4
                if addr.family == socket.AF_INET:
                    ips.append({"iface": iface, "ip": addr.address})
    except Exception:
        pass
    # Fallback if nothing found
    if not ips:
        ips.append({"iface": "lo", "ip": "127.0.0.1"})
    return ips

def check_root():
    """Check if running as root or has sudo/su access."""
    if os.geteuid() == 0:
        return {"is_root": True, "method": "uid 0"}
    
    # Check for sudo
    try:
        import subprocess
        # -n: non-interactive, -v: validate credentials (or just check availability)
        # Using 'true' is safer/faster
        ret = subprocess.run(["sudo", "-n", "true"], capture_output=True)
        if ret.returncode == 0:
            return {"is_root": True, "method": "sudo"}
    except Exception:
        pass
        
    return {"is_root": False, "method": "none"}

@bp.get("/ping")
def ping():
    return {"pong": True}

@bp.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    print("[Stats] WebSocket connection attempt")
    await websocket.accept()
    print("[Stats] WebSocket accepted")
    
    # Send static info once
    await websocket.send_json({
        "type": "static",
        "info": await get_system_info(),
        "root": check_root()
    })

    # Determine collection strategy
    root_info = check_root()
    use_sudo = root_info["method"] == "sudo"
    
    proc = None
    
    try:
        if use_sudo:
            # Resolve worker path
            worker_path = os.path.join(os.path.dirname(__file__), 'root_stats_worker.py')
            
            # Spawn long-lived root worker
            proc = await asyncio.create_subprocess_exec(
                "sudo", "python3", worker_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Read loop
            while True:
                if proc.stdout.at_eof():
                    break
                    
                line = await proc.stdout.readline()
                if not line:
                    break
                    
                try:
                    data = json.loads(line.decode())
                    if 'error' in data:
                        print(f"Worker error: {data['error']}")
                        continue
                        
                    mem_used_gb = round(data['mem_used'] / (1024**3), 2)
                    mem_total_gb = round(data['mem_total'] / (1024**3), 2)
                    
                    payload = {
                        "type": "metrics",
                        "cpu": {
                            "total": data['cpu_total'],
                            "cores": data['cpu_cores'],
                            "count": len(data['cpu_cores'])
                        },
                        "memory": {
                            "percent": data['mem_percent'],
                            "used": mem_used_gb,
                            "total": mem_total_gb
                        },
                        "ip": get_ip_address(),
                        "ips": get_all_ips()
                    }
                    await websocket.send_json(payload)
                except json.JSONDecodeError:
                    pass
                    
        else:
            # Local fallback loop
            while True:
                try:
                    cpu_total = psutil.cpu_percent(interval=None)
                    cpu_cores = psutil.cpu_percent(interval=None, percpu=True)
                    mem = psutil.virtual_memory()
                    
                    payload = {
                        "type": "metrics",
                        "cpu": {
                            "total": cpu_total,
                            "cores": cpu_cores,
                            "count": len(cpu_cores)
                        },
                        "memory": {
                            "percent": mem.percent,
                            "used": round(mem.used / (1024**3), 2),
                            "total": round(mem.total / (1024**3), 2)
                        },
                        "ip": get_ip_address(),
                        "ips": get_all_ips()
                    }
                    await websocket.send_json(payload)
                except Exception as e:
                    print(f"Local stats error: {e}")
                    
                await asyncio.sleep(1)
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Stats error: {e}")
        try:
            await websocket.close()
        except:
            pass
    finally:
        # Cleanup subprocess if it exists
        if proc:
            try:
                if proc.returncode is None:
                    proc.terminate()
                    await proc.wait()
            except Exception as e:
                print(f"Failed to kill worker: {e}")
        print("Client disconnected from stats")
