
// app/static/js/ws_port.js
(function () {
  async function getWsPort(appId) {
    // Hit any normal HTTP endpoint for the app; the header comes back on all proxied responses.
    const r = await fetch(`/api/app/${encodeURIComponent(appId)}/status`, { cache: 'no-store' });
    const p = r.headers.get('X-App-Worker-Port');
    if (!p) throw new Error('WS port header missing');
    return Number(p);
  }

  async function buildWsUrl(appId, path, clientId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use proxied WebSocket route through main app instead of direct worker connection
    // This works for both local and remote clients
    return (
      `${proto}//${location.host}/ws/app/${encodeURIComponent(appId)}/read` +
      `?path=${encodeURIComponent(path)}` +
      `&client_id=${encodeURIComponent(clientId)}`
    );
  }

  // Non‑module attach (no import changes needed in apps)
  window.wsPort = { getWsPort, buildWsUrl };
})();
