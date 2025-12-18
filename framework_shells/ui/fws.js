(function () {
  const content = document.getElementById('fws-content');
  const statusEl = document.getElementById('fws-status');

  async function postForm(form) {
    const method = (form.getAttribute('method') || 'post').toUpperCase();
    const action = form.getAttribute('action') || window.location.href;
    const body = new FormData(form);

    try {
      await fetch(action, {
        method,
        body,
        credentials: 'same-origin',
        headers: { 'X-FWS-AJAX': '1' },
      });
    } catch (err) {
      // ignore; websocket snapshot loop will reconcile when possible
    }
  }

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || !form.matches || !form.matches('form[data-fws-ajax="1"]')) return;

    e.preventDefault();

    const confirmText = form.getAttribute('data-confirm');
    if (confirmText && !window.confirm(confirmText)) return;

    postForm(form);
  });

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
