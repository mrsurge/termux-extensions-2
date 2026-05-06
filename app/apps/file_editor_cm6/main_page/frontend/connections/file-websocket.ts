// @ts-check

interface ManagedFileWebSocket {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onreconnect: ((attempt: number, delayMs: number) => void) | null;
  close: () => void;
  send: (data: string) => void;
}

interface ManagedFileWebSocketCtor {
  new (url: string, options: Record<string, unknown>): ManagedFileWebSocket;
}

interface FileWebSocketManagerDeps {
  ReconnectingWebSocket: ManagedFileWebSocketCtor;
  clientId: string;
  setStatus: (msg: string) => void;
  clearStatus: (msg: string, delayMs: number) => void;
  onMessage: (msg: unknown) => void;
}

interface WindowWithWsPort extends Window {
  wsPort?: {
    buildWsUrl: (appId: string, path: string, clientId: string) => Promise<string>;
  };
}

export function createFileWebSocketManager(deps: FileWebSocketManagerDeps) {
  let ws: ManagedFileWebSocket | null = null;
  let wsKeepaliveTimer: number | null = null;

  function closeWebSocket(): void {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    if (wsKeepaliveTimer) {
      clearInterval(wsKeepaliveTimer);
      wsKeepaliveTimer = null;
    }
  }

  async function openWebSocket(path: string | null | undefined): Promise<void> {
    closeWebSocket();
    if (!path) return;

    let wsUrl: string;
    try {
      const runtimeWindow = window as WindowWithWsPort;
      if (!runtimeWindow.wsPort || typeof runtimeWindow.wsPort.buildWsUrl !== 'function') {
        throw new Error('wsPort helper unavailable');
      }
      wsUrl = await runtimeWindow.wsPort.buildWsUrl('file_editor_cm6', path, deps.clientId);
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

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        deps.onMessage(msg);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onerror = (err: Event) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      if (wsKeepaliveTimer) {
        clearInterval(wsKeepaliveTimer);
        wsKeepaliveTimer = null;
      }
    };

    ws.onreconnect = (attempt: number, delay: number) => {
      console.log(`[FileRead] Reconnecting (attempt ${attempt}) in ${delay}ms...`);
    };
  }

  return { closeWebSocket, openWebSocket };
}
