// @ts-check

/**
 * @param {{
 *   ReconnectingWebSocket: any,
 *   clientId: string,
 *   setStatus: (msg: string) => void,
 *   clearStatus: (msg: string, delayMs: number) => void,
 *   onMessage: (msg: any) => void
 * }} deps
 */
export function createFileWebSocketManager(deps) {
  let ws = null;
  let wsKeepaliveTimer = null;

  function closeWebSocket() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    if (wsKeepaliveTimer) {
      clearInterval(wsKeepaliveTimer);
      wsKeepaliveTimer = null;
    }
  }

  async function openWebSocket(path) {
    closeWebSocket();
    if (!path) return;

    let wsUrl;
    try {
      if (!window.wsPort || typeof window.wsPort.buildWsUrl !== 'function') {
        throw new Error('wsPort helper unavailable');
      }
      wsUrl = await window.wsPort.buildWsUrl('file_editor_cm6', path, deps.clientId);
    } catch (err) {
      console.error('Failed to resolve WebSocket URL:', err);
      deps.setStatus('WebSocket unavailable');
      deps.clearStatus('WebSocket unavailable', 2000);
      return;
    }

    try {
      ws = new deps.ReconnectingWebSocket(wsUrl, {
        maxRetries: 20,
        reconnectInterval: 1000,
        maxReconnectInterval: 10000,
        reconnectDecay: 1.3,
        debug: false,
      });
    } catch (err) {
      console.error('Failed to open WebSocket:', err);
      deps.setStatus('WebSocket unavailable');
      deps.clearStatus('WebSocket unavailable', 2000);
      return;
    }

    ws.onopen = () => {
      console.log('WebSocket connected for:', path);
      if (!wsKeepaliveTimer) {
        wsKeepaliveTimer = setInterval(() => {
          try {
            if (ws && ws.readyState === 1) ws.send('ping');
          } catch (_) {}
        }, 15000);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        deps.onMessage(msg);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      if (wsKeepaliveTimer) {
        clearInterval(wsKeepaliveTimer);
        wsKeepaliveTimer = null;
      }
    };

    ws.onreconnect = (attempt, delay) => {
      console.log(`[FileRead] Reconnecting (attempt ${attempt}) in ${delay}ms...`);
    };
  }

  return { closeWebSocket, openWebSocket };
}
