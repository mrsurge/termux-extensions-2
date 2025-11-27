# NiceGUI Iframe-to-Host Messaging System

**Date:** 2025-11-26
**Status:** Implemented

## Overview

To provide a seamless native experience, the NiceGUI editor (running inside an iframe) needs to communicate with the host application shell (the parent frame). This messaging system allows the Python backend to trigger actions in the host UI, such as displaying system toasts or updating global indicators, bypassing the iframe boundary.

## Architecture

The system consists of three layers:

### 1. Frontend Layer (`codemirror.js`)

A generic method `notifyParent` is added to the CodeMirror Vue component. It wraps the standard `window.parent.postMessage` API.

```javascript
notifyParent(type, data) {
  try {
    const target = window.parent || window;
    target.postMessage({
      type: type, // e.g., 'notification', 'draft_state'
      data: data  // Payload dictionary
    }, '*');
  } catch (err) {
    console.warn('[CodeMirror] Failed to notify parent', err);
  }
}
```

### 2. Bridge Layer (`codemirror.py`)

The Python `CodeMirror` element exposes a `notify_parent` method that invokes the JavaScript function via NiceGUI's `run_method`.

```python
def notify_parent(self, type: str, data: dict) -> None:
    """Send a message to the parent frame via postMessage.
    
    Args:
        type: The message type (e.g., 'notification')
        data: The payload dictionary (e.g., {'message': 'Saved'})
    """
    self.run_method('notifyParent', type, data)
```

### 3. Host Layer (`main.js`)

The parent frame listens for `message` events and dispatches them based on the `type` field.

```javascript
window.addEventListener('message', (event) => {
  // Security check: ensure source is the editor iframe
  if (editorFrame && editorFrame.contentWindow && event.source !== editorFrame.contentWindow) return;

  if (event.data.type === 'notification') {
    // Handle system toast
    const { message, type, timeout } = event.data.data;
    host.toast(message, timeout || 3000);
  }
  // Other types (e.g., 'draft_state') can be handled here
});
```

## Usage Example

**Sending a Toast from Python:**

```python
editor = get_active_editor()
editor.notify_parent('notification', {
    'message': 'Restored unsaved draft',
    'type': 'info',
    'timeout': 3000
})
```

This architecture keeps the frontend stateless and ensures the Python backend remains the source of truth for application events.
