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
import { createConsoleDrawer } from './static/js/console.js';
import { initConsoleBridge } from './static/js/console_bridge.js';

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

function ensureVConsoleLoaded() {
  if (window.VConsole) return Promise.resolve(window.VConsole);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
    script.async = true;
    script.onload = () => resolve(window.VConsole);
    script.onerror = () => reject(new Error('Failed to load vConsole'));
    document.head.appendChild(script);
  });
}
import { initResizeManager, loadLayoutPreferences } from './static/js/resize_manager.js';

const AGENT_HOST_PORT = 12359;
const AGENT_HOST_RESOLVE_ENDPOINT = '/api/host/resolve_iframe';
const AGENT_IFRAME_STORAGE_KEY = 'te2_agent_iframe_url';
const AGENT_EXTENSION_MANIFEST = '/apps/file_editor_cm6/extensions/chat_drawer_extension/manifest.json';
const AGENT_HOST_CWD_ENDPOINT = '/api/host/project/cwd';
const UI_PREF_KEY_AGENT_IFRAME = 'agentDrawerIframe';
const UI_PREF_KEY_AGENT_IFRAME_URL = 'agentDrawerIframeUrl';
const UI_PREF_KEY_AGENT_TOGGLE_DISPLAY = 'agentToggleDisplay';
const UI_PREF_KEY_AGENT_TOGGLE_TEXT = 'agentToggleText';
const UI_PREF_KEY_AGENT_TOGGLE_ICON = 'agentToggleIcon';
const UI_PREF_KEY_AGENT_SHORTCUTS = 'agentShortcuts';

let _latestUiPrefs = {};
let _hasUiPrefsSnapshot = false;
const _uiPrefsWaiters = [];
let _agentRuntimeConfig = null;
let _agentRuntimeMode = null;
let _agentConfigApplySeq = 0;

function _resolveUiPrefsWaiters(ui) {
  if (!_uiPrefsWaiters.length) return;
  while (_uiPrefsWaiters.length) {
    const resolve = _uiPrefsWaiters.shift();
    try {
      resolve(ui);
    } catch (_) {}
  }
}

function waitForInitialUiPrefs(timeoutMs = 2200) {
  if (_hasUiPrefsSnapshot) {
    return Promise.resolve(_latestUiPrefs || {});
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(_latestUiPrefs || {});
    }, Math.max(300, timeoutMs || 0));
    _uiPrefsWaiters.push((ui) => {
      clearTimeout(timer);
      resolve(ui || {});
    });
  });
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

async function resolveAgentIframeUrl(uiPrefs) {
  const explicit = typeof uiPrefs?.[UI_PREF_KEY_AGENT_IFRAME_URL] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_IFRAME_URL].trim()
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

async function resolveAgentIframeSettings(uiPrefs) {
  const enabled = parseBoolean(uiPrefs?.[UI_PREF_KEY_AGENT_IFRAME]);
  const url = await resolveAgentIframeUrl(uiPrefs || {});
  let normalized = '';
  try {
    normalized = String(url || '').trim();
  } catch (_) {
    normalized = '';
  }
  const noProto = normalized.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  const isDefaultCodexTarget = noProto === '127.0.0.1:12359/codex-agent';
  return { enabled, url, hideDrawerHeader: isDefaultCodexTarget };
}

let explorerSocket = null;
const explorerPending = [];
let explorerNeedsResync = false;
let _explorerReqNextId = 1;
const _explorerReqPending = new Map(); // id -> {resolve,reject,timer}

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
        const msgId = msg.id || msg?.data?.id || null;
        const type = msg.type || msg?.data?.type;
        const payload = msg.payload || msg?.data?.payload || {};
        if (msgId && _explorerReqPending.has(msgId)) {
          const pending = _explorerReqPending.get(msgId);
          _explorerReqPending.delete(msgId);
          try { clearTimeout(pending.timer); } catch (_) {}
          try { pending.resolve({ type, payload, id: msgId }); } catch (_) {}
        }
        if (type === 'agent:open') {
          handleAgentOpen(payload);
          return;
        }
        // Watcher config/status events → handled in main.js, not explorer
        if (type === 'watcher:config' && window.__cm6HandleWatcherConfig) {
          window.__cm6HandleWatcherConfig(payload);
        }
        if (type === 'watcher:modeStatus' && window.__cm6HandleWatcherModeStatus) {
          window.__cm6HandleWatcherModeStatus(payload);
        }
        if (type === 'watcher:error' && window.__cm6HandleWatcherError) {
          window.__cm6HandleWatcherError(payload);
        }
        if (type === 'watcher:raiseResult' && window.__cm6HandleWatcherRaiseResult) {
          window.__cm6HandleWatcherRaiseResult(payload);
        }
        if (type === 'prefs:setUi' && window.__cm6HandleUiPrefs) {
          window.__cm6HandleUiPrefs(payload);
        } else if (type === 'prefs:setUi') {
          try { window.__cm6PendingUiPrefs = payload; } catch (_) {}
        }
        // The explorer websocket is THE authority for which file is active.
        // Always update toolbar — no same-path guard so tracked edits
        // and rapid switches never get silently dropped.
        if (type === 'explorer:activeFile' && (payload.rel || payload.abs)) {
          try {
            let abs = payload.abs || null;
            if (!abs && payload.rel) {
              let projRoot = null;
              try { projRoot = activeProjectPath(); } catch (_) {}
              if (!projRoot) try { projRoot = sessionState?.activeProject; } catch (_) {}
              abs = projRoot ? toAbsolute(payload.rel, projRoot, HOME_DIR) : null;
            }
            if (abs) {
              try { currentPath = abs; } catch (_) {}
              try { currentPathExists = true; } catch (_) {}
              try { lastPickerPath = abs.slice(0, abs.lastIndexOf('/')); } catch (_) {}
              try { currentModeLanguage = detectLanguageFromFilename(abs); } catch (_) {}
              // Inline toolbar update — functions declared later are out of scope
              try {
                const name = abs.slice(abs.lastIndexOf('/') + 1);
                const el = document.getElementById('fe-file-name');
                if (el) { el.textContent = name; el.title = name; }
              } catch (_) {}
            }
          } catch (_) {}
        }
        if (type && typeof window.__explorerBusDispatch === 'function') {
          window.__explorerBusDispatch(type, payload);
        }
      });

      explorerSocket.on('explorer:navigate', async (payload) => {
        // Breadcrumb directory click → list the directory + open drawer
        console.log('[explorer:navigate] received:', payload);
        try {
          const p = payload && typeof payload === 'object' ? payload : {};
          const rel = p.rel || '.';

          if (p.is_external && p.abs_path) {
            // Out-of-repo directory → deep link to file_explorer app
            const resp = await fetch('/api/apps/file_explorer/open', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ params: { path: p.abs_path } }),
            });
            const json = await resp.json();
            if (json && json.ok && json.data && json.data.url) {
              window.location.href = json.data.url;
            }
            return;
          }

          if (p.open_drawer) {
            const root = document.querySelector('.fe-root');
            if (root) root.classList.add('drawer-open');
          }
          // Scroll explorer tree to the currently open file
          if (typeof window.__explorerScrollToActiveFile === 'function') {
            window.__explorerScrollToActiveFile();
          }
        } catch (_) {}
      });

      window.__explorerBusSend = (type, payload, id) => {
        const msg = { type, payload: payload || {} };
        if (id) msg.id = id;
        if (explorerSocket && explorerSocket.connected) {
          explorerSocket.emit('explorer_send', msg);
        } else {
          explorerPending.push(msg);
        }
      };

      window.__explorerBusRequest = (type, payload, timeoutMs) => {
        const id = `req_${Date.now()}_${_explorerReqNextId++}`;
        const t = Math.max(500, Number(timeoutMs) || 8000);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (!_explorerReqPending.has(id)) return;
            _explorerReqPending.delete(id);
            reject(new Error(`Explorer request timeout: ${type}`));
          }, t);
          _explorerReqPending.set(id, { resolve, reject, timer });
          window.__explorerBusSend(type, payload || {}, id);
        });
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
    if (pathChanged || (nameEl && (!nameEl.textContent || nameEl.textContent === 'Untitled'))) {
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

// ─── UI IPC (frontend ↔ editor iframe relay) ──────────────────────
let uiIpcSocket = null;

function connectUIIPC() {
  ensureSocketIoLoaded().then((io) => {
    if (!io) return;
    uiIpcSocket = io('/ui_ipc', {
      path: '/ui_ipc_ws/socket.io',
      transports: ['websocket'],
      query: { app_id: 'file_editor_cm6', source: 'main_page' },
    });
    uiIpcSocket.on('connect', () => {
      console.log('[UI_IPC] main page connected');
    });
    uiIpcSocket.on('ui_event', (data) => {
      if (!data || typeof data !== 'object') return;
      console.log('[focus_relay] main got ui_event', data.type);
      if (data.type === 'save') {
        // Dispatch synthetic Ctrl+S to trigger the existing keydown handler.
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's', code: 'KeyS', ctrlKey: true, bubbles: true,
        }));
      } else if (data.type === 'focus') {
        // Dispatch synthetic click to trigger the existing document click handler.
        console.log('[focus_relay] dispatching synthetic click');
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });

    // Console bridge — reuse this socket, no second connection
    initConsoleBridge({ workerId: 'main_page', socket: uiIpcSocket });
  }).catch((err) => {
    console.warn('[UI_IPC] connect failed', err);
  });
}
// ─── End UI IPC ───────────────────────────────────────────────────

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

// ---------- Editor Settings modal ----------
const editorSettingsModal = requireEl('#editor-settings-modal');
const editorSettingsClose = requireEl('#editor-settings-close');
const editorSettingsExtStrip = requireEl('#editor-settings-ext-strip');
const editorSettingsExtSummary = requireEl('#editor-settings-ext-summary');
const editorSettingsThemeStrip = requireEl('#editor-settings-theme-strip');
const editorSettingsThemeSummary = requireEl('#editor-settings-theme-summary');
const editorThemesModal = requireEl('#editor-themes-modal');
const editorThemesClose = requireEl('#editor-themes-close');
const editorThemesList = requireEl('#editor-themes-list');
const editorSettingsAgentIframeToggle = requireEl('#editor-settings-agent-iframe');
const editorSettingsAgentIframeUrlInput = requireEl('#editor-settings-agent-iframe-url');
const editorSettingsAgentToggleText = requireEl('#editor-settings-agent-toggle-text');
const editorSettingsAgentToggleEmoji = requireEl('#editor-settings-agent-toggle-emoji');
const editorSettingsAgentToggleIconBrowse = requireEl('#editor-settings-agent-toggle-icon-browse');
const editorSettingsAgentToggleIconClear = requireEl('#editor-settings-agent-toggle-icon-clear');
const editorSettingsAgentShortcutsBtn = requireEl('#editor-settings-agent-shortcuts');

const agentShortcutsModal = requireEl('#agent-shortcuts-modal');
const agentShortcutsClose = requireEl('#agent-shortcuts-close');
const agentShortcutsAdd = requireEl('#agent-shortcuts-add');
const agentShortcutsList = requireEl('#agent-shortcuts-list');
const agentShortcutsEditor = requireEl('#agent-shortcuts-editor');
const agentShortcutLabel = requireEl('#agent-shortcut-label');
const agentShortcutUrl = requireEl('#agent-shortcut-url');
const agentShortcutEmoji = requireEl('#agent-shortcut-emoji');
const agentShortcutIconBrowse = requireEl('#agent-shortcut-icon-browse');
const agentShortcutIconClear = requireEl('#agent-shortcut-icon-clear');
const agentShortcutIconPreview = requireEl('#agent-shortcut-icon-preview');
const agentShortcutCancel = requireEl('#agent-shortcut-cancel');
const agentShortcutSave = requireEl('#agent-shortcut-save');

const editorExtManagerModal = requireEl('#editor-ext-manager-modal');
const editorExtManagerClose = requireEl('#editor-ext-manager-close');
const editorExtManagerInstallBtn = requireEl('#editor-ext-manager-install');
const editorExtManagerList = requireEl('#editor-ext-manager-list');
const extCustomSettingsInput = requireEl('#editor-ext-custom-settings-input');
const extCustomSettingsSave = requireEl('#editor-ext-custom-settings-save');

const extConfigModal = requireEl('#ext-config-modal');
const extConfigTitle = requireEl('#ext-config-title');
const extConfigClose = requireEl('#ext-config-close');
const extConfigForm = requireEl('#ext-config-form');
const extConfigCancel = requireEl('#ext-config-cancel');
const extConfigSave = requireEl('#ext-config-save');

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

// Readiness spinner step labels.
const _readinessLabels = {
  iframe_ready: 'Editor iframe ready',
  code_server: 'Code-server backend',
  adapter_launched: 'Workbench adapter',
  baton: 'Session ready',
};

function _spinnerSetStep(title, failed) {
  try {
    if (!window.__feLspSpinnerUi) {
      window.__feLspSpinnerUi = {
        lspShow: false, lspTitle: '', busyShow: false,
        busyTitle: '', busyLanguageId: '', busyActivity: '',
      };
    }
    const ui = window.__feLspSpinnerUi;
    ui.busyShow = true;
    ui.busyActivity = 'readiness';
    ui.busyTitle = (failed ? '\u2718 ' : '') + title;
    _feUpdateLspSpinner();
  } catch (_) {}
}

function _spinnerHide(ok) {
  try {
    if (!window.__feLspSpinnerUi) return;
    const ui = window.__feLspSpinnerUi;
    if (ui.busyActivity === 'readiness' || ui.busyActivity === 'workbench_adapter' || ui.busyActivity === '') {
      ui.busyShow = false;
      ui.busyTitle = '';
      ui.busyActivity = '';
      try { console.log(_feHostTs(), '[spinner] STOP request_id=- path=- reason=readiness_' + (ok ? 'ok' : 'fail')); } catch (_) {}
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

async function ensureWorkbenchAdapterReady() {
  try {
    if (workbenchAdapterReadyOk) return;
    if (workbenchAdapterConnecting) return await workbenchAdapterConnecting;

    workbenchAdapterConnecting = (async () => {
      let ok = false;
      try {
        _spinnerSetStep('Waiting for editor\u2026');
        try { console.log(_feHostTs(), '[spinner] START request_id=- path=- reason=readiness_chain'); } catch (_) {}

        // Wait for readiness steps relayed from iframe via postMessage/editorSocket.
        // The iframe triggers the chain (editor_readiness_check) on connect,
        // and relays editor:readiness_step events to us.
        ok = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            _spinnerSetStep('Readiness timeout', true);
            resolve(false);
          }, 60000);

          const stepHandler = (ev) => {
            const step = ev && ev.step || '';
            const stepOk = ev && ev.ok;
            const label = _readinessLabels[step] || step;

            if (!stepOk) {
              _spinnerSetStep(label + ': failed' + (ev.error ? ' (' + ev.error.slice(0, 60) + ')' : ''), true);
              clearTimeout(timeout);
              resolve(false);
              return;
            }

            if (step === 'baton') {
              _spinnerSetStep(label);
              clearTimeout(timeout);
              resolve(true);
              return;
            }

            _spinnerSetStep(label + '\u2026');
          };

          // Listen for steps via editorSocket (from iframe relay).
          if (editorSocket && editorSocket.connected) {
            editorSocket.on('editor:readiness_step', stepHandler);
          } else {
            const check = setInterval(() => {
              if (editorSocket && editorSocket.connected) {
                clearInterval(check);
                editorSocket.on('editor:readiness_step', stepHandler);
              }
            }, 200);
            setTimeout(() => clearInterval(check), 60000);
          }

          // Also listen for editor:adapter_ready (from diagnostics_bridge, backwards compat).
          const adapterHandler = () => {
            clearTimeout(timeout);
            if (!ok) resolve(true);
          };
          if (editorSocket && editorSocket.connected) {
            editorSocket.once('editor:adapter_ready', adapterHandler);
          }
        });
      } catch (e) {
        console.warn('[readiness] chain failed', e);
      } finally {
        workbenchAdapterReadyOk = Boolean(ok);
        _spinnerHide(ok);
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

// --- Color Themes Modal (2nd level) ---
function openEditorThemesModal() {
  editorThemesModal.classList.add('show');
  editorThemesModal.setAttribute('aria-hidden', 'false');
  void refreshEditorThemesModal();
}
function closeEditorThemesModal() {
  editorThemesModal.classList.remove('show');
  editorThemesModal.setAttribute('aria-hidden', 'true');
}
editorThemesClose.addEventListener('click', closeEditorThemesModal);
editorThemesModal.addEventListener('click', (ev) => {
  if (ev.target === editorThemesModal) closeEditorThemesModal();
});
editorSettingsThemeStrip.addEventListener('click', () => {
  openEditorThemesModal();
});

async function refreshEditorThemesModal() {
  editorThemesList.textContent = 'Loading…';
  let themes = [];
  try {
    const res = await fetch('/api/app/file_editor_cm6/ui/monaco_editor/available_themes', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      themes = data?.themes || [];
    }
  } catch (_) {}

  // Built-in Monaco themes (vs, vs-dark, hc-black, hc-light) are disabled —
  // they don't carry a TextMate color map so semantic tokens resolve to wrong
  // palette indices.  Only vscode-style themes with tokenColors are supported.
  // TODO: revisit when we have a setColorMap(null) → retokenize pipeline.

  const currentTheme = editorViewState?.theme || 'github-dark-default';
  editorThemesList.innerHTML = '';

  // Group by source
  const vendored = themes.filter((t) => t.source === 'vendored');
  const fromExts = themes.filter((t) => t.source === 'extension');
  const builtins = themes.filter((t) => t.source === 'builtin');

  function renderSection(title, items) {
    if (!items.length) return;
    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:600; margin:12px 0 8px; font-size:13px; opacity:0.7; text-transform:uppercase; letter-spacing:0.5px;';
    heading.textContent = title;
    editorThemesList.appendChild(heading);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;';

    items.forEach((t) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border, #333); border-radius:8px; cursor:pointer;';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'te2-theme-radio';
      input.value = t.id;
      input.checked = String(currentTheme) === String(t.id);
      if (input.checked) {
        row.style.borderColor = 'var(--accent, #58a6ff)';
        row.style.background = 'rgba(88, 166, 255, 0.08)';
      }

      const isDark = (t.uiTheme || '').includes('dark') || (t.uiTheme || '').includes('hc-black');
      const swatch = document.createElement('span');
      swatch.style.cssText = `display:inline-block; width:16px; height:16px; border-radius:50%; border:1px solid var(--border,#444); background:${isDark ? '#1a1a2e' : '#f0f0f0'};`;

      const text = document.createElement('div');
      text.style.flex = '1';
      text.textContent = t.label;

      input.addEventListener('change', async () => {
        if (!input.checked) return;
        const ok = await updatePreference('theme', t.id);
        if (!ok) host.toast('Failed to change theme');
        try { editorViewState = editorViewState || {}; editorViewState.theme = t.id; } catch {}
        // Update strip summary
        editorSettingsThemeSummary.textContent = t.label;
        // Highlight selected row
        editorThemesList.querySelectorAll('label').forEach((l) => {
          l.style.borderColor = 'var(--border, #333)';
          l.style.background = '';
        });
        row.style.borderColor = 'var(--accent, #58a6ff)';
        row.style.background = 'rgba(88, 166, 255, 0.08)';
      });

      row.appendChild(input);
      row.appendChild(swatch);
      row.appendChild(text);
      grid.appendChild(row);
    });
    editorThemesList.appendChild(grid);
  }

  renderSection('Bundled', vendored);
  renderSection('From Extensions', fromExts);

  if (!themes.length) {
    editorThemesList.textContent = 'No themes available';
  }
}

function openEditorExtManagerModal() {
  editorExtManagerModal.classList.add('show');
  editorExtManagerModal.setAttribute('aria-hidden', 'false');
  void refreshEditorExtManagerModal();
  void loadCustomSettings();
}
function closeEditorExtManagerModal() {
  editorExtManagerModal.classList.remove('show');
  editorExtManagerModal.setAttribute('aria-hidden', 'true');
}
editorExtManagerClose.addEventListener('click', closeEditorExtManagerModal);
editorExtManagerModal.addEventListener('click', (ev) => {
  if (ev.target === editorExtManagerModal) closeEditorExtManagerModal();
});
// Strip in settings modal opens the ext manager
editorSettingsExtStrip.addEventListener('click', () => {
  openEditorExtManagerModal();
});

// --- Extension Config Modal (3rd level) ---
let _extConfigExtId = '';
let _extConfigValues = {};

function openExtConfigModal(extId, displayName, schema, currentValues) {
  _extConfigExtId = extId;
  _extConfigValues = { ...(currentValues || {}) };
  extConfigTitle.textContent = `Configure: ${displayName || extId}`;
  extConfigForm.innerHTML = '';

  const props = schema?.properties || schema || {};
  const propKeys = Object.keys(props);
  if (!propKeys.length) {
    const msg = document.createElement('div');
    msg.style.opacity = '0.7';
    msg.textContent = 'This extension has no configurable settings.';
    extConfigForm.appendChild(msg);
  } else {
    propKeys.forEach((key) => {
      const prop = props[key] || {};
      const fieldRow = document.createElement('div');
      fieldRow.style.marginBottom = '12px';

      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.fontWeight = '600';
      label.style.fontSize = '0.88rem';
      label.style.marginBottom = '4px';
      label.textContent = key;
      fieldRow.appendChild(label);

      if (prop.description) {
        const desc = document.createElement('div');
        desc.style.fontSize = '12px';
        desc.style.opacity = '0.6';
        desc.style.marginBottom = '4px';
        desc.textContent = prop.description;
        fieldRow.appendChild(desc);
      }

      const curVal = _extConfigValues[key] !== undefined ? _extConfigValues[key] : prop.default;

      if (prop.type === 'boolean') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!curVal;
        cb.addEventListener('change', () => { _extConfigValues[key] = cb.checked; });
        fieldRow.appendChild(cb);
      } else if (prop.enum && Array.isArray(prop.enum)) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '4px';
        prop.enum.forEach((opt) => {
          const optLabel = document.createElement('label');
          optLabel.style.display = 'flex';
          optLabel.style.alignItems = 'center';
          optLabel.style.gap = '6px';
          optLabel.style.cursor = 'pointer';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `ext-cfg-${key}`;
          radio.value = String(opt);
          radio.checked = String(curVal) === String(opt);
          radio.addEventListener('change', () => { _extConfigValues[key] = opt; });
          optLabel.appendChild(radio);
          optLabel.appendChild(document.createTextNode(String(opt)));
          wrap.appendChild(optLabel);
        });
        fieldRow.appendChild(wrap);
      } else if (prop.type === 'number' || prop.type === 'integer') {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'lsp-rootrel-input';
        input.style.width = '100%';
        input.value = curVal != null ? String(curVal) : '';
        if (prop.minimum != null) input.min = String(prop.minimum);
        if (prop.maximum != null) input.max = String(prop.maximum);
        input.addEventListener('input', () => {
          _extConfigValues[key] = input.value === '' ? null : Number(input.value);
        });
        fieldRow.appendChild(input);
      } else {
        // string / fallback
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'lsp-rootrel-input';
        input.style.width = '100%';
        input.value = curVal != null ? String(curVal) : '';
        input.placeholder = prop.default != null ? String(prop.default) : '';
        input.addEventListener('input', () => { _extConfigValues[key] = input.value; });
        fieldRow.appendChild(input);
      }

      extConfigForm.appendChild(fieldRow);
    });
  }

  extConfigModal.classList.add('show');
  extConfigModal.setAttribute('aria-hidden', 'false');
}

function closeExtConfigModal() {
  extConfigModal.classList.remove('show');
  extConfigModal.setAttribute('aria-hidden', 'true');
  _extConfigExtId = '';
  _extConfigValues = {};
}

extConfigClose.addEventListener('click', closeExtConfigModal);
extConfigCancel.addEventListener('click', closeExtConfigModal);
extConfigModal.addEventListener('click', (ev) => {
  if (ev.target === extConfigModal) closeExtConfigModal();
});

extConfigSave.addEventListener('click', async () => {
  if (!_extConfigExtId) return;
  extConfigSave.disabled = true;
  try {
    const res = await window.__explorerBusRequest('ext:configure', {
      ext_id: _extConfigExtId,
      values: _extConfigValues,
    }, 15000);
    if (res?.payload?.ok) {
      host.toast('Configuration saved');
      closeExtConfigModal();
      void refreshEditorExtManagerModal();
    } else {
      host.toast(res?.payload?.error || 'Save failed');
    }
  } catch (e) {
    host.toast(e?.message || 'Save failed');
  } finally {
    extConfigSave.disabled = false;
  }
});

// --- Install extension via file picker ---
editorExtManagerInstallBtn.addEventListener('click', async () => {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return; }
  const start = lastPickerPath || HOME_DIR;
  const picked = await pickFile(start);
  if (!picked) return;
  if (!picked.toLowerCase().endsWith('.vsix')) {
    host.toast('Not a .vsix file');
    return;
  }
  editorExtManagerInstallBtn.disabled = true;
  editorExtManagerInstallBtn.textContent = 'Installing…';
  try {
    const res = await window.__explorerBusRequest('ext:install', { vsix_path: picked }, 60000);
    const payload = res?.payload || {};
    if (payload.ok) {
      const ext = payload.extension || {};
      const schema = payload.config_schema || {};
      host.toast(`Installed: ${ext.display_name || ext.id || 'ok'}`);
      void refreshEditorExtManagerModal();
      // If extension has config, open config modal
      if (schema && Object.keys(schema.properties || schema || {}).length) {
        openExtConfigModal(ext.id, ext.display_name, schema, {});
      }
    } else {
      host.toast(payload.error || 'Install failed');
    }
  } catch (e) {
    host.toast(e?.message || 'Install failed');
  } finally {
    editorExtManagerInstallBtn.disabled = false;
    editorExtManagerInstallBtn.textContent = '+ Install';
  }
});

// --- Custom Settings (JSON textarea) ---
async function loadCustomSettings() {
  try {
    const res = await window.__explorerBusRequest('ext:custom_settings_get', {}, 8000);
    const settings = res?.payload?.settings || {};
    const keys = Object.keys(settings);
    extCustomSettingsInput.value = keys.length
      ? JSON.stringify(settings, null, 2)
      : '';
  } catch (_) {
    extCustomSettingsInput.value = '';
  }
}

extCustomSettingsSave.addEventListener('click', async () => {
  const raw = extCustomSettingsInput.value.trim();
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      host.toast('Invalid JSON: ' + e.message);
      return;
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      host.toast('Settings must be a JSON object');
      return;
    }
  }
  extCustomSettingsSave.disabled = true;
  extCustomSettingsSave.textContent = 'Saving…';
  try {
    const res = await window.__explorerBusRequest('ext:custom_settings_set', {
      settings: parsed,
    }, 15000);
    if (res?.payload?.ok) {
      host.toast(`Custom settings saved (${res.payload.count} keys). Restart code-server to apply.`);
    } else {
      host.toast(res?.payload?.error || 'Save failed');
    }
  } catch (e) {
    host.toast(e?.message || 'Save failed');
  } finally {
    extCustomSettingsSave.disabled = false;
    extCustomSettingsSave.textContent = 'Save';
  }
});

async function refreshEditorSettingsModal() {
  // Theme strip summary
  const currentTheme = editorViewState?.theme || 'github-dark-default';
  try {
    const res = await fetch('/api/app/file_editor_cm6/ui/monaco_editor/available_themes', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const themes = data?.themes || [];
      const active = themes.find((t) => t.id === currentTheme);
      const label = active ? active.label : currentTheme;
      editorSettingsThemeSummary.textContent = `${label} — ${themes.length} available`;
    } else {
      editorSettingsThemeSummary.textContent = currentTheme;
    }
  } catch (_) {
    editorSettingsThemeSummary.textContent = currentTheme;
  }

  // Extension summary for the strip
  try {
    if (typeof window.__explorerBusRequest === 'function') {
      const res = await window.__explorerBusRequest('ext:list', {}, 8000);
      const exts = res?.payload?.extensions || [];
      const active = exts.filter((e) => e.active);
      const user = exts.filter((e) => e.source === 'user');
      editorSettingsExtSummary.textContent =
        `${active.length} active, ${user.length} user-installed, ${exts.length} total`;
    }
  } catch (_) {
    editorSettingsExtSummary.textContent = 'Click to manage';
  }

  // Watcher config: request fresh state from server
  try {
    if (typeof window.__explorerBusSend === 'function') {
      window.__explorerBusSend('watcher:getConfig', {});
    }
  } catch (_) {}
}

async function refreshEditorExtManagerModal() {
  editorExtManagerList.textContent = 'Loading…';
  let extensions = [];
  let langSlots = {};
  try {
    const res = await window.__explorerBusRequest('ext:list', {}, 10000);
    extensions = res?.payload?.extensions || [];
    langSlots = res?.payload?.language_slots || {};
  } catch (e) {
    editorExtManagerList.textContent = `Failed to load: ${e?.message || 'unknown error'}`;
    return;
  }

  editorExtManagerList.innerHTML = '';
  if (!extensions.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.8';
    empty.textContent = 'No extensions registered.';
    editorExtManagerList.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';

  extensions
    .slice()
    .sort((a, b) => {
      // user extensions first, then builtins
      if (a.source !== b.source) return a.source === 'user' ? -1 : 1;
      return String(a.display_name || a.id).localeCompare(String(b.display_name || b.id));
    })
    .forEach((ext) => {
      const extId = String(ext.id || '').trim();
      if (!extId) return;
      const label = String(ext.display_name || extId);
      const version = String(ext.version || '');
      const isBuiltin = ext.source === 'builtin';
      const isActive = !!ext.active;
      const langs = ext.languages || [];
      const hasConfig = !!ext.has_config;

      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'flex-start';
      card.style.gap = '10px';
      card.style.padding = '10px 12px';
      card.style.border = '1px solid var(--border, #333)';
      card.style.borderRadius = '10px';
      if (!isActive) card.style.opacity = '0.5';

      // Left: info
      const info = document.createElement('div');
      info.style.flex = '1';
      info.style.minWidth = '0';

      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.gap = '6px';
      titleRow.style.flexWrap = 'wrap';

      const nameEl = document.createElement('span');
      nameEl.textContent = label;
      nameEl.style.fontWeight = '700';
      titleRow.appendChild(nameEl);

      if (version) {
        const verEl = document.createElement('span');
        verEl.textContent = `v${version}`;
        verEl.style.opacity = '0.5';
        verEl.style.fontSize = '12px';
        titleRow.appendChild(verEl);
      }

      const badge = document.createElement('span');
      badge.textContent = isBuiltin ? 'built-in' : 'user';
      badge.style.fontSize = '10px';
      badge.style.padding = '1px 6px';
      badge.style.borderRadius = '4px';
      badge.style.border = '1px solid var(--border, #333)';
      badge.style.opacity = '0.6';
      titleRow.appendChild(badge);
      info.appendChild(titleRow);

      if (langs.length) {
        const langEl = document.createElement('div');
        langEl.style.fontSize = '12px';
        langEl.style.opacity = '0.7';
        langEl.style.marginTop = '2px';
        langEl.textContent = langs.join(', ');
        info.appendChild(langEl);
      }

      card.appendChild(info);

      // Right: action buttons
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.alignItems = 'center';
      actions.style.flexShrink = '0';

      // Active toggle
      const toggle = document.createElement('button');
      toggle.className = 'fe-btn';
      toggle.textContent = isActive ? '●' : '○';
      toggle.title = isActive ? 'Deactivate' : 'Activate';
      toggle.style.fontSize = '14px';
      toggle.style.color = isActive ? 'var(--primary, #3b82f6)' : '';
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await window.__explorerBusRequest('ext:toggle', {
            ext_id: extId,
            active: !isActive,
          }, 10000);
          void refreshEditorExtManagerModal();
        } catch (e) {
          host.toast(e?.message || 'Toggle failed');
        } finally {
          toggle.disabled = false;
        }
      });
      actions.appendChild(toggle);

      // Configure button (only if extension has config)
      if (hasConfig) {
        const cfgBtn = document.createElement('button');
        cfgBtn.className = 'fe-btn';
        cfgBtn.textContent = '⚙';
        cfgBtn.title = 'Configure';
        cfgBtn.addEventListener('click', async () => {
          cfgBtn.disabled = true;
          try {
            const res = await window.__explorerBusRequest('ext:configSchema', {
              ext_id: extId,
            }, 10000);
            const schema = res?.payload?.schema || {};
            // Fetch current values too
            const currentValues = {};
            try {
              const listRes = await window.__explorerBusRequest('ext:list', {}, 5000);
              const fullExt = (listRes?.payload?.extensions || []).find((e) => e.id === extId);
              if (fullExt?.configuration_values) Object.assign(currentValues, fullExt.configuration_values);
            } catch (_) {}
            openExtConfigModal(extId, label, schema, currentValues);
          } catch (e) {
            host.toast(e?.message || 'Failed to load config');
          } finally {
            cfgBtn.disabled = false;
          }
        });
        actions.appendChild(cfgBtn);
      }

      // Uninstall button (only for user extensions)
      if (!isBuiltin) {
        const trash = document.createElement('button');
        trash.className = 'fe-btn';
        trash.textContent = '🗑';
        trash.title = 'Uninstall';
        trash.addEventListener('click', async () => {
          if (!window.confirm(`Uninstall ${label}?`)) return;
          trash.disabled = true;
          try {
            const res = await window.__explorerBusRequest('ext:uninstall', {
              ext_id: extId,
            }, 30000);
            if (res?.payload?.ok) {
              host.toast(`Uninstalled: ${label}`);
              void refreshEditorExtManagerModal();
            } else {
              host.toast(res?.payload?.error || 'Uninstall failed');
            }
          } catch (e) {
            host.toast(e?.message || 'Uninstall failed');
          } finally {
            trash.disabled = false;
          }
        });
        actions.appendChild(trash);
      }

      card.appendChild(actions);
      list.appendChild(card);
    });

  editorExtManagerList.appendChild(list);
}

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
let _agentSettingsUiMutating = false;
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
let _agentShortcutsCache = [];
let _agentShortcutEditingId = null;
let _agentShortcutEditingAssetName = null;
let _agentToggleEditingAssetName = null;

function _setAgentIframeUrlInputEnabled(enabled) {
  if (!editorSettingsAgentIframeUrlInput) return;
  editorSettingsAgentIframeUrlInput.disabled = !enabled;
  editorSettingsAgentIframeUrlInput.style.opacity = enabled ? '1' : '0.72';
}

function _agentIconUrlFromName(name) {
  const safe = String(name || '').trim();
  if (!safe) return '';
  return `/api/app/file_editor_cm6/agent_icons/${encodeURIComponent(safe)}`;
}

function _renderAgentIconInto(el, icon) {
  if (!el) return;
  el.textContent = '';
  const i = icon && typeof icon === 'object' ? icon : null;
  const kind = i && typeof i.kind === 'string' ? i.kind : '';
  if (kind === 'emoji') {
    const emoji = typeof i.emoji === 'string' ? i.emoji.trim() : '';
    el.textContent = emoji || (el.dataset?.defaultIcon || '💬');
    return;
  }
  if (kind === 'asset') {
    const name = typeof i.name === 'string' ? i.name.trim() : '';
    if (!name) {
      el.textContent = el.dataset?.defaultIcon || '💬';
      return;
    }
    const img = document.createElement('img');
    img.src = _agentIconUrlFromName(name);
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
    return;
  }
  // Fallback: keep whatever is already there (manifest icon) if possible.
  el.textContent = el.dataset?.defaultIcon || '💬';
}

function _applyAgentToggleToolbar(uiPrefs) {
  const btn = document.getElementById('fe-agent-toggle');
  if (!btn) return;
  const iconEl = btn.querySelector('.fe-agent-icon');
  if (!iconEl) return;

  const currentUrl = typeof uiPrefs?.[UI_PREF_KEY_AGENT_IFRAME_URL] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_IFRAME_URL].trim()
    : '';

  // If the active URL matches a shortcut with an icon, that icon wins.
  const shortcuts = Array.isArray(uiPrefs?.[UI_PREF_KEY_AGENT_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_AGENT_SHORTCUTS]
    : [];
  let shortcutIcon = null;
  if (currentUrl) {
    const match = shortcuts.find((sc) => sc && typeof sc === 'object' && sc.url === currentUrl);
    if (match && match.icon && typeof match.icon === 'object') {
      shortcutIcon = match.icon;
    }
  }

  const icon = shortcutIcon || uiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_ICON] || null;
  if (icon && typeof icon === 'object' && icon.kind && icon.kind !== 'default') {
    _renderAgentIconInto(iconEl, icon);
  }
}

function _applyAgentSettingsControls(uiPrefs) {
  const enabled = parseBoolean(uiPrefs?.[UI_PREF_KEY_AGENT_IFRAME]);
  const explicitUrl =
    typeof uiPrefs?.[UI_PREF_KEY_AGENT_IFRAME_URL] === 'string'
      ? uiPrefs[UI_PREF_KEY_AGENT_IFRAME_URL].trim()
      : '';
  const display = typeof uiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY].trim()
    : 'icon';
  const toggleText = typeof uiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_TEXT] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_TOGGLE_TEXT].trim()
    : 'Agent';
  const toggleIcon = uiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_ICON];
  const shortcuts = Array.isArray(uiPrefs?.[UI_PREF_KEY_AGENT_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_AGENT_SHORTCUTS]
    : [];

  _agentSettingsUiMutating = true;
  try {
    editorSettingsAgentIframeToggle.checked = enabled;
    editorSettingsAgentIframeUrlInput.value = explicitUrl;
    _setAgentIframeUrlInputEnabled(enabled);

    // Toggle display radios
    try {
      const radios = document.querySelectorAll('input[name="agent-toggle-display"]');
      radios.forEach((r) => { r.checked = (r.value === display); });
    } catch (_) {}

    editorSettingsAgentToggleText.value = toggleText || 'Agent';
    if (toggleIcon && typeof toggleIcon === 'object' && toggleIcon.kind === 'emoji') {
      editorSettingsAgentToggleEmoji.value = String(toggleIcon.emoji || '').trim();
      _agentToggleEditingAssetName = null;
    } else if (toggleIcon && typeof toggleIcon === 'object' && toggleIcon.kind === 'asset') {
      editorSettingsAgentToggleEmoji.value = '';
      _agentToggleEditingAssetName = String(toggleIcon.name || '').trim() || null;
    } else {
      editorSettingsAgentToggleEmoji.value = '';
      _agentToggleEditingAssetName = null;
    }

    _agentShortcutsCache = shortcuts.slice();
  } finally {
    _agentSettingsUiMutating = false;
  }

  _applyAgentToggleToolbar(uiPrefs);
}

function _sendAgentUiPrefUpdate(key, value) {
  if (typeof window.__explorerBusSend !== 'function') {
    host.toast('Explorer WebSocket is not connected yet.');
    return;
  }
  window.__explorerBusSend('prefs:updateUi', { key, value });
}

function _applyAgentIframeUrlToDom(url) {
  const iframe = document.getElementById('agent-iframe');
  if (!iframe) return;
  const next = String(url || '').trim();
  if (!next) return;
  const current = String(iframe.getAttribute('src') || '').trim();
  if (current !== next) {
    iframe.setAttribute('src', next);
  }
}

function _renderShortcutIconNode(icon, sizePx = 16) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  wrap.style.width = `${sizePx}px`;
  wrap.style.height = `${sizePx}px`;
  const i = icon && typeof icon === 'object' ? icon : null;
  if (!i) return wrap;
  if (i.kind === 'emoji') {
    wrap.textContent = String(i.emoji || '').trim();
    return wrap;
  }
  if (i.kind === 'asset') {
    const name = String(i.name || '').trim();
    if (!name) return wrap;
    const img = document.createElement('img');
    img.src = _agentIconUrlFromName(name);
    img.alt = '';
    img.style.width = `${sizePx}px`;
    img.style.height = `${sizePx}px`;
    img.style.objectFit = 'contain';
    wrap.appendChild(img);
  }
  return wrap;
}

function _renderAgentDropdown() {
  const dd = document.getElementById('fe-agent-dd');
  if (!dd) return;
  dd.innerHTML = '';

  const display = typeof _latestUiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY] === 'string'
    ? _latestUiPrefs[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY].trim()
    : 'icon';

  const shortcuts = Array.isArray(_agentShortcutsCache) ? _agentShortcutsCache : [];
  if (!shortcuts.length) {
    const empty = document.createElement('div');
    empty.className = 'fe-dd-item';
    empty.style.opacity = '0.7';
    empty.textContent = 'No shortcuts';
    dd.appendChild(empty);
  } else {
    shortcuts.forEach((sc) => {
      const label = typeof sc?.label === 'string' ? sc.label : '';
      const url = typeof sc?.url === 'string' ? sc.url : '';
      if (!label || !url) return;
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.style.display = 'flex';
      item.style.gap = '8px';
      item.style.alignItems = 'center';
      if (display === 'icon' || display === 'both') {
        item.appendChild(_renderShortcutIconNode(sc.icon, 16));
      }
      if (display === 'text' || display === 'both') {
        const text = document.createElement('span');
        text.textContent = label;
        item.appendChild(text);
      } else {
        item.title = label;
      }
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        _closeAgentDropdown();
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_IFRAME, true);
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_IFRAME_URL, url);
        // Give the controller rebind a beat if mode changes.
        setTimeout(() => { try { agentDrawerHandle?.open?.(); } catch (_) {} }, 120);
      });
      dd.appendChild(item);
    });
  }

  const sep = document.createElement('div');
  sep.className = 'fe-dd-separator';
  sep.style.margin = '6px 0';
  dd.appendChild(sep);

  const manage = document.createElement('div');
  manage.className = 'fe-dd-item';
  manage.textContent = 'Manage shortcuts…';
  manage.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _closeAgentDropdown();
    _openAgentShortcutsModal();
  });
  dd.appendChild(manage);
}

function _closeAgentDropdown() {
  const dd = document.getElementById('fe-agent-dd');
  if (!dd) return;
  dd.classList.remove('show');
}

function _openAgentDropdown() {
  const dd = document.getElementById('fe-agent-dd');
  if (!dd) return;
  try { closeAllMenus(); } catch (_) {}
  _renderAgentDropdown();
  dd.classList.add('show');
}

function _openAgentShortcutsModal() {
  agentShortcutsModal.classList.add('show');
  agentShortcutsModal.setAttribute('aria-hidden', 'false');
  _renderAgentShortcutsList();
}

function _closeAgentShortcutsModal() {
  agentShortcutsModal.classList.remove('show');
  agentShortcutsModal.setAttribute('aria-hidden', 'true');
  _hideAgentShortcutEditor();
}

function _hideAgentShortcutEditor() {
  agentShortcutsEditor.style.display = 'none';
  _agentShortcutEditingId = null;
  _agentShortcutEditingAssetName = null;
  agentShortcutLabel.value = '';
  agentShortcutUrl.value = '';
  agentShortcutEmoji.value = '';
  agentShortcutIconPreview.textContent = '';
}

function _showAgentShortcutEditor(entry) {
  agentShortcutsEditor.style.display = '';
  const e = entry && typeof entry === 'object' ? entry : {};
  _agentShortcutEditingId = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : null;
  agentShortcutLabel.value = typeof e.label === 'string' ? e.label : '';
  agentShortcutUrl.value = typeof e.url === 'string' ? e.url : '';

  const icon = e.icon && typeof e.icon === 'object' ? e.icon : null;
  _agentShortcutEditingAssetName = null;
  agentShortcutEmoji.value = '';
  if (icon && icon.kind === 'emoji') {
    agentShortcutEmoji.value = String(icon.emoji || '').trim();
  } else if (icon && icon.kind === 'asset') {
    _agentShortcutEditingAssetName = String(icon.name || '').trim() || null;
  }
  _renderAgentShortcutPreview();
}

function _renderAgentShortcutPreview() {
  agentShortcutIconPreview.textContent = '';
  if (_agentShortcutEditingAssetName) {
    const img = document.createElement('img');
    img.src = _agentIconUrlFromName(_agentShortcutEditingAssetName);
    img.alt = '';
    img.style.width = '18px';
    img.style.height = '18px';
    img.style.objectFit = 'contain';
    agentShortcutIconPreview.appendChild(img);
    return;
  }
  const em = String(agentShortcutEmoji.value || '').trim();
  if (em) {
    agentShortcutIconPreview.textContent = em;
  }
}

function _persistAgentShortcuts(nextList) {
  _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_SHORTCUTS, nextList);
}

function _renderAgentShortcutsList() {
  agentShortcutsList.innerHTML = '';
  const shortcuts = Array.isArray(_agentShortcutsCache) ? _agentShortcutsCache.slice() : [];
  if (!shortcuts.length) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.7';
    empty.textContent = 'No shortcuts yet.';
    agentShortcutsList.appendChild(empty);
    return;
  }
  shortcuts.forEach((sc, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

    const icon = _renderShortcutIconNode(sc.icon, 18);
    row.appendChild(icon);

    const meta = document.createElement('div');
    meta.style.flex = '1';
    const title = document.createElement('div');
    title.textContent = sc.label || '(no label)';
    const url = document.createElement('div');
    url.style.fontSize = '0.78rem';
    url.style.opacity = '0.7';
    url.textContent = sc.url || '';
    meta.appendChild(title);
    meta.appendChild(url);
    row.appendChild(meta);

    const btn = (text) => {
      const b = document.createElement('button');
      b.className = 'fe-btn';
      b.textContent = text;
      return b;
    };

    const up = btn('↑');
    up.title = 'Move up';
    up.disabled = idx === 0;
    up.addEventListener('click', () => {
      if (idx <= 0) return;
      const next = shortcuts.slice();
      const t = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = t;
      _persistAgentShortcuts(next);
    });
    row.appendChild(up);

    const down = btn('↓');
    down.title = 'Move down';
    down.disabled = idx >= shortcuts.length - 1;
    down.addEventListener('click', () => {
      if (idx >= shortcuts.length - 1) return;
      const next = shortcuts.slice();
      const t = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = t;
      _persistAgentShortcuts(next);
    });
    row.appendChild(down);

    const edit = btn('Edit');
    edit.addEventListener('click', () => _showAgentShortcutEditor(sc));
    row.appendChild(edit);

    const del = btn('Delete');
    del.addEventListener('click', () => {
      const next = shortcuts.slice();
      next.splice(idx, 1);
      _persistAgentShortcuts(next);
      _hideAgentShortcutEditor();
    });
    row.appendChild(del);

    agentShortcutsList.appendChild(row);
  });
}

function _createAgentController(config) {
  const enabled = !!config?.enabled;
  _agentRuntimeMode = enabled ? 'iframe' : 'drawer';
  if (enabled) {
    return initAgentIframe({
      url: config.url,
      title: 'Agent',
      allowAnyOrigin: true,
      hideDrawerHeader: config.hideDrawerHeader !== false,
    });
  }
  return initAgentDrawer();
}

function _destroyAgentController() {
  if (!agentDrawerHandle) return;
  try {
    agentDrawerHandle.close?.();
  } catch (_) {}
  try {
    agentDrawerHandle.destroy?.();
  } catch (_) {}
  agentDrawerHandle = null;
}

function _rebindAgentController(config) {
  const drawerEl = document.getElementById('agent-drawer');
  const wasOpen = !!(drawerEl && drawerEl.classList.contains('open'));
  _destroyAgentController();
  agentDrawerHandle = _createAgentController(config);
  if (wasOpen) {
    try {
      agentDrawerHandle?.open?.();
    } catch (_) {}
  }
}

async function _applyAgentRuntimeConfigFromUi(uiPrefs) {
  const seq = ++_agentConfigApplySeq;
  const config = await resolveAgentIframeSettings(uiPrefs || {});
  if (seq !== _agentConfigApplySeq) return config;

  const previous = _agentRuntimeConfig;
  _agentRuntimeConfig = config;

  try {
    window.__agentHostBase = new URL(config.url, window.location.href).origin;
  } catch (_) {
    window.__agentHostBase = getAgentHostBase();
  }

  try {
    if (config.url) {
      localStorage.setItem(AGENT_IFRAME_STORAGE_KEY, config.url);
    }
  } catch (_) {}

  if (!agentDrawerHandle) {
    return config;
  }

  const nextMode = config.enabled ? 'iframe' : 'drawer';
  const currentMode = _agentRuntimeMode || nextMode;
  const modeChanged = currentMode !== nextMode;
  const headerChanged =
    nextMode === 'iframe'
    && !!previous
    && previous.hideDrawerHeader !== config.hideDrawerHeader;

  if (modeChanged || headerChanged) {
    _rebindAgentController(config);
    return config;
  }

  if (nextMode === 'iframe') {
    if (typeof agentDrawerHandle?.setUrl === 'function') {
      agentDrawerHandle.setUrl(config.url);
    } else {
      _applyAgentIframeUrlToDom(config.url);
    }
  }

  return config;
}

function _initAgentSettingsUI() {
  editorSettingsAgentIframeToggle.addEventListener('change', () => {
    if (_agentSettingsUiMutating) return;
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_IFRAME, !!editorSettingsAgentIframeToggle.checked);
  });

  const sendUrlUpdate = () => {
    if (_agentSettingsUiMutating) return;
    _sendAgentUiPrefUpdate(
      UI_PREF_KEY_AGENT_IFRAME_URL,
      (editorSettingsAgentIframeUrlInput.value || '').trim(),
    );
  };

  editorSettingsAgentIframeUrlInput.addEventListener('change', sendUrlUpdate);
  editorSettingsAgentIframeUrlInput.addEventListener('blur', sendUrlUpdate);
  editorSettingsAgentIframeUrlInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      sendUrlUpdate();
      editorSettingsAgentIframeUrlInput.blur();
    }
  });

  // Toggle display radios
  try {
    const radios = document.querySelectorAll('input[name="agent-toggle-display"]');
    radios.forEach((r) => {
      r.addEventListener('change', () => {
        if (_agentSettingsUiMutating) return;
        if (!r.checked) return;
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_TOGGLE_DISPLAY, r.value);
      });
    });
  } catch (_) {}

  const sendToggleText = () => {
    if (_agentSettingsUiMutating) return;
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_TOGGLE_TEXT, (editorSettingsAgentToggleText.value || '').trim());
  };
  editorSettingsAgentToggleText.addEventListener('change', sendToggleText);
  editorSettingsAgentToggleText.addEventListener('blur', sendToggleText);

  editorSettingsAgentToggleEmoji.addEventListener('change', () => {
    if (_agentSettingsUiMutating) return;
    const em = (editorSettingsAgentToggleEmoji.value || '').trim();
    if (!em) return;
    _agentToggleEditingAssetName = null;
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_TOGGLE_ICON, { kind: 'emoji', emoji: em });
  });

  editorSettingsAgentToggleIconBrowse.addEventListener('click', async () => {
    if (typeof window.__explorerBusRequest !== 'function') {
      host.toast('Explorer connection unavailable');
      return;
    }
    const picked = await pickFile(lastPickerPath || HOME_DIR);
    if (!picked) return;
    try {
      const res = await window.__explorerBusRequest('prefs:vendorAgentIcon', { abs_path: picked }, 12000);
      if (res?.payload?.ok && res.payload.name) {
        _agentToggleEditingAssetName = res.payload.name;
        _agentSettingsUiMutating = true;
        try { editorSettingsAgentToggleEmoji.value = ''; } finally { _agentSettingsUiMutating = false; }
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_TOGGLE_ICON, { kind: 'asset', name: res.payload.name });
      }
    } catch (e) {
      host.toast(e?.message || 'Failed to vendor icon');
    }
  });

  editorSettingsAgentToggleIconClear.addEventListener('click', () => {
    if (_agentSettingsUiMutating) return;
    _agentToggleEditingAssetName = null;
    _agentSettingsUiMutating = true;
    try { editorSettingsAgentToggleEmoji.value = ''; } finally { _agentSettingsUiMutating = false; }
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_TOGGLE_ICON, { kind: 'default' });
  });

  editorSettingsAgentShortcutsBtn.addEventListener('click', () => {
    _openAgentShortcutsModal();
  });

  agentShortcutsClose.addEventListener('click', _closeAgentShortcutsModal);
  agentShortcutsModal.addEventListener('click', (ev) => {
    if (ev.target === agentShortcutsModal) _closeAgentShortcutsModal();
  });
  agentShortcutsAdd.addEventListener('click', () => _showAgentShortcutEditor({}));
  agentShortcutCancel.addEventListener('click', _hideAgentShortcutEditor);
  agentShortcutEmoji.addEventListener('input', _renderAgentShortcutPreview);

  agentShortcutIconBrowse.addEventListener('click', async () => {
    if (typeof window.__explorerBusRequest !== 'function') {
      host.toast('Explorer connection unavailable');
      return;
    }
    const picked = await pickFile(lastPickerPath || HOME_DIR);
    if (!picked) return;
    try {
      const res = await window.__explorerBusRequest('prefs:vendorAgentIcon', { abs_path: picked }, 12000);
      if (res?.payload?.ok && res.payload.name) {
        _agentShortcutEditingAssetName = res.payload.name;
        agentShortcutEmoji.value = '';
        _renderAgentShortcutPreview();
      }
    } catch (e) {
      host.toast(e?.message || 'Failed to vendor icon');
    }
  });

  agentShortcutIconClear.addEventListener('click', () => {
    _agentShortcutEditingAssetName = null;
    agentShortcutEmoji.value = '';
    _renderAgentShortcutPreview();
  });

  agentShortcutSave.addEventListener('click', () => {
    const label = (agentShortcutLabel.value || '').trim();
    const url = (agentShortcutUrl.value || '').trim();
    if (!label || !url) {
      host.toast('Label and URL are required');
      return;
    }
    const id = _agentShortcutEditingId || `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let icon = null;
    if (_agentShortcutEditingAssetName) {
      icon = { kind: 'asset', name: _agentShortcutEditingAssetName };
    } else {
      const em = (agentShortcutEmoji.value || '').trim();
      if (em) icon = { kind: 'emoji', emoji: em };
    }
    const next = Array.isArray(_agentShortcutsCache) ? _agentShortcutsCache.slice() : [];
    const idx = next.findIndex((x) => x && x.id === id);
    const entry = { id, label, url, icon };
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    _persistAgentShortcuts(next);
    _hideAgentShortcutEditor();
  });

  _applyAgentSettingsControls(_latestUiPrefs || {});

  // Agent dropdown: right-click + long-press.
  try {
    const agentBtn = document.getElementById('fe-agent-toggle');
    if (agentBtn) {
      let longPressTimer = null;
      let suppressUntil = 0;
      agentBtn.addEventListener('click', (ev) => {
        if (Date.now() < suppressUntil) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          suppressUntil = 0;
        }
      }, true);
      agentBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openAgentDropdown();
      });
      agentBtn.addEventListener('touchstart', (ev) => {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          suppressUntil = Date.now() + 900;
          _openAgentDropdown();
        }, 520);
      }, { passive: true });
      const clearLp = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
      agentBtn.addEventListener('touchend', clearLp, { passive: true });
      agentBtn.addEventListener('touchcancel', clearLp, { passive: true });
      document.addEventListener('click', (ev) => {
        const dd = document.getElementById('fe-agent-dd');
        if (!dd || !dd.classList.contains('show')) return;
        if (ev.target.closest('#fe-agent-toggle')) return;
        if (ev.target.closest('#fe-agent-dd')) return;
        _closeAgentDropdown();
      }, false);
    }
  } catch (_) {}
}

window.__cm6HandleUiPrefs = function(payload) {
  try {
    const ui =
      payload && typeof payload.ui === 'object' && payload.ui
        ? payload.ui
        : {};
    _latestUiPrefs = { ...ui };
    _hasUiPrefsSnapshot = true;
    _resolveUiPrefsWaiters(_latestUiPrefs);
    _applyAgentSettingsControls(_latestUiPrefs);
    if (agentDrawerHandle) {
      void _applyAgentRuntimeConfigFromUi(_latestUiPrefs);
    }
    // Keep agent dropdown in sync if open.
    try {
      const dd = document.getElementById('fe-agent-dd');
      if (dd && dd.classList.contains('show')) {
        _renderAgentDropdown();
      }
    } catch (_) {}
    // Keep shortcuts modal list in sync while open.
    try {
      if (agentShortcutsModal && agentShortcutsModal.classList.contains('show')) {
        _renderAgentShortcutsList();
      }
    } catch (_) {}
  } catch (err) {
    console.warn('[AgentPrefs] Failed to apply prefs:setUi payload:', err);
  }
};

try {
  if (window.__cm6PendingUiPrefs) {
    window.__cm6HandleUiPrefs(window.__cm6PendingUiPrefs);
    window.__cm6PendingUiPrefs = null;
  }
} catch (_) {}

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

window.__cm6RequestGitBaselines = function() {
  try {
    if (!editorSocket || !editorSocket.connected) return false;
    if (!currentPath) return false;
    editorSocket.emit('editor_git_baselines_request', { path: currentPath });
    return true;
  } catch (_) {
    return false;
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
async function saveFile(opts) {
  if (!currentPath || !currentPathExists) return saveAsDialog();
  const isAutosave = !!(opts && opts.isAutosave);
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
        // Autosave silently skips on mismatch (mirror clients hit this)
        if (isAutosave) {
          statusEl.textContent = '';
          return false;
        }
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
      saveFile({ isAutosave: true }).then((ok) => {
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
  // On ENOSPC, show the standalone raise modal
  const warning = msg
    ? `${msg}\n\nAttempt to raise the limit now?`
    : 'File watcher limit reached. Attempt to raise now?';
  showWatcherLimitModal(warning, limit);
};

window.__cm6HandleWatcherRaiseResult = (payload) => {
  if (!payload) return;
  const statusEl = document.getElementById('watcher-raise-status');
  if (payload.ok) {
    host.toast(payload.stdout || 'Watcher limit updated — IPC watcher resubscribed');
    if (statusEl) statusEl.textContent = '✓ Limit raised successfully';
    _updateWatcherStatusIndicator('ipc');
  } else {
    const err = payload.stderr || payload.stdout || 'Failed to raise watcher limit';
    host.toast(err);
    if (statusEl) statusEl.textContent = `✗ ${err}`;
  }
};

// ── Watcher settings UI (integrated into editor-settings-modal) ──
let _watcherConfig = { mode: 'ipc', storage_type: 'ssd', poll_interval_ms: 1500, watchexec_available: false };

function _initWatcherSettingsUI() {
  const modeRadios = document.querySelectorAll('input[name="watcher-mode"]');
  const storageRadios = document.querySelectorAll('input[name="watcher-storage"]');
  const watchexecOpts = document.getElementById('watcher-watchexec-opts');
  const watchexecLabel = document.getElementById('watcher-mode-watchexec-label');
  const raiseBtn = document.getElementById('watcher-raise-btn');
  const raisePwd = document.getElementById('watcher-raise-password');
  const raiseStatus = document.getElementById('watcher-raise-status');

  // Show/hide watchexec sub-options based on mode selection
  modeRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (watchexecOpts) {
        watchexecOpts.style.display = r.value === 'watchexec' && r.checked ? 'block' : '';
        if (r.value !== 'watchexec') watchexecOpts.style.display = 'none';
      }
      if (r.checked) _sendWatcherMode(r.value);
    });
  });

  storageRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        const modeEl = document.querySelector('input[name="watcher-mode"]:checked');
        if (modeEl) _sendWatcherMode(modeEl.value);
      }
    });
  });

  // Raise limit button
  if (raiseBtn) {
    raiseBtn.addEventListener('click', () => {
      showWatcherLimitModal('Raise the inotify watch limit?', 524288);
    });
  }
}

function _sendWatcherMode(mode) {
  const storageEl = document.querySelector('input[name="watcher-storage"]:checked');
  const storageType = storageEl ? storageEl.value : 'ssd';
  if (typeof window.__explorerBusSend === 'function') {
    window.__explorerBusSend('watcher:setMode', { mode, storage_type: storageType });
  }
}

function _applyWatcherConfig(cfg) {
  _watcherConfig = { ..._watcherConfig, ...cfg };

  // Apply mode radio
  const modeRadios = document.querySelectorAll('input[name="watcher-mode"]');
  modeRadios.forEach(r => { r.checked = r.value === cfg.mode; });

  // Apply storage radio
  const storageRadios = document.querySelectorAll('input[name="watcher-storage"]');
  storageRadios.forEach(r => { r.checked = r.value === cfg.storage_type; });

  // Show/hide watchexec options
  const watchexecOpts = document.getElementById('watcher-watchexec-opts');
  if (watchexecOpts) watchexecOpts.style.display = cfg.mode === 'watchexec' ? 'block' : 'none';

  // Grey out watchexec if not available
  const watchexecRadio = document.querySelector('input[name="watcher-mode"][value="watchexec"]');
  const watchexecLabel = document.getElementById('watcher-mode-watchexec-label');
  if (watchexecRadio && !cfg.watchexec_available) {
    watchexecRadio.disabled = true;
    if (watchexecLabel) watchexecLabel.style.opacity = '0.4';
  } else if (watchexecRadio) {
    watchexecRadio.disabled = false;
    if (watchexecLabel) watchexecLabel.style.opacity = '';
  }

  _updateWatcherStatusIndicator(cfg.mode);
}

function _updateWatcherStatusIndicator(mode) {
  const indicator = document.getElementById('watcher-status-indicator');
  if (indicator) {
    const labels = { ipc: 'VS Code IPC', watchexec: 'watchexec poll', none: 'None (manual)' };
    indicator.textContent = `Active: ${labels[mode] || mode}`;
  }
}

// Handle watcher:config from server (on connect)
window.__cm6HandleWatcherConfig = (cfg) => { _applyWatcherConfig(cfg); };

// Handle watcher:modeStatus from server (after setMode)
window.__cm6HandleWatcherModeStatus = (status) => {
  if (status && status.mode) {
    _applyWatcherConfig(status);
    if (status.active === false) {
      host.toast('Failed to activate watcher mode');
    }
  }
};

// Init watcher UI on load
try { _initWatcherSettingsUI(); } catch (_) {}
try { _initAgentSettingsUI(); } catch (_) {}

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

  // Guard: autosave forces draft diffs off (there are no drafts in autosave mode)
  if (editorViewState?.showDraftDiffs) {
    await updatePreference('showDraftDiffs', false);
  }

  // Guard: autosave + trackEdits + editable is dangerous — the tracker chases its own saves.
  if (editorViewState?.trackAgentEdits && !editorViewState?.readOnly) {
    await updatePreference('trackAgentEdits', false);
    host.toast('Auto-track edits disabled (incompatible with autosave)', 'warn');
  }
});

bindMenuToggle(miToggleDiffs, async () => {
  const turningOff = !!(editorViewState?.showInlineDiffs);
  const success = await updatePreference('showInlineDiffs', !turningOff);
  if (!success) { host.toast('Failed to update preference'); return; }
  // Guard: turning git diffs OFF while auto-track is on → disable auto-track
  if (turningOff && editorViewState?.trackAgentEdits) {
    await updatePreference('trackAgentEdits', false);
    host.toast('Auto-track edits disabled (requires git diffs)', 'warn');
  }
});

bindMenuToggle(miToggleDraftDiffs, async () => {
  const turningOn = !(editorViewState?.showDraftDiffs);
  if (turningOn && editorViewState?.autoSave) {
    // Draft diffs require draft mode — disable autosave first
    await updatePreference('autoSave', false);
    host.toast('Autosave disabled (draft diffs require draft mode)', 'warn');
  }
  const success = await updatePreference('showDraftDiffs', turningOn);
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleColorPicker, async () => {
  const success = await updatePreference('colorPicker', !(editorViewState?.colorPicker));
  if (!success) host.toast('Failed to update color picker');
});

bindMenuToggle(miToggleReadonly, async () => {
  const goingEditable = !!(editorViewState?.readOnly);
  const success = await updatePreference('readOnly', !goingEditable);
  if (success) {
    host.toast(editorViewState?.readOnly ? 'Editor is now read-only' : 'Editor is now editable', 'info');
    // Guard: if we just made it editable while autosave + trackEdits are both ON,
    // the tracker would chase its own saves in an infinite loop. Disable tracking.
    if (goingEditable && editorViewState?.autoSave && editorViewState?.trackAgentEdits) {
      await updatePreference('trackAgentEdits', false);
      host.toast('Auto-track edits disabled (incompatible with autosave)', 'warn');
    }
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

// Saved preferences before track-edits mode forces overrides
let _preTrackingPrefs = null;

bindMenuToggle(miTrackEdits, async () => {
  const enabling = !(editorViewState?.trackAgentEdits);
  if (enabling) {
    // Save current values before forcing overrides
    _preTrackingPrefs = {
      showInlineDiffs: editorViewState?.showInlineDiffs ?? true,
      readOnly: editorViewState?.readOnly ?? false,
    };
    // Force showInlineDiffs + readOnly ON, then enable tracking
    // readOnly keeps autosave harmless — no edits means no save loop
    await updatePreference('showInlineDiffs', true);
    await updatePreference('readOnly', true);
    const success = await updatePreference('trackAgentEdits', true);
    if (!success) host.toast('Failed to enable edit tracking');
  } else {
    const success = await updatePreference('trackAgentEdits', false);
    if (!success) { host.toast('Failed to disable edit tracking'); return; }
    // Restore pre-tracking values
    if (_preTrackingPrefs) {
      await updatePreference('showInlineDiffs', _preTrackingPrefs.showInlineDiffs);
      await updatePreference('readOnly', _preTrackingPrefs.readOnly);
      _preTrackingPrefs = null;
    }
  }
});

// Initialize terminal drawer
const terminal = createTerminalDrawer({
  onReady: () => console.log('Terminal drawer ready'),
});

// Initialize console drawer (tab alongside terminal in the drawer)
const consoleDrawer = createConsoleDrawer();

// Initialize console bridge — patches console.* on the main page
// and sends logs to the ui_ipc bus so the console drawer can receive them.
// Actual init happens inside connectUIIPC() after the socket is created.

// ─── Drawer tab switching (Terminal ↔ Console) ────────────────
{
  const tabBar = document.querySelector('.drawer-tab-bar');
  const terminalHeader = document.querySelector('.terminal-header');
  const terminalContainer = document.getElementById('terminal-container');
  const consoleContainer = document.getElementById('console-container');

  if (tabBar) {
    tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('.drawer-tab');
      if (!tab) return;
      const target = tab.dataset.tab;

      // Update active tab
      tabBar.querySelectorAll('.drawer-tab').forEach(t => t.classList.toggle('active', t === tab));

      if (target === 'terminal') {
        if (terminalHeader) terminalHeader.style.display = '';
        if (terminalContainer) terminalContainer.style.display = '';
        if (consoleContainer) consoleContainer.style.display = 'none';
        consoleDrawer.hide();
      } else if (target === 'console') {
        if (terminalHeader) terminalHeader.style.display = 'none';
        if (terminalContainer) terminalContainer.style.display = 'none';
        consoleDrawer.show();
      }
    });
  }
}

// Bind terminal toggle menu item
const miToggleTerminal = requireEl('#mi-toggle-terminal');
bindMenuToggle(miToggleTerminal, () => {
  terminal.toggle();
});

// Bind console toggle menu item (opens drawer to console tab)
const miToggleConsole = document.getElementById('mi-toggle-console');
if (miToggleConsole) {
  bindMenuToggle(miToggleConsole, () => {
    const drawer = document.getElementById('terminal-drawer');
    const isOpen = drawer && drawer.classList.contains('open');
    // Switch to console tab
    const consoleTab = document.querySelector('.drawer-tab[data-tab="console"]');
    if (consoleTab) consoleTab.click();
    // Open the drawer if it's closed
    if (!isOpen) terminal.toggle();
  });
}

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

  // Connect UI IPC Socket.IO (frontend-to-frontend relay with editor iframe).
  try {
    connectUIIPC();
  } catch (e) {
    console.warn('Failed to connect UI IPC channel:', e);
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
  const initialUiPrefs = await waitForInitialUiPrefs(2200);
  const agentIframeConfig = await _applyAgentRuntimeConfigFromUi(initialUiPrefs);
  agentDrawerHandle = _createAgentController(agentIframeConfig);

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
const ENABLE_LEGACY_IFRAME_DOM_UNSAVED_OBSERVER = false;
if (ENABLE_LEGACY_IFRAME_DOM_UNSAVED_OBSERVER) {
  const observer = new MutationObserver(() => onAnyChange());
  observer.observe(editorFrame, { childList:true, subtree:true, characterData:true });
}
}
