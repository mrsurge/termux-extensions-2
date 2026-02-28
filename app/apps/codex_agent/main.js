const PROXY_BASE = '/api/app/codex_agent/proxy';
const TARGET_URL = `${PROXY_BASE}/codex-agent`;
const HEALTH_URL = `${PROXY_BASE}/api/health`;
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
  let ready = false;
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    try {
      const response = await fetch(HEALTH_URL, { method: 'GET', cache: 'no-store' });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (_) {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (!ready) {
    throw new Error('Codex Agent server did not become ready in time');
  }

  frame.src = TARGET_URL;
  if (loading) {
    loading.style.display = 'none';
  }
}
