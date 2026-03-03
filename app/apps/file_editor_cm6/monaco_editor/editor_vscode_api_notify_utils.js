export function vscodeApiNotify(ws, method, params) {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: String(method || ''), params: params || {} }));
    return true;
  } catch (_) {
    return false;
  }
}
