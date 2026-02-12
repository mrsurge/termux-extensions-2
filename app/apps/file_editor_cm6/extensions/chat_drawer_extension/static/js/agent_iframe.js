// app/apps/file_editor_cm6/extensions/chat_drawer_extension/static/js/agent_iframe.js
// Lightweight iframe-based agent drawer.

const DEFAULT_IFRAME_URL = '/codex-agent';
const DEFAULT_HOST_UI_ENDPOINT = '/api/host/ui';
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
    return { open: () => {}, close: () => {} };
  }

  const url = options.url || DEFAULT_IFRAME_URL;
  let hostOrigin = '';
  try {
    hostOrigin = new URL(url, window.location.href).origin;
  } catch {
    hostOrigin = '';
  }
  const hostUiEndpoint = options.hostUiEndpoint || (hostOrigin ? `${hostOrigin}${DEFAULT_HOST_UI_ENDPOINT}` : DEFAULT_HOST_UI_ENDPOINT);
  const drawerOpenEndpoint = options.drawerOpenEndpoint || (hostOrigin ? `${hostOrigin}${DEFAULT_DRAWER_OPEN_ENDPOINT}` : DEFAULT_DRAWER_OPEN_ENDPOINT);
  const drawerCloseEndpoint = options.drawerCloseEndpoint || (hostOrigin ? `${hostOrigin}${DEFAULT_DRAWER_CLOSE_ENDPOINT}` : DEFAULT_DRAWER_CLOSE_ENDPOINT);
  const allowAnyOrigin = options.allowAnyOrigin === true;
  const hideDrawerHeader = options.hideDrawerHeader !== false;
  let isOpen = false;
  let iframeOrigin = null;

  function updateAria() {
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
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
    if (!iframe.src) {
      iframe.src = url;
    }
  }

  function openDrawer() {
    if (isOpen) return;
    drawer.classList.add('open');
    isOpen = true;
    updateAria();
    ensureIframeLoaded();
    updateHostUi(true);
    if (hideDrawerHeader) {
      updateHostHints().then((ok) => {
        if (ok && header) {
          header.remove();
        }
      });
    }
  }

  function closeDrawer() {
    if (!isOpen) return;
    drawer.classList.remove('open');
    isOpen = false;
    updateAria();
    updateHostUi(false);
  }

  drawer.classList.add('agent-drawer--iframe');
  if (title) {
    title.textContent = options.title || 'Agent';
  }

  resolveIframeOrigin();

  window.addEventListener('message', (event) => {
    if (!allowAnyOrigin && iframeOrigin && event.origin !== iframeOrigin) return;
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'codex_agent_close') {
      closeDrawer();
    }
  });

  toggle.addEventListener('click', () => {
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeDrawer);
  }

  return { open: openDrawer, close: closeDrawer };
}
