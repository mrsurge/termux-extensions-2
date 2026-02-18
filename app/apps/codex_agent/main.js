const TARGET_URL = 'http://localhost:12359/codex-agent';
const HEALTH_URL = 'http://127.0.0.1:12359/';
const MAX_WAIT_MS = 30000;
const POLL_INTERVAL_MS = 1200;

export default async function initCodexAgent(rootEl, _api, host) {
  const frame = rootEl.querySelector('#ca-frame');
  const loading = rootEl.querySelector('#ca-loading');

  if (host && typeof host.setTitle === 'function') {
    host.setTitle('Codex Agent');
  }

  if (!frame) {
    throw new Error('Missing iframe element');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    try {
      await fetch(HEALTH_URL, { method: 'GET', mode: 'no-cors' });
      break;
    } catch (_) {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  frame.src = TARGET_URL;
  if (loading) {
    loading.style.display = 'none';
  }
}
