# WebSocket Architecture & Implementation Guide

**Last Updated:** November 2, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [WebSocket Stack](#websocket-stack)
3. [Architecture Patterns](#architecture-patterns)
4. [Implementation Guide](#implementation-guide)
5. [Proxy Pattern (App Workers)](#proxy-pattern-app-workers)
6. [Direct Pattern (Main App)](#direct-pattern-main-app)
7. [Best Practices](#best-practices)
8. [Common Patterns](#common-patterns)
9. [Error Handling](#error-handling)
10. [Debugging](#debugging)

---

## Overview

The framework uses **flask-sock** for WebSocket support, providing bidirectional real-time communication between browsers and backend services. WebSockets are used extensively for:

- **Terminal streaming** - PTY output and input
- **Agent communication** - AI agent responses and tool calls
- **File watching** - Real-time diff updates and file change notifications
- **Edit tracking** - Monitor file modifications by agents/terminal
- **Live logs** - Streaming logs from framework shells

### Key Concepts

**Two deployment patterns:**

1. **Main app WebSockets** - Handled directly by main Flask process (`app/main.py`)
2. **Worker app WebSockets** - Handled by on-demand worker processes, proxied by main app

**Why proxy worker WebSockets?**
- Apps run in isolated worker processes (port 50000+)
- Main app runs on port 8080
- Browser connects to main app, which forwards to worker
- Enables process isolation and independent lifecycle management

---

## WebSocket Stack

### Dependencies

```python
from flask import Flask
from flask_sock import Sock
from simple_websocket import Client as WSClient, ConnectionClosed
```

**flask-sock** - WebSocket decorator for Flask routes  
**simple-websocket** - Low-level WebSocket client/server (used for proxying)

### Initialization

```python
# In app/main.py
from flask import Flask
from flask_sock import Sock

app = Flask(__name__)
sock = Sock(app)

# Make sock available to other modules
app.config["SOCK"] = sock
```

### URL Conventions

**Main app WebSockets:**
```
/ws/<route>                    # Direct WebSocket in main process
```

**Worker app WebSockets:**
```
/ws/app/<app_id>/<route>       # Client connects here
    ↓ proxied to ↓
/ws/<route>                    # Worker handles here
```

**Examples:**
```
# Main app - direct
ws://localhost:8080/ws/terminal/shell_123

# Worker app - proxied
ws://localhost:8080/ws/app/file_editor_cm6/agent
  → proxied to →
ws://localhost:50001/ws/agent
```

---

## Architecture Patterns

### Pattern 1: Direct WebSocket (Main App)

```
Browser
  ↓ ws://localhost:8080/ws/terminal/shell_123
Main Flask App
  ↓
Handle WebSocket directly
```

**Use when:**
- Feature is core to framework (not app-specific)
- Low latency required
- No process isolation needed

**Examples:**
- Framework shell management
- Core terminal sessions
- System-wide notifications

### Pattern 2: Proxied WebSocket (Worker App)

```
Browser
  ↓ ws://localhost:8080/ws/app/code_cm6/agent
Main Flask App (proxy)
  ↓ ws://localhost:50001/ws/agent
Worker Process
  ↓
Handle WebSocket
```

**Use when:**
- App-specific functionality
- Process isolation desired
- Resource limits needed
- Independent lifecycle management

**Examples:**
- Code CM6 agent drawer
- Code CM6 terminal
- App-specific file watchers

---

## Implementation Guide

### Step 1: Choose Pattern

**Decision tree:**
```
Is this core framework functionality?
  ↓ YES
  Use Direct Pattern (main app)
  
  ↓ NO
  Is this app-specific?
    ↓ YES
    Use Proxy Pattern (worker app)
```

### Step 2A: Direct Pattern Implementation

**File:** `app/main.py` or `app/libs/your_module.py`

```python
# app/libs/my_websocket.py

from flask import current_app

def register_my_websocket():
    """Register WebSocket route on main app."""
    sock = current_app.config["SOCK"]
    
    @sock.route('/ws/my_feature')
    def my_websocket(ws):
        """WebSocket handler."""
        try:
            while True:
                # Receive message from client
                msg = ws.receive()
                if msg is None:
                    break
                
                # Process message
                response = process_message(msg)
                
                # Send response to client
                ws.send(response)
        
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            ws.close()

# In app/main.py, call during initialization:
# from app.libs.my_websocket import register_my_websocket
# register_my_websocket()
```

### Step 2B: Proxy Pattern Implementation

**Two files needed:**

**1. Worker WebSocket Handler** - `app/apps/my_app/main.py`

```python
# app/apps/my_app/main.py

from flask import Blueprint, current_app

bp = Blueprint('my_app', __name__)

def init_app(app):
    """Initialize app - called by framework."""
    sock = app.config.get("SOCK")
    if sock:
        register_websockets(sock)

def register_websockets(sock):
    """Register WebSocket routes."""
    
    @sock.route('/ws/my_feature')
    def my_feature_websocket(ws):
        """
        Worker WebSocket handler.
        
        Client connects to: ws://localhost:8080/ws/app/my_app/my_feature
        Main app proxies to: ws://localhost:50001/ws/my_feature
        """
        try:
            while True:
                msg = ws.receive()
                if msg is None:
                    break
                
                # Process message
                response = handle_message(msg)
                
                # Send response
                ws.send(response)
        
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            ws.close()
```

**2. Main App Proxy** - `app/main.py` (already implemented!)

The main app automatically proxies all `/ws/app/<app_id>/<route>` connections to worker processes:

```python
# In app/main.py (already exists!)

@sock.route('/ws/app/<app_id>/<path:subpath>')
def proxy_app_websocket(client_ws, app_id, subpath):
    """
    Generic WebSocket proxy for app workers.
    Forwards WebSocket connections from clients to the appropriate worker process.
    """
    # Get worker info
    app_info = ensure_app_running(app_id)
    port = app_info['port']
    
    # Build worker URL
    worker_url = f"ws://127.0.0.1:{port}/ws/{subpath}"
    
    # Connect to worker
    worker_ws = WSClient.connect(worker_url)
    
    # Forward messages bidirectionally
    # ... (see full implementation in app/main.py)
```

**No additional work needed!** Just implement your WebSocket in the worker, and the proxy handles the rest.

---

## Proxy Pattern (App Workers)

### How Proxying Works

```
1. Browser connects to main app:
   ws://localhost:8080/ws/app/code_cm6/agent

2. Main app extracts:
   - app_id: "code_cm6"
   - subpath: "agent"

3. Main app ensures worker is running:
   - Checks if worker process exists
   - Spawns worker if needed
   - Gets worker port (e.g., 50001)

4. Main app connects to worker:
   ws://localhost:50001/ws/agent

5. Main app creates bidirectional bridge:
   Browser ↔ Main App ↔ Worker

6. Messages flow in both directions:
   - Browser → Main → Worker
   - Worker → Main → Browser

7. Connection cleanup:
   - If browser disconnects, main closes worker connection
   - If worker disconnects, main closes browser connection
```

### Bidirectional Forwarding

The main app uses **two threads** for full-duplex communication:

```python
def forward_client_to_worker():
    """Forward messages from client to worker"""
    try:
        while True:
            msg = client_ws.receive()
            if msg is None:
                break
            worker_ws.send(msg)
    except ConnectionClosed:
        pass
    finally:
        worker_ws.close()

def forward_worker_to_client():
    """Forward messages from worker to client"""
    try:
        while True:
            msg = worker_ws.receive()
            if msg is None:
                break
            client_ws.send(msg)
    except ConnectionClosed:
        pass
    finally:
        client_ws.close()

# Start both threads
client_thread = threading.Thread(target=forward_client_to_worker, daemon=True)
worker_thread = threading.Thread(target=forward_worker_to_client, daemon=True)

client_thread.start()
worker_thread.start()

# Wait for both to complete
client_thread.join()
worker_thread.join()
```

**Why threads?**
- `ws.receive()` is blocking
- Need to listen on both connections simultaneously
- Clean shutdown when either side closes

---

## Direct Pattern (Main App)

### When to Use

Use direct WebSockets in the main app for:
- Framework-wide features
- Shared services
- Low-latency requirements
- Features used by multiple apps

### Registration

**Option 1: In module**

```python
# app/libs/my_feature.py

def register_my_websocket():
    """Register on main app's sock instance."""
    from flask import current_app
    sock = current_app.config["SOCK"]
    
    @sock.route('/ws/my_feature')
    def handle_websocket(ws):
        # ... handler code ...
        pass

# In app/main.py:
# from app.libs.my_feature import register_my_websocket
# register_my_websocket()
```

**Option 2: In main.py**

```python
# app/main.py

@sock.route('/ws/my_feature')
def my_websocket(ws):
    # ... handler code ...
    pass
```

---

## Best Practices

### 1. Message Format

**Use JSON for structured communication:**

```python
# Sending
msg = {
    "type": "response",
    "data": {"key": "value"},
    "timestamp": time.time()
}
ws.send(json.dumps(msg))

# Receiving
raw = ws.receive()
if raw:
    msg = json.loads(raw)
    msg_type = msg.get("type")
```

**Common message types:**
- `request` - Client request
- `response` - Server response
- `event` - Asynchronous event/notification
- `error` - Error message
- `ping` / `pong` - Keep-alive

### 2. Error Handling

**Always use try-finally:**

```python
@sock.route('/ws/feature')
def websocket_handler(ws):
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            
            try:
                # Process message
                result = process(msg)
                ws.send(result)
            except Exception as e:
                # Send error to client
                ws.send(json.dumps({
                    "type": "error",
                    "error": str(e)
                }))
    
    except ConnectionClosed:
        # Client disconnected
        pass
    
    finally:
        # Always cleanup
        ws.close()
        cleanup_resources()
```

### 3. Connection Lifecycle

**Track connection state:**

```python
connections = set()

@sock.route('/ws/feature')
def websocket_handler(ws):
    # Register connection
    connections.add(ws)
    
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            # ... handle message ...
    
    finally:
        # Unregister connection
        connections.discard(ws)
        ws.close()

# Broadcast to all connections
def broadcast(message):
    for ws in list(connections):
        try:
            ws.send(message)
        except:
            connections.discard(ws)
```

### 4. Timeouts

**Don't block indefinitely:**

```python
import select

@sock.route('/ws/feature')
def websocket_handler(ws):
    try:
        while True:
            # Check if data available (with timeout)
            ready, _, _ = select.select([ws.sock], [], [], 30.0)
            
            if not ready:
                # Timeout - send ping
                ws.send(json.dumps({"type": "ping"}))
                continue
            
            msg = ws.receive()
            if msg is None:
                break
            
            # Process message...
    
    finally:
        ws.close()
```

### 5. Threading for Long Operations

**Don't block WebSocket thread:**

```python
import threading
import queue

@sock.route('/ws/feature')
def websocket_handler(ws):
    response_queue = queue.Queue()
    
    def process_in_background(data):
        """Long-running operation in separate thread."""
        result = expensive_operation(data)
        response_queue.put(result)
    
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            
            # Start background processing
            threading.Thread(
                target=process_in_background,
                args=(msg,),
                daemon=True
            ).start()
            
            # Check for responses (non-blocking)
            try:
                result = response_queue.get_nowait()
                ws.send(json.dumps(result))
            except queue.Empty:
                pass
    
    finally:
        ws.close()
```

### 6. Authentication

**Validate connections:**

```python
@sock.route('/ws/feature')
def websocket_handler(ws):
    # Check auth token from query params or first message
    token = request.args.get('token')
    
    if not validate_token(token):
        ws.send(json.dumps({"type": "error", "error": "Unauthorized"}))
        ws.close()
        return
    
    # Continue with authenticated connection...
```

### 7. Resource Cleanup

**Always clean up resources:**

```python
@sock.route('/ws/agent')
def agent_websocket(ws):
    shell = None
    
    try:
        # Acquire resources
        shell = get_framework_shell()
        
        while True:
            msg = ws.receive()
            if msg is None:
                break
            # ... process ...
    
    finally:
        # Always cleanup
        if shell:
            cleanup_shell(shell)
        ws.close()
```

---

## Common Patterns

### Pattern: Request-Response

```python
@sock.route('/ws/query')
def query_websocket(ws):
    try:
        while True:
            # Receive request
            raw = ws.receive()
            if not raw:
                break
            
            request = json.loads(raw)
            request_id = request.get('id')
            
            # Process
            result = process_query(request['query'])
            
            # Send response
            response = {
                "id": request_id,
                "type": "response",
                "result": result
            }
            ws.send(json.dumps(response))
    
    finally:
        ws.close()
```

**Client:**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/query');

ws.onopen = () => {
    ws.send(JSON.stringify({
        id: '123',
        query: 'SELECT * FROM users'
    }));
};

ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    if (response.id === '123') {
        console.log('Result:', response.result);
    }
};
```

### Pattern: Streaming Events

```python
@sock.route('/ws/stream')
def stream_websocket(ws):
    try:
        # Start background event generator
        for event in generate_events():
            ws.send(json.dumps({
                "type": "event",
                "data": event
            }))
    
    except ConnectionClosed:
        pass
    
    finally:
        ws.close()
```

**Client:**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/stream');

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'event') {
        handleEvent(msg.data);
    }
};
```

### Pattern: Bidirectional (Agent Communication)

```python
@sock.route('/ws/agent')
def agent_websocket(ws):
    shell = get_agent_shell()
    
    def read_agent_output():
        """Background thread reading agent output."""
        try:
            for line in shell.read_lines():
                event = json.loads(line)
                ws.send(json.dumps(event))
        except:
            pass
    
    # Start output reader
    threading.Thread(target=read_agent_output, daemon=True).start()
    
    try:
        while True:
            # Receive from client
            msg = ws.receive()
            if not msg:
                break
            
            # Send to agent
            shell.write_line(msg)
    
    finally:
        ws.close()
```

### Pattern: Broadcast

```python
subscribers = set()

@sock.route('/ws/broadcast')
def broadcast_websocket(ws):
    subscribers.add(ws)
    
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            
            # Broadcast to all subscribers
            for sub in list(subscribers):
                try:
                    sub.send(msg)
                except:
                    subscribers.discard(sub)
    
    finally:
        subscribers.discard(ws)
        ws.close()
```

### Pattern: Framework Shell Streaming

```python
@sock.route('/ws/terminal/<shell_id>')
def terminal_websocket(ws, shell_id):
    from app.framework_shells import get_framework_shell_manager
    
    manager = get_framework_shell_manager()
    shell = manager.get_shell(shell_id)
    
    if not shell or not shell.alive:
        ws.send(json.dumps({"type": "error", "error": "Shell not found"}))
        ws.close()
        return
    
    def read_output():
        """Stream shell output to client."""
        try:
            for line in iter(shell.process.stdout.readline, b''):
                if not line:
                    break
                ws.send(line.decode('utf-8'))
        except:
            pass
    
    # Start output streaming
    threading.Thread(target=read_output, daemon=True).start()
    
    try:
        while True:
            # Receive input from client
            msg = ws.receive()
            if msg is None:
                break
            
            # Send to shell stdin
            shell.process.stdin.write(msg.encode('utf-8'))
            shell.process.stdin.flush()
    
    finally:
        ws.close()
```

---

## Error Handling

### Connection Errors

```python
from simple_websocket import ConnectionClosed

@sock.route('/ws/feature')
def websocket_handler(ws):
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                # Normal close
                break
            
            # Process...
    
    except ConnectionClosed:
        # Client closed connection
        print("Connection closed by client")
    
    except Exception as e:
        # Other errors
        print(f"Error: {e}")
        try:
            ws.send(json.dumps({
                "type": "error",
                "error": str(e)
            }))
        except:
            pass
    
    finally:
        try:
            ws.close()
        except:
            pass
```

### Processing Errors

```python
@sock.route('/ws/feature')
def websocket_handler(ws):
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            
            try:
                # Parse message
                data = json.loads(msg)
                
                # Process
                result = process(data)
                
                # Send result
                ws.send(json.dumps({
                    "type": "response",
                    "result": result
                }))
            
            except json.JSONDecodeError:
                # Invalid JSON
                ws.send(json.dumps({
                    "type": "error",
                    "error": "Invalid JSON"
                }))
            
            except ValueError as e:
                # Business logic error
                ws.send(json.dumps({
                    "type": "error",
                    "error": str(e)
                }))
            
            except Exception as e:
                # Unexpected error
                ws.send(json.dumps({
                    "type": "error",
                    "error": "Internal server error"
                }))
                print(f"Unexpected error: {e}")
    
    finally:
        ws.close()
```

### Timeout Handling

```python
import select

@sock.route('/ws/feature')
def websocket_handler(ws):
    TIMEOUT = 60  # seconds
    last_activity = time.time()
    
    try:
        while True:
            # Check for timeout
            if time.time() - last_activity > TIMEOUT:
                ws.send(json.dumps({
                    "type": "error",
                    "error": "Connection timeout"
                }))
                break
            
            # Non-blocking receive with timeout
            ready, _, _ = select.select([ws.sock], [], [], 10.0)
            
            if not ready:
                # Send keepalive
                ws.send(json.dumps({"type": "ping"}))
                continue
            
            msg = ws.receive()
            if msg is None:
                break
            
            last_activity = time.time()
            
            # Process message...
    
    finally:
        ws.close()
```

---

## Debugging

### Enable Logging

```python
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

@sock.route('/ws/feature')
def websocket_handler(ws):
    logger.info(f"WebSocket connected: {request.remote_addr}")
    
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                logger.info("Client disconnected")
                break
            
            logger.debug(f"Received: {msg}")
            
            # Process...
            
            logger.debug(f"Sent: {response}")
    
    finally:
        ws.close()
```

### Debug Messages

**Client-side:**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/feature');

ws.onopen = () => {
    console.log('WebSocket connected');
};

ws.onmessage = (event) => {
    console.log('Received:', event.data);
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
};
```

**Server-side:**
```python
@sock.route('/ws/feature')
def websocket_handler(ws):
    print(f"[WS] Connection from {request.remote_addr}")
    
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                print(f"[WS] Client disconnected")
                break
            
            print(f"[WS] Recv: {msg[:100]}")  # First 100 chars
            
            response = process(msg)
            
            print(f"[WS] Send: {response[:100]}")
            ws.send(response)
    
    except Exception as e:
        print(f"[WS] Error: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        print(f"[WS] Closing connection")
        ws.close()
```

### Testing with wscat

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c ws://localhost:8080/ws/feature

# Send messages
> {"type":"request","data":"hello"}

# View responses
< {"type":"response","data":"world"}
```

### Testing with curl

```bash
# Connect (curl 7.86+)
curl --no-buffer \
     --header "Connection: Upgrade" \
     --header "Upgrade: websocket" \
     --header "Sec-WebSocket-Version: 13" \
     --header "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
     http://localhost:8080/ws/feature
```

### Monitor Active Connections

```python
# Track connections
active_connections = {}

@sock.route('/ws/feature')
def websocket_handler(ws):
    conn_id = str(uuid.uuid4())
    active_connections[conn_id] = {
        "ws": ws,
        "remote_addr": request.remote_addr,
        "connected_at": time.time()
    }
    
    try:
        # ... handler code ...
        pass
    
    finally:
        del active_connections[conn_id]
        ws.close()

# Debug endpoint
@app.route('/api/debug/websockets')
def debug_websockets():
    return jsonify({
        "count": len(active_connections),
        "connections": [
            {
                "id": conn_id,
                "remote_addr": conn["remote_addr"],
                "uptime": time.time() - conn["connected_at"]
            }
            for conn_id, conn in active_connections.items()
        ]
    })
```

---

## Real-World Examples

### Example 1: Code CM6 Agent Drawer

**Client connects to:**
```
ws://localhost:8080/ws/app/file_editor_cm6/agent
```

**Main app proxies to:**
```
ws://localhost:50001/ws/agent
```

**Worker handler:**
```python
# app/apps/file_editor_cm6/agent_ws.py

@sock.route('/ws/agent')
def agent_websocket(ws):
    """Bidirectional agent communication."""
    from .agent_session_store import append_message, get_session
    from app.framework_shells import get_framework_shell_manager
    
    manager = get_framework_shell_manager()
    shell = get_or_spawn_agent_shell(manager)
    
    def read_agent_output():
        """Stream agent output to client."""
        for line in shell.read_lines():
            event = normalize_agent_event(line)
            
            # Persist to disk
            if event['type'] == 'final':
                append_message(session_id, {
                    'type': 'assistant',
                    'text': event['text'],
                    'timestamp': time.time()
                })
            
            # Forward to client
            ws.send(json.dumps(event))
    
    threading.Thread(target=read_agent_output, daemon=True).start()
    
    try:
        while True:
            msg = ws.receive()
            if not msg:
                break
            
            data = json.loads(msg)
            session_id = data['session']
            
            # Persist user message
            append_message(session_id, {
                'type': 'user',
                'text': data['text'],
                'timestamp': time.time()
            })
            
            # Send to agent
            shell.write_line(json.dumps({
                'method': 'codex',
                'params': {'prompt': data['text']}
            }))
    
    finally:
        ws.close()
```

### Example 2: Terminal PTY Streaming

```python
# app/apps/file_editor_cm6/terminal_backend.py

@sock.route('/ws/terminal/<shell_id>')
def terminal_websocket(ws, shell_id):
    """Bidirectional terminal I/O."""
    from app.framework_shells import get_framework_shell_manager
    
    manager = get_framework_shell_manager()
    shell = manager.get_shell(shell_id)
    
    if not shell:
        ws.close()
        return
    
    def stream_output():
        """Read PTY output, send to client."""
        while shell.alive:
            try:
                data = shell.process.stdout.read(1024)
                if data:
                    ws.send(data.decode('utf-8'))
            except:
                break
    
    threading.Thread(target=stream_output, daemon=True).start()
    
    try:
        while True:
            # Receive input from client
            input_data = ws.receive()
            if not input_data:
                break
            
            # Send to PTY
            shell.process.stdin.write(input_data.encode('utf-8'))
            shell.process.stdin.flush()
    
    finally:
        ws.close()
```

### Example 3: File Watcher

```python
# app/apps/file_editor_cm6/main.py

@sock.route('/ws/read')
def file_watcher_websocket(ws):
    """Stream file change notifications."""
    import os
    import time
    
    file_path = request.args.get('file')
    if not file_path:
        ws.close()
        return
    
    last_mtime = os.path.getmtime(file_path)
    
    try:
        while True:
            # Check for changes
            try:
                current_mtime = os.path.getmtime(file_path)
                if current_mtime != last_mtime:
                    # File changed!
                    last_mtime = current_mtime
                    
                    # Send notification
                    ws.send(json.dumps({
                        'event': 'file_changed',
                        'file': file_path,
                        'mtime': current_mtime
                    }))
            except FileNotFoundError:
                ws.send(json.dumps({
                    'event': 'file_deleted',
                    'file': file_path
                }))
                break
            
            time.sleep(1)
    
    finally:
        ws.close()
```

---

## Summary

### Key Takeaways

1. **Two patterns:** Direct (main app) vs Proxied (worker app)
2. **Automatic proxying:** Main app handles `/ws/app/<app_id>/<route>` automatically
3. **Always cleanup:** Use try-finally blocks
4. **JSON messages:** Use structured format for reliability
5. **Error handling:** Catch and send errors to client
6. **Threading:** Use threads for bidirectional communication
7. **Resource management:** Clean up framework shells, file handles, etc.

### When to Use WebSockets

**✅ Good for:**
- Real-time bidirectional communication
- Streaming data (logs, terminal output, agent responses)
- Live notifications
- Interactive tools (REPLs, agents)

**❌ Not good for:**
- One-time requests (use REST API)
- File uploads (use multipart POST)
- Large binary data (use chunked HTTP)

---

**Last Updated:** November 2, 2025

**See Also:**
- `docs/core/framework_shells.md` - Framework shell integration
- `docs/apps/code_cm6/AGENT_DRAWER.md` - Real-world WebSocket example
- `docs/core/app_lifecycle.md` - Worker process management
