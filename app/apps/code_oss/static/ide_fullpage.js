(() => {
  const root = document.getElementById('ide-root');
  if (!root) return;

  let seed = {};
  try {
    seed = JSON.parse(root.dataset.seed || '{}');
  } catch (_error) {
    seed = {};
  }

  const frame = document.getElementById('ide-frame');
  const statusCard = document.getElementById('ide-status');
  const subtitleEl = document.getElementById('ide-subtitle');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const explorerContent = document.getElementById('explorer-content');
  const btnMenu = document.getElementById('btn-menu');
  const btnSearch = document.getElementById('btn-search');
  const btnCommand = document.getElementById('btn-command');
  const btnSettings = document.getElementById('btn-settings');
  const btnChatRefresh = document.getElementById('btn-chat-refresh');
  const btnDrawerClose = document.querySelector('.drawer-close');
  const chatSubtitle = document.getElementById('chat-subtitle');

  let iframeOrigin = null;
  let frameReady = false;

  function setSubtitleFromSeed() {
    const parts = [];
    if (seed.project_id) parts.push(`Project ${seed.project_id}`);
    if (seed.file_path) parts.push(seed.file_path);
    if (parts.length === 0) {
      subtitleEl.textContent = 'Ready when the server starts…';
    } else {
      subtitleEl.textContent = parts.join(' · ');
    }
  }

  setSubtitleFromSeed();

  function toggleDrawer(open) {
    if (open === undefined) {
      root.classList.toggle('drawer-open');
    } else if (open) {
      root.classList.add('drawer-open');
    } else {
      root.classList.remove('drawer-open');
    }
  }

  btnMenu?.addEventListener('click', () => toggleDrawer(true));
  btnDrawerClose?.addEventListener('click', () => toggleDrawer(false));
  drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

  function explorerPlaceholder(message) {
    explorerContent.classList.add('explorer-empty');
    explorerContent.innerHTML = `<p>${message}</p>`;
  }

  explorerPlaceholder('Loading workspace…');

  function sendCommand(cmd, args = {}) {
    if (!frameReady || !iframeOrigin || !frame?.contentWindow) return;
    const payload = { _mobileShell: true, type: 'command', cmd, args };
    frame.contentWindow.postMessage(payload, iframeOrigin);
  }

  btnSearch?.addEventListener('click', () => sendCommand('openSearch'));
  btnCommand?.addEventListener('click', () => sendCommand('showCommands'));
  btnSettings?.addEventListener('click', () => sendCommand('openSettingsJSON'));
  btnChatRefresh?.addEventListener('click', () => sendCommand('refreshChat'));

  function markReady(url) {
    const urlObj = new URL(url);
    iframeOrigin = urlObj.origin;
    frame.src = url;
    subtitleEl.textContent = `Connected to ${urlObj.hostname}:${urlObj.port}`;
  }

  function showError(message) {
    statusCard.classList.remove('ide-status--working');
    statusCard.innerHTML = `
      <div class="status-copy">
        <h1>Unable to launch Code OSS</h1>
        <p>${message}</p>
      </div>
    `;
  }

  async function startServer() {
    try {
      const response = await fetch('/api/app/code_oss/start', { method: 'POST' });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const { url } = body.data || {};
      if (!url) throw new Error('No URL returned from code-server start');
      markReady(url);
    } catch (error) {
      showError(error.message || 'Unknown error');
    }
  }

  startServer();

  frame?.addEventListener('load', () => {
    frameReady = true;
    frame.hidden = false;
    statusCard.style.display = 'none';
    if (iframeOrigin) {
      frame.contentWindow?.postMessage({ _mobileShell: true, type: 'hello' }, iframeOrigin);
    }
    setTimeout(() => {
      sendCommand('requestExplorerTree');
      if (seed.file_path) {
        sendCommand('openPath', {
          path: seed.file_path,
          line: seed.line,
          column: seed.column,
        });
      }
      if (seed.view) {
        sendCommand('showView', { viewId: seed.view, inPanel: true });
      }
    }, 600);
  });

  window.addEventListener('message', (event) => {
    if (!iframeOrigin || event.origin !== iframeOrigin) return;
    const data = event.data || {};
    if (!data || !data._mobileBridge) return;

    if (data.type === 'state') {
      const dim = !!(data.sidebarVisible || data.panelVisible);
      document.body.classList.toggle('dim', dim);
    }

    if (data.type === 'explorerTree') {
      const entries = data.entries || [];
      if (!entries.length) {
        explorerPlaceholder('Workspace is empty.');
        return;
      }
      root.classList.add('drawer-open');
      explorerContent.classList.remove('explorer-empty');
      explorerContent.innerHTML = '';
      const list = document.createElement('ul');
      list.className = 'explorer-list';
      entries.forEach((node) => {
        const item = document.createElement('li');
        item.className = `explorer-item explorer-item--${node.type}`;
        item.textContent = node.label || node.path || 'file';
        item.addEventListener('click', () => {
          sendCommand('openPath', { path: node.path });
          toggleDrawer(false);
        });
        list.appendChild(item);
      });
      explorerContent.appendChild(list);
    }

    if (data.type === 'chatProviders') {
      if (Array.isArray(data.providers) && data.providers.length) {
        const active = data.providers.find((provider) => provider.active);
        chatSubtitle.textContent = active
          ? `Showing ${active.label || active.id}`
          : 'No active provider selected';
      }
    }

    if (data.type === 'chatAttachment') {
      const placeholder = document.getElementById('chat-placeholder');
      if (placeholder) {
        placeholder.innerHTML = '';
        placeholder.appendChild(data.element || document.createTextNode('Extension attached.'));
      }
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      toggleDrawer(false);
    }
  });
})();
