// /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.js
// app/apps/file_editor_cm6/main.js
// Iframe-based NiceGUI Editor Integration

// CM6 import removed - now using NiceGUI's ui.codemirror in iframe
// import * as CM from '/static/vendor/codemirror.3/cm6.bundle.js';
//some comment
// #ts-check
import { initExplorerUI } from './static/js/explorer.js';
import { createDiffController } from './static/js/diff_decorations.js';
import { createTerminalDrawer } from './static/js/terminal.js';
import { initBranchMenu } from './static/js/git_menu.js';
// Hardcoded extension imports for now; will be dynamically loaded later.
import { initAgentDrawer } from './extensions/chat_drawer_extension/static/js/agent_drawer.js';
import { initAgentIframe } from './extensions/chat_drawer_extension/static/js/agent_iframe.js';
import ReconnectingWebSocket from './static/js/reconnecting_websocket.js'; // used by other WS helpers (not explorer)
import { initLspModal } from './static/js/lsp-modal/index.js';

function ensureSocketIoLoaded() {
  if (window.io) return Promise.resolve(window.io);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/socket.io.min.js';
    script.async = true;
    script.onload = () => resolve(window.io);
    script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
    document.head.appendChild(script);
  });
}
import { initResizeManager, loadLayoutPreferences } from './static/js/resize_manager.js';

const AGENT_HOST_PORT = 12359;
const AGENT_HOST_RESOLVE_ENDPOINT = '/api/host/resolve_iframe';
const AGENT_IFRAME_STORAGE_KEY = 'te2_agent_iframe_url';
const AGENT_EXTENSION_MANIFEST = '/apps/file_editor_cm6/extensions/chat_drawer_extension/manifest.json';
const AGENT_HOST_CWD_ENDPOINT = '/api/host/project/cwd';

async function fetchFrameworkSettings() {
  try {
    const resp = await fetch('/api/settings', { cache: 'no-store' });
    const body = await resp.json();
    if (body && body.ok && body.data && typeof body.data === 'object') {
      return body.data;
    }
  } catch (e) {
    console.warn('[Settings] Failed to load framework settings:', e);
  }
  return {};
}

function _isMobileLayout() {
  try {
    const root = document.querySelector('.fe-root');
    if (root && root.classList.contains('layout-mobile')) return true;
    if (root && root.classList.contains('layout-desktop')) return false;

    // Fallback for early boot / unexpected DOM state.
    const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
    return !isDesktop;
  } catch (_) {
    return true;
  }
}

async function fetchAgentExtensionManifest() {
  try {
    const resp = await fetch(AGENT_EXTENSION_MANIFEST, { cache: 'no-store' });
    const body = await resp.json();
    if (body && typeof body === 'object') {
      return body;
    }
  } catch (e) {
    console.warn('[Agent Drawer] Failed to load extension manifest:', e);
  }
  return {};
}

function applyAgentIcon(manifest) {
  const iconEl = document.querySelector('#fe-agent-toggle .fe-agent-icon');
  if (!iconEl) return;

  const iconPath = typeof manifest.icon === 'string' ? manifest.icon.trim() : '';
  const iconEmoji = typeof manifest.icon_emoji === 'string' ? manifest.icon_emoji.trim() : '';

  if (iconPath) {
    const img = document.createElement('img');
    const resolvedPath = iconPath.startsWith('/')
      ? iconPath
      : `/apps/file_editor_cm6/${iconPath.replace(/^\/+/, '')}`;
    img.src = resolvedPath;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    iconEl.textContent = '';
    iconEl.appendChild(img);
    return;
  }

  if (iconEmoji) {
    iconEl.textContent = iconEmoji;
  } else if (iconEl.dataset?.defaultIcon) {
    iconEl.textContent = iconEl.dataset.defaultIcon;
  }
}

let _agentOpenRequestPollerStarted = false;

function startAgentOpenRequestPoller() {
  if (_agentOpenRequestPollerStarted) return;
  _agentOpenRequestPollerStarted = true;

  const nextUrl = '/api/app/file_editor_cm6/agent/open_request/next';

  async function drainOnce() {
    // Drain up to a few queued requests per tick to keep UI responsive.
    for (let i = 0; i < 4; i++) {
      let resp;
      try {
        resp = await fetch(nextUrl, { cache: 'no-store' });
      } catch (_) {
        return;
      }

      if (!resp || resp.status === 204) return;

      let body;
      try {
        body = await resp.json();
      } catch (_) {
        return;
      }
      if (!body || !body.ok || !body.data) return;

      const req = body.data || {};
      const rel = typeof req.rel === 'string' ? req.rel.trim() : '';
      const abs = typeof req.path === 'string' ? req.path.trim() : '';
      const line = Number.isFinite(Number(req.line)) ? Number(req.line) : null;

      // Mobile: close overlay drawer before navigating/jumping.
      if (_isMobileLayout()) {
        try {
          agentDrawerHandle?.close?.();
        } catch (_) {}
      }

      let targetAbs = abs;
      if (!targetAbs && rel) {
        const base = cachedProjectRoot || (await getCurrentProjectRoot(false)) || HOME_DIR;
        targetAbs = toAbsolute(rel, base, HOME_DIR);
      }

      if (!targetAbs) return;

      try {
        await openFile(targetAbs, { forceRefresh: true });
        if (typeof line === 'number' && line >= 1) {
          await new Promise((resolve) => setTimeout(resolve, 140));
          await jumpToCurrentFileLine(line, { focus: true });
        }
      } catch (e) {
        host.toast(`Failed to open link: ${e?.message || 'unknown error'}`);
      }
    }
  }

  async function loop() {
    try {
      await drainOnce();
    } finally {
      setTimeout(loop, 650);
    }
  }

  loop();
}

async function pushAgentHostCwd(cwd) {
  const value = typeof cwd === 'string' ? cwd.trim() : '';
  if (!value) return;
  try {
    await fetch(`${getAgentHostBase()}${AGENT_HOST_CWD_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: value }),
    });
  } catch (err) {
    console.warn('[Agent Host] Failed to push project cwd:', err);
  }
}

function parseBoolean(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
  }
  return false;
}

function buildAgentHostBase() {
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const host = window.location.hostname || '127.0.0.1';
  return `${protocol}//${host}:${AGENT_HOST_PORT}`;
}

function buildDefaultAgentIframeUrl() {
  return `${buildAgentHostBase()}/codex-agent`;
}

function getAgentHostBaseFromStorage() {
  try {
    const stored = localStorage.getItem(AGENT_IFRAME_STORAGE_KEY);
    if (stored) {
      const parsed = new URL(stored, window.location.href);
      return parsed.origin;
    }
  } catch (_) {}
  return '';
}

function getAgentHostBase() {
  return getAgentHostBaseFromStorage() || buildAgentHostBase();
}

async function resolveAgentIframeUrl(settings) {
  const explicit = typeof settings.agent_drawer_iframe_url === 'string'
    ? settings.agent_drawer_iframe_url.trim()
    : '';
  if (explicit) {
    return explicit;
  }

  let resolved = '';
  try {
    const resp = await fetch(`${buildAgentHostBase()}${AGENT_HOST_RESOLVE_ENDPOINT}`, { cache: 'no-store' });
    const body = await resp.json();
    resolved = (body && typeof body.url === 'string' && body.url.trim()) ? body.url.trim() : '';
    if (!resolved && body && body.data && typeof body.data.url === 'string') {
      resolved = body.data.url.trim();
    }
  } catch (e) {
    console.warn('[Agent Drawer] Failed to resolve iframe URL:', e);
  }

  if (!resolved) {
    resolved = buildDefaultAgentIframeUrl();
  }

  try {
    localStorage.setItem(AGENT_IFRAME_STORAGE_KEY, resolved);
  } catch (_) {}

  return resolved;
}

async function resolveAgentIframeSettings(settings) {
  const enabled = parseBoolean(settings.agent_drawer_iframe);
  const url = await resolveAgentIframeUrl(settings);
  return { enabled, url };
}

// =============================================================================
// Debug Console WebSocket - forwards ALL console output to server file
// =============================================================================
let _debugWs = null;
let _debugWsReady = false;
const _originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

function initDebugConsole() {
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Use the framework's WebSocket proxy for apps
  const wsUrl = `${wsProto}//${window.location.host}/ws/app/file_editor_cm6/ws/debug_console`;
  try {
    _debugWs = new WebSocket(wsUrl);
    _debugWs.onopen = () => { _debugWsReady = true; };
    _debugWs.onclose = () => { _debugWsReady = false; };
    _debugWs.onerror = () => { _debugWsReady = false; };
  } catch (e) {
    // Silent fail
  }
}

function sendToDebugWs(level, args) {
  if (!_debugWsReady || !_debugWs) return;
  try {
    const msg = JSON.stringify({
      ts: Date.now(),
      level,
      args: args.map(a => {
        try {
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch {
          return String(a);
        }
      })
    });
    _debugWs.send(msg);
  } catch (e) {
    // Silent fail
  }
}

// Override console methods
console.log = (...args) => { _originalConsole.log(...args); sendToDebugWs('log', args); };
console.warn = (...args) => { _originalConsole.warn(...args); sendToDebugWs('warn', args); };
console.error = (...args) => { _originalConsole.error(...args); sendToDebugWs('error', args); };
console.info = (...args) => { _originalConsole.info(...args); sendToDebugWs('info', args); };

// Initialize debug console
initDebugConsole();

let explorerSocket = null;
const explorerPending = [];
let explorerNeedsResync = false;

// Dedicated Editor Socket.IO transport (separate from explorer and NiceGUI).
let editorSocket = null;
let editorSocketId = null;
const editorPending = [];
const _editorIssuesDumpWaiters = new Map(); // requestId -> {resolve,reject,timer}

async function handleAgentOpen(payload) {
  const isMobile = _isMobileLayout();
  const rel = typeof payload?.rel === 'string' ? payload.rel.trim() : '';
  const abs = typeof payload?.path === 'string'
    ? payload.path.trim()
    : (typeof payload?.abs === 'string'
      ? payload.abs.trim()
      : (typeof payload?.file === 'string' ? payload.file.trim() : ''));
  const line = Number.isFinite(Number(payload?.line)) ? Number(payload.line) : null;
  const source = typeof payload?.source === 'string' ? payload.source : '';

  if (isMobile) {
    try {
      agentDrawerHandle?.close?.();
    } catch (_) {}
    try {
      const drawer = document.getElementById('agent-drawer');
      if (drawer) {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
      }
    } catch (_) {}
  }

  let targetAbs = abs;
  if (!targetAbs && rel) {
    try {
      const base = cachedProjectRoot || (await getCurrentProjectRoot(false)) || HOME_DIR;
      targetAbs = toAbsolute(rel, base, HOME_DIR);
    } catch (_) {
      targetAbs = '';
    }
  }

  if (!targetAbs) return;
  try {
    if (typeof openFile === 'function') {
      await openFile(targetAbs, { forceRefresh: true });
    } else if (typeof window.appOpenFile === 'function') {
      window.appOpenFile(targetAbs);
      await new Promise((resolve) => setTimeout(resolve, 220));
    } else {
      throw new Error('openFile is not available yet');
    }
    if (typeof line === 'number' && line >= 1) {
      await new Promise((resolve) => setTimeout(resolve, 140));
      const jumpOptions = { focus: !isMobile };
      if (source === 'codex-agent') {
        jumpOptions.scrollY = 'center';
      }
      if (typeof jumpToCurrentFileLine === 'function') {
        await jumpToCurrentFileLine(line, jumpOptions);
      } else if (typeof window.jumpToCurrentFileLine === 'function') {
        await window.jumpToCurrentFileLine(line, jumpOptions);
      }
    }
  } catch (e) {
    console.warn('[AgentOpen] Failed to open+jump:', e);
    host.toast(`Failed to open link: ${e?.message || 'unknown error'}`);
  }
}

function connectExplorerSocket() {
  if (explorerSocket) return;
  ensureSocketIoLoaded()
    .then((io) => {
      if (!io) throw new Error('Socket.IO client unavailable');
      // Use dedicated Explorer Socket.IO endpoint (separate from NiceGUI transport).
      const socketPath = '/explorer_ws/socket.io';
      explorerSocket = io('/explorer', {
        path: socketPath,
        transports: ['websocket'],
        query: { app_id: 'file_editor_cm6' },
      });

      explorerSocket.on('connect', () => {
        console.log('[ExplorerSIO] Connected');
        // Flush any queued messages
        while (explorerPending.length) {
          const msg = explorerPending.shift();
          explorerSocket.emit('explorer_send', msg);
        }

        if (explorerNeedsResync) {
          explorerNeedsResync = false;
          try {
            if (typeof window.__cm6ExplorerOnReconnect === 'function') {
              window.__cm6ExplorerOnReconnect();
            }
          } catch (e) {
            console.warn('[ExplorerSIO] Reconnect resync failed:', e);
          }
        }
      });

      explorerSocket.on('disconnect', (reason) => {
        console.log('[ExplorerSIO] Disconnected', reason);
        explorerNeedsResync = true;
      });

      explorerSocket.on('connect_error', (err) => {
        console.warn('[ExplorerSIO] Connect error', err);
      });

      explorerSocket.on('explorer:event', (msg) => {
        if (window.__debugExplorer) {
          console.log('[ExplorerSIO:event]', msg);
        }
        if (!msg) return;
        try {
          if (typeof msg === 'string') {
            msg = JSON.parse(msg);
          }
        } catch {
          return;
        }
        const type = msg.type || msg?.data?.type;
        const payload = msg.payload || msg?.data?.payload || {};
        if (type === 'agent:open') {
          handleAgentOpen(payload);
          return;
        }
        // The explorer websocket is THE authority for which file is active.
        // Update host toolbar whenever the active file changes.
        if (type === 'explorer:activeFile' && payload.rel) {
          try {
            const projRoot = cachedProjectRoot || null;
            if (projRoot) {
              const abs = toAbsolute(payload.rel, projRoot, HOME_DIR);
              if (abs && abs !== currentPath) {
                currentPath = abs;
                currentPathExists = true;
                lastPickerPath = parentDir(abs);
                currentModeLanguage = detectLanguageFromFilename(abs);
                updatePathDisplay();
              }
            }
          } catch (_) {}
        }
        if (type && typeof window.__explorerBusDispatch === 'function') {
          window.__explorerBusDispatch(type, payload);
        }
      });

      window.__explorerBusSend = (type, payload) => {
        const msg = { type, payload: payload || {} };
        if (explorerSocket && explorerSocket.connected) {
          explorerSocket.emit('explorer_send', msg);
        } else {
          explorerPending.push(msg);
        }
      };

      // Android/Gecko often drops websockets while backgrounded; force a reconnect
      // when returning to the foreground so explorer state can resync.
      document.addEventListener('visibilitychange', () => {
        try {
          if (document.visibilityState !== 'visible') return;
          if (explorerSocket && !explorerSocket.connected) {
            explorerSocket.connect();
          }
        } catch (_) {}
      });
    })
    .catch((err) => {
      console.warn('[ExplorerSIO] Failed to open explorer Socket.IO:', err);
    });
}

// Ensure lastSha256 exists before any cache-state events fire.
var lastSha256 = null;
// `explorer:event` may arrive before helper functions are defined; keep a stable symbol.
// This is NOT a suppression: we queue the latest indicator payload and replay it once
// the real implementation is installed.
var applyCacheIndicator = function (info) {
  try { window.__fePendingCacheIndicator = info; } catch (_) {}
};

function _applyEditorCacheState(data) {
  if (!data || typeof data !== 'object') return;

  // Editor runtime always reports absolute paths; avoid pulling in path helpers here
  // (this function is hit early during bootstrap, before some legacy helpers exist).
  const normalizedPath = (typeof data.path === 'string' && data.path) ? data.path : null;
  if (normalizedPath) {
    let prevPath = null;
    try { prevPath = currentPath; } catch (_) { prevPath = null; }
    const pathChanged = prevPath ? (normalizedPath !== prevPath) : true;
    try { currentPath = normalizedPath; } catch (_) {}
    try { currentPathExists = true; } catch (_) {}
    try {
      const trimmed = normalizedPath.replace(/\/+$/, '');
      const idx = trimmed.lastIndexOf('/');
      lastPickerPath = idx > 0 ? trimmed.slice(0, idx) : '/';
    } catch (_) {}
    const nameEl = window.fileNameEl || fileNameEl || null;
    if (nameEl && (pathChanged || !nameEl.textContent || nameEl.textContent === 'Untitled')) {
      try {
        if (typeof updatePathDisplay === 'function') updatePathDisplay();
        else if (typeof window.updatePathDisplay === 'function') window.updatePathDisplay();
      } catch (_) {}
    }
  }
  if (typeof data.content_sha256 === 'string' && data.content_sha256.length === 64) {
    lastSha256 = data.content_sha256;
  }
  let restoredActive = (typeof restoredSessionActive !== 'undefined') ? restoredSessionActive : false;
  if (data.reason === 'restore') {
    restoredActive = true;
    try { restoredSessionActive = true; } catch (_) {}
  } else if (data.state === 'clean') {
    restoredActive = false;
    try { restoredSessionActive = false; } catch (_) {}
  }
  if (data.reason === 'watcher_external' && normalizedPath) {
    triggerExternalRefresh(normalizedPath);
  }
  applyCacheIndicator({
    state: data.state,
    unsaved: data.unsaved,
    reason: data.reason,
    restoredActive: restoredActive,
  });

  // Synchronize autosave mode across host shells (other clients).
  try {
    const autosaveValue =
      typeof data.auto_save === 'boolean' ? data.auto_save :
      (typeof data.autoSave === 'boolean' ? data.autoSave : null);
    if (typeof autosaveValue === 'boolean') {
      if (!editorViewState || typeof editorViewState !== 'object') editorViewState = {};
      editorViewState.autoSave = autosaveValue;
      if (typeof applyStateToMenus === 'function') {
        applyStateToMenus(editorViewState);
      }
    }
  } catch (_) {}

  if (data.path) {
    window.dispatchEvent(new CustomEvent('cm6:draft-updated', {
      detail: {
        path: data.path,
        unsaved: !!data.unsaved
      }
    }));
  }
  window.__cm6CacheState = data;
}

function _handleEditorScrollState(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  if (typeof data.line !== 'number' || data.line < 1) return;

  // Avoid TDZ/caching issues by keeping scroll restore state on window.
  // This can be emitted early by Socket.IO before other module-scope vars are initialized.
  window.__feLastScrollState = {
    path: currentPath || null,
    line: data.line,
    column: (typeof data.column === 'number' && data.column >= 0) ? data.column : null,
    top: (typeof data.top === 'number' && data.top >= 0) ? data.top : null,
  };

  if (window.__feScrollStateTimer) clearTimeout(window.__feScrollStateTimer);
  window.__feScrollStateTimer = setTimeout(async () => {
    window.__feScrollStateTimer = null;
    const lastScrollState = window.__feLastScrollState || null;
    if (!lastScrollState || !lastScrollState.path) return;
    try {
      try {
        const q = (typeof queueSessionStateUpdate === 'function')
          ? queueSessionStateUpdate
          : (typeof window.queueSessionStateUpdate === 'function' ? window.queueSessionStateUpdate : null);
        if (q) {
          q({
            scrollLine: lastScrollState.line,
            scrollTop: lastScrollState.top != null ? lastScrollState.top : null,
          });
        }
      } catch (_) {}

      if (lastScrollState.line && lastScrollState.line > 0) {
        const post = (typeof apiPost === 'function')
          ? apiPost
          : (typeof window.apiPost === 'function' ? window.apiPost : null);
        if (post) {
          await post('state/file_scroll', {
            path: lastScrollState.path,
            scroll_line: lastScrollState.line,
          });
        }
      }
    } catch (err) {
      console.warn('Failed to persist scroll state:', err);
    }
  }, (typeof window.__feCursorStateDebounceMs === 'number' ? window.__feCursorStateDebounceMs : 1000));
}

function _resolveIssuesDumpWaiter(requestId, dump) {
  const waiter = _editorIssuesDumpWaiters.get(requestId);
  if (!waiter) return;
  _editorIssuesDumpWaiters.delete(requestId);
  try { clearTimeout(waiter.timer); } catch (_) {}
  try { waiter.resolve(dump || null); } catch (_) {}
}

function _rejectIssuesDumpWaiter(requestId, err) {
  const waiter = _editorIssuesDumpWaiters.get(requestId);
  if (!waiter) return;
  _editorIssuesDumpWaiters.delete(requestId);
  try { clearTimeout(waiter.timer); } catch (_) {}
  try { waiter.reject(err); } catch (_) {}
}

function _issuesDumpRequestOnce() {
  const requestId = `issues_dump_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeoutMs = 10000;
    const timer = setTimeout(() => {
      _editorIssuesDumpWaiters.delete(requestId);
      reject(new Error('Issues dump timed out'));
    }, timeoutMs);
    _editorIssuesDumpWaiters.set(requestId, { resolve, reject, timer });

    if (editorSocket && editorSocket.connected) {
      editorSocket.emit('editor_issues_dump_request', { requestId });
      return;
    }
    reject(new Error('Editor socket not connected'));
  });
}

function connectEditorSocket() {
  if (editorSocket) return;
  ensureSocketIoLoaded()
    .then((io) => {
      if (!io) throw new Error('Socket.IO client unavailable');
      editorSocket = io('/editor', {
        path: '/editor_ws/socket.io',
        transports: ['websocket'],
        query: { app_id: 'file_editor_cm6', role: 'host' },
      });

      editorSocket.on('connect', () => {
        editorSocketId = editorSocket.id || null;
        while (editorPending.length) {
          const msg = editorPending.shift();
          editorSocket.emit(msg.type, msg.payload || {});
        }
      });

      editorSocket.on('disconnect', (reason) => {
        console.log('[EditorSIO] Disconnected', reason);
      });

      editorSocket.on('connect_error', (err) => {
        console.warn('[EditorSIO] Connect error', err);
      });

      editorSocket.on('editor:ssot', (snapshot) => {
        // Host receives its own SSOT on connect — extract currentPath so the
        // toolbar shows the filename even if the iframe's cache_state broadcast
        // arrived before the host Socket.IO was connected (race fix).
        try {
          const p = snapshot && typeof snapshot === 'object' ? snapshot : {};
          const filePath = (p.file && p.file.path) || p.currentPath || null;
          if (filePath && typeof filePath === 'string') {
            _applyEditorCacheState({
              path: filePath,
              state: (p.file && p.file.state) || 'clean',
              unsaved: !!(p.file && p.file.unsaved),
              reason: (p.file && p.file.reason) || 'ssot',
              content_sha256: (p.file && p.file.content_sha256) || null,
              auto_save: (p.file && p.file.auto_save) != null ? p.file.auto_save : null,
            });
          }
        } catch (_) {}
      });

      editorSocket.on('editor:cache_state', (payload) => {
        _applyEditorCacheState(payload);
      });

      editorSocket.on('editor:draft_state', (payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        if (p.has_draft && p.path) {
          try { restoredSessionActive = true; } catch (_) {}
          try { restoredSessionPath = p.path; } catch (_) {}
        }
      });

      editorSocket.on('editor:scroll_state', (payload) => {
        _handleEditorScrollState(payload);
      });

      editorSocket.on('editor:notify', (payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        const message = typeof p.message === 'string' ? p.message : null;
        if (message) host.toast(message, p.timeout || 3000);
      });

      editorSocket.on('editor:issues_dump_response', (payload) => {
        try {
          const requestId = payload && (payload.requestId || payload.request_id) ? String(payload.requestId || payload.request_id) : '';
          if (!requestId) return;
          _resolveIssuesDumpWaiter(requestId, payload.dump);
        } catch (_) {}
      });

      function _feTs() {
        try {
          const t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
            ? Math.round(performance.now() * 10) / 10
            : null;
          return (t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now();
        } catch (_) {
          return 'now=' + Date.now();
        }
      }

      // Diagnostics baton: show spinner while waiting for analysis of newly opened file.
      editorSocket.on('editor:diagnostics_pending', (payload) => {
        try {
          const p = payload && typeof payload === 'object' ? payload : {};
          const pendingPath = p.path || '';
          const pendingRequestId = p.request_id || '';
          console.log(_feTs(), '[diag_baton] pending path=' + pendingPath + ' request_id=' + (pendingRequestId || '-'));
          try {
            const prev = window.__feDiagBaton;
            const prevRid = prev && prev.requestId ? String(prev.requestId) : '';
            const prevPath = prev && prev.path ? String(prev.path) : '';
            if (prevRid && prevRid !== pendingRequestId) {
              console.log(_feTs(), '[spinner] REPLACE old=' + prevRid + ' new=' + pendingRequestId + ' path=' + pendingPath + ' prevPath=' + prevPath);
            }
            console.log(_feTs(), '[spinner] START request_id=' + (pendingRequestId || '-') + ' path=' + pendingPath + ' reason=diagnostics_pending');
          } catch (_) {}
          window.__feDiagBaton = { path: pendingPath, requestId: pendingRequestId, ts: Date.now() };
          // Show the LSP spinner.
          if (window.__feLspSpinnerUi) {
            window.__feLspSpinnerUi.busyShow = true;
            window.__feLspSpinnerUi.busyActivity = 'diagnostics';
            window.__feLspSpinnerUi.busyTitle = 'Analyzing ' + (pendingPath.split('/').pop() || 'file') + '…';
          }
          _feUpdateLspSpinner();
          // Safety timeout: auto-hide after 45s if no ready event.
          // Must be longer than adapter connect (~30s) + Pyright analysis (~10s).
          if (window.__feDiagBatonTimer) clearTimeout(window.__feDiagBatonTimer);
          window.__feDiagBatonTimer = setTimeout(() => {
            console.log(_feTs(), '[diag_baton] timeout, hiding spinner');
            console.log(_feTs(), '[spinner] STOP request_id=' + (pendingRequestId || '-') + ' path=' + pendingPath + ' reason=timeout');
            window.__feDiagBaton = null;
            if (window.__feLspSpinnerUi) {
              window.__feLspSpinnerUi.busyShow = false;
              window.__feLspSpinnerUi.busyActivity = '';
              window.__feLspSpinnerUi.busyTitle = '';
            }
            // Force-hide: bypass anti-flicker.
            try {
              if (window.__feLspSpinnerState && window.__feLspSpinnerState.hideTimer) {
                clearTimeout(window.__feLspSpinnerState.hideTimer);
                window.__feLspSpinnerState.hideTimer = null;
              }
              var _sp = document.getElementById('fe-lsp-spinner');
              if (_sp) { _sp.style.display = 'none'; _sp.title = ''; }
            } catch (_) {}
            _feUpdateLspSpinner();
          }, 45000);
        } catch (_) {}
      });

      editorSocket.on('editor:diagnostics_ready', (payload) => {
        try {
          const p = payload && typeof payload === 'object' ? payload : {};
          const readyPath = p.path || '';
          const readyRequestId = p.request_id || '';
          console.log(_feTs(), '[diag_baton] ready path=' + readyPath + ' request_id=' + (readyRequestId || '-') + ' markers=' + (p.markers || 0) + (p.reason ? (' reason=' + p.reason) : '') + (p.error ? ' error=1' : ''));
          const baton = window.__feDiagBaton;
          const matchByRequest = !!(baton && baton.requestId && readyRequestId && baton.requestId === readyRequestId);
          const matchByPath = !!(baton && baton.path && baton.path === readyPath);
          try {
            const pendingRid = baton && baton.requestId ? String(baton.requestId) : '';
            console.log(_feTs(), '[spinner] READY request_id=' + (readyRequestId || '-') + ' pending=' + (pendingRid || '-') + ' match=' + ((matchByRequest || matchByPath) ? '1' : '0') + ' path=' + readyPath);
          } catch (_) {}
          if (matchByRequest || matchByPath) {
            window.__feDiagBaton = null;
            if (window.__feDiagBatonTimer) {
              clearTimeout(window.__feDiagBatonTimer);
              window.__feDiagBatonTimer = null;
            }
            if (window.__feLspSpinnerUi) {
              window.__feLspSpinnerUi.busyShow = false;
              window.__feLspSpinnerUi.busyActivity = '';
              window.__feLspSpinnerUi.busyTitle = '';
            }
            console.log(_feTs(), '[spinner] STOP request_id=' + (readyRequestId || '-') + ' path=' + readyPath + ' reason=diagnostics_ready');
            // Force-hide: bypass anti-flicker to avoid race where delayed hide gets cancelled.
            try {
              if (window.__feLspSpinnerState && window.__feLspSpinnerState.hideTimer) {
                clearTimeout(window.__feLspSpinnerState.hideTimer);
                window.__feLspSpinnerState.hideTimer = null;
              }
              var _sp = document.getElementById('fe-lsp-spinner');
              if (_sp) { _sp.style.display = 'none'; _sp.title = ''; }
            } catch (_) {}
            _feUpdateLspSpinner();
          }
        } catch (_) {}
      });

      // Diagnostics counts from iframe → update toolbar badges.
      editorSocket.on('editor:diagnostics_counts', (payload) => {
        try {
          const p = payload && typeof payload === 'object' ? payload : {};
          const errors = Number(p.errors || 0);
          const warnings = Number(p.warnings || 0);
          const hints = Number(p.hints || 0);
          const total = errors + warnings + hints;
          const el = document.getElementById('fe-issues-badges');
          if (!el) return;
          el.innerHTML = '';
          if (errors > 0) {
            const d = document.createElement('span');
            d.className = 'fe-issues-dot error';
            d.textContent = String(errors);
            d.title = errors + ' error' + (errors !== 1 ? 's' : '');
            el.appendChild(d);
          }
          if (warnings > 0) {
            const d = document.createElement('span');
            d.className = 'fe-issues-dot warning';
            d.textContent = String(warnings);
            d.title = warnings + ' warning' + (warnings !== 1 ? 's' : '');
            el.appendChild(d);
          }
          // Enable/disable issues nav buttons.
          const toggleBtn = document.getElementById('fe-issues-toggle');
          const prevBtn = document.getElementById('fe-issues-prev');
          const nextBtn = document.getElementById('fe-issues-next');
          if (toggleBtn) toggleBtn.disabled = (total === 0);
          if (prevBtn) prevBtn.disabled = (total === 0);
          if (nextBtn) nextBtn.disabled = (total === 0);
        } catch (_) {}
      });
    })
    .catch((err) => {
      console.warn('[EditorSIO] Failed to open editor Socket.IO:', err);
    });
}

// === CM6 Code Disabled - Using NiceGUI iframe ===
// All CM6 initialization, themes, languages, and editor setup moved to NiceGUI
/*
// Core
const EditorState = CM.EditorState;
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers, Decoration, ViewPlugin, Compartment } = CM;
const defaultKeymap   = CM.defaultKeymap   || [];
const history         = CM.history         || (() => []);
const historyKeymap   = CM.historyKeymap   || [];
const searchKeymap    = CM.searchKeymap    || [];
const indentWithTab   = CM.indentWithTab   || (() => {});
const syntaxHighlighting = CM.syntaxHighlighting || (() => []);
const StreamLanguage  = CM.StreamLanguage;
const defaultHighlightStyle = CM.defaultHighlightStyle || null;
const { undo, redo, oneDark, search, openSearchPanel, termuxTheme } = CM;

// Import all available themes from the new bundle
const {
  githubDark, githubLight,
  vscodeDark, vscodeLight,
  xcodeDark, xcodeLight,
  solarizedDark, solarizedLight,
  nord, dracula, okaidia, sublime,
  androidstudio, darcula,
  basicDark, basicLight
} = CM;

const THEMES = {
  'cm6-dark': EditorView.theme({}, {dark: true}),
  'one-dark': oneDark || null,
  'termux': termuxTheme ? termuxTheme() : null,
  // GitHub themes
  'github-dark': githubDark || null,
  'github-light': githubLight || null,
  // VS Code themes
  'vscode-dark': vscodeDark || null,
  'vscode-light': vscodeLight || null,
  // Xcode themes
  'xcode-dark': xcodeDark || null,
  'xcode-light': xcodeLight || null,
  // Solarized themes
  'solarized-dark': solarizedDark || null,
  'solarized-light': solarizedLight || null,
  // Popular themes
  'nord': nord || null,
  'dracula': dracula || null,
  'okaidia': okaidia || null,
  'sublime': sublime || null,
  'androidstudio': androidstudio || null,
  'darcula': darcula || null,
  // Basic themes
  'basic-dark': basicDark || null,
  'basic-light': basicLight || null,
};

const zebraStripes = EditorView.theme({
  '& .cm-line:nth-child(even)': { 
    backgroundColor: 'rgba(128, 128, 128, 0.1)' 
  },
  '.cm-dark & .cm-line:nth-child(even)': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
});

// Languages (fallbacks are no-ops if missing in your bundle)
const javascript = CM.javascript || (() => []);
const jsonLang   = CM.json       || (() => []);
const python     = CM.python     || (() => []);
const htmlLang   = CM.html       || (() => []);
const cssLang    = CM.css        || (() => []);
const markdown   = CM.markdown   || (() => []);
const xmlLang    = CM.xml        || (() => []);

// Shell (legacy) — wrap if present in the bundle
const shellLang = () => {
  const mode = CM.shellMode;
  return (mode && CM.StreamLanguage) ? CM.StreamLanguage.define(mode) : null;
};

// ---------- Empty Line Selection Anchors (for Android native selection) ----------
// Creates invisible widgets in empty lines so Android selection can anchor properly
// Uses WORD JOINER (\u2060) which won't create line breaks

const emptyLineAnchorCompartment = new Compartment();

function createEmptyLineAnchorWidget() {
  class EmptyLineAnchor extends CM.WidgetType {
    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-empty-anchor';
      span.textContent = '\u2060'; // WORD JOINER - invisible, non-breaking
      return span;
    }
    ignoreEvent() { return false; }
  }

  const emptyLinePlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }
    
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    
    buildDecorations(view) {
      const builder = [];
      for (let { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = view.state.doc.lineAt(pos);
          if (line.length === 0) {
            // Empty line - add anchor widget at the start
            builder.push(
              Decoration.widget({
                widget: new EmptyLineAnchor(),
                side: -1,
              }).range(line.from)
            );
          }
          pos = line.to + 1;
        }
      }
      return Decoration.set(builder);
    }
  }, {
    decorations: v => v.decorations,
  });

  return emptyLinePlugin;
}

// Initially disabled (will be enabled during native selection)
const emptyLineAnchorExtension = emptyLineAnchorCompartment.of([]);
*/
// === End of CM6 disabled code ===

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl, api, host) {

window.host = host;
const cacheStateBadge = requireEl('#fe-file-draft-badge');
var fileNameEl = null;
window.api  = api;
const HOME_DIR = '/data/data/com.termux/files/home';
const HOME_PREFIX = `${HOME_DIR}/`;

// DOM helpers
function requireEl(selector, scope=document) {
  const el = scope.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function initVirtualKeyboardAdjustments({ root }) {
  if (!root) return;

  const docEl = document.documentElement;
  const viewport = window.visualViewport;

  // We only care about detecting if the keyboard is likely open to toggle a class.
  // We do NOT want to manually resize elements or set CSS variables that fight native behavior.

  const getViewportHeight = () => {
    if (viewport) return viewport.height;
    return window.innerHeight || docEl.clientHeight || 0;
  };

  let baselineHeight = getViewportHeight() || window.innerHeight || docEl.clientHeight || 0;
  let keyboardActive = false;

  const updateKeyboardState = () => {
    const currentHeight = getViewportHeight();
    if (!currentHeight) return;

    // specific check: if height shrinks by > 150px, assume keyboard
    const diff = baselineHeight - currentHeight;
    const likelyKeyboard = diff > 150;

    if (likelyKeyboard !== keyboardActive) {
      keyboardActive = likelyKeyboard;
      root.classList.toggle('keyboard-open', keyboardActive);
    }
    
    // Update baseline if we get a larger height (e.g. keyboard closed or orientation changed)
    if (currentHeight > baselineHeight) {
      baselineHeight = currentHeight;
    }
  };

  if (viewport) {
    viewport.addEventListener('resize', updateKeyboardState);
  } else {
    window.addEventListener('resize', updateKeyboardState);
  }

  // Handle orientation changes by resetting baseline
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      baselineHeight = getViewportHeight() || window.innerHeight || baselineHeight;
      updateKeyboardState();
    }, 250);
  });

  // Initial check
  updateKeyboardState();
}

const container = requireEl('#editor-container');
const editorFrame = requireEl('#editor-frame'); // Changed from cm6-host to editor-frame
const root = requireEl('.fe-root');
const agentDrawerEl = requireEl('#agent-drawer');
const agentTranscript = requireEl('#agent-transcript');
const agentComposer = requireEl('#agent-input');

// Title/status & chrome
fileNameEl = requireEl('#fe-file-name');
window.fileNameEl = fileNameEl;
const issuesToggleBtn = requireEl('#fe-issues-toggle');
const issuesPrevBtn = requireEl('#fe-issues-prev');
const issuesNextBtn = requireEl('#fe-issues-next');
const issuesBadgesEl = requireEl('#fe-issues-badges');
const statusEl = requireEl('#fe-status');
const editTrackerStatusEl = requireEl('#edit-tracker-status');

// Menus (ids must match template.html)
const menuFileBtn = requireEl('#menu-file-btn');
const menuFileDD  = requireEl('#menu-file-dd');
const menuEditBtn = requireEl('#menu-edit-btn');
const menuEditDD  = requireEl('#menu-edit-dd');
const menuEditorBtn = requireEl('#menu-editor-btn');
const menuEditorDD  = requireEl('#menu-editor-dd');
const menuViewBtn = requireEl('#menu-view-btn');
const menuViewDD  = requireEl('#menu-view-dd');


const recentFilesBtn = requireEl('#recent-files-btn');
const recentFilesDD  = requireEl('#recent-files-dd');
const runActiveBtn   = requireEl('#run-active-file-btn');
const MAX_FILENAME_DISPLAY = 34;

function formatFileNameDisplay(name) {
  if (!name) return '';
  if (name.length <= MAX_FILENAME_DISPLAY) return name;
  const keepStart = Math.max(6, Math.floor((MAX_FILENAME_DISPLAY - 1) * 0.6));
  const keepEnd = Math.max(4, MAX_FILENAME_DISPLAY - keepStart - 1);
  return `${name.slice(0, keepStart)}…${name.slice(-keepEnd)}`;
}


function setToolbarFileName(rawName) {
  const safe = rawName || '';
  fileNameEl.textContent = formatFileNameDisplay(safe);
  fileNameEl.title = safe;
}

function setIssuesButtonsEnabled(enabled) {
  issuesToggleBtn.disabled = !enabled;
  if (!enabled) {
    issuesPrevBtn.disabled = true;
    issuesNextBtn.disabled = true;
    issuesBadgesEl.textContent = '';
  }
}

function sendIssuesCmd(action) {
  try {
    if (!editorSocket || !editorSocket.connected) return;
    // Monaco issues navigation runs inside the editor iframe via editor Socket.IO.
    editorSocket.emit('editor_issues_cmd', { action: String(action || '') });
  } catch (err) {
    console.warn('[Issues] Failed to send via editor socket:', err);
  }
}

issuesToggleBtn.addEventListener('click', () => sendIssuesCmd('next'));
issuesPrevBtn.addEventListener('click', () => sendIssuesCmd('prev'));
issuesNextBtn.addEventListener('click', () => sendIssuesCmd('next'));

function _basenameNoExt(p) {
  const b = basename(p || '');
  if (!b) return 'untitled';
  const idx = b.lastIndexOf('.');
  if (idx <= 0) return b;
  return b.slice(0, idx);
}

function _extNoDot(p) {
  const b = basename(p || '');
  const idx = b.lastIndexOf('.');
  if (idx === -1 || idx === b.length - 1) return '';
  return b.slice(idx + 1);
}

function _safeFilePart(s) {
  const text = String(s || '').trim();
  if (!text) return '';
  return text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildDefaultDiagnosticsFilename(absPath, projectRoot) {
  const file = String(absPath || '').trim();
  const pr = String(projectRoot || '').trim().replace(/\/+$/, '');

  // Prefer project-relative path (stable, readable, and avoids HOME_DIR confusion).
  let rel = '';
  if (pr && file && file.startsWith(pr + '/')) {
    rel = file.slice(pr.length + 1);
  }

  const dotted = (rel || basename(file) || 'untitled')
    .split('/')
    .filter(Boolean)
    .map(_safeFilePart)
    .filter(Boolean)
    .join('.');

  return `${dotted || 'untitled'}.json`;
}

// NOTE: _issuesDumpRequestOnce is now implemented via the editor Socket.IO channel
// (see connectEditorSocket block) to avoid host↔iframe postMessage bridges.

async function _ensureDiagnosticsDir(projectRootAbs) {
  const projectRoot = String(projectRootAbs || '').replace(/\/+$/, '');
  if (!projectRoot) return { ok: false, dir: '' };
  const codeRoot = `${projectRoot}/.code_cm6`;
  const target = `${codeRoot}/diagnostics`;

  const exists = async () => {
    try {
      const params = new URLSearchParams({ path: target, hidden: '1', root: 'system' });
      const resp = await fetch(`/api/browse?${params.toString()}`, { cache: 'no-store' });
      if (!resp.ok) return false;
      const json = await resp.json().catch(() => ({}));
      return Boolean(json && json.ok);
    } catch {
      return false;
    }
  };

  if (await exists()) return { ok: true, dir: target };

  const yes = window.confirm('This will create a new directory called .code_cm6/diagnostics in your project root. Is this ok?');
  if (!yes) return { ok: false, dir: projectRoot };

  try {
    const rootResp = await apiPost('explorer/mkdir', { parent_rel: '.', name: '.code_cm6' });
    if (rootResp?.ok === false) throw new Error(rootResp?.error || 'mkdir failed');
    const resp = await apiPost('explorer/mkdir', { parent_rel: '.code_cm6', name: 'diagnostics' });
    if (resp?.ok === false) throw new Error(resp?.error || 'mkdir failed');
  } catch (err) {
    host.toast(err?.message || 'Failed to create .code_cm6/diagnostics');
    return { ok: false, dir: projectRoot };
  }

  return { ok: true, dir: target };
}

async function writeTextFileInProject(absPath, content) {
  const opId = `op_diag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    path: absPath,
    content: String(content ?? ''),
    client_id: clientId,
    op_id: opId,
  };
  const res = await apiPost('write', payload);
  if (res?.ok === false) {
    throw new Error(res?.error || 'Write failed');
  }
  return res;
}

async function exportDiagnosticsToFile() {
  if (!currentPath) {
    host.toast('Open a file first');
    return;
  }
  if (!cachedProjectRoot) {
    host.toast('No active project root');
    return;
  }

  let dump = null;
  try {
    dump = await _issuesDumpRequestOnce();
  } catch (err) {
    console.error('[Diagnostics Export] Failed to request dump:', err);
    host.toast(err?.message || 'Failed to gather diagnostics');
    return;
  }

  const projectRoot = String(cachedProjectRoot || '').replace(/\/+$/, '');
  const defaultDirRes = await _ensureDiagnosticsDir(projectRoot);
  const startDir = defaultDirRes.dir || projectRoot;
  const defaultName = buildDefaultDiagnosticsFilename(currentPath, projectRoot);

  if (!pickerAvailable()) { host.toast('File picker unavailable'); return; }

  let choice = null;
  try {
    choice = await window.teFilePicker.saveFile({
      title: 'Export Diagnostics',
      startPath: startDir,
      filename: defaultName,
      selectLabel: 'Save',
    });
  } catch (e) {
    if (e && e.message === 'cancelled') return;
    host.toast(e?.message || 'Export cancelled');
    return;
  }
  if (!choice || !choice.path) return;

  const targetAbs = toAbsolute(choice.path, null, HOME_DIR);
  if (!(targetAbs === projectRoot || targetAbs.startsWith(projectRoot + '/'))) {
    host.toast('Export path must be inside the project root');
    return;
  }
  if (choice.existed && !window.confirm('File exists. Overwrite?')) return;

  const payload = {
    exported_at: new Date().toISOString(),
    project_root: projectRoot,
    file_path: currentPath,
    dump: dump || {},
  };
  const text = JSON.stringify(payload, null, 2) + '\n';

  try {
    await writeTextFileInProject(targetAbs, text);
    host.toast(`Diagnostics exported: ${basename(targetAbs)}`);
  } catch (err) {
    console.error('[Diagnostics Export] Write failed:', err);
    host.toast(err?.message || 'Failed to write diagnostics file');
  }
}

const miNew       = requireEl('#mi-new');
const miOpen      = requireEl('#mi-open');
const miSave      = requireEl('#mi-save');
const miSaveAs    = requireEl('#mi-saveas');
const miClose     = requireEl('#mi-close');
const miQuit      = requireEl('#mi-quit');
const miDebugProjects = requireEl('#mi-debug-projects');

const miUndo      = requireEl('#mi-undo');
const miRedo      = requireEl('#mi-redo');
const miCut       = requireEl('#mi-cut');
const miCopy      = requireEl('#mi-copy');
const miPaste     = requireEl('#mi-paste');
const miSelectAll = requireEl('#mi-selectall');

const miToggleLines   = requireEl('#mi-toggle-lines');
const miToggleSyntax  = requireEl('#mi-toggle-syntax');
const miToggleCloseBrackets = requireEl('#mi-toggle-closebrackets');
const miToggleAutocomplete = requireEl('#mi-toggle-autocomplete');
const miToggleShading = requireEl('#mi-toggle-shading');
const miToggleIndentGuides = requireEl('#mi-toggle-indent-guides');
const miToggleWrap    = requireEl('#mi-toggle-wrap');
const miToggleAutosave = requireEl('#mi-toggle-autosave');
const miToggleDiffs  = requireEl('#mi-toggle-diffs');
const miToggleDraftDiffs = requireEl('#mi-toggle-draft-diffs');
const miToggleColorPicker = requireEl('#mi-toggle-color-picker');
const miToggleReadonly = requireEl('#mi-toggle-readonly');
const miToggleStickyScroll = requireEl('#mi-toggle-sticky-scroll');  // Added: 2025-12-03 by vectorArc - TE2 Team
const miTrackEdits   = requireEl('#mi-track-edits');
const miFind          = requireEl('#mi-find');
const miGoto          = requireEl('#mi-goto');
const miLanguageServers = requireEl('#mi-language-servers');  // Added: 2025-12-08 - LSP settings modal
const miExportDiagnostics = requireEl('#mi-export-diagnostics');
const miEditorSettings = requireEl('#mi-editor-settings');

// ---------- Editor Settings modal (VS Code API harness) ----------
const editorSettingsModal = requireEl('#editor-settings-modal');
const editorSettingsClose = requireEl('#editor-settings-close');
const editorSettingsMenuBtn = requireEl('#editor-settings-menu');
const editorSettingsVsixPath = requireEl('#editor-settings-vsix-path');
const editorSettingsVsixBrowse = requireEl('#editor-settings-vsix-browse');
const editorSettingsVsixInstall = requireEl('#editor-settings-vsix-install');
const editorSettingsThemeList = requireEl('#editor-settings-theme-list');
const editorSettingsExtList = requireEl('#editor-settings-ext-list');

const editorExtManagerModal = requireEl('#editor-ext-manager-modal');
const editorExtManagerClose = requireEl('#editor-ext-manager-close');
const editorExtManagerList = requireEl('#editor-ext-manager-list');

let vscodeApiWs = null;
let vscodeApiNextId = 1;
const vscodeApiPending = new Map();
let vscodeApiConnecting = null;
let workbenchAdapterConnecting = null;
let workbenchAdapterReadyOk = false;
const _sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function _feHostTs() {
  try {
    const t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? Math.round(performance.now() * 10) / 10
      : null;
    return (t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now();
  } catch (_) {
    return 'now=' + Date.now();
  }
}

async function ensureWorkbenchAdapterReady() {
  try {
    if (workbenchAdapterReadyOk) return;
    if (workbenchAdapterConnecting) return await workbenchAdapterConnecting;

    workbenchAdapterConnecting = (async () => {
      let ok = false;
      try {
        if (!window.__feLspSpinnerUi) {
          window.__feLspSpinnerUi = {
            lspShow: false,
            lspTitle: '',
            busyShow: false,
            busyTitle: '',
            busyLanguageId: '',
            busyActivity: '',
          };
        }
        const ui = window.__feLspSpinnerUi;
        ui.busyShow = true;
        ui.busyActivity = 'workbench_adapter';
        ui.busyTitle = 'Starting workbench adapter…';
        try { console.log(_feHostTs(), '[spinner] START request_id=- path=- reason=workbench_adapter_start'); } catch (_) {}
        _feUpdateLspSpinner();

        // Attach (idempotent HTTP): does not perturb an already-running adapter and
        // returns immediate readiness state so page refresh doesn't miss one-shot events.
        const attachResp = await fetch('/api/app/file_editor_cm6/workbench_adapter/attach', { cache: 'no-store' });
        const attachJson = await attachResp.json();
        if (!attachResp.ok || attachJson?.ok === false) {
          throw new Error(attachJson?.error || attachJson?.detail || `attach failed HTTP ${attachResp.status}`);
        }

        try {
          const st = attachJson && attachJson.data ? attachJson.data.state : '';
          if (st === 'ready') {
            ok = true;
          }
        } catch (_) {}

        // If not already ready, wait for adapter/ready via editor Socket.IO (relayed by diagnostics_bridge).
        if (!ok) {
          ok = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve(false);
            }, 30000);
            const handler = () => {
              clearTimeout(timeout);
              resolve(true);
            };
            if (editorSocket && editorSocket.connected) {
              editorSocket.once('editor:adapter_ready', handler);
            } else {
              // If socket isn't connected yet, also listen for when it connects.
              const checkInterval = setInterval(() => {
                if (editorSocket && editorSocket.connected) {
                  clearInterval(checkInterval);
                  editorSocket.once('editor:adapter_ready', handler);
                }
              }, 200);
              setTimeout(() => clearInterval(checkInterval), 30000);
            }
          });
        }
      } catch (e) {
        console.warn('[workbench_adapter] readiness failed', e);
      } finally {
        try {
          workbenchAdapterReadyOk = Boolean(ok);
          if (!window.__feLspSpinnerUi) return;
          const ui = window.__feLspSpinnerUi;
          // Always clean up adapter spinner if we own it or nobody else does.
          const ours = ui.busyActivity === 'workbench_adapter' || ui.busyActivity === '';
          if (ours) {
            ui.busyShow = false;
            ui.busyTitle = '';
            ui.busyActivity = '';
            try { console.log(_feHostTs(), '[spinner] STOP request_id=- path=- reason=workbench_adapter_' + (ok ? 'ready' : 'timeout')); } catch (_) {}
            try {
              if (window.__feLspSpinnerState && window.__feLspSpinnerState.hideTimer) {
                clearTimeout(window.__feLspSpinnerState.hideTimer);
                window.__feLspSpinnerState.hideTimer = null;
              }
              var _sp = document.getElementById('fe-lsp-spinner');
              if (_sp) { _sp.style.display = 'none'; _sp.title = ''; }
            } catch (_) {}
            _feUpdateLspSpinner();
          }
        } catch (_) {}
      }
      return ok;
    })();

    return await workbenchAdapterConnecting;
  } finally {
    try { workbenchAdapterConnecting = null; } catch (_) {}
  }
}

async function ensureVscodeApiWs() {
  if (vscodeApiWs && vscodeApiWs.readyState === WebSocket.OPEN) return vscodeApiWs;
  if (vscodeApiConnecting) return vscodeApiConnecting;

  vscodeApiConnecting = (async () => {
    const resp = await fetch('/api/app/file_editor_cm6/vscode_api/discover', { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || json?.detail || `discover failed HTTP ${resp.status}`);
    }
    const wsPath = json?.data?.ws_url || json?.ws_url;
    if (!wsPath) throw new Error('vscode_api discover missing ws_url');
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${wsPath}`;

    const ws = new WebSocket(wsUrl);
    vscodeApiWs = ws;

    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(String(ev.data || '')); } catch { return; }
      const handleOne = (m) => {
        const id = m && m.id;
        if (id == null) return;
        const pending = vscodeApiPending.get(id);
        if (!pending) return;
        vscodeApiPending.delete(id);
        if (m.error) pending.reject(new Error(m.error.message || 'jsonrpc error'));
        else pending.resolve(m.result);
      };
      if (Array.isArray(msg)) msg.forEach(handleOne);
      else handleOne(msg);
    };

    ws.onclose = () => {
      vscodeApiWs = null;
      vscodeApiConnecting = null;
      // Fail all pending calls quickly.
      for (const [, pending] of vscodeApiPending) {
        try { pending.reject(new Error('vscode_api ws closed')); } catch {}
      }
      vscodeApiPending.clear();
    };

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('vscode_api ws connect timeout')), 8000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('vscode_api ws error')); };
    });

    vscodeApiConnecting = null;
    return ws;
  })();

  return vscodeApiConnecting;
}

async function vscodeApiCall(method, params) {
  const ws = await ensureVscodeApiWs();
  const id = vscodeApiNextId++;
  const payload = { jsonrpc: '2.0', id, method, params: params || {} };
  const p = new Promise((resolve, reject) => {
    vscodeApiPending.set(id, { resolve, reject });
    // Hard timeout so modal never "hangs".
    setTimeout(() => {
      if (!vscodeApiPending.has(id)) return;
      vscodeApiPending.delete(id);
      reject(new Error(`vscode_api timeout: ${method}`));
    }, 12000);
  });
  ws.send(JSON.stringify(payload));
  return p;
}

function openEditorSettingsModal() {
  editorSettingsModal.classList.add('show');
  editorSettingsModal.setAttribute('aria-hidden', 'false');
  void refreshEditorSettingsModal();
}

function closeEditorSettingsModal() {
  editorSettingsModal.classList.remove('show');
  editorSettingsModal.setAttribute('aria-hidden', 'true');
}

editorSettingsClose.addEventListener('click', closeEditorSettingsModal);
editorSettingsModal.addEventListener('click', (ev) => {
  // click outside card closes
  if (ev.target === editorSettingsModal) closeEditorSettingsModal();
});
miEditorSettings.addEventListener('click', () => {
  closeAllMenus();
  openEditorSettingsModal();
});

function openEditorExtManagerModal() {
  editorExtManagerModal.classList.add('show');
  editorExtManagerModal.setAttribute('aria-hidden', 'false');
  void refreshEditorExtManagerModal();
}
function closeEditorExtManagerModal() {
  editorExtManagerModal.classList.remove('show');
  editorExtManagerModal.setAttribute('aria-hidden', 'true');
}
editorExtManagerClose.addEventListener('click', closeEditorExtManagerModal);
editorExtManagerModal.addEventListener('click', (ev) => {
  if (ev.target === editorExtManagerModal) closeEditorExtManagerModal();
});
editorSettingsMenuBtn.addEventListener('click', () => {
  openEditorExtManagerModal();
});

async function refreshEditorSettingsModal() {
  // Themes: use existing supported Monaco ids (SSOT is preference_store: editor.theme)
  // Extensions: list installed VSIXs (global pool) and allow per-project enablement (project sidecar).
  editorSettingsThemeList.textContent = 'Loading…';
  editorSettingsExtList.textContent = 'Loading…';

  let installed = [];
  let enabled = [];
  let vscodeThemes = [];
  try {
    const installedRes = await vscodeApiCall('vscode.vsix.listInstalled', {});
    installed = installedRes?.installed || [];
  } catch (e) {
    editorSettingsExtList.textContent = `Failed to load extensions: ${e?.message || 'unknown error'}`;
  }
  try {
    const enabledRes = await vscodeApiCall('vscode.vsix.listEnabled', {});
    enabled = enabledRes?.enabled || [];
  } catch (e) {
    // ok to keep enabled empty
  }
  try {
    const themesRes = await vscodeApiCall('vscode.themes.list', {});
    vscodeThemes = themesRes?.themes || [];
  } catch (e) {
    // ok: keep empty, still show built-ins
  }
  const enabledSet = new Set((enabled || []).map(String));

  const currentTheme = editorViewState?.theme || 'vs-dark';
  const themeOptions = [
    { id: 'te2-dark', label: 'TE2 Dark (GitHub-ish)' },
    { id: 'te2-light', label: 'TE2 Light (GitHub-ish)' },
    { id: 'te2-dracula', label: 'TE2 Dracula' },
    { id: 'github-dark-default', label: 'GitHub Dark Default' },
    { id: 'github-light-default', label: 'GitHub Light Default' },
    { id: 'atom-dark', label: 'Atom One Dark' },
    { id: 'atom-light', label: 'Atom One Light' },
    { id: 'one-dark-pro', label: 'One Dark Pro' },
    { id: 'darcula', label: 'Darcula' },
    { id: 'material-dark', label: 'Material Theme Dark' },
    { id: 'material-light', label: 'Material Theme Light' },
    { id: 'monokai-pro', label: 'Monokai Pro' },
    { id: 'vs-dark', label: 'VS Code Dark' },
    { id: 'vs', label: 'VS Code Light' },
  ];

  // Append VSIX-provided themes (global). Use a stable SSOT key:
  // `theme = "vscode:<extensionId>:<relPath>"`.
  try {
    (vscodeThemes || []).forEach((t) => {
      const tid = String(t?.id || '').trim();
      if (!tid) return;
      const label = String(t?.label || tid);
      const extId = String(t?.extensionId || '').trim();
      const suffix = extId ? ` — ${extId}` : '';
      themeOptions.push({
        id: `vscode:${tid}`,
        label: `${label}${suffix}`,
      });
    });
  } catch (_) {}

  editorSettingsThemeList.innerHTML = '';
  const themeWrap = document.createElement('div');
  themeWrap.style.display = 'grid';
  themeWrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  themeWrap.style.gap = '8px';

  themeOptions.forEach((t) => {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.padding = '8px 10px';
    row.style.border = '1px solid var(--border, #333)';
    row.style.borderRadius = '8px';
    row.style.cursor = 'pointer';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'te2-theme-radio';
    input.value = t.id;
    input.checked = String(currentTheme) === String(t.id);

    const text = document.createElement('div');
    text.textContent = t.label;
    text.style.flex = '1';

    row.appendChild(input);
    row.appendChild(text);

    input.addEventListener('change', async () => {
      if (!input.checked) return;
      const ok = await updatePreference('theme', t.id);
      if (!ok) host.toast('Failed to change theme');
      // Keep local view_state in sync for subsequent opens.
      try { editorViewState = editorViewState || {}; editorViewState.theme = t.id; } catch {}
    });

    themeWrap.appendChild(row);
  });
  editorSettingsThemeList.appendChild(themeWrap);

  // Extensions list (checkboxes)
  editorSettingsExtList.innerHTML = '';
  // Exclude *pure* theme packs from per-project enablement list.
  // IMPORTANT: most real language extensions contribute grammars; they must remain enable-able.
  const projectExtensions = (installed || []).filter((ext) => {
    try {
      const contributes = ext?.contributes || {};
      const themes = contributes?.themes;
      const iconThemes = contributes?.iconThemes;
      const productIconThemes = contributes?.productIconThemes;
      const grammars = contributes?.grammars;
      const languages = contributes?.languages;
      const commands = contributes?.commands;

      const hasThemes = Array.isArray(themes) && themes.length > 0;
      const hasIconThemes = Array.isArray(iconThemes) && iconThemes.length > 0;
      const hasProductIconThemes = Array.isArray(productIconThemes) && productIconThemes.length > 0;
      const hasGrammars = Array.isArray(grammars) && grammars.length > 0;
      const hasLanguages = Array.isArray(languages) && languages.length > 0;
      const hasCommands = Array.isArray(commands) && commands.length > 0;

      const onlyVisualThemes = (hasThemes || hasIconThemes || hasProductIconThemes) && !hasLanguages && !hasCommands && !hasGrammars;
      return !onlyVisualThemes;
    } catch (_) {
      return true;
    }
  });

  if (!projectExtensions.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.8';
    empty.textContent = installed.length ? 'No project-scoped extensions installed.' : 'No VSIX installed yet.';
    editorSettingsExtList.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '6px';

    projectExtensions
      .slice()
      .sort((a, b) => String(a.display_name || a.id).localeCompare(String(b.display_name || b.id)))
      .forEach((ext) => {
        const extId = String(ext.id || '').trim();
        if (!extId) return;
        const label = String(ext.display_name || extId);
        const desc = String(ext.description || '').trim();

        const row = document.createElement('label');
        row.style.display = 'flex';
        row.style.alignItems = 'flex-start';
        row.style.gap = '10px';
        row.style.padding = '8px 10px';
        row.style.border = '1px solid var(--border, #333)';
        row.style.borderRadius = '8px';
        row.style.cursor = 'pointer';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = enabledSet.has(extId);
        input.style.marginTop = '3px';

        const text = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = `${label} (${extId})`;
        title.style.fontWeight = '600';
        const sub = document.createElement('div');
        sub.textContent = desc || `v${ext.version || ''}`;
        sub.style.opacity = '0.8';
        sub.style.fontSize = '12px';
        text.appendChild(title);
        text.appendChild(sub);

        row.appendChild(input);
        row.appendChild(text);

        input.addEventListener('change', async () => {
          const want = !!input.checked;
          input.disabled = true;
          try {
            await vscodeApiCall(want ? 'vscode.vsix.enable' : 'vscode.vsix.disable', { id: extId });
            if (want) enabledSet.add(extId);
            else enabledSet.delete(extId);
          } catch (e) {
            host.toast(e?.message || 'Failed to update extension');
            input.checked = !want;
          } finally {
            input.disabled = false;
          }
        });

        list.appendChild(row);
      });

    editorSettingsExtList.appendChild(list);
  }
}

async function refreshEditorExtManagerModal() {
  editorExtManagerList.textContent = 'Loading…';
  let installed = [];
  try {
    const installedRes = await vscodeApiCall('vscode.vsix.listInstalled', {});
    installed = installedRes?.installed || [];
  } catch (e) {
    editorExtManagerList.textContent = `Failed to load: ${e?.message || 'unknown error'}`;
    return;
  }

  editorExtManagerList.innerHTML = '';
  if (!installed.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.8';
    empty.textContent = 'No VSIX installed yet.';
    editorExtManagerList.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';

  installed
    .slice()
    .sort((a, b) => String(a.display_name || a.id).localeCompare(String(b.display_name || b.id)))
    .forEach((ext) => {
      const extId = String(ext.id || '').trim();
      if (!extId) return;
      const label = String(ext.display_name || extId);
      const version = String(ext.version || '');
      const desc = String(ext.description || '').trim();
        const hasThemes = Array.isArray(ext?.contributes?.themes) && ext.contributes.themes.length > 0;
        const hasGrammars = Array.isArray(ext?.contributes?.grammars) && ext.contributes.grammars.length > 0;
        const hasLanguages = Array.isArray(ext?.contributes?.languages) && ext.contributes.languages.length > 0;
        const hasCommands = Array.isArray(ext?.contributes?.commands) && ext.contributes.commands.length > 0;
        const tags = [];
        if (hasThemes) tags.push('themes');
        if (hasGrammars) tags.push('grammars');
        if (hasLanguages) tags.push('languages');
        if (hasCommands) tags.push('commands');

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'flex-start';
      row.style.gap = '10px';
      row.style.padding = '10px 12px';
      row.style.border = '1px solid var(--border, #333)';
      row.style.borderRadius = '10px';

      const text = document.createElement('div');
      text.style.flex = '1';
      const title = document.createElement('div');
      title.textContent = `${label} (${extId})${version ? ` v${version}` : ''}`;
      title.style.fontWeight = '700';
      const sub = document.createElement('div');
      sub.textContent = desc || (tags.length ? tags.join(', ') : '');
      sub.style.opacity = '0.8';
      sub.style.fontSize = '12px';
      text.appendChild(title);
      text.appendChild(sub);

      const trash = document.createElement('button');
      trash.className = 'fe-btn fe-btn-secondary';
      trash.textContent = '🗑';
      trash.title = 'Uninstall';

      trash.addEventListener('click', async () => {
        if (!window.confirm(`Uninstall ${extId}?`)) return;
        trash.disabled = true;
        try {
          const res = await vscodeApiCall('vscode.vsix.uninstall', { id: extId });
          if (!res?.ok) throw new Error(res?.error || 'uninstall failed');

          // If the active theme belongs to the uninstalled extension, revert to te2-dark.
          try {
            const t = String(editorViewState?.theme || '');
            if (t.startsWith('vscode:') && t.slice('vscode:'.length).startsWith(extId + ':')) {
              await updatePreference('theme', 'te2-dark');
            }
          } catch (_) {}

          host.toast(`Uninstalled: ${extId}`);
          await refreshEditorExtManagerModal();
          await refreshEditorSettingsModal();
        } catch (e) {
          host.toast(e?.message || 'Uninstall failed');
        } finally {
          trash.disabled = false;
        }
      });

      row.appendChild(text);
      row.appendChild(trash);
      list.appendChild(row);
    });

  editorExtManagerList.appendChild(list);
}

editorSettingsVsixInstall.addEventListener('click', async () => {
  const p = String(editorSettingsVsixPath.value || '').trim();
  if (!p) {
    host.toast('Enter an absolute .vsix path');
    return;
  }
  editorSettingsVsixInstall.disabled = true;
  try {
    const res = await vscodeApiCall('vscode.vsix.installLocal', { path: p });
    if (!res?.ok) throw new Error(res?.error || 'VSIX install failed');
    host.toast(`Installed: ${res.installed?.id || 'ok'}`);
    editorSettingsVsixPath.value = '';
    await refreshEditorSettingsModal();
  } catch (e) {
    host.toast(e?.message || 'VSIX install failed');
  } finally {
    editorSettingsVsixInstall.disabled = false;
  }
});

editorSettingsVsixBrowse.addEventListener('click', async () => {
  const start = lastPickerPath || HOME_DIR;
  const picked = await pickFile(start);
  if (!picked) return;
  if (!picked.toLowerCase().endsWith('.vsix')) {
    host.toast('Not a .vsix file');
    return;
  }
  editorSettingsVsixPath.value = picked;
});

initVirtualKeyboardAdjustments({
  root,
  agentDrawer: agentDrawerEl,
  composer: agentComposer,
  transcript: agentTranscript,
  editorSurface: editorFrame,
});

async function fetchDiffPayload(path) {
  if (!path) return { hunks: [], summary: { tracked: false } };
  try {
    const resp = await fetch(`/api/app/file_editor_cm6/diff?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Diff request failed');
    }
    return json?.data || { hunks: [], summary: { tracked: true } };
  } catch (err) {
    console.error('Diff fetch failed:', err);
    return { hunks: [], summary: { tracked: false } };
  }
}

function handleDiffStatus(summary) {
  const current = statusEl.textContent || '';
  const isDiffLabel = current.startsWith('Δ ');

  if (!summary || summary.tracked === false || (!summary.added && !summary.deleted)) {
    statusEl.dataset.diffSummary = '';
    if (!unsaved && isDiffLabel) {
      statusEl.textContent = '';
    }
    return;
  }
  const label = `Δ +${summary.added || 0} −${summary.deleted || 0}`;
  statusEl.dataset.diffSummary = label;
  if (!unsaved && (isDiffLabel || !current)) {
    statusEl.textContent = label;
  }
}

const diffController = createDiffController({
  fetchDiff: fetchDiffPayload,
  onStatus: handleDiffStatus,
  getWordWrap: () => wordWrap,
});
window.__cm6Diff = diffController;

// ---------- Session telemetry ----------
async function fetchPersistedSessionState() {
  try {
    const resp = await fetch('/api/app/file_editor_cm6/session_state', { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Session state fetch failed');
    }
    persistedSessionSnapshot = json?.data || {};
    return persistedSessionSnapshot;
  } catch (err) {
    console.warn('Failed to load session telemetry:', err);
    persistedSessionSnapshot = null;
    return null;
  }
}

function initSessionStateContext(serverState) {
  const persisted = persistedSessionSnapshot || {};
  sessionState.activeProject = serverState?.activeProject || persisted.activeProject || null;
  sessionState.currentPath = persisted.currentPath || null;
  sessionState.unsaved = !!persisted.unsaved;
  sessionState.lastSha256 = persisted.lastSha256 || null;
  sessionState.updatedAt = persisted.updated_at || null;
  sessionStateInitialized = true;
}

function queueSessionStateUpdate(partial = null) {
  if (!sessionStateInitialized) return;
  if (partial && Object.keys(partial).length) {
    sessionState = { ...sessionState, ...partial };
  }
  sessionState.updatedAt = new Date().toISOString();
  if (sessionStateTimer) clearTimeout(sessionStateTimer);
  sessionStateTimer = setTimeout(() => flushSessionState(), 600);
}

async function flushSessionState(force = false) {
  if (!sessionStateInitialized) return;
  if (sessionStateTimer) {
    clearTimeout(sessionStateTimer);
    sessionStateTimer = null;
  } else if (!force) {
    // Nothing pending; skip.
    return;
  }
  try {
    await apiPost('session_state', sessionState);
  } catch (err) {
    console.warn('Failed to persist session telemetry:', err);
  }
}

function activeProjectPath() {
  return cachedProjectRoot || (editorState && editorState.activeProject) || sessionState.activeProject || null;
}

function syncSessionPath(extra = {}) {
  queueSessionStateUpdate({
    activeProject: activeProjectPath(),
    currentPath: currentPath || null,
    lastSha256,
    unsaved,
    ...extra,
  });
}

// ---------- Edit Tracker ----------
function connectEditTracker() {
  // Backend-only - no WebSocket needed
  // Just call the backend to enable edit tracking
  apiPost('editor/toggle_edit_tracking', { enabled: true })
    .then(() => console.log('[EditTracker] Enabled'))
    .catch(err => console.error('[EditTracker] Failed to enable:', err));
}

function disconnectEditTracker() {
  // Backend-only - no WebSocket needed
  apiPost('editor/toggle_edit_tracking', { enabled: false })
    .then(() => console.log('[EditTracker] Disabled'))
    .catch(err => console.error('[EditTracker] Failed to disable:', err));
}

function handleEditTrackerEvent(data) {
  if (data.event === 'tracking_status') {
    updateEditTrackerStatus(data);
  } else if (data.event === 'edit_tracked') {
    if (trackAgentEdits) {
      autoJumpToEdit(data.path, data.line);
    }
  }
}

function updateEditTrackerStatus(status) {
  if (status.active && status.shells && status.shells.length > 0) {
    const shellTypes = status.shells.map(s => s.type).join(', ');
    editTrackerStatusEl.textContent = `🤖 Tracking (${status.shells.length} ${shellTypes})`;
    editTrackerStatusEl.style.display = '';
  } else {
    editTrackerStatusEl.textContent = '';
    editTrackerStatusEl.style.display = 'none';
  }
}

async function autoJumpToEdit(path, line) {
  try {
    // Open file if not already open
    if (currentPath !== path) {
      await openFile(path);
    }
    
    // Wait 3 seconds for editor and file to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Scroll to line and flash highlight
    if (view && line > 0) {
      const docLines = view.state.doc.lines;
      if (line <= docLines) {
        const lineObj = view.state.doc.line(line);
        const pos = lineObj.from;
        
        // Scroll into view
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        
        // Flash highlight effect
        flashLine(line);
      }
    }
  } catch (e) {
    console.error('[EditTracker] Auto-jump failed:', e);
  }
}

function flashLine(lineNumber) {
  if (!view) return;
  
  const lineObj = view.state.doc.line(lineNumber);
  const flashDeco = CM.Decoration.line({ class: 'cm-edit-flash' });
  const decoSet = CM.RangeSetBuilder.of([flashDeco.range(lineObj.from)]);
  
  const flashField = CM.StateField.define({
    create: () => decoSet,
    update: (value) => value,
    provide: field => CM.EditorView.decorations.from(field),
  });
  
  // Add decoration
  view.dispatch({
    effects: CM.StateEffect.appendConfig.of(flashField),
  });
  
  // Remove after 1 second
  setTimeout(() => {
    try {
      view.dispatch({
        effects: CM.StateEffect.reconfigure.of([]),
      });
    } catch (e) {
      // Ignore if view is destroyed
    }
  }, 1000);
}

// ---------- small utils ----------
function simplifyAbsolute(path) {
  if (!path) return '/';
  const segments = [];
  const parts = String(path).split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (segments.length) segments.pop(); continue; }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

function toAbsolute(path, base, homeDir=HOME_DIR) {
  if (!path) return simplifyAbsolute(base || homeDir);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base || homeDir);
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return simplifyAbsolute(`${homeDir}/${value.slice(2)}`);
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = toAbsolute(base || homeDir, null, homeDir);
  return simplifyAbsolute(`${origin.replace(/\/+$/, '')}/${value}`);
}

function parentDir(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/' || abs === '') return '/';
  if (abs === HOME_DIR) return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx) || '/';
}

function basename(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/') return '/';
  const parts = abs.split('/');
  return parts[parts.length - 1] || '/';
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', pyw: 'python',
    kt: 'kotlin', kts: 'kotlin',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    ksh: 'shell', csh: 'shell', tcsh: 'shell',
    xml: 'xml', svg: 'xml',
  };
  return map[ext] || null;
}

function isRunnableFile(path) {
  if (!path) return false;
  const normalized = String(path).toLowerCase().trim();
  const idx = normalized.lastIndexOf('.');
  if (idx === -1) return false;
  const ext = normalized.slice(idx);
  return RUNNABLE_EXTENSIONS.has(ext);
}

function setMenuChecked(element, checked) {
  if (!element) return;
  element.classList.toggle('fe-menu-item-checked', !!checked);
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

function formatDisplayPath(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === HOME_DIR) return '~';
  if (abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`;
  return abs;
}

function formatDisplayDirectory(path) {
  const abs = toAbsolute(path || HOME_DIR);
  const dir = parentDir(abs);
  if (!dir || dir === abs) {
    return formatDisplayPath(abs);
  }
  return formatDisplayPath(dir);
}

// Font scale preset mapping
const FONT_SCALE_PRESETS = {
  small: 0.70,   // 85% user-facing (smaller than comfortable)
  medium: 0.85,  // 100% user-facing (comfortable baseline)
  large: 1.0     // 115% user-facing (back to browser default)
};

const RUNNABLE_EXTENSIONS = new Set(['.py', '.pyw', '.sh', '.bash', '.zsh', '.c', '.cc', '.cpp', '.cxx']);

function applyFontScale(scale) {
  // This function applies the selected font scale to the UI.
  // It updates the --chrome-font-scale CSS variable, which is used
  // by the stylesheet to resize UI elements like menus and the explorer.
  document.documentElement.style.setProperty('--chrome-font-scale', scale);
  
  // Update menu checkmarks
  updateFontScaleMenuChecks(scale);
  
  console.log(`[FontScale] Applied scale: ${scale}`);
}

function updateFontScaleMenuChecks(currentScale) {
  // This helper ensures the correct font size preset is checked in the menu.
  const items = {
    'mi-font-small': FONT_SCALE_PRESETS.small,
    'mi-font-medium': FONT_SCALE_PRESETS.medium,
    'mi-font-large': FONT_SCALE_PRESETS.large
  };
  
  for (const [id, scale] of Object.entries(items)) {
    const item = document.getElementById(id);
    if (item) {
      const isActive = Math.abs(scale - currentScale) < 0.01;
      item.classList.toggle('fe-menu-item-checked', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }
}

async function setFontScale(preset) {
  // This function orchestrates changing the font size. It applies the
  // new scale to the UI, sends the change to the backend to update the
  // editor iframe, and persists the setting for future sessions.
  const scale = FONT_SCALE_PRESETS[preset];
  if (!scale) {
    console.error(`[FontScale] Invalid preset: ${preset}`);
    return;
  }
  
  try {
    // 1. Update chrome immediately
    applyFontScale(scale);
    
    // 2. Update editor via backend and persist
    await updatePreference('fontScale', scale);
    
  } catch (error) {
    console.error('[FontScale] Failed to update:', error);
    host.toast('Failed to update font scale', 'error');
  }
}


// ---------- Editor state ----------
let view = null;
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;
let nativeSelectionActive = false; // No NiceGUI native selection tracking; keep flag for legacy guards
// Restored-session flags must exist before any socket events fire.
var restoredSessionActive = false;
var restoredSessionPath = null;

// Preferences are managed by backend; frontend displays state only (no caching)
let editorViewState = null; // Loaded from backend at startup via /editor/view_state

let currentModeLanguage = null;
let cachedProjectRoot = null;
let editorState = null;
let branchMenuHandle = null;
let agentDrawerHandle = null;
let sessionState = {
  activeProject: null,
  currentPath: null,
  unsaved: false,
  lastSha256: null,
  updatedAt: null,
};
let sessionStateInitialized = false;
let sessionStateTimer = null;
let persistedSessionSnapshot = null;
let externalRefreshInProgress = false;
let lastPickerPath = HOME_DIR;

// WebSocket and autosave state
let ws = null;
let wsKeepaliveTimer = null;
let editTrackerWS = null;
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let cm6NiceguiClientId = null;
let explorerRefreshTimer = null;
var lastSha256 = null;
// Keep early bootstrap handlers from hitting TDZ on debounce constants.
try {
  if (typeof window.__feCursorStateDebounceMs !== 'number') window.__feCursorStateDebounceMs = 1000;
} catch (_) {}
let inflightOpId = null;
let saveDebounceTimer = null;
const AUTOSAVE_IDLE_DELAY = 1200; // manual saves / disabled autosave
const AUTOSAVE_ACTIVE_DELAY = 450; // faster loop while autosave is ON
let lastSaveTime = 0;
const SELF_ECHO_GRACE = 1800; // 1.8s grace period after save (avoid cursor jumps on slow typing)

// Use `var` so early Socket.IO events can't hit TDZ before initialization.
var lastScrollState = null;
var scrollStateTimer = null;
const CURSOR_STATE_DEBOUNCE = 1000; // ms

function _feUpdateLspSpinner() {
  try {
    const spinner = document.getElementById('fe-lsp-spinner');
    if (!spinner) return;

    if (!window.__feLspSpinnerUi) {
      window.__feLspSpinnerUi = {
        lspShow: false,
        lspTitle: '',
        busyShow: false,
        busyTitle: '',
        busyLanguageId: '',
        busyActivity: '',
      };
    }
    const ui = window.__feLspSpinnerUi;

    const anyShow = Boolean(ui.lspShow || ui.busyShow);
    const title = ui.busyShow ? (ui.busyTitle || ui.lspTitle) : ui.lspTitle;

    // Anti-flicker: if we show, keep visible for a minimum window.
    const MIN_VISIBLE_MS = 650;
    const now = Date.now();
    if (!window.__feLspSpinnerState) {
      window.__feLspSpinnerState = { shownAtMs: 0, hideTimer: null };
    }
    const st = window.__feLspSpinnerState;

    if (anyShow) {
      if (st.hideTimer) {
        clearTimeout(st.hideTimer);
        st.hideTimer = null;
      }
      if (spinner.style.display === 'none') {
        spinner.style.display = 'inline-block';
        st.shownAtMs = now;
      } else if (!spinner.style.display) {
        spinner.style.display = 'inline-block';
        st.shownAtMs = now;
      }
      spinner.title = title || '';
      return;
    }

    // anyShow === false
    const elapsed = now - (st.shownAtMs || 0);
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (wait > 0) {
      if (st.hideTimer) return; // already scheduled
      st.hideTimer = setTimeout(() => {
        try {
          st.hideTimer = null;
          spinner.style.display = 'none';
          // Clear title on hide; otherwise stale titles (e.g. "Starting workbench adapter...")
          // persist and make debugging impossible.
          spinner.title = title || '';
        } catch { }
      }, wait);
      return;
    }

    spinner.style.display = 'none';
    spinner.title = title || '';
    try {
      const ui = window.__feLspSpinnerUi || {};
      const computed = (typeof getComputedStyle === 'function') ? getComputedStyle(spinner).display : '';
      if (computed && computed !== 'none') {
        console.log(_feHostTs(), '[spinner] WARN hide_failed anyShow=0 lspShow=' + (ui.lspShow ? '1' : '0') + ' busyShow=' + (ui.busyShow ? '1' : '0') + ' busyActivity=' + String(ui.busyActivity || '') + ' style=' + String(spinner.style.display || '') + ' computed=' + String(computed || '') + ' title=' + String(spinner.title || ''));
      }
    } catch (_) {}
  } catch { }
}

// No host↔iframe postMessage bridge: all editor telemetry uses /editor Socket.IO.
// The editor (Monaco) sends LSP status updates over the editor socket; this helper
// keeps the UI spinner + toast behavior consistent with the prior CM6 implementation.
function _feHandleLspStatusUpdate({ show, languageId, state, payload } = {}) {
  try {
    if (!window.__feLspSpinnerUi) {
      window.__feLspSpinnerUi = {
        lspShow: false,
        lspTitle: '',
        busyShow: false,
        busyTitle: '',
        busyLanguageId: '',
        busyActivity: '',
      };
    }
    const feSpinnerUi = window.__feLspSpinnerUi;

    feSpinnerUi.lspShow = Boolean(show);

    let title = 'Language server';
    if (languageId) title += ` (${languageId})`;
    if (state) title += `: ${state}`;
    if (payload && payload.error) title += ` — ${payload.error}`;
    feSpinnerUi.lspTitle = title;
    _feUpdateLspSpinner();

    // Toast behavior:
    // - Show "Loading <lang> LSP…" only if the spinner stays visible long enough (avoids spam for fast servers)
    // - Show "<lang> LSP loaded" once per successful connection attempt
    // - Always toast errors (best-effort)
    try {
      if (!window.__cm6LspUi) {
        window.__cm6LspUi = {
          activeLang: '',
          activeAttempt: 0,
          loadingToastTimer: null,
          loadingToastShown: false,
          lastReadyToastAt: 0,
        };
      }
      const ui = window.__cm6LspUi;

      const langLabel = languageId ? `${languageId} LSP` : 'Language server';

      const bumpAttempt = () => {
        ui.activeAttempt = (ui.activeAttempt || 0) + 1;
        return ui.activeAttempt;
      };

      // New attempt when we start connecting, or when language changes while spinner is visible.
      if (state === 'connecting' || (show && languageId && ui.activeLang && ui.activeLang !== languageId)) {
        ui.activeLang = languageId;
        ui.loadingToastShown = false;
        if (ui.loadingToastTimer) clearTimeout(ui.loadingToastTimer);
        const attemptId = bumpAttempt();
        ui.loadingToastTimer = setTimeout(() => {
          // Only show if still the same attempt and still loading.
          if (ui.activeAttempt !== attemptId) return;
          if (!feSpinnerUi || !feSpinnerUi.lspShow) return;
          if (ui.loadingToastShown) return;
          ui.loadingToastShown = true;
          host.toast(`Loading ${langLabel}…`, 2500);
        }, 650);
      }

      if (state === 'ready') {
        if (ui.loadingToastTimer) {
          clearTimeout(ui.loadingToastTimer);
          ui.loadingToastTimer = null;
        }
        const now = Date.now();
        // Avoid repeated "loaded" toasts if something chatters ready repeatedly.
        if (now - (ui.lastReadyToastAt || 0) > 1500) {
          // Only toast if we likely showed (or would have shown) a loading indicator.
          // This keeps the UI tidy for ultra-fast servers.
          if (ui.loadingToastShown || ui.activeLang === 'kotlin') {
            host.toast(`${langLabel} loaded`, 1800);
            ui.lastReadyToastAt = now;
          }
        }
        ui.loadingToastShown = false;
      }

      if (state === 'disconnected') {
        if (ui.loadingToastTimer) {
          clearTimeout(ui.loadingToastTimer);
          ui.loadingToastTimer = null;
        }
        ui.loadingToastShown = false;
      }

      if (state === 'error') {
        if (ui.loadingToastTimer) {
          clearTimeout(ui.loadingToastTimer);
          ui.loadingToastTimer = null;
        }
        ui.loadingToastShown = false;
        const msg =
          payload && payload.error ? String(payload.error) : `${langLabel} failed to initialize`;
        host.toast(msg, 4500);
      }
    } catch { }
  } catch { }
}

window.__cm6HandleLspStatusUpdate = _feHandleLspStatusUpdate;

async function triggerExternalRefresh(path) {
  if (externalRefreshInProgress) return;
  externalRefreshInProgress = true;
  try {
    console.log('[WATCHER] External edit detected; reloading', path);
    await openFile(path, { forceRefresh: true });
  } catch (err) {
    console.error('Failed to refresh after external edit:', err);
  } finally {
    externalRefreshInProgress = false;
  }
}

// Disabled - CM6 editor replaced with NiceGUI iframe
/*
function makeExtensions() {
  const exts = [
    history(),
    search(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    highlightActiveLine(),
    emptyLineAnchorExtension, // Add the compartment for empty line anchors
  ];
  if (showLineNumbers) exts.push(lineNumbers(), highlightActiveLineGutter());
  if (showSyntaxHighlight && defaultHighlightStyle) {
    exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));
  }
  if (wordWrap) {
    exts.push(EditorView.lineWrapping);
  }
  if (showLineShading) {
    exts.push(zebraStripes);
  }
  if (autoCloseBrackets && CM.closeBrackets) {
    exts.push(CM.closeBrackets());
  }
  if (enableAutocompletion && CM.autocompletion) {
    exts.push(CM.autocompletion());
  }
  
  // Disable CM6's native double-click word selection (conflicts with our native selection)
  exts.push(EditorView.domEventHandlers({
    dblclick: (event, view) => {
      event.preventDefault();
      return true; // Mark as handled
    }
  }));

  // Theme
  const theme = THEMES[currentTheme] || THEMES['cm6-dark'];
  if (theme) exts.push(theme);

  if (diffController?.extension) {
    exts.push(diffController.extension);
  }

  // Language
  if (showSyntaxHighlight) {
    const lang = (currentModeLanguage || 'text');
    switch (lang) {
      case 'javascript': exts.push(javascript()); break;
      case 'json': exts.push(jsonLang()); break;
      case 'python': exts.push(python()); break;
      case 'html': exts.push(htmlLang()); break;
      case 'css': exts.push(cssLang()); break;
      case 'markdown': exts.push(markdown()); break;
      case 'xml': exts.push(xmlLang()); break;
      case 'shell': { const s = shellLang(); if (s) exts.push(s); } break;
      default: break;
    }
  }
  return exts;
}
*/

function createView(docText='') {
  // Disabled: CM6 editor replaced with NiceGUI iframe
  console.log('[CM6] createView() disabled - using NiceGUI iframe instead');
}

function getText() { return ''; } // Stub: content is in iframe (legacy code still calls this)
function setText(t) { console.log('[CM6] setText() disabled'); }

function markUnsaved(flag) {
  const next = !!flag;
  cacheStateBadge.dataset.state = next ? (cacheStateBadge.dataset.state || '') : '';
  unsaved = next;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
  syncSessionPath();
  if (!unsaved && saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  if (unsaved && editorViewState?.autoSave) {
    scheduleAutosave();
  }
}

// ---------- API helpers ----------
async function apiGet(path) {
  const data = await api.get(path);
  // framework returns either raw or {ok,data}; normalize:
  return data.content ? data : (data.data || data);
}
async function apiPost(path, body) {
  try {
    const res = await api.post(path, body);
    return res?.data || res || {};
  } catch (error) {
    console.error(`[apiPost] Error calling ${path}:`, error);
    return {};
  }
}

// Live draft/autosave propagation is handled by the dedicated editor Socket.IO channel.

async function triggerEditorSearchPanel(reason = 'menu', opts = {}) {
  const action = opts && opts.replace ? 'replace' : 'find';
  if (editorSocket && editorSocket.connected) {
    editorSocket.emit('editor_find_cmd', { action, reason });
    return;
  }
  const payload = {
    path: currentPath || null,
    project: cachedProjectRoot || null,
    reason,
  };
  const result = await apiPost('editor/search/open', payload);
  if (result?.ok === false) {
    const message = result?.error || 'Search unavailable';
    host.toast(message);
  }
}

// ---------- Unified Preference Management (Backend as Single Source of Truth) ----------

async function fetchEditorState() {
  // Query backend for current editor state (for menu checkmarks only)
  try {
    const resp = await fetch('/api/app/file_editor_cm6/editor/view_state', { cache: 'no-store' });
    const json = await resp.json();
    return json?.data || null;
  } catch (err) {
    console.error('[EditorState] Failed to fetch:', err);
    return null;
  }
}

async function updatePreference(key, value) {
  // Send preference change to backend; backend handles persistence + application
  // Returns full state in single round trip (Jimmy's optimization)
  try {
    console.log('[Preference] updatePreference request', key, value);
    const body = { key, value };
    if (cm6NiceguiClientId) body.nicegui_client_id = cm6NiceguiClientId;
    const resp = await apiPost('editor/update_preference', body);
    
    // apiPost already unwraps the response (returns res.data)
    // Backend sends {ok: true, data: {...}}, apiPost returns the data object
    if (resp && typeof resp === 'object' && Object.keys(resp).length > 0) {
      // resp is the state object (not wrapped in {ok, data})
      editorViewState = resp; // Update state BEFORE applying (fixes minimap toggle inversion)
      applyStateToMenus(resp);
      console.log('[Preference] updatePreference applied', key, value);
      return true;
    }
    
    // Empty response or error
    console.error(`[Preference] Update ${key} failed: empty or invalid response`, resp);
    return false;
  } catch (err) {
    console.error(`[Preference] Failed to update ${key}:`, err);
    return false;
  }
}

// Cross-client preference sync: other connected host shells apply immediately when
// the backend broadcasts editor:prefs_changed on the explorer bus.
window.__cm6HandlePrefsChanged = function(payload) {
  try {
    const viewState = payload && typeof payload === 'object'
      ? (payload.view_state || payload.viewState || null)
      : null;
    if (!viewState || typeof viewState !== 'object') return;

    // Ignore self-echo (originating host that initiated the preference change).
    try {
      if (payload.source_client && cm6NiceguiClientId && String(payload.source_client) === String(cm6NiceguiClientId)) {
        return;
      }
    } catch (_) {}

    editorViewState = viewState;
    applyStateToMenus(viewState);
  } catch (err) {
    console.warn('[PrefsSync] Failed to apply prefs_changed:', err);
  }
};

try {
  if (window.__cm6PendingPrefsChanged) {
    window.__cm6HandlePrefsChanged(window.__cm6PendingPrefsChanged);
    window.__cm6PendingPrefsChanged = null;
  }
} catch (_) {}

async function refreshMenuState() {
  // Query backend for current state and update menu checkmarks
  const state = await fetchEditorState();
  if (!state) return;
  
  applyStateToMenus(state);
  editorViewState = state;
}

function applyStateToMenus(state) {
  // Update all menu checkmarks from backend state
  setMenuChecked(miToggleLines, state.showLineNumbers);
  setMenuChecked(miToggleSyntax, state.showSyntax);
  setMenuChecked(miToggleCloseBrackets, state.autoCloseBrackets);
  setMenuChecked(miToggleAutocomplete, state.autocompletion);
  setMenuChecked(miToggleShading, state.showShading);
  setMenuChecked(miToggleIndentGuides, state.showIndentGuides);
  setMenuChecked(miToggleWrap, state.wordWrap);
  setMenuChecked(miToggleAutosave, state.autoSave);
  setMenuChecked(miToggleDiffs, state.showInlineDiffs);
  setMenuChecked(miToggleDraftDiffs, state.showDraftDiffs);
  setMenuChecked(miToggleColorPicker, state.colorPicker);
  setMenuChecked(miToggleReadonly, state.readOnly);
  setMenuChecked(miToggleMinimap, state.showMinimap);
  setMenuChecked(miToggleStickyScroll, state.stickyScroll);  // Added: 2025-12-03 by vectorArc - TE2 Team
  setMenuChecked(miTrackEdits, state.trackAgentEdits);
  
  // Apply font scale to UI
  applyFontScale(state.fontScale ?? 0.85);
}

function broadcastRecentsUpdate(state) {
  if (!state) {
    return;
  }
  window.__cm6EditorState = state;
  if (typeof window.__cm6RefreshRecents === 'function') {
    try {
      window.__cm6RefreshRecents(state);
    } catch (err) {
      console.error('Failed to refresh recents dropdown:', err);
    }
  }
  window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: state }));
}

/**
 * Populate the recents dropdown from state.recents.
 * Called by broadcastRecentsUpdate whenever editor state changes.
 */
window.__cm6RefreshRecents = function(state) {
  const recents = state?.recents || [];
  
  // Clear existing dropdown content
  recentFilesDD.innerHTML = '';
  
  if (!recents.length) {
    recentFilesBtn.disabled = true;
    const emptyItem = document.createElement('div');
    emptyItem.className = 'fe-dd-item fe-dd-item--disabled';
    emptyItem.textContent = 'No recent files';
    recentFilesDD.appendChild(emptyItem);
    return;
  }
  
  recentFilesBtn.disabled = false;
  
  recents.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'fe-dd-item';
    if (!entry.exists) {
      item.classList.add('fe-dd-item--missing');
    }
    
    const label = entry.label || entry.path || '(unknown)';
    const path = entry.path || '';
    
    // Show label, with path as tooltip
    item.textContent = formatFileNameDisplay(label);
    item.title = path;
    
    // Store scroll position if available (for per-file scroll restore)
    const scrollLine = entry.scroll_line || entry.scrollLine || null;
    
    item.addEventListener('click', async () => {
      recentFilesDD.classList.remove('show');
      if (!entry.exists) {
        console.warn('[Recents] File does not exist:', path);
        return;
      }
      try {
        // Open the file - openFile() now handles scroll restoration automatically
        await openFile(path);
        // Note: scroll restoration is now handled by openFile() with offset=5
        // No separate jump needed here
      } catch (err) {
        console.error('[Recents] Failed to open file:', err);
      }
    });
    
    recentFilesDD.appendChild(item);
  });
};

// Synchronize host + iframe when a project is opened in the explorer.
// Called from explorer.js via window.__cm6HandleProjectOpened(path).
async function handleProjectOpened(newProjectPath) {
  // If the terminal drawer is open, shut it down first so it doesn't try to
  // auto-rebind shells during a hot project switch.
  try {
    if (terminal && typeof terminal.closeAndDisconnect === 'function') {
      terminal.closeAndDisconnect();
    }
  } catch (err) {
    console.warn('[ProjectSwitch] Failed to close terminal drawer:', err);
  }

  // Reset host-side editor/file state so we don't keep editing a file
  // from the previous project while the backend has already switched.
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath = '';
  currentPathExists = false;
  lastSha256 = null;
  lastSavedContent = '';
  setText('');
  markUnsaved(false);
  updatePathDisplay();
  syncSessionPath();

  // Ensure the worker process updates its active project before iframe reload.
  try {
    await fetch('/api/app/file_editor_cm6/editor/set_active_project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: newProjectPath }),
    });
  } catch (err) {
    console.warn('[ProjectSwitch] Failed to sync worker project root:', err);
  }

  // Refresh state snapshot so cachedProjectRoot, recents, and git base reflect
  // the new active project.
  const newState = await syncEditorState(true);

  // Notify agent host about the new project root (updates conversation list).
  try {
    const root = newState?.activeProject || newProjectPath || '';
    const rootAbs = root ? String(root).replace(/\/+$/, '') : '';
    await pushAgentHostCwd(rootAbs);
  } catch (err) {
    console.warn('[ProjectSwitch] Failed to push agent cwd:', err);
  }
  
  // Update recents dropdown with new project's recents
  broadcastRecentsUpdate(newState);
  
  // Refresh branch menu to show new project's branches
  if (branchMenuHandle && typeof branchMenuHandle.refresh === 'function') {
    try {
      branchMenuHandle.refresh();
    } catch (err) {
      console.warn('[ProjectSwitch] Failed to refresh branch menu:', err);
    }
  }

  // Reload the NiceGUI iframe so editor_page() re-runs under the new project.
  try {
    if (editorFrame && editorFrame.contentWindow && editorFrame.contentWindow.location) {
      editorFrame.contentWindow.location.reload();
    } else if (editorFrame) {
      // Fallback: bump src to force a reload.
      editorFrame.src = editorFrame.src;
    }
  } catch (err) {
    console.warn('[ProjectSwitch] Failed to reload editor iframe:', err);
  }
}

// Expose for explorer.js (project:opened handler)
window.__cm6HandleProjectOpened = handleProjectOpened;

async function syncEditorState(forceRefresh = false) {
  if (!forceRefresh && editorState) {
    return editorState;
  }
  try {
    const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
    const json = await resp.json();
    editorState = json?.data || {};
    cachedProjectRoot = editorState.activeProject || null;
    window.__cm6EditorState = editorState;
    return editorState;
  } catch (err) {
    console.error('Failed to fetch editor state:', err);
    editorState = null;
    cachedProjectRoot = null;
    window.__cm6EditorState = null;
    return null;
  }
}

window.__cm6SyncState = syncEditorState;

// Expose function to reload current file (for git operations)
window.__cm6ReloadCurrentFile = async function() {
  if (currentPath) {
    await openFile(currentPath, { allowOverwrite: true, forceRefresh: true });
  }
};

window.__cm6EnsureInlineDiffs = async function ensureInlineDiffsEnabled(forceOn = true) {
  if (!forceOn) {
    return true;
  }
  if (editorViewState?.showInlineDiffs) {
    return true;
  }
  try {
    return await updatePreference('showInlineDiffs', true);
  } catch (err) {
    console.warn('Auto-enable inline diffs failed:', err);
    return false;
  }
};

window.__cm6EnsureDraftDiffs = async function ensureDraftDiffsEnabled(forceOn = true) {
  if (!forceOn) {
    return true;
  }
  if (editorViewState?.showDraftDiffs) {
    return true;
  }
  try {
    return await updatePreference('showDraftDiffs', true);
  } catch (err) {
    console.warn('Auto-enable draft diffs failed:', err);
    return false;
  }
};

// Expose currentPath getter
Object.defineProperty(window, 'currentPath', {
  get: () => currentPath,
  set: (value) => { currentPath = value; },
  configurable: true
});

async function ensureProjectContext() {
  const state = await syncEditorState(!cachedProjectRoot);
  if (!state || !state.activeProject || !state.activeProjectExists) {
    return null;
  }
  cachedProjectRoot = state.activeProject;
  return state;
}

// ---------- WebSocket management ----------
function closeWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  if (wsKeepaliveTimer) {
    clearInterval(wsKeepaliveTimer);
    wsKeepaliveTimer = null;
  }
}

async function openWebSocket(path) {
  closeWebSocket();
  if (!path) return;

  let wsUrl;
  try {
    if (!window.wsPort || typeof window.wsPort.buildWsUrl !== 'function') {
      throw new Error('wsPort helper unavailable');
    }
    wsUrl = await window.wsPort.buildWsUrl('file_editor_cm6', path, clientId);
  } catch (err) {
    console.error('Failed to resolve WebSocket URL:', err);
    statusEl.textContent = 'WebSocket unavailable';
    setTimeout(() => {
      if (statusEl.textContent === 'WebSocket unavailable') {
        statusEl.textContent = '';
      }
    }, 2000);
    return;
  }

  try {
    ws = new ReconnectingWebSocket(wsUrl, {
      maxRetries: 20,
      reconnectInterval: 1000,
      maxReconnectInterval: 10000,
      reconnectDecay: 1.3,
      debug: false
    });
  } catch (err) {
    console.error('Failed to open WebSocket:', err);
    statusEl.textContent = 'WebSocket unavailable';
    setTimeout(() => {
      if (statusEl.textContent === 'WebSocket unavailable') {
        statusEl.textContent = '';
      }
    }, 2000);
    return;
  }

  ws.onopen = () => {
    console.log('WebSocket connected for:', path);
    if (!wsKeepaliveTimer) {
      wsKeepaliveTimer = setInterval(() => {
        try {
          if (ws && ws.readyState === 1) ws.send('ping');
        } catch (_) {}
      }, 15000);
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
    if (wsKeepaliveTimer) {
      clearInterval(wsKeepaliveTimer);
      wsKeepaliveTimer = null;
    }
  };
  
  ws.onreconnect = (attempt, delay) => {
    console.log(`[FileRead] Reconnecting (attempt ${attempt}) in ${delay}ms...`);
  };
}

function handleWSMessage(msg) {
  const type = msg.type;

  if (type === 'replace_full') {
    // Check if we're in grace period after save
    const timeSinceSave = Date.now() - lastSaveTime;
    const isInGracePeriod = inflightOpId || timeSinceSave < SELF_ECHO_GRACE;

    if (isInGracePeriod) {
      console.log('Ignoring replace_full during grace period');
      return;
    }

    if (msg.path) {
      const normalized = toAbsolute(msg.path, null, HOME_DIR);
      if (normalized !== currentPath) {
        currentPath = normalized;
        updatePathDisplay();
      }
    }

    // Update editor content
    const newContent = msg.content || '';
    if (getText() !== newContent) {
      setText(newContent);
      lastSavedContent = newContent;
      lastSha256 = msg.sha256 || null;
      markUnsaved(false);
      statusEl.textContent = 'Updated from disk';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 2000);
      diffController.invalidateCacheForPath(currentPath);
      diffController.setContext({ path: currentPath, sha: lastSha256 });
      if (editorViewState?.showInlineDiffs) {
        diffController.refresh(true);
      }
    }
  } else if (type === 'save_ack') {
    if (msg.op_id === inflightOpId) {
      inflightOpId = null;
      lastSha256 = msg.meta?.sha256 || lastSha256;
      statusEl.textContent = 'Saved';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
    }
  } else if (type === 'diff_changed') {
    if (diffController && editorViewState?.showInlineDiffs && currentPath) {
      diffController.invalidateCacheForPath(currentPath);
      diffController.refresh(true);
    }
  }
}

function scheduleExplorerRefresh() {
  if (explorerRefreshTimer) {
    clearTimeout(explorerRefreshTimer);
  }
  explorerRefreshTimer = setTimeout(() => {
    if (typeof window.__cm6RefreshExplorer === 'function') {
      window.__cm6RefreshExplorer().catch(err => {
        console.error('Failed to refresh explorer:', err);
      });
    }
  }, 500);
}

// ---------- File ops ----------
function updateRunButtonState() {
  if (!runActiveBtn) return;
  const runnable = Boolean(currentPath && currentPathExists && isRunnableFile(currentPath));
  runActiveBtn.disabled = !runnable;
  runActiveBtn.title = runnable ? 'Run active file in terminal' : 'Open a Python, shell, or C/C++ source file to enable running';
}

function updatePathDisplay() {
  const badge = document.getElementById('fe-file-draft-badge');
  if (!currentPath) {
    setToolbarFileName('Untitled');
    if (badge) setIndicatorInactive(badge);
    setIssuesButtonsEnabled(false);
    updateRunButtonState();
    return;
  }
  const abs = toAbsolute(currentPath, null, HOME_DIR);
  setToolbarFileName(basename(abs));
  if (badge) setIndicatorInactive(badge); // Reset to grey default
  setIssuesButtonsEnabled(true);
  updateRunButtonState();
}

async function handleDiscardClick(e) {
  e.stopPropagation();
  e.preventDefault();
  
  const project = cachedProjectRoot || (await getCurrentProjectRoot());
  if (!project) {
    host.toast('Cannot discard: Project root unknown');
    return;
  }

  // Instant discard - no confirmation
  try {
    const url = `session_cache?project=${encodeURIComponent(project)}&path=${encodeURIComponent(currentPath)}`;
    await api.delete(url);
    
    // Reload file to reset content to disk version
    await openFile(currentPath, { forceRefresh: true });
    host.toast('Draft discarded');
  } catch (err) {
    host.toast('Failed to discard draft');
    console.error(err);
  }
}

function setIndicatorActive(badge, char) {
  badge.textContent = char;
  badge.style.color = '#ff4444'; // Red
  badge.style.cursor = 'pointer';
  badge.title = 'Unsaved draft available. Click to discard.';
  badge.onclick = handleDiscardClick;
  badge.style.display = 'inline-block';
}

function setIndicatorInactive(badge) {
  // Respect global restored flag - do not clear if we are holding a draft
  if (restoredSessionActive) return;

  badge.textContent = '*';
  badge.style.color = '#666'; // Grey
  badge.style.cursor = 'default';
  badge.title = 'No unsaved draft';
  badge.onclick = null;
  badge.style.display = 'inline-block';
}

function _applyCacheIndicatorImpl(info) {
  const badge = document.getElementById('fe-file-draft-badge');
  if (!badge) return;

  if (!info) {
    setIndicatorInactive(badge);
    return;
  }

  const { state, unsaved, reason, restoredActive } = info;
  
  // Logic to determine if we should show RED (Active)
  const isCrashed = (state === 'crashed');
  const isRestored = (state === 'mid_session' && (reason === 'restore' || restoredActive));
  const isActiveDraft = (state === 'mid_session' && unsaved);

  if (isCrashed || isRestored || isActiveDraft) {
    setIndicatorActive(badge, isCrashed ? '!' : '*');
    badge.dataset.state = isCrashed ? 'crashed' : (isRestored ? 'restored' : 'cached');
    markUnsaved(true);
  } else {
    // Only turn inactive if we are NOT holding a restored session
    // This protects against race conditions where 'clean' arrives after 'restore'
    if (!restoredSessionActive) {
      setIndicatorInactive(badge);
      badge.dataset.state = '';
      markUnsaved(false);
    }
  }
}

// Install the real implementation and replay any pending payload.
applyCacheIndicator = _applyCacheIndicatorImpl;
window.applyCacheIndicator = applyCacheIndicator;
try {
  if (window.__fePendingCacheIndicator) {
    applyCacheIndicator(window.__fePendingCacheIndicator);
    window.__fePendingCacheIndicator = null;
  }
} catch (_) {}

async function openFile(path, options = {}) {
  const { allowOverwrite = true, forceRefresh = false } = options;
  if (!path) throw new Error("Path is empty");
  statusEl.textContent = "Opening...";
  
  const projectState = await ensureProjectContext();
  if (!projectState || !projectState.activeProject || !projectState.activeProjectExists) {
    statusEl.textContent = "";
    host.toast(projectState?.activeProjectMessage || "Select a project before opening files.");
    return;
  }

  try {
    const resolvedTarget = toAbsolute(path, null, HOME_DIR);
    if (!forceRefresh && !allowOverwrite && restoredSessionActive && currentPath && resolvedTarget === currentPath) {
      console.log("[Editor] Skipping host-side open; restored session buffer already loaded");
      statusEl.textContent = "";
      return;
    }
    
    // Reset indicator for new file load
    restoredSessionActive = false;
    setIndicatorInactive(cacheStateBadge);

    let contentPayload;
    let hasDraft = false;
    
    try {
        const check = await apiPost("editor/check_cache", { path: resolvedTarget });
        if (check && check.ok && check.has_draft) {
            contentPayload = {
                path: resolvedTarget,
                content: check.content,
                sha256: check.base_sha256
            };
            hasDraft = true;
            console.log("[Editor] Opening cached draft for", resolvedTarget);
        }
    } catch (e) { console.warn("Cache check failed", e); }
    
    if (!contentPayload) {
        contentPayload = await apiGet(`read?path=${encodeURIComponent(path)}`);
    }
    const payload = contentPayload;

    const resolved = toAbsolute(payload.path || path, null, HOME_DIR);
    currentPath = resolved;
    currentPathExists = true;
    lastPickerPath = parentDir(resolved);
    currentModeLanguage = detectLanguageFromFilename(resolved);

    // Initialize SHA256 if provided
    lastSha256 = payload.sha256 || null;

    // Tell the editor runtime to open the file via the dedicated editor Socket.IO channel.
    try {
      const msg = { type: 'editor_open_request', payload: { path: resolved } };
      if (editorSocket && editorSocket.connected) {
        editorSocket.emit(msg.type, msg.payload);
      } else {
        editorPending.push(msg);
      }
    } catch (e) {
      console.warn("[Editor] Failed to request open via editor socket:", e);
    }

    setText(payload.content || "");
    lastSavedContent = getText();
    markUnsaved(false);
    updatePathDisplay();
    syncSessionPath();
    statusEl.textContent = "";

    // Notify explorer of the active file (fast-path; backend seeds from HistoryStore on connect).
    try {
      if (typeof window.__explorerBusDispatch === 'function') {
        const projectRoot = projectState.activeProject || cachedProjectRoot || null;
        const rootAbs = projectRoot
          ? toAbsolute(projectRoot, null, HOME_DIR).replace(/\/+$/, '')
          : null;
        let rel = null;
        if (rootAbs && resolved.startsWith(rootAbs + '/')) {
          rel = resolved.slice(rootAbs.length + 1);
        }
        window.__explorerBusDispatch('explorer:activeFile', { rel });
      }
    } catch (e) {
      // Ignore explorer notification errors.
    }

    // Open WebSocket for this file
    openWebSocket(resolved);
    diffController.setContext({ path: resolved, sha: lastSha256 });
    if (editorViewState?.showInlineDiffs) {
      diffController.refresh(true);
    }

    // Update persisted editor state (last file + recents)
    // The returned entry includes scroll_line if previously stored
    let scrollLineToRestore = null;
    try {
      const activity = await apiPost("state/file_activity", {
        path: resolved,
        project: cachedProjectRoot || projectState.activeProject,
      });
      if (activity?.data?.entry?.scroll_line) {
        scrollLineToRestore = activity.data.entry.scroll_line;
      }
      if (activity?.state || activity?.data?.state) {
        editorState = activity.state || activity.data.state;
        cachedProjectRoot = editorState.activeProject || cachedProjectRoot;
        broadcastRecentsUpdate(editorState);
        syncSessionPath();
      } else {
        // Fallback to a fresh pull if the payload lacked state
        const refreshed = await syncEditorState(true);
        if (refreshed) {
          broadcastRecentsUpdate(refreshed);
          sessionState.activeProject = refreshed.activeProject || sessionState.activeProject;
          syncSessionPath();
        }
      }
    } catch (err) {
      console.error("Failed to record file activity:", err);
    }

    // Restore scroll position if we have one stored for this file
    // Use scrollToTop to position line at viewport top (symmetrical with recording)
    if (scrollLineToRestore && scrollLineToRestore > 1) {
      setTimeout(() => {
        console.log("[Editor] Restoring scroll to line", scrollLineToRestore);
        jumpToCurrentFileLine(scrollLineToRestore, { focus: false, scrollToTop: true });
      }, 150); // Small delay to let editor render
    }
  } catch (e) {
    statusEl.textContent = "";
    host.toast(`Failed to open: ${e.message}`);
    throw e;
  }
}

async function doSave(targetPath, content) {
  const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  inflightOpId = opId;
  lastSaveTime = Date.now();

  const payload = {
    path: targetPath,
    content: content,
    client_id: clientId,
    op_id: opId
  };

  if (lastSha256) {
    payload.base = { sha256: lastSha256 };
  }

  try {
    const result = await apiPost('write', payload);
    lastSha256 = result.sha256 || lastSha256;
    lastSavedContent = content;
    markUnsaved(false);
    syncSessionPath();
    return { success: true, result };
  } catch (e) {
    inflightOpId = null;

    // Handle 409 conflict
    if (e.status === 409 || (e.response && e.response.error === 'BASE_MISMATCH')) {
      // Try to fetch latest and rebase once
      try {
        const latest = await apiGet(`read?path=${encodeURIComponent(targetPath)}`);
        lastSha256 = latest.sha256 || null;

        // Simple rebase: if our changes conflict, ask user
        if (window.confirm('File was modified externally. Retry save and overwrite?')) {
          // Retry once without base check (force overwrite)
          const retryPayload = {
            path: targetPath,
            content: content,
            client_id: clientId,
            op_id: `${opId}_retry`
          };
          const retryResult = await apiPost('write', retryPayload);
          lastSha256 = retryResult.sha256 || lastSha256;
          lastSavedContent = content;
          markUnsaved(false);
          return { success: true, result: retryResult };
        } else {
          return { success: false, error: 'Conflict - user cancelled' };
        }
      } catch (retryErr) {
        return { success: false, error: `Conflict resolution failed: ${retryErr.message}` };
      }
    }

    return { success: false, error: e.message };
  }
}

function saveFileViaEditorSocket(payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!editorSocket || !editorSocket.connected) {
      reject(new Error('Editor socket not connected'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Save timed out'));
    }, timeoutMs);
    editorSocket.emit('editor_save_request', payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}
 // getAgentHostBase
async function saveFile() {
  if (!currentPath || !currentPathExists) return saveAsDialog();
  statusEl.textContent = 'Saving...';

  const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const payload = {
    path: currentPath,
    client_id: clientId,
    op_id: opId,
  };
  if (lastSha256) payload.base_sha256 = lastSha256;

  try {
    const result = await saveFileViaEditorSocket(payload);

    if (!result || typeof result !== 'object') {
      throw new Error('Invalid save response');
    }
    if (result.ok === false) {
      if (result.error === 'BASE_MISMATCH') {
        if (window.confirm('File was modified externally. Retry save and overwrite?')) {
          const retryPayload = {
            path: currentPath,
            client_id: clientId,
            op_id: `${opId}_retry`,
            force: true,
          };
          const retryResult = await saveFileViaEditorSocket(retryPayload);
          if (retryResult && retryResult.ok) {
            const fileMeta = retryResult.data || {};
            lastSha256 = fileMeta.sha256 || lastSha256;
            lastSavedContent = getText();
            markUnsaved(false);
            statusEl.textContent = 'Saved';
            setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
            return true;
          }
        }
        statusEl.textContent = '';
        return false;
      }
      if (result.error) host.toast(`Save failed: ${result.error}`);
      statusEl.textContent = '';
      return false;
    }

    const fileMeta = result.data || {};
    if (fileMeta && Object.keys(fileMeta).length > 0) {
      lastSha256 = fileMeta.sha256 || lastSha256;
      lastSavedContent = getText();
      markUnsaved(false);
      statusEl.textContent = 'Saved';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
      return true;
    }

    console.error('[SAVE] Failed: empty or invalid response');
    host.toast('Save failed');
    statusEl.textContent = '';
    return false;
  } catch (e) {
    console.error('[SAVE] Exception:', e);
    const errMsg = e.message || e.error || JSON.stringify(e);
    host.toast(`Save failed: ${errMsg}`);
    statusEl.textContent = '';
    return false;
  }
}

async function runCurrentFile() {
  const runnable = currentPath && currentPathExists && isRunnableFile(currentPath);
  if (!runnable) {
    host.toast('Open a Python, shell, or C/C++ source file to run it in the terminal');
    return;
  }

  runActiveBtn.disabled = true;
  try {
    // Ensure backend buffer is flushed before running.
    const saved = await saveFile();
    if (!saved) {
      host.toast('Save failed; not running file');
      return;
    }

    if (terminal && typeof terminal.open === 'function') {
      await terminal.open();
    }

    const response = await apiPost('terminal/run_active_file', {});

    // apiPost may unwrap {ok,data} -> data. Handle both shapes.
    const isWrapped = response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok');
    if (isWrapped && response.ok === false) {
      host.toast(response.error || 'Failed to run file');
    } else {
      const payload = isWrapped ? (response.data || {}) : (response || {});
      if (payload && Object.keys(payload).length > 0) {
        const preview = payload.command_preview || basename(currentPath);
        host.toast(`Running ${preview} in terminal`);
      } else {
        host.toast('Failed to run file');
      }
    }
  } catch (err) {
    console.error('[RUN] Failed to execute file:', err);
    host.toast(err?.message || 'Failed to run file');
  } finally {
    updateRunButtonState();
  }
}

async function saveAsDialog() {
  const target = await pickSaveTarget();
  if (!target || !target.path) return;
  if (target.existed && !window.confirm('File exists. Overwrite?')) return;
  statusEl.textContent = 'Saving...';

  const content = await getText();
  const targetAbs = toAbsolute(target.path, null, HOME_DIR);

  // Reset SHA256 since this is a new file path
  lastSha256 = null;

  const result = await doSave(targetAbs, content);

  if (result.success) {
    currentPath = targetAbs;
    currentPathExists = true;
    lastPickerPath = parentDir(currentPath);
    currentModeLanguage = detectLanguageFromFilename(currentPath);
    updatePathDisplay();
    statusEl.textContent = 'Saved';
    setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);

    // Open WebSocket for this new file
    closeWebSocket();
    openWebSocket(currentPath);
    diffController.invalidateCacheForPath(currentPath);
    diffController.setContext({ path: currentPath, sha: lastSha256 });
    if (editorViewState?.showInlineDiffs) {
      diffController.refresh(true);
    }

    apiPost('state/file_activity', {
      path: currentPath,
      project: cachedProjectRoot || (editorState && editorState.activeProject) || undefined,
    }).then((data) => {
      if (data?.state) {
        editorState = data.state;
        cachedProjectRoot = editorState.activeProject || cachedProjectRoot;
        window.__cm6EditorState = editorState;
        if (typeof window.__cm6RefreshRecents === 'function') {
          window.__cm6RefreshRecents(editorState);
        }
      }
    }).catch(err => {
      console.error('Failed to record file activity after save-as:', err);
    });
  } else {
    host.toast(`Save failed: ${result.error}`);
    statusEl.textContent = '';
  }
}

// Autosave: debounced save
function scheduleAutosave() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  // Don't autosave if disabled OR if native selection is active (ZWSPs present)
  if (!(editorViewState?.autoSave) || nativeSelectionActive) {
    return;
  }

  const delay = editorViewState?.autoSave ? AUTOSAVE_ACTIVE_DELAY : AUTOSAVE_IDLE_DELAY;
  saveDebounceTimer = setTimeout(() => {
    if (unsaved && currentPath && currentPathExists && !nativeSelectionActive) {
      saveFile().then((ok) => {
        if (ok === false) {
          console.warn('Autosave attempt failed; leaving changes unsaved');
        }
      }).catch(err => {
        console.error('Autosave failed:', err);
      });
    }
  }, delay);
}

// Autosave confirmation modal (constructed lazily)
let autosaveModalController = null;
function ensureAutosaveModal() {
  if (autosaveModalController) return autosaveModalController;
  const modal = document.createElement('div');
  modal.id = 'fe-autosave-modal';
  modal.className = 'fe-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 460px;">
      <div class="fe-modal-header">
        <strong>Enable Autosave?</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-autosave-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <p id="fe-autosave-message" style="margin:0; line-height:1.5;"></p>
      </div>
      <div class="fe-modal-actions">
        <button class="fe-btn" id="fe-autosave-cancel">Cancel</button>
        <button class="fe-btn fe-btn-primary" id="fe-autosave-confirm">Enable Autosave</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  autosaveModalController = {
    root: modal,
    messageEl: modal.querySelector('#fe-autosave-message'),
    confirmBtn: modal.querySelector('#fe-autosave-confirm'),
    cancelBtn: modal.querySelector('#fe-autosave-cancel'),
    closeBtn: modal.querySelector('#fe-autosave-close'),
  };
  autosaveModalController.closeBtn.addEventListener('click', () => hideAutosaveModal(false));
  autosaveModalController.root.addEventListener('click', (evt) => {
    if (evt.target === autosaveModalController.root) {
      hideAutosaveModal(false);
    }
  });
  return autosaveModalController;
}

let autosaveModalResolve = null;
function hideAutosaveModal(result) {
  if (!autosaveModalController) return;
  autosaveModalController.root.classList.remove('show');
  autosaveModalController.root.setAttribute('aria-hidden', 'true');
  const resolver = autosaveModalResolve;
  autosaveModalResolve = null;
  if (resolver) resolver(result);
}

function showAutosaveModal(fileLabel, hasOtherDrafts) {
  const modal = ensureAutosaveModal();
  const safeLabel = fileLabel ? `“${fileLabel}”` : 'this document';
  const tail = hasOtherDrafts
    ? 'Any other unsaved drafts in different files will be discarded when autosave is on.'
    : 'Autosave will overwrite the current document and discard draft caches for other files.';
  modal.messageEl.textContent = `Enabling autosave will immediately save ${safeLabel}. ${tail} Continue?`;
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');
  return new Promise((resolve) => {
    autosaveModalResolve = resolve;
    const onConfirm = () => hideAutosaveModal(true);
    const onCancel = () => hideAutosaveModal(false);
    modal.confirmBtn.onclick = onConfirm;
    modal.cancelBtn.onclick = onCancel;
  });
}

// ---------- Watcher (inotify) warning modal ----------
let watcherModalController = null;

function ensureWatcherLimitModal() {
  if (watcherModalController) return watcherModalController;
  const modal = document.createElement('div');
  modal.id = 'fe-watcher-modal';
  modal.className = 'fe-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 520px;">
      <div class="fe-modal-header">
        <strong>File watcher limit reached</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-watcher-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <div id="fe-watcher-message" style="font-size:0.9rem; line-height:1.5;"></div>
        <div style="margin-top: 10px;">
          <label style="display:block; font-size: 12px; opacity: 0.85; margin-bottom: 6px;">Sudo password (optional)</label>
          <input id="fe-watcher-password" type="password" placeholder="Leave blank if sudo has no password" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--fe-border, #2c333b); background: var(--fe-panel, #0f141a); color: inherit;" />
        </div>
        <p style="margin-top:10px; font-size:12px; opacity:0.8;">
          This will run: <code>sudo sysctl -w fs.inotify.max_user_watches=524288</code>
        </p>
      </div>
      <div class="fe-modal-actions">
        <button class="fe-btn fe-btn-primary" id="fe-watcher-confirm">Raise limit</button>
        <button class="fe-btn" id="fe-watcher-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  watcherModalController = {
    root: modal,
    messageEl: modal.querySelector('#fe-watcher-message'),
    passwordEl: modal.querySelector('#fe-watcher-password'),
    confirmBtn: modal.querySelector('#fe-watcher-confirm'),
    cancelBtn: modal.querySelector('#fe-watcher-cancel'),
    closeBtn: modal.querySelector('#fe-watcher-close'),
  };
  watcherModalController.closeBtn.addEventListener('click', () => hideWatcherLimitModal());
  watcherModalController.cancelBtn.addEventListener('click', () => hideWatcherLimitModal());
  watcherModalController.root.addEventListener('click', (evt) => {
    if (evt.target === watcherModalController.root) {
      hideWatcherLimitModal();
    }
  });
  return watcherModalController;
}

function hideWatcherLimitModal() {
  if (!watcherModalController) return;
  watcherModalController.root.classList.remove('show');
  watcherModalController.root.setAttribute('aria-hidden', 'true');
}

function showWatcherLimitModal(message, limit) {
  const modal = ensureWatcherLimitModal();
  modal.messageEl.textContent = message || 'File watcher limit reached. Attempt to raise now?';
  modal.passwordEl.value = '';
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');

  modal.confirmBtn.onclick = () => {
    const pwd = modal.passwordEl.value || '';
    if (typeof window.__explorerBusSend === 'function') {
      window.__explorerBusSend('watcher:raiseLimit', {
        limit: typeof limit === 'number' ? limit : 524288,
        password: pwd,
      });
    } else {
      host.toast('Explorer transport not available');
    }
    hideWatcherLimitModal();
  };
}

window.__cm6HandleWatcherError = (payload) => {
  const msg = payload && payload.message ? payload.message : null;
  const limit = payload && typeof payload.limit === 'number' ? payload.limit : 524288;
  const warning = msg ? `${msg}\n\nAttempt to raise the limit now?` : 'File watcher limit reached. Attempt to raise now?';
  showWatcherLimitModal(warning, limit);
};

window.__cm6HandleWatcherRaiseResult = (payload) => {
  if (!payload) return;
  if (payload.ok) {
    host.toast(payload.stdout || 'Watcher limit updated');
  } else {
    const err = payload.stderr || payload.stdout || 'Failed to raise watcher limit';
    host.toast(err);
  }
};

try {
  if (window.__cm6PendingWatcherError) {
    window.__cm6HandleWatcherError(window.__cm6PendingWatcherError);
    window.__cm6PendingWatcherError = null;
  }
  if (window.__cm6PendingWatcherRaiseResult) {
    window.__cm6HandleWatcherRaiseResult(window.__cm6PendingWatcherRaiseResult);
    window.__cm6PendingWatcherRaiseResult = null;
  }
} catch (_) {}

// ---------- Projects & Sidecars debug modal ----------
let projectsDebugModal = null;

function ensureProjectsDebugModal() {
  if (projectsDebugModal) return projectsDebugModal;
  const modal = document.createElement('div');
  modal.id = 'fe-projects-debug-modal';
  modal.className = 'fe-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 640px;">
      <div class="fe-modal-header">
        <strong>Projects</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-projects-debug-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <div id="fe-projects-debug-content" style="font-size:0.85rem; line-height:1.5;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  projectsDebugModal = {
    root: modal,
    contentEl: modal.querySelector('#fe-projects-debug-content'),
    closeBtn: modal.querySelector('#fe-projects-debug-close'),
  };
  projectsDebugModal.closeBtn.addEventListener('click', () => hideProjectsDebugModal());
  projectsDebugModal.root.addEventListener('click', (evt) => {
    if (evt.target === projectsDebugModal.root) {
      hideProjectsDebugModal();
    }
  });
  return projectsDebugModal;
}

function hideProjectsDebugModal() {
  if (!projectsDebugModal) return;
  projectsDebugModal.root.classList.remove('show');
  projectsDebugModal.root.setAttribute('aria-hidden', 'true');
}

async function loadProjectsDebugContent() {
  const modal = ensureProjectsDebugModal();
  modal.contentEl.textContent = 'Loading recent projects…';
  try {
    const resp = await fetch('/api/app/file_editor_cm6/debug/projects', { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Request failed');
    }
    const items = Array.isArray(json.data) ? json.data.slice() : [];
    if (!items.length) {
      modal.contentEl.innerHTML = '<p>No recent projects recorded.</p>';
      return;
    }

    // Sort so that the active project (if any) appears first, then by
    // most recently opened.
    items.sort((a, b) => {
      const aActive = !!a.is_active;
      const bActive = !!b.is_active;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const ao = a.opened_at || '';
      const bo = b.opened_at || '';
      if (ao > bo) return -1;
      if (ao < bo) return 1;
      return 0;
    });

    const frag = document.createDocumentFragment();
    items.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'fe-projects-debug-row';
      if (entry.is_active) {
        row.classList.add('fe-projects-debug-row--active');
      }

      const info = document.createElement('div');
      info.className = 'fe-projects-debug-info';

      const title = document.createElement('div');
      title.className = 'fe-projects-debug-title';
      const label = entry.label || '(no label)';
      const path = entry.path || '(no path)';
      title.textContent = `${label} — ${path}`;

      const meta = document.createElement('div');
      meta.className = 'fe-projects-debug-meta';
      const scPath = entry.sidecar_path || '(no sidecar path)';
      const exists = entry.sidecar_exists ? 'exists' : 'missing';
      const session =
        typeof entry.session_count === 'number'
          ? `, session_count=${entry.session_count}`
          : '';
      const lastBoot = entry.last_boot_at
        ? `, last_boot_at=${entry.last_boot_at}`
        : '';
      const drafts = typeof entry.draft_count === 'number' && entry.draft_count > 0
        ? `, drafts=${entry.draft_count}`
        : '';
      meta.textContent = `State: ${scPath} (${exists}${session}${lastBoot}${drafts})`;

      info.appendChild(title);
      info.appendChild(meta);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'fe-projects-debug-trash';

      const trashBtn = document.createElement('button');
      trashBtn.className = 'fe-btn';
      trashBtn.textContent = '🗑';
      trashBtn.title = entry.is_active ? 'Reset project state' : 'Remove project entry and sidecar';
      trashBtn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        const p = entry.path;
        if (!p) return;
        const confirmText = entry.is_active
          ? [
              'Reset history and draft cache for the CURRENT project:',
              p,
              '',
              'This does not delete the project folder itself, and the project',
              'will remain in the list. All recents, diff base, and drafts for',
              'this project will be cleared.',
            ].join('\n')
          : [
              'Remove project entry and sidecar for:',
              p,
              '',
              'This does not delete the project folder itself, but it will be',
              'removed from the recent projects list and its drafts will be lost.',
            ].join('\n');
        if (!window.confirm(confirmText)) return;
        try {
          const respDel = await fetch('/api/app/file_editor_cm6/debug/projects', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: p }),
          });
          const jsonDel = await respDel.json().catch(() => ({}));
          if (!respDel.ok || jsonDel?.ok === false) {
            throw new Error(jsonDel?.error || respDel.statusText || 'Delete failed');
          }
          await loadProjectsDebugContent();

          // If we just soft-reset the CURRENT project, treat this as the user
          // having just opened a \"fresh\" project: clear host editor state and
          // let the iframe reload into its null-document state for this project.
          if (entry.is_active && typeof window.__cm6HandleProjectOpened === 'function') {
            try {
              window.__cm6HandleProjectOpened(p);
              hideProjectsDebugModal();
            } catch (err) {
              console.warn('[ProjectsDebug] Failed to resync editor after reset:', err);
            }
          }
        } catch (e) {
          window.alert(
            `Failed to delete project entry: ${
              e && e.message ? e.message : String(e || 'unknown error')
            }`,
          );
        }
      });

      actions.appendChild(trashBtn);
      row.appendChild(actions);
      frag.appendChild(row);

      // Clicking the info area (not the trash) can act as a quick
      // "open project" shortcut for non-active projects.
      if (!entry.is_active) {
        info.style.cursor = 'pointer';
        info.addEventListener('click', () => {
          const p = entry.path;
          if (!p) return;
          if (
            !window.confirm(
              'Any unsaved changes in the current project will be lost. Continue?',
            )
          ) {
            return;
          }
          if (typeof window.__explorerBusSend !== 'function') {
            window.alert('Explorer connection unavailable.');
            return;
          }
          window.__explorerBusSend('project:open', { path: p });
          hideProjectsDebugModal();
        });
      }
    });

    modal.contentEl.innerHTML = '';
    modal.contentEl.appendChild(frag);
  } catch (err) {
    modal.contentEl.textContent = `Failed to load debug info: ${
      err && err.message ? err.message : String(err || 'unknown error')
    }`;
  }
}

async function showProjectsDebugModal() {
  const modal = ensureProjectsDebugModal();
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');
  await loadProjectsDebugContent();
}

// ---------- Language Servers Modal ----------
const lspModalApi = initLspModal({
  host,
  apiPost,
  apiGet,
  updatePreference,
  fetchEditorState,
  getEditorViewState: () => editorViewState,
  basename,
  closeAllMenus,
  updateLspSpinner: _feUpdateLspSpinner,
  toAbsolute,
  HOME_DIR,
  getCachedProjectRoot: () => cachedProjectRoot,
  parentDir,
  pickFile,
  pickDirectory,
  openFile,
  getClientId: () => clientId,
});
const showLspModal = lspModalApi?.showLspModal || (async () => {
  host.toast('Language servers modal not available');
});

// ---------- Picker helpers (shared modal provided by framework) ----------
function pickerAvailable() {
  return window.teFilePicker && typeof window.teFilePicker.openFile === 'function';
}
async function pickFile(startPath) {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, HOME_DIR);
  try {
    const choice = await window.teFilePicker.openFile({ title:'Open File', startPath:initial, selectLabel:'Open' });
    if (choice && choice.path) { lastPickerPath = parentDir(choice.path); return choice.path; }
    return null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Browse failed');
    return null;
  }
}
async function pickDirectory(startPath) {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, HOME_DIR);
  try {
    const choice = await window.teFilePicker.openDirectory({ title:'Select Folder', startPath:initial, selectLabel:'Select' });
    if (choice && choice.path) { lastPickerPath = choice.path; return choice.path; }
    return null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Browse failed');
    return null;
  }
}
async function pickSaveTarget() {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
  const initialDir = toAbsolute(baseDir, null, HOME_DIR);
  try {
    const result = await window.teFilePicker.saveFile({
      title:'Save As', startPath: initialDir, filename: currentPath ? basename(currentPath) : '', selectLabel:'Save'
    });
    return result || null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Save cancelled');
    return null;
  }
}

function _relToBase(targetAbs, baseAbs) {
  const base = String(baseAbs || '').replace(/\/+$/, '');
  const target = String(targetAbs || '').replace(/\/+$/, '');
  if (!base || !target) return target;
  if (target === base) return '';
  if (target.startsWith(base + '/')) return target.slice(base.length + 1);
  return target;
}

function _deriveWorkerId(rootRel) {
  const cleaned = String(rootRel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/\//g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'root';
}

// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line, options = {}) {
  const path = window.currentPath;
  if (!path) {
    host.toast('No file currently open');
    return;
  }
  
  try {
    const targetLine = parseInt(line, 10);
    if (!Number.isFinite(targetLine) || targetLine < 1) {
      host.toast('Invalid line number');
      return;
    }
    const payload = { line: targetLine, path };
    if (options && Object.prototype.hasOwnProperty.call(options, 'focus')) {
      payload.focus = Boolean(options.focus);
    }
    // scrollToTop: position line at viewport top (for scroll restore)
    if (options && Object.prototype.hasOwnProperty.call(options, 'scrollToTop')) {
      payload.scroll_to_top = Boolean(options.scrollToTop);
    }
    if (options && Object.prototype.hasOwnProperty.call(options, 'scrollY')) {
      if (typeof options.scrollY === 'string') {
        payload.scroll_y = options.scrollY;
      }
    }
    if (editorSocket && editorSocket.connected) {
      editorSocket.emit('editor_jump_to_line_request', payload);
      return;
    }
    // Queue until editor Socket.IO connects.
    editorPending.push({ type: 'editor_jump_to_line_request', payload });
  } catch (e) {
    host.toast('Failed to jump: ' + (e?.message || 'unknown error'));
  }
}

// Expose for search overlay
window.jumpToCurrentFileLine = jumpToCurrentFileLine;

// ---------- Menu & keyboard wiring ----------
function closeAllMenus() {
  menuFileDD.classList.remove('show');
  menuEditDD.classList.remove('show');
  menuEditorDD.classList.remove('show');
  menuViewDD.classList.remove('show');
  recentFilesDD.classList.remove('show');
  try {
    if (typeof window.__cm6CloseLspMenus === 'function') {
      window.__cm6CloseLspMenus();
    }
  } catch { }
  if (branchMenuHandle && typeof branchMenuHandle.close === 'function') {
    branchMenuHandle.close();
  }
}
function bindMenuToggle(el, action) {
  if (!el) return;
  const run = () => { closeAllMenus(); action(); };
  el.addEventListener('click', run);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); } });
}

menuFileBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuFileDD.classList.toggle('show'); if (open){menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuEditBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuEditorBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditorDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuViewBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuViewDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
recentFilesBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = recentFilesDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
runActiveBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  runCurrentFile();
});
document.addEventListener('click', () => closeAllMenus());

bindMenuToggle(miNew, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath = ''; currentPathExists = false; lastPickerPath = HOME_DIR; currentModeLanguage = null;
  lastSha256 = null;
  setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});
bindMenuToggle(miOpen, async () => { const p = await pickFile(); if (p) await openFile(p); });
bindMenuToggle(miSave, () => saveFile());
bindMenuToggle(miSaveAs, () => saveAsDialog());
bindMenuToggle(miClose, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentModeLanguage=null;
  lastSha256 = null;
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});
bindMenuToggle(miQuit, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath=''; currentPathExists=false; lastSha256 = null;
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});

bindMenuToggle(miDebugProjects, () => {
  showProjectsDebugModal();
});

// Language Servers modal - Added: 2025-12-08
bindMenuToggle(miLanguageServers, () => {
  showLspModal();
});

bindMenuToggle(miExportDiagnostics, () => {
  exportDiagnosticsToFile();
});

bindMenuToggle(miUndo, () => { if (view && undo) undo(view); });
bindMenuToggle(miRedo, () => { if (view && redo) redo(view); });
bindMenuToggle(miCut,  () => document.execCommand('cut'));
bindMenuToggle(miCopy, () => document.execCommand('copy'));
bindMenuToggle(miPaste, async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text != null) {
      view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text } });
      return;
    }
  } catch {}
  document.execCommand('paste');
});
bindMenuToggle(miSelectAll, () => {
  // Select all text in CodeMirror
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
});

bindMenuToggle(miToggleLines, async () => {
  const success = await updatePreference('showLineNumbers', !(editorViewState?.showLineNumbers));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleShading, async () => {
  const success = await updatePreference('showShading', !(editorViewState?.showShading));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleIndentGuides, async () => {
  const success = await updatePreference('showIndentGuides', !(editorViewState?.showIndentGuides));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleSyntax, async () => {
  const success = await updatePreference('showSyntax', !(editorViewState?.showSyntax));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleCloseBrackets, async () => {
  const success = await updatePreference('autoCloseBrackets', !(editorViewState?.autoCloseBrackets));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutocomplete, async () => {
  const success = await updatePreference('autocompletion', !(editorViewState?.autocompletion));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleWrap, async () => {
  const success = await updatePreference('wordWrap', !(editorViewState?.wordWrap));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutosave, async () => {
  const currentlyEnabled = !!(editorViewState?.autoSave);
  if (currentlyEnabled) {
    const success = await updatePreference('autoSave', false);
    if (!success) {
      host.toast('Failed to update preference');
      setMenuChecked(miToggleAutosave, true);
    }
    return;
  }

  if (!currentPath || !currentPathExists) {
    host.toast('Open a file before enabling autosave');
    setMenuChecked(miToggleAutosave, false);
    return;
  }

  const fileLabel = basename(currentPath);
  const confirmed = await showAutosaveModal(fileLabel, unsaved);
  if (!confirmed) {
    setMenuChecked(miToggleAutosave, false);
    return;
  }

  if (unsaved && currentPath && currentPathExists) {
    const saved = await saveFile();
    if (!saved) {
      host.toast('Autosave not enabled: saving failed');
      setMenuChecked(miToggleAutosave, false);
      return;
    }
  }

  // Clear any cached draft for the active document (best-effort)
  try {
    await apiPost('editor/discard_draft', { path: currentPath });
  } catch (err) {
    console.warn('[Autosave] Failed to discard existing draft', err);
  }

  const success = await updatePreference('autoSave', true);
  if (!success) {
    host.toast('Failed to update preference');
    setMenuChecked(miToggleAutosave, false);
    return;
  }

  editorViewState.autoSave = true;
  markUnsaved(false);
});

bindMenuToggle(miToggleDiffs, async () => {
  const success = await updatePreference('showInlineDiffs', !(editorViewState?.showInlineDiffs));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleDraftDiffs, async () => {
  const success = await updatePreference('showDraftDiffs', !(editorViewState?.showDraftDiffs));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleColorPicker, async () => {
  const success = await updatePreference('colorPicker', !(editorViewState?.colorPicker));
  if (!success) host.toast('Failed to update color picker');
});

bindMenuToggle(miToggleReadonly, async () => {
  const success = await updatePreference('readOnly', !(editorViewState?.readOnly));
  if (success) {
    host.toast(editorViewState?.readOnly ? 'Editor is now read-only' : 'Editor is now editable', 'info');
  } else {
    host.toast('Failed to toggle read-only mode');
  }
});

const miToggleMinimap = requireEl('#mi-toggle-minimap');
bindMenuToggle(miToggleMinimap, async () => {
  const success = await updatePreference('showMinimap', !(editorViewState?.showMinimap));
  if (!success) host.toast('Failed to update preference');
});

// ============================================================================
// Sticky Scroll Toggle
// Added: 2025-12-03 by vectorArc - TE2 Team
// ============================================================================
bindMenuToggle(miToggleStickyScroll, async () => {
  const success = await updatePreference('stickyScroll', !(editorViewState?.stickyScroll));
  if (!success) host.toast('Failed to update sticky scroll preference');
});

bindMenuToggle(miTrackEdits, async () => {
  const success = await updatePreference('trackAgentEdits', !(editorViewState?.trackAgentEdits));
  if (!success) host.toast('Failed to update preference');
});

// Initialize terminal drawer
const terminal = createTerminalDrawer({
  onReady: () => console.log('Terminal drawer ready'),
});

// Bind terminal toggle menu item
const miToggleTerminal = requireEl('#mi-toggle-terminal');
bindMenuToggle(miToggleTerminal, () => {
  terminal.toggle();
});

// NEW: Font scale radio buttons
const miFontSmall = document.getElementById('mi-font-small');
const miFontMedium = document.getElementById('mi-font-medium');
const miFontLarge = document.getElementById('mi-font-large');

if (miFontSmall) {
  miFontSmall.addEventListener('click', () => setFontScale('small'));
}
if (miFontMedium) {
  miFontMedium.addEventListener('click', () => setFontScale('medium'));
}
if (miFontLarge) {
  miFontLarge.addEventListener('click', () => setFontScale('large'));
}

bindMenuToggle(miFind, () => { triggerEditorSearchPanel('menu', { replace: true }); });
bindMenuToggle(miGoto, async () => {
  const input = window.prompt('Go to line:');
  if (!input) return;
  
  const line = parseInt(input, 10);
  if (isNaN(line) || line < 1) {
    host.toast('Invalid line number');
    return;
  }
  
  await jumpToCurrentFileLine(line);
});



// Unsaved tracking
function onAnyChange() {
  const now = getText();
  const hasChanges = now !== lastSavedContent;
  markUnsaved(hasChanges);
}
const changeObserver = new MutationObserver(onAnyChange);
const observeEditor = () => {
  changeObserver.disconnect();
  if (view?.dom) changeObserver.observe(view.dom, { childList:true, subtree:true, characterData:true });
};
function reobserve() {
  setTimeout(observeEditor, 0);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Ctrl/Cmd+`: Toggle Terminal
  if (cmdOrCtrl && e.key === '`') {
    e.preventDefault();
    terminal.toggle();
  }

  // Ctrl/Cmd+S: Save
  if (cmdOrCtrl && e.key === 's') {
    e.preventDefault();
    saveFile();
  }

  // Ctrl/Cmd+F: Search
  if (cmdOrCtrl && e.key === 'f') {
    e.preventDefault();
    triggerEditorSearchPanel('shortcut', { replace: false });
  }

  // Ctrl/Cmd+N: New
  if (cmdOrCtrl && e.key === 'n') {
    e.preventDefault();
    closeWebSocket();
    if (currentPath) {
      diffController.invalidateCacheForPath(currentPath);
    }
    diffController.setContext(null);
    currentPath = ''; currentPathExists = false; lastPickerPath = HOME_DIR; currentModeLanguage = null;
    lastSha256 = null;
    setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
  }

  // Ctrl/Cmd+O: Open
  if (cmdOrCtrl && e.key === 'o') {
    e.preventDefault();
    pickFile().then(p => { if (p) openFile(p); });
  }

  // NEW: Font scale shortcuts
  if ((e.ctrlKey || e.metaKey) && e.key === '=' && !e.shiftKey) {
    // This shortcut allows increasing the font size through presets.
    e.preventDefault();
    const currentScale = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome-font-scale') || '0.85'
    );
    
    if (currentScale < 0.75) setFontScale('medium');
    else if (currentScale < 1.0) setFontScale('large');
    // Already at Large, do nothing
  }

  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    // This shortcut allows decreasing the font size through presets.
    e.preventDefault();
    const currentScale = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome-font-scale') || '0.85'
    );
    
    if (currentScale > 1.0) setFontScale('medium');
    else if (currentScale > 0.75) setFontScale('small');
    // Already at Small, do nothing
  }
});


// ---------- State load/init ----------
// host.setTitle('Code CM6');

// Set up global file opening hooks for explorer.js
window.appOpenFile = (absPath) => {
  openFile(absPath).catch(e => {
    host.toast(`Failed to open: ${e.message}`);
  });
};

window.appOpenFileRel = (rel, projectRoot) => {
  // Convert relative path to absolute using project root
  const base = projectRoot || cachedProjectRoot || HOME_DIR;
  const abs = toAbsolute(rel, base, HOME_DIR);
  openFile(abs).catch(e => {
    host.toast(`Failed to open: ${e.message}`);
  });
};

async function getCurrentProjectRoot(forceRefresh = false) {
  const state = await syncEditorState(forceRefresh);
  return state?.activeProject || null;
}

async function main() {
  // Responsive layout manager - detects viewport and applies layout class
  const layoutManager = {
    init() {
      this.update();
      window.addEventListener('resize', () => this.update());
      window.addEventListener('orientationchange', () => setTimeout(() => this.update(), 100));
    },
    
    update() {
      const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
      const root = document.querySelector('.fe-root');
      
      if (isDesktop) {
        root.classList.add('layout-desktop');
        root.classList.remove('layout-mobile');
      } else {
        root.classList.add('layout-mobile');
        root.classList.remove('layout-desktop');
      }
    }
  };

  // Initialize layout manager
  layoutManager.init();

  // Load saved layout preferences
  loadLayoutPreferences();

  // Initialize resize handles
  initResizeManager();

  // Initialize explorer first to get project context
  await initExplorerUI().catch(e => {
    console.error('Failed to initialize explorer UI:', e);
  });

  // Connect Socket.IO-based explorer UI bus (v2)
  try {
    connectExplorerSocket();
  } catch (e) {
    console.warn('Failed to connect explorer Socket.IO bus:', e);
  }

  // Connect dedicated editor Socket.IO channel (Monaco iframe control plane).
  try {
    connectEditorSocket();
  } catch (e) {
    console.warn('Failed to connect editor Socket.IO channel:', e);
  }

  // Deterministic workbench adapter startup (prevents early 502/500).
  try {
    await ensureWorkbenchAdapterReady();
  } catch (e) {
    console.warn('Workbench adapter readiness failed:', e);
  }

  branchMenuHandle = initBranchMenu();
  const agentExtensionManifest = await fetchAgentExtensionManifest();
  applyAgentIcon(agentExtensionManifest);
  const frameworkSettings = await fetchFrameworkSettings();
  const agentIframeConfig = await resolveAgentIframeSettings(frameworkSettings);
  let agentHostBase = getAgentHostBase();
  try {
    if (agentIframeConfig && agentIframeConfig.url) {
      agentHostBase = new URL(agentIframeConfig.url, window.location.href).origin;
    }
  } catch (_) {}
  window.__agentHostBase = agentHostBase;
  agentDrawerHandle = agentIframeConfig.enabled
    ? initAgentIframe({ url: agentIframeConfig.url, title: 'Agent', allowAnyOrigin: true })
    : initAgentDrawer();

  const serverState = await syncEditorState(true);
  
  // Populate recents dropdown on initial load
  broadcastRecentsUpdate(serverState);

  // Load menu state from backend (backend already configured editor at page render)
  await refreshMenuState();
  // Theme selection is handled via Editor → Settings… modal (vscode_api harness).

  // Ask backend to resend cache state so draft indicator is accurate
  try {
    await apiPost('editor/refresh_cache_state', {});
  } catch (e) {
    console.warn('Failed to refresh cache state on boot:', e);
  }
  
  await fetchPersistedSessionState();
  initSessionStateContext(serverState);
  queueSessionStateUpdate({ activeProject: serverState?.activeProject || null });

  const initialDoc = '';
  createView(initialDoc);
  lastSavedContent = getText();
  markUnsaved(false);
  // Don't call updatePathDisplay() here — currentPath is empty so it would flash "Untitled".
  // The real path will arrive from editor:ssot (Socket.IO) or restoredPath (HTTP) below.

  if (!serverState || !serverState.activeProject || !serverState.activeProjectExists) {
    statusEl.textContent = serverState?.activeProjectMessage || 'Select a project to begin.';
    setToolbarFileName('No file');
    setIssuesButtonsEnabled(false);
    return;
  }

  // Open file via URL param or saved state.
  // Prefer currentPath (session_state, synced by on_connect from history_store.last_file).
  // Fall back to lastFile for compatibility.
  const params = new URLSearchParams(window.location.search);
  const fileFromUrl = params.get('file');
  const restoredPath = serverState.currentPath || serverState.lastFile;
  const restoredSha = serverState.lastFileSha256 || null;

  // Sync host bookkeeping with backend SSOT - the iframe already loaded the file.
  // Don't call updatePathDisplay() here — the explorer socket's explorer:activeFile
  // handler will set the toolbar when the authoritative value arrives.
  if (restoredPath) {
    currentPath = restoredPath;
    currentPathExists = !!serverState.lastFileExists;
    lastPickerPath = parentDir(restoredPath);
    lastSha256 = restoredSha;
    currentModeLanguage = detectLanguageFromFilename(restoredPath);
    setText(''); // NiceGUI iframe owns the real buffer
    syncSessionPath();

    // Open WebSocket for file watching
    openWebSocket(restoredPath);

    console.log('[BOOT] Synced with backend SSOT:', restoredPath);

    // Safety: if explorer socket hasn't updated the toolbar within 2s, do it ourselves.
    setTimeout(() => {
      try {
        const el = document.getElementById('fe-file-name');
        if (el && currentPath && (!el.textContent || el.textContent === 'Untitled')) {
          updatePathDisplay();
        }
      } catch (_) {}
    }, 2000);
  }

  // Only call openFile() for explicit URL parameter - user wants a specific file
  if (fileFromUrl) {
    const abs = toAbsolute(fileFromUrl, null, HOME_DIR);
    if (abs !== restoredPath) {
      // URL requests a DIFFERENT file than what backend loaded - honor the URL
      lastPickerPath = parentDir(abs);
      await openFile(abs).catch((e) => {
        host.toast(`Failed to open file: ${e.message}`);
        currentPath = ''; currentPathExists = false; setText(''); markUnsaved(false); updatePathDisplay();
      });
    }
  } else if (!restoredPath) {
    // No file to restore
    if (serverState.lastFile && !serverState.lastFileExists) {
      statusEl.textContent = serverState.lastFileMessage || 'Last file not found.';
    } else {
      statusEl.textContent = 'Select a file to begin.';
    }
  }
  // else: restoredPath exists, iframe already loaded it, we just synced - done!

}

// Run the main boot sequence
main();

// Save state on exit
host.onBeforeExit(() => {
  if (unsaved) { showConfirm(); host.toast('Unsaved changes — Save or Discard before leaving.'); return { cancel:true }; }
  flushSessionState(true);
  return {};
});

// Track changes: refresh unsaved flag
// (We don't wire CM6 transactions directly since we're using bare ESM; use a lightweight observer)
const observer = new MutationObserver(() => onAnyChange());
observer.observe(editorFrame, { childList:true, subtree:true, characterData:true });
}
