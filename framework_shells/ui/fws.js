(function () {
  const content = document.getElementById('fws-content');
  const statusEl = document.getElementById('fws-status');

  function setStatus(text, connected) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (connected) statusEl.classList.remove('disconnected');
    else statusEl.classList.add('disconnected');
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${scheme}://${window.location.host}/ws/fws`;

  let ws = null;
  let reconnectTimer = null;

  function connect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    setStatus('Connecting...', false);
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setStatus('Live', true);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.type === 'snapshot_html' && typeof msg.html === 'string') {
            if (content) content.innerHTML = msg.html;
          }
        } catch (err) {
          // ignore
        }
      };
      ws.onclose = () => {
        setStatus('Disconnected', false);
        reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try { ws.close(); } catch (err) { }
      };
    } catch (err) {
      reconnectTimer = setTimeout(connect, 2000);
    }
  }

  connect();
})();

