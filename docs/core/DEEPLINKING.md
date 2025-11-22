# App Deep Linking & Intent System

**Status:** Implemented (URL-based) / Planned (Manifest-driven)

The Termux Extensions framework provides a centralized mechanism for applications to launch other applications with context (arguments). This enables workflows like "Open directory in File Explorer" or "Edit file in Code Editor".

## Current Implementation: URL Deep Linking

Currently, deep linking is handled by the **Apps Extension** via a standardized API endpoint. This endpoint ensures the target app is running (starting its worker process if necessary) before generating the destination URL.

### 1. The Launch API

**Endpoint:** `POST /api/apps/{app_id}/open`

**Request Body:**
```json
{
  "params": {
    "path": "/data/data/com.termux/files/home/project",
    "other_param": "value"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "url": "/app/file_explorer?path=%2Fdata%2F...%2Fproject&other_param=value",
    "app_info": { "port": 12345, "shell_id": "..." }
  }
}
```

### 2. Usage Example (Caller)

To open the File Explorer from another app:

```javascript
async function launchExplorer(path) {
  const response = await fetch('/api/apps/file_explorer/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      params: { path: path } 
    })
  });
  
  const result = await response.json();
  if (result.ok && result.data.url) {
    // Navigate the current window to the target app
    window.location.href = result.data.url;
  }
}
```

### 3. Usage Example (Receiver)

The target app (e.g., `file_explorer/main.js`) reads the parameters from the URL query string during initialization.

```javascript
// main.js
export default function initApp(root, api, host) {
  // Parse deep link parameters
  const urlParams = new URLSearchParams(window.location.search);
  const initialPath = urlParams.get('path');

  // Priority: Deep link > Saved State > Default
  const startPath = initialPath || savedState?.path || HOME_DIR;
  
  loadDirectory(startPath);
}
```

---

## Future Roadmap: Manifest-Driven Intents

We plan to evolve this system into a full **Intents** mechanism. Instead of hardcoding URL patterns, apps will define their capabilities in `manifest.json`. This allows for background API calls and decoupled navigation logic.

### Proposed Manifest Schema

```json
{
  "id": "file_explorer",
  "intents": {
    "open": {
      "type": "navigate",
      "url_pattern": "/app/file_explorer?path={path}"
    },
    "compress_files": {
      "type": "api",
      "method": "POST",
      "endpoint": "/api/compress"
    }
  }
}
```

### Proposed Dispatch Flow

1.  **Caller:** request `POST /api/apps/file_explorer/launch` with `{ "intent": "open", "params": {...} }`.
2.  **Framework:**
    *   Loads manifest for `file_explorer`.
    *   Ensures app worker is running.
    *   Resolves the `open` intent.
    *   If `type` is `navigate`, constructs the URL and returns it.
    *   If `type` is `api`, proxies the request directly to the worker and returns the data.
