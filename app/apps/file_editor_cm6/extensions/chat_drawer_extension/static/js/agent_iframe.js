// app/apps/file_editor_cm6/extensions/chat_drawer_extension/static/js/agent_iframe.js
// Lightweight iframe-based agent drawer.

const DEFAULT_IFRAME_URL = '/codex-agent';
const DEFAULT_DRAWER_OPEN_ENDPOINT = '/api/host/drawer/open';
const DEFAULT_DRAWER_CLOSE_ENDPOINT = '/api/host/drawer/close';

export function initAgentIframe(options = {}) {
  const drawer = document.getElementById('agent-drawer');
  const toggle = document.getElementById('fe-agent-toggle');
  const closeBtn = document.getElementById('agent-close');
  const iframe = document.getElementById('agent-iframe');
  const title = document.querySelector('.agent-drawer__title');
  const header = drawer?.querySelector('.agent-drawer__header');

  if (!drawer || !toggle) {
    return { open: () => {}, close: () => {}, destroy: () => {}, setUrl: () => {} };
  }

  let url = options.url || DEFAULT_IFRAME_URL;
  let hostOrigin = '';
  let drawerOpenEndpoint = DEFAULT_DRAWER_OPEN_ENDPOINT;
  let drawerCloseEndpoint = DEFAULT_DRAWER_CLOSE_ENDPOINT;
  const allowAnyOrigin = options.allowAnyOrigin === true;
  const hideDrawerHeader = options.hideDrawerHeader !== false;
  const originalHeaderDisplay = header ? header.style.display : '';
  let isOpen = false;
  let destroyed = false;
  let iframeOrigin = null;

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function refreshOriginsAndEndpoints() {
    try {
      hostOrigin = new URL(url, window.location.href).origin;
    } catch {
      hostOrigin = '';
    }
    drawerOpenEndpoint = options.drawerOpenEndpoint || (hostOrigin ? `${hostOrigin}${DEFAULT_DRAWER_OPEN_ENDPOINT}` : DEFAULT_DRAWER_OPEN_ENDPOINT);
    drawerCloseEndpoint = options.drawerCloseEndpoint || (hostOrigin ? `${hostOrigin}${DEFAULT_DRAWER_CLOSE_ENDPOINT}` : DEFAULT_DRAWER_CLOSE_ENDPOINT);
    resolveIframeOrigin();
  }

  function resolveIframeOrigin() {
    try {
      iframeOrigin = new URL(url, window.location.href).origin;
    } catch {
      iframeOrigin = null;
    }
  }

  async function updateHostUi(showClose) {
    const endpoint = showClose ? drawerOpenEndpoint : drawerCloseEndpoint;
    if (!endpoint) return;
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          show_close: !!showClose,
          parent_origin: window.location.origin,
        }),
      });
    } catch (err) {
      // Non-fatal if iframe app isn't up yet or CORS blocks.
      console.warn('[Agent iframe] Failed to update host UI state:', err);
    }
  }

  async function updateHostHints() {
    if (!hideDrawerHeader) return false;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/agent/drawer/ui_hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide_header: true }),
      });
      const body = await resp.json();
      return !!(body && body.ok);
    } catch (err) {
      console.warn('[Agent iframe] Failed to update UI hints:', err);
      return false;
    }
  }

  function ensureIframeLoaded() {
    if (!iframe) return;
    if (!iframe.src || iframe.src !== url) {
      iframe.src = url;
    }
  }

  function applyHeaderMode() {
    if (!header) return;
    header.style.display = hideDrawerHeader ? 'none' : originalHeaderDisplay;
  }

  function openDrawer() {
    if (destroyed) return;
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
    ensureIframeLoaded();
    updateHostUi(true);
    if (hideDrawerHeader) {
      updateHostHints().then((ok) => {
        if (ok) applyHeaderMode();
      });
    }
  }

  function closeDrawer() {
    if (destroyed) return;
    if (!isOpen) return;
    drawer.classList.remove('open');
    isOpen = false;
    updateAria();
    updateHostUi(false);
  }

  drawer.classList.add('agent-drawer--iframe');
  applyHeaderMode();
  if (title) {
    title.textContent = options.title || 'Agent';
  }

  refreshOriginsAndEndpoints();

  const onMessage = (event) => {
    if (destroyed) return;
    if (!allowAnyOrigin && iframeOrigin && event.origin !== iframeOrigin) return;
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'codex_agent_close') {
      closeDrawer();
    }
  };

  const onToggleClick = () => {
    if (destroyed) return;
    if (isOpen) closeDrawer();
    else openDrawer();
  };

  window.addEventListener('message', onMessage);
  toggle.addEventListener('click', onToggleClick);

  if (closeBtn) {
    closeBtn.addEventListener('click', closeDrawer);
  }

  function setUrl(nextUrl) {
    const normalized = String(nextUrl || '').trim();
    if (!normalized || normalized === url) return;
    url = normalized;
    refreshOriginsAndEndpoints();
    if (iframe) {
      iframe.src = url;
    }
  }

  function destroy() {
    if (destroyed) return;
    if (isOpen) {
      updateHostUi(false);
    }
    destroyed = true;
    try {
      window.removeEventListener('message', onMessage);
    } catch (_) {}
    try {
      toggle.removeEventListener('click', onToggleClick);
    } catch (_) {}
    try {
      if (closeBtn) closeBtn.removeEventListener('click', closeDrawer);
    } catch (_) {}
    try {
      drawer.classList.remove('agent-drawer--iframe');
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    } catch (_) {}
    if (header) {
      header.style.display = originalHeaderDisplay;
    }
    isOpen = false;
  }

  return { open: openDrawer, close: closeDrawer, destroy, setUrl };
}
