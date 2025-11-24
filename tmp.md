# Intended Architecture - mrselect Framework

## Overview
A Python-based application framework running on Android (Termux) that manages multiple independent NiceGUI applications through a central FastAPI server. The framework provides process management, IPC communication, and network access control.

## Core Components

### 1. Framework Server (main.py)
**Intended Purpose:** Central FastAPI server that:
- Hosts on 0.0.0.0:8088
- Manages lifecycle of child application processes
- Routes HTTP requests to appropriate child apps via reverse proxy
- Enforces IP-based access control via middleware
- Handles graceful shutdown and cleanup

**Key Responsibilities:**
- Start/stop/monitor child application processes
- Proxy requests from `/app/<app_id>/*` to child app ports
- Filter incoming connections based on network interface allowlist
- Maintain IPC socket for process registration/communication
- Serve NiceGUI framework assets

### 2. IP Filtering Middleware
**Intended Purpose:** Block all connections except from explicitly allowed networks

**Design:**
- `--broadcast all` → Allow from any IP (no filtering)
- `--broadcast` → Allow from localhost only (127.0.0.1, ::1)
- `--broadcast <interface>` → Allow from that interface's subnet
- `--broadcast <ip/cidr>` → Allow from specific IP or CIDR range

**Logic Flow:**
1. Parse allowlist items (interfaces, IPs, CIDR ranges)
2. For interfaces: resolve to subnet using ifconfig + netmask
3. Skip /32 masks (single host, not a subnet)
4. On each request: check client IP against allowlist
5. Match by direct IP comparison OR subnet membership
6. Block (403) if no match found
7. Fail secure: block on any error during validation

### 3. Application Management
**Intended Purpose:** Launch and monitor child NiceGUI applications

**Design:**
- Each app defined in JSON config file
- Apps run as separate Python processes on unique ports (8090+)
- Framework maintains registry of running apps
- Apps register with framework via IPC socket
- Apps can be started/stopped/restarted independently

**App Configuration Structure:**
```json
{
  "app_id": "unique-identifier",
  "label": "Display Name",
  "module_path": "path/to/app.py",
  "port": 8090,
  "enabled": true
}
```

### 4. IPC System (Inter-Process Communication)
**Intended Purpose:** Unix socket-based communication between framework and child apps

**Design:**
- Socket file: `/tmp/mrselect_ipc.sock`
- Protocol: JSON messages over Unix socket
- Message types:
  - `register`: Child app announces itself (pid, type, label, port)
  - `status`: Query process status
  - `shutdown`: Request graceful shutdown

**Intended Flow:**
1. Framework creates IPC socket on startup
2. Child app connects and sends register message
3. Framework stores app metadata in running registry
4. Framework can query/control apps via IPC

### 5. Request Routing
**Intended Purpose:** Proxy HTTP requests to correct child application

**Design:**
- URL pattern: `/app/<app_id>/<subpath>`
- Framework looks up app_id in registry to get port
- Proxies request to `http://localhost:<port>/<subpath>`
- Streams response back to client
- Preserves headers, query params, request body

**Special Routes:**
- `/_nicegui/*` → Framework serves NiceGUI static assets
- `/shutdown` → Framework graceful shutdown endpoint
- All other `/app/*` → Proxy to child apps

### 6. Process Lifecycle
**Intended Purpose:** Manage child app processes cleanly

**Startup:**
1. Parse command-line args for network allowlist
2. Build IP/subnet allowlist from interfaces
3. Register middleware for IP filtering
4. Initialize IPC socket listener
5. Load app configs from JSON files
6. Launch enabled apps as subprocess.Popen
7. Start background monitoring thread
8. Run uvicorn server (blocking)

**Shutdown:**
1. Receive SIGTERM/SIGINT or /shutdown request
2. Stop accepting new connections
3. Send shutdown signal to all child processes via IPC
4. Wait for child processes to exit (with timeout)
5. Close IPC socket
6. Cleanup temporary files
7. Exit framework process

### 7. NiceGUI Integration
**Intended Purpose:** Provide modified NiceGUI library for child apps

**Design:**
- Vendored NiceGUI in `app/static/vendor/nicegui/`
- Modified to work with framework routing
- Child apps import from vendored path
- Framework serves NiceGUI assets at `/_nicegui/*`
- Apps can use ui.run() and framework handles the rest

### 8. Background Monitoring
**Intended Purpose:** Detect and restart crashed child apps

**Design:**
- Background thread polls child process status
- If process exits unexpectedly, restart it
- Log crashes and restart attempts
- Configurable retry limits and backoff

## Network Security Model

**Intended Behavior:**
- Default: localhost only (127.0.0.1, ::1)
- With `--broadcast wlan0`: Allow only from wlan0's subnet
- With `--broadcast tailscale0`: Allow only from tailscale0's subnet  
- With `--broadcast 192.168.1.0/24`: Allow only from that CIDR
- With `--broadcast all`: No filtering (dangerous)

**Critical:** Should NEVER allow connections from interfaces not explicitly listed

## File Structure
```
/data/data/com.termux/files/home/mrselect/
├── app/
│   ├── main.py                    # Framework server
│   ├── libs/
│   │   ├── app_manager.py         # Process management
│   │   └── app_lifecycle.py       # Startup/shutdown logic
│   ├── ipc/
│   │   ├── client.py              # IPC client (for child apps)
│   │   └── server.py              # IPC server (in framework)
│   ├── static/
│   │   └── vendor/nicegui/        # Vendored NiceGUI library
│   └── <various_apps>/            # Child application directories
├── runtime_paths/                 # App config JSON files
└── requirements.txt               # Python dependencies
```

## Dependencies
- Python 3.10+
- FastAPI (web framework)
- Uvicorn (ASGI server)
- NiceGUI (UI framework for apps)
- httpx (HTTP client for proxying)
- Standard library: subprocess, socket, signal, threading

## Intended Use Cases
1. **Development:** Run multiple UI apps during development, each isolated
2. **Multi-tenant:** Host several NiceGUI apps under one server
3. **Android Deployment:** Run web apps on Android via Termux
4. **Network Isolation:** Restrict access to specific network interfaces

## Security Assumptions
- IP filtering is the ONLY access control mechanism
- No authentication/authorization beyond IP allowlist
- Child apps trust the framework (same user, no isolation)
- IPC socket has filesystem permissions protection only
- Intended for trusted networks (home, VPN, development)
