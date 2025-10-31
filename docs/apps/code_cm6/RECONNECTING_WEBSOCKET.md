# ReconnectingWebSocket Usage Guide

## Overview

`ReconnectingWebSocket` is a drop-in replacement for the native WebSocket API that adds automatic reconnection with exponential backoff.

## Quick Start

### Basic Usage

```javascript
import ReconnectingWebSocket from './static/js/reconnecting_websocket.js';

const ws = new ReconnectingWebSocket('ws://localhost:8080/ws/endpoint');

ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => console.log('Message:', event.data);
ws.onerror = (error) => console.error('Error:', error);
ws.onclose = (event) => console.log('Closed:', event);

ws.send('Hello server');
```

### With Options

```javascript
const ws = new ReconnectingWebSocket('ws://localhost:8080/ws/endpoint', {
  maxRetries: 10,              // Maximum reconnection attempts (default: Infinity)
  reconnectInterval: 1000,      // Initial delay in ms (default: 1000)
  maxReconnectInterval: 30000,  // Max delay cap in ms (default: 30000)
  reconnectDecay: 1.5,          // Exponential backoff multiplier (default: 1.5)
  debug: true,                  // Enable debug logging (default: false)
  protocols: []                 // WebSocket sub-protocols (default: [])
});
```

## Features

### Automatic Reconnection

When the connection drops, ReconnectingWebSocket will automatically attempt to reconnect with exponential backoff:

- Attempt 1: 1 second delay
- Attempt 2: 1.5 seconds delay  
- Attempt 3: 2.25 seconds delay
- Attempt 4: 3.38 seconds delay
- ...continues up to `maxReconnectInterval`

### Message Queueing

Messages sent while disconnected are automatically queued and sent when reconnection succeeds:

```javascript
ws.send('Message 1'); // Queued if disconnected
ws.send('Message 2'); // Queued if disconnected
// When reconnected, both messages are sent in order
```

### Event Handlers

All native WebSocket events plus an additional `onreconnect` event:

```javascript
ws.onopen = (event) => {
  // Connection opened (first time or after reconnection)
};

ws.onmessage = (event) => {
  // Message received
  const data = JSON.parse(event.data);
};

ws.onerror = (error) => {
  // Error occurred
};

ws.onclose = (event) => {
  // Connection closed
  // Will auto-reconnect unless manually closed
};

ws.onreconnect = (attempt, delay) => {
  // About to attempt reconnection
  console.log(`Reconnecting (attempt ${attempt}) in ${delay}ms...`);
};
```

### Manual Control

```javascript
// Manual reconnect
ws.reconnect();

// Stop reconnecting (permanent close)
ws.close();

// Check connection state
console.log(ws.readyState); // WebSocket.CONNECTING, OPEN, CLOSING, or CLOSED
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | number | Infinity | Maximum reconnection attempts before giving up |
| `reconnectInterval` | number | 1000 | Initial reconnection delay in milliseconds |
| `maxReconnectInterval` | number | 30000 | Maximum delay cap in milliseconds |
| `reconnectDecay` | number | 1.5 | Exponential backoff multiplier |
| `debug` | boolean | false | Enable console debug logging |
| `protocols` | string\|array | [] | WebSocket sub-protocols |

## Examples

### Edit Tracker (Already Implemented)

```javascript
editTrackerWS = new ReconnectingWebSocket(wsUrl, {
  maxRetries: 10,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  reconnectDecay: 1.5,
  debug: true
});

editTrackerWS.onopen = () => {
  console.log('[EditTracker] Connected');
};

editTrackerWS.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleEditTrackerEvent(data);
};

editTrackerWS.onreconnect = (attempt, delay) => {
  console.log(`[EditTracker] Reconnecting (attempt ${attempt}) in ${delay}ms...`);
};
```

### File Read WebSocket (Already Implemented)

```javascript
ws = new ReconnectingWebSocket(wsUrl, {
  maxRetries: 20,
  reconnectInterval: 1000,
  maxReconnectInterval: 10000,
  reconnectDecay: 1.3,
  debug: false
});

ws.onopen = () => {
  console.log('WebSocket connected for:', path);
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  handleWSMessage(msg);
};
```

### Terminal WebSocket

```javascript
const ws = new ReconnectingWebSocket(terminalWsUrl, {
  maxRetries: 15,
  reconnectInterval: 500,
  maxReconnectInterval: 5000,
  debug: true
});

ws.onopen = () => {
  terminal.clear();
  terminal.writeln('Terminal connected');
};

ws.onmessage = (event) => {
  terminal.write(event.data);
};

ws.onreconnect = (attempt) => {
  terminal.writeln(`\r\nReconnecting (attempt ${attempt})...`);
};
```

### Agent Drawer

```javascript
sharedShell.ws = new ReconnectingWebSocket(wsUrl, {
  maxRetries: 10,
  reconnectInterval: 2000,
  maxReconnectInterval: 30000,
  debug: true
});

sharedShell.ws.onopen = () => {
  console.log('[Agent] Shared shell connected');
};

sharedShell.ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleAgentMessage(data);
};

sharedShell.ws.onreconnect = (attempt, delay) => {
  console.log(`[Agent] Reconnecting in ${delay}ms...`);
  showReconnectingToast(attempt);
};
```

## Exponential Backoff Formula

```
delay = min(
  reconnectInterval * (reconnectDecay ^ (attempt - 1)),
  maxReconnectInterval
)
```

### Example with defaults:
- Attempt 1: 1000ms
- Attempt 2: 1500ms (1000 * 1.5^1)
- Attempt 3: 2250ms (1000 * 1.5^2)
- Attempt 4: 3375ms (1000 * 1.5^3)
- Attempt 5: 5063ms (1000 * 1.5^4)
- Attempt 6: 7594ms (1000 * 1.5^5)
- Attempt 7: 11391ms (1000 * 1.5^6)
- Attempt 8: 17086ms (1000 * 1.5^7)
- Attempt 9: 25629ms (1000 * 1.5^8)
- Attempt 10+: 30000ms (capped at maxReconnectInterval)

## Migration Guide

### Before (Native WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');
ws.onopen = () => console.log('Connected');
ws.send('Hello');
```

### After (ReconnectingWebSocket)

```javascript
import ReconnectingWebSocket from './static/js/reconnecting_websocket.js';

const ws = new ReconnectingWebSocket('ws://localhost:8080/ws');
ws.onopen = () => console.log('Connected');
ws.send('Hello'); // Automatically queued if disconnected!
```

**That's it!** The API is identical, just import and replace `WebSocket` with `ReconnectingWebSocket`.

## Best Practices

1. **Set appropriate maxRetries**: Don't retry forever for transient connections
2. **Use debug mode during development**: Helps diagnose connection issues
3. **Implement onreconnect**: Show users when reconnection is happening
4. **Adjust backoff parameters**: Faster reconnection for critical features, slower for background tasks
5. **Handle onclose gracefully**: Check if connection was manually closed vs. dropped

## Compatibility

- ✅ Drop-in replacement for native WebSocket
- ✅ Same event model (onopen, onmessage, onerror, onclose)
- ✅ Same methods (send, close)
- ✅ Same properties (readyState, bufferedAmount, etc.)
- ✅ Bonus: Automatic reconnection + message queueing

## License

MIT - Use freely in your projects!
