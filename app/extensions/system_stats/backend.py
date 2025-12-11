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
    """Check if running as root.

    NOTE: Root-based collection is currently disabled for safety. This function
    is retained only to report whether the process is UID 0; the system_stats
    extension always uses the non-privileged psutil path regardless.
    """
    try:
        return {"is_root": os.geteuid() == 0, "method": "uid 0" if os.geteuid() == 0 else "none"}
    except AttributeError:
        # os.geteuid may not exist on some platforms (e.g., Windows/Termux quirks)
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

    try:
        # Local non-privileged loop (root-based worker path intentionally disabled)
        permission_failure_logged = False
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
            except PermissionError as e:
                # Some Android/Termux environments deny access to /proc/*
                if not permission_failure_logged:
                    print(f"[Stats] Permission denied for local metrics; disabling system_stats stream: {e}")
                    permission_failure_logged = True
                # Best-effort error payload for the client, then stop the loop
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Permission denied reading system metrics on this device."
                    })
                except Exception:
                    pass
                break
            except OSError as e:
                if getattr(e, "errno", None) == 13:
                    if not permission_failure_logged:
                        print(f"[Stats] Permission denied (errno 13) for local metrics; disabling system_stats stream: {e}")
                        permission_failure_logged = True
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Permission denied reading system metrics on this device."
                        })
                    except Exception:
                        pass
                    break
                else:
                    print(f"[Stats] Local stats OS error: {e}")
            except Exception as e:
                print(f"[Stats] Local stats error: {e}")
            
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
        print("Client disconnected from stats")
