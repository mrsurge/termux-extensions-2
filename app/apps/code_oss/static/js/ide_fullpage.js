(() => {
  const root = document.getElementById('ide-root');
  if (!root) return;

  let seed = {};
  try {
    seed = JSON.parse(root.dataset.seed || '{}');
  } catch (_error) {
    seed = {};
  }

  const frameShell = document.getElementById('ide-frame-shell');
  const frame = document.getElementById('ide-frame');
  const statusCard = document.getElementById('ide-status');
  const statusHeadline = statusCard?.querySelector('h1');
  const statusDetail = statusCard?.querySelector('p');
  const subtitleEl = document.getElementById('ide-subtitle');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const explorerContent = document.getElementById('explorer-content');
  const btnMenu = document.getElementById('btn-menu');
  const btnBack = document.getElementById('btn-back');
  const btnSearch = document.getElementById('btn-search');
  const btnCommand = document.getElementById('btn-command');
  const btnSettings = document.getElementById('btn-settings');
  const btnChatRefresh = document.getElementById('btn-chat-refresh');
  const btnDrawerClose = document.querySelector('.drawer-close');
  const btnOpenProject = document.getElementById('btn-open-project');
  const btnDocOpenFull = document.getElementById('btn-doc-open-full');
  const tabDocument = document.getElementById('tab-document');
  const tabFull = document.getElementById('tab-full');
  const documentView = document.getElementById('document-view');
  const fullView = document.getElementById('full-ide-view');
  const bridgeStatusLabel = document.getElementById('bridge-status');
  const documentFrameTarget = document.getElementById('document-frame-target');
  const fullFrameTarget = document.getElementById('full-frame-target');
  const docCurrentProject = document.getElementById('doc-current-project');
  const docCurrentPath = document.getElementById('doc-current-path');
  const chatSubtitle = document.getElementById('chat-subtitle');

  const viewTabs = {
    document: tabDocument,
    full: tabFull,
  };

  const viewPanes = {
    document: documentView,
    full: fullView,
  };

  let iframeOrigin = null;
  let frameReady = false;
  let activeView = 'full';
  let autoSwitchPending = true;

  let currentProject = seed.project_id || null;
  let currentFile = seed.file_path || null;
  let connectionLabel = null;
  const bridgeState = {
    installed: false,
    version: null,
  };

  const explorerState = {
    rootPaths: [],
    nodes: new Map(),
    expanded: new Set(),
    activePath: null,
  };

  function resolveHost(host) {
    if (!host || host === '0.0.0.0' || host === '127.0.0.1') {
      return window.location.hostname || '127.0.0.1';
    }
    return host;
  }

  function updateSubtitle() {
    const parts = [];
    if (currentProject) parts.push(currentProject);
    if (currentFile) parts.push(currentFile);

    if (parts.length) {
      subtitleEl.textContent = parts.join(' · ');
    } else if (connectionLabel) {
      subtitleEl.textContent = connectionLabel;
    } else {
      subtitleEl.textContent = 'Ready when the server starts…';
    }
  }

  function updateDocPlaceholder() {
    if (docCurrentProject) {
      docCurrentProject.textContent = currentProject || 'Not selected';
    }
    if (docCurrentPath) {
      docCurrentPath.textContent = currentFile || 'None selected';
    }
  }

  updateSubtitle();
  updateDocPlaceholder();

  function hideFrame() {
    if (frame) frame.classList.add('is-hidden');
    frameReady = false;
  }

  function showFrame() {
    if (frame) frame.classList.remove('is-hidden');
  }

  function updateStatus(headline, detail, { working = true } = {}) {
    if (!statusCard) return;
    statusCard.style.display = '';
    if (headline && statusHeadline) statusHeadline.textContent = headline;
    if (detail && statusDetail) statusDetail.textContent = detail;
    statusCard.classList.toggle('ide-status--working', working);
  }

  function setActiveView(view) {
    if (!viewPanes[view]) return;
    if (activeView === view) return;

    activeView = view;
    root.classList.toggle('mode-document', view === 'document');
    root.classList.toggle('mode-full', view === 'full');

    // Move the iframe shell to the appropriate container
    if (frameShell) {
      if (view === 'document') {
        // Only show iframe in document view if a file is actually open
        if (currentFile) {
          frameShell.style.display = 'block';
          documentFrameTarget.appendChild(frameShell);
          // Tell VS Code to hide UI for focused editing
          sendCommand('setDocumentMode');
        } else {
          // Hide iframe if no document is open
          frameShell.style.display = 'none';
        }
      } else if (view === 'full' && fullFrameTarget) {
        frameShell.style.display = 'block';
        fullFrameTarget.appendChild(frameShell);
        // Tell VS Code to show full UI
        sendCommand('setFullMode');
      }
    }

    Object.entries(viewPanes).forEach(([key, pane]) => {
      const isActive = key === view;
      pane?.classList.toggle('is-active', isActive);
      pane?.setAttribute('aria-hidden', (!isActive).toString());
    });

    Object.entries(viewTabs).forEach(([key, tab]) => {
      const isActive = key === view;
      tab?.classList.toggle('is-active', isActive);
      tab?.setAttribute('aria-selected', isActive.toString());
    });
  }

  // Default to document mode; switching functions will move the frame shell as needed.
  setActiveView('document');

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

  tabDocument?.addEventListener('click', () => {
    setActiveView('document');
    autoSwitchPending = false;
  });
  tabFull?.addEventListener('click', () => {
    setActiveView('full');
    autoSwitchPending = false;
  });
  btnDocOpenFull?.addEventListener('click', () => {
    setActiveView('full');
    autoSwitchPending = false;
  });

  btnBack?.addEventListener('click', () => {
    if (document.referrer && document.referrer.includes('/app/')) {
      window.location.href = document.referrer;
    } else {
      window.location.href = '/app/code_oss';
    }
  });

  function explorerPlaceholder(message) {
    if (!explorerContent) return;
    explorerContent.classList.add('explorer-empty');
    explorerContent.innerHTML = `<p>${message}</p>`;
  }

  explorerPlaceholder('Loading workspace…');

  function applyBridgeState(data = {}) {
    if (typeof data.bridge_installed === 'boolean') {
      bridgeState.installed = data.bridge_installed;
    }
    if (data.bridge_version) {
      bridgeState.version = data.bridge_version;
    }
    if (bridgeStatusLabel) {
      if (bridgeState.installed) {
        bridgeStatusLabel.dataset.state = 'installed';
        bridgeStatusLabel.textContent = bridgeState.version
          ? `Bridge: installed (v${bridgeState.version})`
          : 'Bridge: installed';
      } else if (data.error) {
        bridgeStatusLabel.dataset.state = 'error';
        bridgeStatusLabel.textContent = `Bridge error: ${data.error}`;
      } else {
        bridgeStatusLabel.dataset.state = 'missing';
        bridgeStatusLabel.textContent = 'Bridge: not installed';
      }
    }
  }

  function sendCommand(cmd, args = {}) {
    if (!frameReady || !frame?.contentWindow) return;
    if (cmd === 'openPath' && args?.path) {
      currentFile = args.path;
      updateDocPlaceholder();
      updateSubtitle();
    }
    const payload = { _mobileShell: true, type: 'command', cmd, args };
    frame.contentWindow.postMessage(payload, '*');
  }

  // File will be opened directly in Code OSS frame for live updates
  function openFileInEditor(path) {
    currentFile = path;
    updateDocPlaceholder();
    updateSubtitle();
    sendCommand('openPath', { path });
    
    // If in document view, show the iframe now that we have a file
    if (activeView === 'document' && frameShell) {
      frameShell.style.display = 'block';
      if (documentFrameTarget && !documentFrameTarget.contains(frameShell)) {
        documentFrameTarget.appendChild(frameShell);
      }
    }
  }

  btnSearch?.addEventListener('click', () => sendCommand('openSearch'));
  btnCommand?.addEventListener('click', () => sendCommand('showCommands'));
  btnSettings?.addEventListener('click', () => sendCommand('openSettingsJSON'));
  btnChatRefresh?.addEventListener('click', () => sendCommand('refreshChat'));

  function normalizeEntry(raw) {
    if (!raw) return null;
    const type = raw.entryType || raw.type || 'file';
    const label = raw.label || raw.name || raw.path?.split('/').pop() || 'item';
    return {
      path: raw.path,
      label,
      entryType: type,
      hasChildren: !!raw.hasChildren || type === 'directory',
      children: raw.children || [],
    };
  }

  function applyExplorerEntries(entries, parentPath = null) {
    if (!Array.isArray(entries)) return;
    const normalized = entries
      .map(normalizeEntry)
      .filter((entry) => entry && entry.path);

    let previousExpanded;
    if (!parentPath) {
      previousExpanded = new Set(explorerState.expanded);
      explorerState.rootPaths = normalized.map((entry) => entry.path);
      explorerState.nodes.clear();
      explorerState.expanded.clear();
    }

    normalized.forEach((entry) => {
      const node = explorerState.nodes.get(entry.path) || { children: [] };
      node.path = entry.path;
      node.label = entry.label;
      node.entryType = entry.entryType;
      node.hasChildren = entry.hasChildren;
      node.children = Array.isArray(entry.children) ? entry.children.map((child) => child.path).filter(Boolean) : [];
      node.childrenLoaded = Array.isArray(entry.children) && entry.children.length > 0;
      explorerState.nodes.set(entry.path, node);
      if (!parentPath && entry.entryType === 'directory') {
        if (previousExpanded && previousExpanded.has(entry.path)) {
          explorerState.expanded.add(entry.path);
        } else if (!previousExpanded || previousExpanded.size === 0) {
          explorerState.expanded.add(entry.path);
        }
      }
      if (entry.children && entry.children.length) {
        applyExplorerEntries(entry.children, entry.path);
      }
    });

    if (parentPath) {
      const parentNode = explorerState.nodes.get(parentPath) || { children: [] };
      parentNode.children = normalized.map((entry) => entry.path);
      parentNode.childrenLoaded = true;
      parentNode.hasChildren = normalized.length > 0;
      explorerState.nodes.set(parentPath, parentNode);
    }
  }

  function renderExplorerTree() {
    if (!explorerContent) return;
    if (!explorerState.rootPaths.length) {
      explorerPlaceholder('Workspace is empty.');
      return;
    }
    explorerContent.classList.remove('explorer-empty');
    explorerContent.innerHTML = '';
    const rootList = document.createElement('ul');
    rootList.className = 'explorer-tree';
    explorerState.rootPaths.forEach((path) => {
      const node = explorerState.nodes.get(path);
      if (node) {
        rootList.appendChild(renderExplorerNode(node, 0));
      }
    });
    explorerContent.appendChild(rootList);
  }

  function renderExplorerNode(node, depth) {
    const item = document.createElement('li');
    item.className = 'explorer-node';
    item.dataset.path = node.path;
    if (node.entryType === 'directory') item.classList.add('is-directory');
    if (node.entryType === 'file') item.classList.add('is-file');
    if (explorerState.activePath === node.path) item.classList.add('is-active');

    const row = document.createElement('div');
    row.className = 'explorer-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    if (node.entryType === 'directory') {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'explorer-toggle';
      toggle.setAttribute('aria-label', 'Toggle folder');
      toggle.textContent = explorerState.expanded.has(node.path) ? '▼' : '▶';
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleDirectory(node);
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'explorer-toggle-spacer';
      row.appendChild(spacer);
    }

    const name = document.createElement('span');
    name.className = 'explorer-name';
    name.textContent = node.label || node.path.split('/').pop() || node.path;
    row.appendChild(name);

    row.addEventListener('click', () => {
      if (node.entryType === 'directory') {
        toggleDirectory(node);
      } else {
        explorerState.activePath = node.path;
        renderExplorerTree();
        
        // Always open in the Code OSS frame for live updates
        openFileInEditor(node.path);
      }
    });

    item.appendChild(row);

    if (node.entryType === 'directory' && explorerState.expanded.has(node.path)) {
      const childList = document.createElement('ul');
      childList.className = 'explorer-children';
      if (node.children && node.children.length) {
        node.children.forEach((childPath) => {
          const childNode = explorerState.nodes.get(childPath);
          if (childNode) {
            childList.appendChild(renderExplorerNode(childNode, depth + 1));
          }
        });
      } else if (!node.childrenLoaded) {
        const loadingItem = document.createElement('li');
        loadingItem.className = 'explorer-node is-loading';
        loadingItem.innerHTML = '<div class="explorer-row">Loading…</div>';
        childList.appendChild(loadingItem);
      }
      item.appendChild(childList);
    }

    return item;
  }

  function toggleDirectory(node) {
    if (explorerState.expanded.has(node.path)) {
      explorerState.expanded.delete(node.path);
      renderExplorerTree();
      return;
    }
    explorerState.expanded.add(node.path);
    if (!node.childrenLoaded) {
      sendCommand('requestExplorerChildren', { path: node.path, depth: 1 });
    }
    renderExplorerTree();
  }

  function ensurePathVisible(path) {
    if (!path) return;
    const normalized = path.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    let current = normalized.startsWith('/') ? '' : '';
    segments.forEach((segment, index) => {
      current = current ? `${current}/${segment}` : (normalized.startsWith('/') ? `/${segment}` : segment);
      const node = explorerState.nodes.get(current);
      if (node && node.entryType === 'directory') {
        explorerState.expanded.add(node.path);
        if (!node.childrenLoaded) {
          sendCommand('requestExplorerChildren', { path: node.path, depth: 1 });
        }
      }
      if (index === segments.length - 1) {
        explorerState.activePath = path;
      }
    });
    renderExplorerTree();
  }

  function markReady(url) {
    const urlObj = new URL(url);
    iframeOrigin = urlObj.origin;
    connectionLabel = `Connected to ${urlObj.hostname}:${urlObj.port || ''}`.trim();
    updateSubtitle();
    if (frame) {
      frame.src = url;
    }
  }

  function showError(message) {
    updateStatus('Unable to launch Code OSS', message || 'Unknown error', { working: false });
    setActiveView('full');
  }

  async function startServer({ headline, detail } = {}) {
    hideFrame();
    const shouldAutoSwitch = activeView !== 'document';
    if (!shouldAutoSwitch) {
      // Ensure the frame shell lives inside the document target while reloading.
      setActiveView('document');
    } else {
      setActiveView('full');
    }
    autoSwitchPending = shouldAutoSwitch;
    updateStatus(
      headline || 'Starting Code OSS…',
      detail || 'Booting the bundled code-server binary. This can take a moment.'
    );

    try {
      const response = await fetch('/api/app/code_oss/start', { method: 'POST' });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }

      const data = body.data || {};
      if (data.project_path) {
        currentProject = data.project_path;
        updateDocPlaceholder();
        updateSubtitle();
      }
      applyBridgeState(data);

      const { host, port } = data;
      if (!port) throw new Error('No port returned from code-server start');
      const resolvedHost = resolveHost(host);
      const url = `http://${resolvedHost}:${port}`;
      markReady(url);
    } catch (error) {
      showError(error.message || 'Unknown error');
    }
  }

  // Add manual bridge test button (temporary for debugging)
  const testBridgeBtn = document.createElement('button');
  testBridgeBtn.textContent = 'Test Bridge';
  testBridgeBtn.className = 'drawer-action';
  testBridgeBtn.style.marginLeft = '8px';
  btnOpenProject?.parentElement?.appendChild(testBridgeBtn);
  
  testBridgeBtn.addEventListener('click', () => {
    console.log('[ide_fullpage] Sending manual hello to bridge');
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ _mobileShell: true, type: 'hello' }, '*');
      setTimeout(() => {
        frame.contentWindow.postMessage({ 
          _mobileShell: true, 
          type: 'command', 
          cmd: 'requestExplorerTree',
          args: { depth: 2 }
        }, '*');
      }, 500);
    }
  });
  
  btnOpenProject?.addEventListener('click', async () => {
    if (!(window.teFilePicker && typeof window.teFilePicker.openDirectory === 'function')) {
      window.alert('Directory picker is unavailable in this environment.');
      return;
    }
    try {
      const choice = await window.teFilePicker.openDirectory({
        title: 'Open Project Folder',
        selectLabel: 'Open',
        startPath: currentProject || '~',
      });
      if (!choice || !choice.path) return;

      btnOpenProject.disabled = true;
      hideFrame();
      setActiveView('full');
      autoSwitchPending = true;
      updateStatus('Switching workspace…', 'Restarting code-server for the selected folder.');

      const response = await fetch('/api/app/code_oss/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: choice.path }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const data = body.data || {};
      currentProject = data.project_path || choice.path;
      currentFile = null;
      updateDocPlaceholder();
      updateSubtitle();
      applyBridgeState(data);
      explorerState.nodes.clear();
      explorerState.rootPaths = [];
      explorerState.expanded.clear();
      explorerState.activePath = null;
      explorerPlaceholder('Loading workspace…');

      const { host, port } = data;
      if (port) {
        const resolvedHost = resolveHost(host);
        markReady(`http://${resolvedHost}:${port}`);
      } else {
        await startServer();
      }
    } catch (error) {
      showError(error.message || 'Failed to open project');
    } finally {
      btnOpenProject.disabled = false;
    }
  });

  frame?.addEventListener('load', () => {
    frameReady = true;
    showFrame();
    if (statusCard) statusCard.style.display = 'none';
    // Send hello to establish communication
    frame.contentWindow?.postMessage({ _mobileShell: true, type: 'hello' }, '*');
    setTimeout(() => {
      sendCommand('requestExplorerTree');
      if (seed.file_path) {
        sendCommand('openPath', {
          path: seed.file_path,
          line: seed.line,
          column: seed.column,
        });
        seed.file_path = null;
      }
      if (seed.view) {
        sendCommand('showView', { viewId: seed.view, inPanel: true });
        seed.view = null;
      }
    }, 600);

    if (autoSwitchPending) {
      setActiveView('document');
      autoSwitchPending = false;
    }
  });

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    
    // DEBUG: Log ALL messages to see what's happening
    console.log('[ide_fullpage] Message received:', {
      origin: event.origin,
      data: data,
      hasMobileBridge: !!data._mobileBridge,
      hasMobileShell: !!data._mobileShell,
      type: data.type
    });
    
    if (!data || !data._mobileBridge) return;

    switch (data.type) {
      case 'state': {
        const dim = !!(data.sidebarVisible || data.panelVisible);
        document.body.classList.toggle('dim', dim);
        break;
      }
      case 'explorerTree': {
        const entries = data.entries || [];
        if (!entries.length && !data.parent) {
          explorerState.nodes.clear();
          explorerState.rootPaths = [];
          explorerState.expanded.clear();
          explorerPlaceholder('Workspace is empty.');
          break;
        }
        applyBridgeState({ bridge_installed: true });
        applyExplorerEntries(entries, data.parent || null);
        if (!data.parent && !currentProject && explorerState.rootPaths.length) {
          currentProject = explorerState.rootPaths[0];
          updateDocPlaceholder();
          updateSubtitle();
        }
        renderExplorerTree();
        if (!data.parent) {
          root.classList.add('drawer-open');
        }
        break;
      }
      case 'chatProviders': {
        if (Array.isArray(data.providers) && data.providers.length) {
          const active = data.providers.find((provider) => provider.active);
          chatSubtitle.textContent = active
            ? `Showing ${active.label || active.id}`
            : 'No active provider selected';
        }
        break;
      }
      case 'chatAttachment': {
        const placeholder = document.getElementById('chat-placeholder');
        if (placeholder) {
          placeholder.innerHTML = '';
          placeholder.appendChild(data.element || document.createTextNode('Extension attached.'));
        }
        break;
      }
      case 'activeEditor': {
        if (data.path) {
          currentFile = data.path;
          updateDocPlaceholder();
          updateSubtitle();
          if (!explorerState.nodes.has(data.path)) {
            sendCommand('revealPath', { path: data.path });
          }
          ensurePathVisible(data.path);
          applyBridgeState({ bridge_installed: true });
          
          // Show iframe in document view when file is active
          if (activeView === 'document' && frameShell) {
            frameShell.style.display = 'block';
            if (documentFrameTarget && !documentFrameTarget.contains(frameShell)) {
              documentFrameTarget.appendChild(frameShell);
            }
          }
        } else {
          // No active editor
          currentFile = null;
          updateDocPlaceholder();
          updateSubtitle();
          
          // Hide iframe in document view when no file is open
          if (activeView === 'document' && frameShell) {
            frameShell.style.display = 'none';
          }
        }
        break;
      }
      case 'workspaceFolders': {
        if (!Array.isArray(data.folders) || !data.folders.length) {
          explorerPlaceholder('Workspace is empty.');
        }
        break;
      }
      case 'bridgeState': {
        applyBridgeState(data);
        break;
      }
      case 'bridgeActivated': {
        console.log('[ide_fullpage] Bridge activated!', data);
        applyBridgeState({ bridge_installed: true });
        // Request initial data
        setTimeout(() => {
          sendCommand('requestExplorerTree', { depth: 2 });
        }, 100);
        break;
      }
      case 'test': {
        console.log('[ide_fullpage] Test message from bridge:', data.message);
        break;
      }
      default:
        console.log('[ide_fullpage] Unknown message type:', data.type);
        break;
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      toggleDrawer(false);
    }
  });

  hideFrame();
  root.classList.add('mode-document');
  startServer();
})();
