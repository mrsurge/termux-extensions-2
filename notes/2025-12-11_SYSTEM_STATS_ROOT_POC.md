# System Stats Root Worker PoC (Archived)

**Date:** 2025-12-11  
**Component:** `app/extensions/system_stats`  
**Status:** Archived (root path disabled in live code)

---

This note preserves the original PoC for a root-privileged system stats worker that was wired into the `system_stats` extension. The live backend has been simplified to always use the non-privileged `psutil` loop; the root path is kept here purely for reference.

## Original `check_root` Logic (PoC)

```python
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
```

## Original WebSocket Root Worker Path (PoC)

```python
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
            # Local fallback loop (non-root psutil metrics)
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
```

## Root Worker Script (`root_stats_worker.py`)

> Note: This file still exists in the tree and remains unchanged; the live backend no longer calls it. Included here for completeness.

```python
import json
import psutil
import time
import sys

def main():
    while True:
        try:
            # Gather metrics
            # interval=None means non-blocking (since last call)
            # We sleep manually at the end
            cpu_total = psutil.cpu_percent(interval=None)
            cpu_cores = psutil.cpu_percent(interval=None, percpu=True)
            mem = psutil.virtual_memory()
            
            data = {
                'cpu_total': cpu_total,
                'cpu_cores': cpu_cores,
                'mem_percent': mem.percent,
                'mem_used': mem.used,
                'mem_total': mem.total
            }
            
            # Print JSON line and flush immediately
            print(json.dumps(data))
            sys.stdout.flush()
            
            time.sleep(1)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            # Send error as JSON so parent can log it
            print(json.dumps({'error': str(e)}))
            sys.stdout.flush()
            time.sleep(1)

if __name__ == "__main__":
    main()
```

---

In the current implementation, the `system_stats` extension always uses the non-privileged psutil loop and never spawns root/sudo workers. This note is the canonical reference for the old behavior if a future design revisits root-level metrics under a safer framework shell model.

