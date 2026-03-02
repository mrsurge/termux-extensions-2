const APP_ID = 'codex_agent';
const PROXY_META_URL = `/api/apps/${APP_ID}/proxy_shell`;
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

  const metaResponse = await fetch(PROXY_META_URL, { method: 'GET', cache: 'no-store' });
  if (!metaResponse.ok) {
    throw new Error(`Failed to load proxy shell config (${metaResponse.status})`);
  }
  const metaPayload = await metaResponse.json();
  const data = metaPayload && metaPayload.data;
  if (!data || typeof data.start_url !== 'string' || typeof data.health_url !== 'string') {
    throw new Error('Invalid proxy shell config response');
  }
  const targetUrl = data.start_url;
  const healthUrl = data.health_url;

  const startedAt = Date.now();
  let ready = false;
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    try {
      const response = await fetch(healthUrl, { method: 'GET', cache: 'no-store' });
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

  frame.src = targetUrl;
  if (loading) {
    loading.style.display = 'none';
  }
}
