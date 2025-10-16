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
  const btnDocTestEdit = document.getElementById('btn-doc-test-edit');
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
  const docMonacoContainer = document.getElementById('doc-monaco-container');
  const docMonacoEditorEl = document.getElementById('doc-monaco-editor');

  const monacoBasePath = '/apps/code_oss/static/vendor/monaco/min';
  let monacoLoaderPromise = null;
  let monacoInstance = null;
  let monacoEditor = null;
  let monacoModel = null;
  let monacoDocId = null;
  let pendingMonacoState = null;
  let pendingMonacoChanges = [];

  const viewTabs = {
    document: tabDocument,
    full: tabFull,
  };

  const viewPanes = {
    document: documentView,
    full: fullView,
  };

  const bridgeStateEndpoint = `${window.location.origin}/api/app/code_oss/state`;
  const statePoll = {
    timer: null,
    pending: false,
    lastSeq: 0,
    interval: 1500,
    retryDelay: 4000,
    jitter: 400,
  };
  let summaryBootstrapped = false;

  let iframeOrigin = null;
  let frameReady = false;
  let activeView = 'full';
  let autoSwitchPending = true;

  let currentProject = seed.project_id || null;
  let currentFile = seed.file_path || null;
  let currentDocId = null;
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
  const docRevisions = new Map();

  function resolveHost(host) {
    if (!host || host === '0.0.0.0' || host === '127.0.0.1') {
      return window.location.hostname || '127.0.0.1';
    }
    return host;
  }

  function updateSubtitle() {
    const project = currentProject ? (currentProject.split('/').pop() || currentProject) : 'Code IDE';
    subtitleEl.textContent = project;
  }

  function updateDocPlaceholder() {
    const file = currentFile ? (currentFile.split('/').pop() || currentFile) : 'None';
    docCurrentPath.textContent = file;
    docCurrentProject.textContent = currentProject ? (currentProject.split('/').pop() || currentProject) : 'Not selected';
    setDocumentHasContent(!!currentFile);
  }

  function scheduleStatePoll(delay) {
    if (statePoll.timer) {
      clearTimeout(statePoll.timer);
      statePoll.timer = null;
    }
    const base = typeof delay === 'number' && !Number.isNaN(delay)
      ? delay
      : statePoll.interval;
    const jitterSpan = statePoll.jitter > 0
      ? Math.floor(Math.random() * statePoll.jitter)
      : 0;
    const jitter = jitterSpan > 0 && Math.random() < 0.5 ? -jitterSpan : jitterSpan;
    const wait = Math.max(300, Math.round(base + jitter));
    statePoll.timer = setTimeout(runStatePoll, wait);
  }

  function startBridgePolling(initialDelay = 600) {
    if (statePoll.timer) return;
    scheduleStatePoll(initialDelay);
  }

  async function runStatePoll() {
    if (statePoll.pending) {
      scheduleStatePoll(statePoll.interval);
      return;
    }
    statePoll.pending = true;
    let nextDelay = statePoll.interval;
    try {
      const params = statePoll.lastSeq ? `?since=${statePoll.lastSeq}` : '';
      const response = await fetch(`${bridgeStateEndpoint}${params}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      if (body?.ok) {
        const data = body.data || {};
        if (!summaryBootstrapped && data.summary) {
          applyBridgeSummary(data.summary);
        }
        if (typeof data.sequence === 'number') {
          statePoll.lastSeq = data.sequence;
        }
        const events = Array.isArray(data.events) ? data.events : [];
        if (events.length) {
          events.forEach((evt) => handleBridgeEvent(evt));
          const lastEvent = events[events.length - 1];
          if (lastEvent && typeof lastEvent.seq === 'number') {
            statePoll.lastSeq = lastEvent.seq;
          }
        }
      } else if (body && body.error) {
        throw new Error(body.error);
      }
    } catch (error) {
      console.error('[ide_fullpage] Failed to poll bridge state', error);
      nextDelay = statePoll.retryDelay;
    } finally {
      statePoll.pending = false;
      scheduleStatePoll(nextDelay);
    }
  }

  function applyBridgeSummary(summary) {
    if (!summary || summaryBootstrapped) return;
    const bootstrapEvents = [];
    if (summary.state) {
      bootstrapEvents.push({ type: 'state', ...summary.state });
    }
    if (summary.workspace_folders && summary.workspace_folders.length) {
      bootstrapEvents.push({ type: 'workspaceFolders', folders: summary.workspace_folders });
    }
    if (summary.explorer_tree && summary.explorer_tree.type) {
      bootstrapEvents.push(summary.explorer_tree);
    }
    if (summary.chat_providers && summary.chat_providers.length) {
      bootstrapEvents.push({ type: 'chatProviders', providers: summary.chat_providers });
    }
    if (summary.active_editor) {
      bootstrapEvents.push({ type: 'activeEditor', path: summary.active_editor });
    }
    if (summary.bridge) {
      bootstrapEvents.push({ type: 'bridgeState', ...summary.bridge });
    }
    if (Array.isArray(summary.errors) && summary.errors.length) {
      const lastError = summary.errors[summary.errors.length - 1];
      if (lastError?.message) {
        console.warn('[ide_fullpage] Bridge reported previous error:', lastError.message);
      }
    }
    bootstrapEvents.forEach((evt) => handleBridgeEvent(evt));
    summaryBootstrapped = true;
  }

  function handleBridgeEvent(data) {
    if (!data || typeof data !== 'object') return;

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
      case 'doc_state': {
        if (data.doc_id) {
          currentDocId = data.doc_id;
          if (typeof data.rev === 'number') {
            docRevisions.set(data.doc_id, data.rev);
          }
          setMonacoDocument(data.doc_id, data.text, data.languageId);
          setDocumentHasContent(true);
        }
        break;
      }
      case 'doc_changes': {
        if (data.doc_id) {
          if (typeof data.next_rev === 'number') {
            docRevisions.set(data.doc_id, data.next_rev);
          }
          applyMonacoChanges(data.doc_id, data.changes);
          setDocumentHasContent(true);
        }
        break;
      }
      case 'ack': {
        if (data.doc_id && typeof data.applied_rev === 'number') {
          docRevisions.set(data.doc_id, data.applied_rev);
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
          setDocumentHasContent(true);
          
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
          currentDocId = null;
          updateDocPlaceholder();
          updateSubtitle();
          setDocumentHasContent(false);
          
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
  }

  updateSubtitle();
  updateDocPlaceholder();
  ensureMonacoEditor().catch((error) => {
    console.error('[ide_fullpage] Failed to bootstrap Monaco editor', error);
  });

  function setDocumentHasContent(hasContent) {
    const enabled = !!hasContent;
    documentView?.classList.toggle('has-doc', enabled);
    root.classList.toggle('doc-ready', enabled);
    if (btnDocTestEdit) {
      btnDocTestEdit.disabled = !enabled;
    }
  }

  function buildDocIdFromPath(path) {
    if (!path) return null;
    if (path.startsWith('file://') || path.startsWith('vscode-')) {
      return path;
    }
    if (path.startsWith('/')) {
      return `file://${encodeURI(path)}`;
    }
    return `file://${encodeURI(path)}`;
  }

  function ensureMonacoEditor() {
    if (monacoEditor && monacoInstance) {
      return Promise.resolve(monacoInstance);
    }
    if (!monacoLoaderPromise) {
      monacoLoaderPromise = new Promise((resolve, reject) => {
        const configureAndLoad = () => {
          if (typeof window.require !== 'function') {
            reject(new Error('AMD loader not available'));
            return;
          }
          window.require.config({ paths: { vs: `${monacoBasePath}/vs` } });
          window.require(['vs/editor/editor.main'], (monaco) => {
            try {
              monacoInstance = monaco;
              if (!docMonacoEditorEl) {
                reject(new Error('Missing Monaco editor container'));
                return;
              }
              monacoEditor = monaco.editor.create(docMonacoEditorEl, {
                value: '',
                language: 'plaintext',
                readOnly: true,
                automaticLayout: true,
                minimap: { enabled: false },
                theme: 'vs-dark',
                scrollbar: { vertical: 'visible', horizontal: 'auto' },
                fontFamily: 'Fira Code, JetBrains Mono, Menlo, Consolas, monospace',
                fontSize: 14,
              });
              monacoModel = monacoEditor.getModel();
              applyPendingMonacoQueues();
              resolve(monaco);
            } catch (error) {
              reject(error);
            }
          }, (error) => reject(error));
        };
        if (typeof window.require === 'function') {
          configureAndLoad();
        } else {
          const script = document.createElement('script');
          script.src = `${monacoBasePath}/vs/loader.js`;
          script.async = true;
          script.onload = configureAndLoad;
          script.onerror = () => reject(new Error('Failed to load Monaco loader'));
          document.head.appendChild(script);
        }
      });
    }
    return monacoLoaderPromise;
  }

  function applyPendingMonacoQueues() {
    if (!monacoEditor || !monacoInstance) return;
    if (pendingMonacoState) {
      const state = pendingMonacoState;
      pendingMonacoState = null;
      internalSetMonacoDocument(state.docId, state.text, state.languageId);
    }
    if (pendingMonacoChanges.length) {
      const queue = pendingMonacoChanges.slice();
      pendingMonacoChanges = [];
      queue.forEach(({ docId, changes }) => internalApplyMonacoChanges(docId, changes));
    }
  }

  function internalSetMonacoDocument(docId, text, languageId) {
    if (!monacoInstance || !monacoEditor || !docId) return;
    const value = typeof text === 'string' ? text : (monacoModel ? monacoModel.getValue() : '');
    const lang = languageId || 'plaintext';
    if (!monacoModel || monacoDocId !== docId) {
      const previousModel = monacoModel;
      monacoModel = monacoInstance.editor.createModel(value, lang);
      monacoDocId = docId;
      monacoEditor.setModel(monacoModel);
      if (previousModel && previousModel !== monacoModel) {
        previousModel.dispose();
      }
    } else if (typeof text === 'string' && monacoModel.getValue() !== text) {
      monacoModel.setValue(text);
    }
    try {
      monacoInstance.editor.setModelLanguage(monacoModel, lang);
    } catch (error) {
      console.warn('[ide_fullpage] Failed to set Monaco language', lang, error);
    }
    applyPendingMonacoQueues();
  }

  function setMonacoDocument(docId, text, languageId) {
    if (!docId) return;
    if (!monacoEditor || !monacoInstance) {
      pendingMonacoState = { docId, text, languageId };
      ensureMonacoEditor().catch((error) => {
        console.error('[ide_fullpage] Failed to load Monaco editor', error);
      });
      return;
    }
    pendingMonacoState = null;
    internalSetMonacoDocument(docId, text, languageId);
  }

  function internalApplyMonacoChanges(docId, changes) {
    if (!monacoModel || monacoDocId !== docId || !monacoInstance) return;
    if (!Array.isArray(changes) || !changes.length) return;
    const edits = [];
    changes.forEach((change) => {
      const start = change?.start || {};
      const end = change?.end || {};
      const startLine = (start.l ?? 0) + 1;
      const startColumn = (start.c ?? 0) + 1;
      const endLine = (end.l ?? 0) + 1;
      const endColumn = (end.c ?? 0) + 1;
      edits.push({
        range: new monacoInstance.Range(startLine, startColumn, endLine, endColumn),
        text: change?.text ?? '',
        forceMoveMarkers: true,
      });
    });
    if (edits.length) {
      monacoModel.applyEdits(edits);
    }
  }

  function applyMonacoChanges(docId, changes) {
    if (!docId || !Array.isArray(changes) || !changes.length) return;
    if (!monacoEditor || !monacoModel || monacoDocId !== docId) {
      pendingMonacoChanges.push({ docId, changes });
      ensureMonacoEditor().catch((error) => {
        console.error('[ide_fullpage] Failed to load Monaco editor for changes', error);
      });
      return;
    }
    internalApplyMonacoChanges(docId, changes);
  }

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

  async function openFileInEditor(path) {
    currentFile = path;
    updateDocPlaceholder();
    updateSubtitle();

    // Keep the full IDE in sync
    sendCommand('openPath', { path });

    // Directly fetch content for the Monaco mirror view for a faster user experience
    try {
      const response = await fetch(`/api/app/code_oss/file?path=${encodeURIComponent(path)}`);
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const fileData = body.data || {};
      const docId = buildDocIdFromPath(path);
      // Guess language from file extension
      const language = monacoInstance?.languages.getLanguages().find(l => 
        l.extensions?.some(ext => path.endsWith(ext))
      )?.id || 'plaintext';

      setMonacoDocument(docId, fileData.content, language);
      setDocumentHasContent(true);
    } catch (error) {
      console.error(`[ide_fullpage] Failed to fetch file content for ${path}:`, error);
      // Show an error in the monaco editor itself
      setMonacoDocument(buildDocIdFromPath(path), `// Failed to load file: ${path}\n// Reason: ${error.message}`.trim(), 'plaintext');
      setDocumentHasContent(true);
    }
  }

  btnSearch?.addEventListener('click', () => sendCommand('openSearch'));
  btnCommand?.addEventListener('click', () => sendCommand('showCommands'));
  btnSettings?.addEventListener('click', () => sendCommand('openSettingsJSON'));
  btnChatRefresh?.addEventListener('click', () => sendCommand('refreshChat'));
  btnDocTestEdit?.addEventListener('click', async () => {
    if (btnDocTestEdit.disabled) return;
    const docId = currentDocId || buildDocIdFromPath(currentFile);
    if (!docId) {
      window.alert('No focused document available for edits yet.');
      return;
    }
    const baseRev = docRevisions.get(docId);
    const timestamp = new Date().toISOString();
    const payload = {
      doc_id: docId,
      base_rev: baseRev,
      edits: [
        {
          start: { l: 0, c: 0 },
          end: { l: 0, c: 0 },
          text: `// inserted via mobile wrapper ${timestamp}\n`,
        },
      ],
    };
    btnDocTestEdit.disabled = true;
    try {
      const response = await fetch('/api/app/code_oss/edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      console.log('[ide_fullpage] Queued sample edit', body?.data);
    } catch (error) {
      console.error('[ide_fullpage] Failed to queue sample edit', error);
      window.alert(`Failed to queue edit: ${error?.message || error}`);
    } finally {
      btnDocTestEdit.disabled = false;
    }
  });

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
    summaryBootstrapped = false;
    statePoll.lastSeq = 0;
    scheduleStatePoll(500);
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
      const bridgeArgs = {
        endpoint: bridgeStateEndpoint,
        flushInterval: statePoll.interval,
        retryDelay: statePoll.retryDelay,
      };
      frame.contentWindow.postMessage({ _mobileShell: true, type: 'hello', args: bridgeArgs }, '*');
      setTimeout(() => {
        frame.contentWindow.postMessage({
          _mobileShell: true,
          type: 'command',
          cmd: 'configureBridge',
          args: bridgeArgs,
        }, '*');
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

      summaryBootstrapped = false;
      statePoll.lastSeq = 0;
      scheduleStatePoll(500);

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
    const bridgeArgs = {
      endpoint: bridgeStateEndpoint,
      flushInterval: statePoll.interval,
      retryDelay: statePoll.retryDelay,
    };
    frame.contentWindow?.postMessage({ _mobileShell: true, type: 'hello', args: bridgeArgs }, '*');
    startBridgePolling(300);
    setTimeout(() => {
      sendCommand('configureBridge', bridgeArgs);
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
    if (data && data._mobileBridge) {
      handleBridgeEvent(data);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (statePoll.timer) {
      clearTimeout(statePoll.timer);
      statePoll.timer = null;
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

  async function initAssistantToggle() {
    const btnToggleAssistant = document.getElementById('btn-toggle-assistant');
    if (!btnToggleAssistant) return;
    const stateKey = 'code_oss.assistant_collapsed';
    let isCollapsed = await window.teState.get(stateKey, false);

    function applyState(collapsed) {
        root.classList.toggle('assistant-collapsed', collapsed);
        btnToggleAssistant.textContent = collapsed ? '▲' : '▼';
    }

    applyState(isCollapsed);

    btnToggleAssistant.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        applyState(isCollapsed);
        window.teState.set(stateKey, isCollapsed);
    });
  }

  initAssistantToggle();
})();
