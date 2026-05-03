// /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.js
// app/apps/file_editor_cm6/main.js
// Inline Monaco editor integration

// @ts-check
import { initExplorerUI } from './static/js/explorer.ts';
import { createTerminalDrawer } from './static/js/terminal.js';
import { initBranchMenu } from './static/js/git_menu.js';
// Hardcoded extension imports for now; will be dynamically loaded later.
import { initSidebarIframe } from './extensions/sidebar_extension/static/js/sidebar_iframe.js';
import { initSidebarShortcuts } from './extensions/sidebar_extension/static/js/sidebar_shortcuts.js';
import ReconnectingWebSocket from './static/js/reconnecting_websocket.js'; // used by other WS helpers (not explorer)
import { createConsoleDrawer } from './static/js/console.js';
import { createProblemsPanel } from './static/js/problems.js';
import { initConsoleBridge } from './static/js/console_bridge.js';
import {
  HOME_DIR, HOME_PREFIX, simplifyAbsolute, toAbsolute, parentDir, basename,
  formatDisplayPath, formatDisplayDirectory, detectLanguageFromFilename,
  RUNNABLE_EXTENSIONS, isRunnableFile, setMenuChecked, FONT_SCALE_PRESETS,
  requireEl,
} from './src/host/utils.ts';
import { createAppContext } from './src/host/app-context.ts';
import { initVirtualKeyboardAdjustments } from './src/host/ui/virtual-keyboard.ts';
import { pickerAvailable as pickerUiAvailable, pickFileWithPicker, pickDirectoryWithPicker, pickSaveTargetWithPicker } from './src/host/io/picker-helpers.ts';
import { createPickerController } from './src/host/io/picker-controller.ts';
import { createJumpLineController } from './src/host/io/jump-line.ts';
import { createAdapterUiController } from './src/host/ui/adapter-ui.ts';
import { createEditTrackerController } from './src/host/ui/edit-tracker.ts';
import { createFontScaleController } from './src/host/ui/font-scale.ts';
import { createSearchPanelController } from './src/host/ui/search-panel.ts';
import { createMenuCoreController } from './src/host/ui/menu-core.ts';
import { installBasicMenuActions } from './src/host/ui/menu-actions-basic.ts';
import { installSimplePreferenceMenuActions } from './src/host/ui/menu-actions-preferences.ts';
import { installAdvancedMenuActions } from './src/host/ui/menu-actions-advanced.ts';
import { installPrefsSync } from './src/host/ui/prefs-sync.ts';
import { createRecentsController } from './src/host/ui/recents.ts';
import { createPreferencesController } from './src/host/ui/preferences.ts';
import { createProjectSwitchController } from './src/host/ui/project-switch.ts';
import { createCacheIndicatorController } from './src/host/ui/cache-indicator.ts';
import { initDrawerAndShortcuts } from './src/host/ui/drawer-shortcuts.ts';
import { initPanelsAndDrawer } from './src/host/ui/panels-drawer.ts';
import { initSidebarShortcutsSafe } from './src/host/ui/sidebar-shortcuts-bootstrap.ts';
import { initResponsiveLayout } from './src/host/ui/layout-manager.ts';
import { createFileStatusController } from './src/host/ui/file-status.ts';
import { createSettingsBootstrap } from './src/host/ui/settings-bootstrap.ts';
import { createAutosaveModalController } from './src/host/ui/autosave-modal.ts';
import { createAutosaveRuntimeController } from './src/host/ui/autosave-runtime.ts';
import { showProjectsDebugModal } from './src/host/ui/projects-debug-modal.ts';
import { initWatcherUI, drainPendingWatcherEvents, showWatcherLimitModal } from './src/host/ui/watcher-settings.ts';
import { createUiIpcConnections } from './src/host/connections/ui-ipc.ts';
import { createExplorerRpcConnection } from './src/host/connections/explorer-rpc.ts';
import { EXPLORER_RPC_METHODS, EXPLORER_RPC_NOTIFICATIONS } from './src/explorer/rpc/contract.ts';
import { createFileWebSocketManager } from './src/host/connections/file-websocket.ts';
import { createFileSyncHandler } from './src/host/connections/file-sync-handler.ts';
import { ensureSocketIoLoaded, ensureVConsoleLoaded } from './src/host/connections/vendor-loaders.ts';
import { createSessionTelemetryController } from './src/host/boot/session-telemetry.ts';
import { createEditorStateController } from './src/host/boot/editor-state.ts';
import { runBootSequence } from './src/host/boot/boot-sequence.ts';
import { installBeforeExitGuard } from './src/host/boot/public-hooks.ts';
import { createStateInitController } from './src/host/boot/state-init.ts';
import { createBootSequenceDeps } from './src/host/boot/sequence-deps.ts';
import { applyNoProjectState, applyRestoredPathState, schedulePathDisplayFallback, applyNoRestoredPathState } from './src/host/boot/path-state.ts';
import { installHostExitGuard } from './src/host/boot/exit-guard.ts';
import { createSaveSocketController } from './src/host/file-ops/save-socket.ts';
import { createSaveFlowController } from './src/host/file-ops/save-flow.ts';
import { createOpenFlowController } from './src/host/file-ops/open-flow.ts';
import { createRunFileController } from './src/host/file-ops/run-file.ts';
import { createApiClient } from './src/host/api/client.ts';
import { bootInlineEditorHost } from './monaco_editor/inline_host.ts';
import { createHostChromeRuntime } from './main_page/frontend/host-chrome-runtime.ts';
import { createHostStateRuntime } from './main_page/frontend/host-state-runtime.ts';
import { createHostEditorEventsRuntime } from './main_page/frontend/host-editor-events-runtime.ts';

let problemsPanel = { show() {}, hide() {}, update() {}, destroy() {}, get isVisible() { return false; } };

import { initResizeManager, loadLayoutPreferences } from './static/js/resize_manager.js';

const AGENT_EXTENSION_MANIFEST = '/apps/file_editor_cm6/extensions/sidebar_extension/manifest.json';
const CODEX_PROXY_SOCKET_PATH = '/api/app/codex_agent/proxy/socket.io';
const UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT = 'agentActiveShortcutId';
const UI_PREF_KEY_AGENT_TOGGLE_DISPLAY = 'agentToggleDisplay';
const UI_PREF_KEY_AGENT_HEADER_DISPLAY = 'agentHeaderDisplay';
const UI_PREF_KEY_AGENT_SHORTCUTS = 'agentShortcuts';
const UI_PREF_KEY_WEB_WORKERS_ENABLED = 'webWorkersEnabled';
const SHORTCUT_KIND_URL = 'url';
const SHORTCUT_KIND_FRAMEWORK_APP = 'framework_app';

let _latestUiPrefs = {};
let _hasUiPrefsSnapshot = false;
const _uiPrefsWaiters = [];
let _agentRuntimeConfig = null;
let _agentRuntimeMode = null;
let _agentConfigApplySeq = 0;
let agentShortcutLoadBtn = null;
let agentShortcutLoadLabel = null;
let agentShortcutLoadDD = null;
let editorViewState = null; // Loaded from backend at startup via /editor/view_state
let cachedProjectRoot = null;
// Host file-state must be declared before any early reconciler/helper functions
// that read or write it, otherwise the built host bundle can split the binding.
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;
var restoredSessionActive = false;
var restoredSessionPath = null;
let currentModeLanguage = null;
let lastPickerPath = HOME_DIR;

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
  const headerIconEl = document.getElementById('agent-drawer-icon');
  if (!iconEl && !headerIconEl) return;

  const iconPath = typeof manifest.icon === 'string' ? manifest.icon.trim() : '';
  const iconEmoji = typeof manifest.icon_emoji === 'string' ? manifest.icon_emoji.trim() : '';
  const targets = [iconEl, headerIconEl].filter(Boolean);

  if (iconPath) {
    const img = document.createElement('img');
    const resolvedPath = iconPath.startsWith('/')
      ? iconPath
      : `/apps/file_editor_cm6/${iconPath.replace(/^\/+/, '')}`;
    img.src = resolvedPath;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    targets.forEach((el) => {
      el.textContent = '';
      el.appendChild(img.cloneNode(true));
      el.dataset.manifestKind = 'image';
      el.dataset.manifestValue = resolvedPath;
    });
    return;
  }

  if (iconEmoji) {
    targets.forEach((el) => {
      el.textContent = iconEmoji;
      el.dataset.manifestKind = 'emoji';
      el.dataset.manifestValue = iconEmoji;
    });
  } else {
    targets.forEach((el) => {
      if (el.dataset?.defaultIcon) {
        el.textContent = el.dataset.defaultIcon;
      }
      el.dataset.manifestKind = '';
      el.dataset.manifestValue = '';
    });
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
        const base = cachedProjectRoot || (await stateInitController.getCurrentProjectRoot(false)) || HOME_DIR;
        targetAbs = toAbsolute(rel, base, HOME_DIR);
      }

      if (!targetAbs) return;

      try {
        await openFile(targetAbs, {
          forceRefresh: true,
          line,
          focus: true,
        });
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

function _deriveAgentHostBaseFromRuntimeUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''), window.location.href);
    const origin = (u.origin || '').replace(/\/+$/, '');
    const pathname = u.pathname || '';
    const proxyMatch = pathname.match(/(\/api\/app\/[^/]+\/proxy)(?:\/|$)/);
    if (proxyMatch && proxyMatch[1]) {
      return `${origin}${proxyMatch[1]}`;
    }
    const appMatch = pathname.match(/^\/app\/([^/?#]+)(?:\/|$)/);
    if (appMatch && appMatch[1]) {
      const appId = decodeURIComponent(appMatch[1]);
      return `${origin}/api/app/${encodeURIComponent(appId)}/proxy`;
    }
    return origin;
  } catch (_) {
    return '';
  }
}

function _emitSidebarIpc(eventName, payload) {
  uiIpcConnections.emitSidebarIpc(eventName, payload);
}

function _isAgentSidebarEditTrackingEnabled() {
  return !!(editorViewState && editorViewState.trackAgentSidebarEdits);
}

function _rememberAgentSidebarEditKey(key) {
  if (!key) return false;
  const now = Date.now();
  const seen = _agentSidebarTrackedEditDedup.get(key);
  if (seen && (now - seen) < 30000) {
    return true;
  }
  _agentSidebarTrackedEditDedup.set(key, now);
  if (_agentSidebarTrackedEditDedup.size > 256) {
    const cutoff = now - 120000;
    for (const [k, ts] of _agentSidebarTrackedEditDedup.entries()) {
      if (ts < cutoff) _agentSidebarTrackedEditDedup.delete(k);
    }
  }
  return false;
}

function _extractPathFromDiff(diffText) {
  if (typeof diffText !== 'string' || !diffText) return '';
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (!line.startsWith('+++ ')) continue;
    let path = line.slice(4).trim();
    if (!path || path === '/dev/null') return '';
    if (path.startsWith('b/')) path = path.slice(2);
    if (path.startsWith('a/')) path = path.slice(2);
    return path;
  }
  return '';
}

function _extractLineFromDiff(diffText) {
  if (typeof diffText !== 'string' || !diffText) return 1;
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (!line.startsWith('@@')) continue;
    const match = line.match(/\+(\d+)(?:,\d+)?\s@@/);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

async function _resolveAgentSidebarEditAbsPath(rawPath) {
  const value = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!value) return '';
  if (value.startsWith('/')) return value;
  const root = cachedProjectRoot || (await stateInitController.getCurrentProjectRoot(false)) || '';
  if (!root) return '';
  return toAbsolute(value, root, HOME_DIR);
}

async function _applyAgentSidebarTrackedEdit(edit) {
  if (!edit || typeof edit !== 'object') return;
  if (!_isAgentSidebarEditTrackingEnabled()) return;

  const absPath = await _resolveAgentSidebarEditAbsPath(edit.path);
  if (!absPath) return;
  const line = Number.isFinite(Number(edit.line)) ? Number(edit.line) : 1;
  const key = `${edit.id || ''}:${absPath}:${line}`;
  if (_rememberAgentSidebarEditKey(key)) return;

  try {
    await openFile(absPath, {
      forceRefresh: true,
      line,
      focus: true,
    });
  } catch (err) {
    console.warn('[CodexEditTrack] Failed to auto-open tracked edit:', err);
  }
}

function _handleCodexAppserverEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (!_isAgentSidebarEditTrackingEnabled()) return;
  const type = typeof event.type === 'string' ? event.type : '';
  if (type !== 'diff') return;

  const diffText = typeof event.text === 'string' ? event.text : '';
  const eventPath = typeof event.path === 'string' ? event.path : '';
  const path = eventPath || _extractPathFromDiff(diffText);
  if (!path) return;
  const line = _extractLineFromDiff(diffText);
  const payload = {
    id: event.id || '',
    path,
    line,
    source: 'codex_ws',
    conversation_id: event.conversation_id || '',
  };

  _emitSidebarIpc('sidebar:agent_edit', payload);
}

function _isCodexRuntimeUrl(rawUrl) {
  const value = typeof rawUrl === 'string' ? rawUrl : '';
  return (
    value.includes('/api/app/codex_agent/proxy/')
    || value.includes('/app/codex_agent')
    || value.includes('/codex-agent')
  );
}

function _disconnectCodexAppserverSocket() {
  if (!codexAppserverSocket) return;
  try {
    codexAppserverSocket.disconnect();
  } catch (_) {}
  codexAppserverSocket = null;
}

function connectCodexAppserverSocket(runtimeUrl = '') {
  if (!_isCodexRuntimeUrl(runtimeUrl)) {
    _disconnectCodexAppserverSocket();
    return;
  }
  ensureSocketIoLoaded().then((io) => {
    if (!io) return;
    if (codexAppserverSocket) {
      if (!codexAppserverSocket.connected) codexAppserverSocket.connect();
      return;
    }

    codexAppserverSocket = io('/appserver', {
      path: CODEX_PROXY_SOCKET_PATH,
      transports: ['websocket'],
      query: { source: 'file_editor_cm6_main' },
    });
    codexAppserverSocket.on('connect', () => {
      console.log('[CodexAppserverWS] connected');
    });
    codexAppserverSocket.on('disconnect', (reason) => {
      console.log('[CodexAppserverWS] disconnected', reason);
    });
    codexAppserverSocket.on('connect_error', (err) => {
      console.warn('[CodexAppserverWS] connect error', err);
    });
    codexAppserverSocket.on('appserver_event', (event) => {
      try {
        _handleCodexAppserverEvent(event);
      } catch (err) {
        console.warn('[CodexAppserverWS] event handling failed', err);
      }
    });
  }).catch((err) => {
    console.warn('[CodexAppserverWS] load failed', err);
  });
}

function _normalizeShortcutLoad(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'eager' ? 'eager' : 'lazy';
}

function _setAgentShortcutLoadValue(value) {
  const normalized = _normalizeShortcutLoad(value);
  if (agentShortcutLoadBtn) {
    agentShortcutLoadBtn.dataset.value = normalized;
  }
  if (agentShortcutLoadLabel) {
    agentShortcutLoadLabel.textContent = normalized === 'eager' ? 'Eager' : 'Lazy';
  }
}

function _getAgentShortcutLoadValue() {
  const raw = agentShortcutLoadBtn?.dataset?.value;
  return _normalizeShortcutLoad(raw);
}

function _collectSidebarShortcuts(uiPrefs) {
  const shortcuts = Array.isArray(uiPrefs?.[UI_PREF_KEY_AGENT_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_AGENT_SHORTCUTS]
    : [];
  const out = [];
  shortcuts.forEach((sc) => {
    if (!sc || typeof sc !== 'object') return;
    const kind = typeof sc.kind === 'string' ? sc.kind.trim().toLowerCase() : '';
    if (kind !== SHORTCUT_KIND_URL && kind !== SHORTCUT_KIND_FRAMEWORK_APP) return;
    const url = typeof sc.url === 'string' ? sc.url.trim() : '';
    if (!url) return;
    const id = typeof sc.id === 'string' ? sc.id.trim() : '';
    const key = id || url;
    if (!key) return;
    out.push({
      key,
      id,
      kind,
      app_id: typeof sc.app_id === 'string' ? sc.app_id.trim() : '',
      label: typeof sc.label === 'string' ? sc.label : '',
      url,
      icon: sc.icon || null,
      load: _normalizeShortcutLoad(sc.load),
      header: true,
      last_used: Number.isFinite(Number(sc.last_used)) ? Number(sc.last_used) : 0,
    });
  });
  return out;
}

function _resolveActiveShortcut(uiPrefs, shortcuts) {
  const activeId = typeof uiPrefs?.[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT].trim()
    : '';
  if (!activeId) return null;
  const list = Array.isArray(shortcuts) ? shortcuts : _collectSidebarShortcuts(uiPrefs);
  return list.find((sc) => sc && (sc.id === activeId || sc.url === activeId || sc.key === activeId)) || null;
}

async function resolveAgentIframeUrl(uiPrefs) {
  try {
    const url = sidebarShortcuts?.getActiveUrl?.(uiPrefs || {});
    if (url) return url;
  } catch (_) {}
  const match = _resolveActiveShortcut(uiPrefs);
  return match ? match.url : '';
}

async function resolveAgentIframeSettings(uiPrefs) {
  const url = await resolveAgentIframeUrl(uiPrefs || {});
  return { enabled: true, url, hideDrawerHeader: false };
}

let explorerRpcConnection = null;
let explorerNeedsResync = false;
let codexAppserverSocket = null;
const _agentSidebarTrackedEditDedup = new Map();
const _recentAgentOpenKeys = new Map();

function _rememberRecentAgentOpen(key) {
  if (!key) return false;
  const now = Date.now();
  const seen = _recentAgentOpenKeys.get(key);
  if (seen && (now - seen) < 1500) {
    return true;
  }
  _recentAgentOpenKeys.set(key, now);
  if (_recentAgentOpenKeys.size > 256) {
    const cutoff = now - 30000;
    for (const [k, ts] of _recentAgentOpenKeys.entries()) {
      if (ts < cutoff) _recentAgentOpenKeys.delete(k);
    }
  }
  return false;
}

async function handleAgentOpen(payload) {
  const isMobile = _isMobileLayout();
  const rel = typeof payload?.rel === 'string' ? payload.rel.trim() : '';
  const abs = typeof payload?.path === 'string'
    ? payload.path.trim()
    : (typeof payload?.abs === 'string'
      ? payload.abs.trim()
      : (typeof payload?.file === 'string' ? payload.file.trim() : ''));
  const line = Number.isFinite(Number(payload?.line)) ? Number(payload.line) : null;
  const column = Number.isFinite(Number(payload?.column)) ? Number(payload.column) : null;
  const source = typeof payload?.source === 'string' ? payload.source : '';
  const conversationId = typeof payload?.conversation_id === 'string' ? payload.conversation_id : '';
  console.log('[AgentOpen] rx payload', {
    path: payload?.path || '',
    abs: payload?.abs || '',
    rel,
    line,
    column,
    source,
    conversation_id: conversationId,
  });

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
      const base = cachedProjectRoot || (await stateInitController.getCurrentProjectRoot(false)) || HOME_DIR;
      targetAbs = toAbsolute(rel, base, HOME_DIR);
    } catch (_) {
      targetAbs = '';
    }
  }

  if (!targetAbs) {
    console.warn('[AgentOpen] drop: unable to resolve targetAbs', { rel, abs, source });
    return;
  }
  const dedupeKey = `${targetAbs}|${line ?? ''}|${column ?? ''}|${source}|${conversationId}`;
  if (_rememberRecentAgentOpen(dedupeKey)) {
    console.log('[AgentOpen] drop duplicate', {
      path: targetAbs,
      line,
      column,
      source,
      conversation_id: conversationId,
    });
    return;
  }
  try {
    const openOptions = { forceRefresh: true };
    if (typeof line === 'number' && line >= 1) {
      openOptions.line = line;
      if (typeof column === 'number' && column >= 1) {
        openOptions.column = column;
      }
      openOptions.focus = !isMobile;
      if (source === 'codex-agent') {
        openOptions.scrollY = 'center';
      }
    }
    if (typeof openFile === 'function') {
      await openFile(targetAbs, openOptions);
    } else if (typeof window.appOpenFile === 'function') {
      await window.appOpenFile(targetAbs, openOptions);
    } else {
      throw new Error('openFile is not available yet');
    }
  } catch (e) {
    console.warn('[AgentOpen] Failed to open+jump:', e);
    host.toast(`Failed to open link: ${e?.message || 'unknown error'}`);
  }
}

function handleExplorerRpcNotification(method, params) {
  const payload = params && typeof params === 'object' ? params : {};
  if (typeof method !== 'string' || !method) return;

  if (window.__debugExplorer) {
    console.log('[ExplorerRPC:event]', { method, payload });
  }

  if (method === EXPLORER_RPC_NOTIFICATIONS.agentOpen) {
    console.log('[ExplorerRPC] rx agent:open', {
      path: payload?.path || '',
      rel: payload?.rel || '',
      line: payload?.line,
      column: payload?.column,
      source: payload?.source || '',
      conversation_id: payload?.conversation_id || '',
    });
    handleAgentOpen(payload);
    return;
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherConfigUpdated && window.__cm6HandleWatcherConfig) {
    window.__cm6HandleWatcherConfig(payload);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherModeStatus && window.__cm6HandleWatcherModeStatus) {
    window.__cm6HandleWatcherModeStatus(payload);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherError && window.__cm6HandleWatcherError) {
    window.__cm6HandleWatcherError(payload);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherLimitRaiseResult && window.__cm6HandleWatcherRaiseResult) {
    window.__cm6HandleWatcherRaiseResult(payload);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.prefsUiUpdated && window.__cm6HandleUiPrefs) {
    window.__cm6HandleUiPrefs(payload);
  } else if (method === EXPLORER_RPC_NOTIFICATIONS.prefsUiUpdated) {
    try { window.__cm6PendingUiPrefs = payload; } catch (_) {}
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.extensionsAdapterRestarting) {
    console.log('[adapter_restart] received', payload);
    if (typeof _reloadEditorFrame === 'function') setTimeout(() => _reloadEditorFrame(), 0);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.extensionsSettingsChanged) {
    console.log('[adapter_restart] settings changed', payload);
    if (typeof _requestAdapterRestart === 'function') setTimeout(() => _requestAdapterRestart(), 0);
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated && (payload.rel || payload.abs)) {
    try {
      let abs = payload.abs || null;
      if (!abs && payload.rel) {
        let projRoot = null;
        try { projRoot = sessionTelemetry.activeProjectPath(); } catch (_) {}
        if (!projRoot) try { projRoot = sessionState?.activeProject; } catch (_) {}
        abs = projRoot ? toAbsolute(payload.rel, projRoot, HOME_DIR) : null;
      }
      if (abs) {
        _applyHostActivePath(abs, { forceToolbar: true });
      }
    } catch (_) {}
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.diagnosticsDetail) {
    try {
      const keys = payload ? Object.keys(payload) : [];
      const sampleMarkers = keys.length > 0 ? (payload[keys[0]] || []).slice(0, 1) : [];
      console.log('[Problems] diagnostics:detail rx', keys.length, 'files, sample:', JSON.stringify(sampleMarkers).slice(0, 300));
      problemsPanel.update(payload);
    } catch (e) { console.error('[Problems] update error:', e); }
  }
  if (typeof window.__explorerHandleNotification === 'function') {
    window.__explorerHandleNotification(method, payload);
  }
}

function connectExplorerSocket() {
  if (explorerRpcConnection) {
    explorerRpcConnection.reconnect();
    return Promise.resolve(explorerRpcConnection);
  }

  explorerRpcConnection = createExplorerRpcConnection({
    ensureSocketIoLoaded,
    onConnect: () => {
      console.log('[ExplorerRPC] Connected');
      if (explorerNeedsResync) {
        explorerNeedsResync = false;
      }
      try {
        if (typeof window.__cm6ExplorerOnReconnect === 'function') {
          window.__cm6ExplorerOnReconnect();
        }
      } catch (e) {
        console.warn('[ExplorerRPC] Connect resync failed:', e);
      }
    },
    onDisconnect: (reason) => {
      console.log('[ExplorerRPC] Disconnected', reason);
      explorerNeedsResync = true;
    },
    onConnectError: (err) => {
      console.warn('[ExplorerRPC] Connect error', err);
    },
    onNotification: (method, params) => {
      handleExplorerRpcNotification(method, params);
    },
  });

  window.__explorerRpc = {
    connect: () => explorerRpcConnection.connect(),
    reconnect: () => explorerRpcConnection.reconnect(),
    isConnected: () => explorerRpcConnection.isConnected(),
    notify: (method, params = {}) => explorerRpcConnection.notify(method, params || {}),
    request: (method, params = {}, timeoutMs) => explorerRpcConnection.request(method, params || {}, timeoutMs),
  };

  void explorerRpcConnection.connect().catch((err) => {
    console.warn('[ExplorerRPC] Failed to open explorer Socket.IO:', err);
  });

  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState !== 'visible') return;
      explorerRpcConnection?.reconnect?.();
    } catch (_) {}
  });

  return Promise.resolve(explorerRpcConnection);
}

// Ensure lastSha256 exists before any cache-state events fire.
var lastSha256 = null;
// `explorer:event` may arrive before helper functions are defined; keep a stable symbol.
// This is NOT a suppression: we queue the latest indicator payload and replay it once
// the real implementation is installed.
var applyCacheIndicator = function (info) {
  try { window.__fePendingCacheIndicator = info; } catch (_) {}
};

function _applyHostActivePath(filePath, options = {}) {
  const normalizedPath = (typeof filePath === 'string' && filePath) ? filePath : '';
  if (!normalizedPath) return;

  try { currentPath = normalizedPath; } catch (_) {}
  try { currentPathExists = true; } catch (_) {}
  try {
    const trimmed = normalizedPath.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    lastPickerPath = idx > 0 ? trimmed.slice(0, idx) : '/';
  } catch (_) {}
  try { currentModeLanguage = detectLanguageFromFilename(normalizedPath); } catch (_) {}
  try { if (problemsPanel.setActiveFile) problemsPanel.setActiveFile(normalizedPath); } catch (_) {}

  const trimmed = normalizedPath.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const expectedName = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  const nameEl = window.fileNameEl || fileNameEl || null;
  const forceToolbar = !!(options && options.forceToolbar);
  const toolbarStale = !!(
    nameEl
    && (
      nameEl.textContent !== expectedName
      || nameEl.title !== expectedName
    )
  );

  try {
    if (typeof updatePathDisplay === 'function') updatePathDisplay();
    else if (typeof window.updatePathDisplay === 'function') window.updatePathDisplay();
    else if (forceToolbar || toolbarStale || !nameEl) setToolbarFileName(expectedName);
  } catch (_) {
    try {
      if (forceToolbar || toolbarStale || !nameEl) setToolbarFileName(expectedName);
    } catch (_) {}
  }
}

function _setHostCurrentPathOnly(path) {
  if (typeof path === 'string' && path) {
    _applyHostActivePath(path);
    return;
  }
  try { currentPath = ''; } catch (_) {}
}

function _issuesDumpRequestOnce() {
  return uiIpcConnections.requestBackendEditorIssuesDump({
    request_id: `issues_dump_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  });
}

// ─── UI IPC (frontend ↔ inline editor relay) ──────────────────────
const uiIpcConnections = createUiIpcConnections({
  ensureSocketIoLoaded,
  initConsoleBridge,
  getClientId: () => clientId,
});
function connectSidebarIPC() {
  uiIpcConnections.connectSidebarIPC();
}

function connectUIIPC() {
  return uiIpcConnections.connectUIIPC();
}
// ─── End UI IPC ───────────────────────────────────────────────────

// ─── Mention requests via UI IPC CustomEvent ─────────────────────
window.addEventListener('cm6:mention-request', async (evt) => {
  try {
    const data = evt.detail || {};
    if (!window.__explorerRpc) {
      console.warn('[mention] Explorer bus unavailable');
      return;
    }
    const body = { path: data.path || '' };
    if (data.lineNo != null) body.lineNo = data.lineNo;
    if (data.endLineNo != null) body.endLineNo = data.endLineNo;
    if (data.col != null) body.col = data.col;
    if (data.endCol != null) body.endCol = data.endCol;
    if (data.content) body.content = data.content;
    window.__explorerRpc.notify(EXPLORER_RPC_METHODS.mentionAgent, body);
    console.log('[mention] Mentioned in conversation:', body.path);
  } catch (err) {
    console.warn('[mention] Request failed:', err);
  }
});
// ─── End Mention ─────────────────────────────────────────────────

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl, api, host) {
const appContext = createAppContext({ rootEl, api, host });
window.__feAppContext = appContext;
window.host = appContext.host;
const cacheStateBadge = requireEl('#fe-file-draft-badge');
var fileNameEl = null;
window.api  = appContext.api;

const container = requireEl('#editor-container');
const editorFrameEl = requireEl('#editor-frame');
const root = requireEl('.fe-root');
const toolbarEl = requireEl('.fe-toolbar');
const titleBlockEl = requireEl('.fe-title-block');
const leftToolbarControlEl = requireEl('#fe-drawer-open');
const rightToolbarControlEl = requireEl('.fe-toolbar > .fe-menu');
const agentDrawerEl = requireEl('#agent-drawer');
const agentTranscript = requireEl('#agent-transcript');
const agentComposer = requireEl('#agent-input');
Object.assign(appContext.elements, {
  cacheStateBadge,
  container,
  editorFrame: editorFrameEl,
  root,
  agentDrawerEl,
  agentTranscript,
  agentComposer,
});

// Title/status & chrome
fileNameEl = requireEl('#fe-file-name');
const fileNameScrollEl = requireEl('#fe-file-name-scroll');
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
const hostChromeRuntime = createHostChromeRuntime({
  root,
  toolbarEl,
  titleBlockEl,
  leftToolbarControlEl,
  rightToolbarControlEl,
  agentDrawerEl,
  fileNameEl,
  fileNameScrollEl,
  issuesToggleBtn,
  issuesPrevBtn,
  issuesNextBtn,
  issuesBadgesEl,
  isMobileLayout: () => _isMobileLayout(),
  basename,
  toAbsolute,
  homeDir: HOME_DIR,
  getCurrentPath: () => currentPath,
  getCachedProjectRoot: () => cachedProjectRoot,
  getProblemsDetail: () => problemsPanel.getDetail ? problemsPanel.getDetail() : {},
  pickerAvailable: () => pickerController.pickerAvailable(),
  saveFileWithPicker: (options) => window.teFilePicker.saveFile(options),
  apiPost: (path, body) => apiPost(path, body),
  getClientId: () => clientId,
  requestBackendEditorIssuesCommand: (payload) => uiIpcConnections.requestBackendEditorIssuesCommand(payload),
  toast: (message, kind) => host.toast(message, kind),
  confirm: (message) => window.confirm(message),
});
const {
  formatFileNameDisplay,
  scheduleToolbarTitleClamp,
  setToolbarFileName,
  initToolbarTitleClampObservers,
  setIssuesButtonsEnabled,
  exportDiagnosticsToFile,
} = hostChromeRuntime;
hostChromeRuntime.install();
const hostStateRuntime = createHostStateRuntime({
  updateLspSpinner: () => {
    const ui = window.__feAdapterUi;
    if (ui && typeof ui.updateLspSpinner === 'function') {
      ui.updateLspSpinner();
    }
  },
  applyActiveFilePath: (filePath) => _applyHostActivePath(filePath, { forceToolbar: true }),
  log: (...args) => console.log(...args),
});
hostStateRuntime.install();
const hostEditorEventsRuntime = createHostEditorEventsRuntime({
  applyCacheIndicator: (info) => applyCacheIndicator(info),
  triggerExternalRefresh: (path) => triggerExternalRefresh(path),
  applyAutosavePreference: (autoSave) => {
    if (!editorViewState || typeof editorViewState !== 'object') editorViewState = {};
    editorViewState.autoSave = autoSave;
    preferencesController.applyStateToMenus(editorViewState);
  },
  setLastSha256: (sha) => { lastSha256 = sha; },
  getRestoredSessionActive: () => !!restoredSessionActive,
  setRestoredSessionActive: (flag) => { restoredSessionActive = !!flag; },
  setRestoredSessionPath: (path) => { restoredSessionPath = path; },
  getCurrentPath: () => currentPath || '',
  queueSessionStateUpdate: (partial) => queueSessionStateUpdate(partial),
  apiPost: (path, body) => apiPost(path, body),
  issuesBadgesEl,
  setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
  toast: (message, timeoutMs) => host.toast(message, timeoutMs),
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
});
hostEditorEventsRuntime.install();
function ensureEditorFrameReady() {
  return hostEditorEventsRuntime.ensureEditorFrameReady();
}
function _awaitEditorOpen(requestId, path, timeoutMs) {
  return hostEditorEventsRuntime.awaitEditorOpen(requestId, path, timeoutMs);
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
const miTrackAgentSidebarEdits = requireEl('#mi-track-agent-sidebar-edits');
const miFind          = requireEl('#mi-find');
const miGoto          = requireEl('#mi-goto');
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
const editorSettingsAgentShortcutsBtn = requireEl('#editor-settings-agent-shortcuts');
const sidebarSetupShortcutsBtn = requireEl('#sidebar-setup-shortcuts');

const agentShortcutsModal = requireEl('#agent-shortcuts-modal');
const agentShortcutsClose = requireEl('#agent-shortcuts-close');
const agentShortcutsAdd = requireEl('#agent-shortcuts-add');
const agentShortcutsList = requireEl('#agent-shortcuts-list');
const agentShortcutsEditor = requireEl('#agent-shortcuts-editor');
const agentShortcutLabel = requireEl('#agent-shortcut-label');
const agentShortcutUrl = requireEl('#agent-shortcut-url');
const agentShortcutHeader = document.getElementById('agent-shortcut-header');
agentShortcutLoadBtn = requireEl('#agent-shortcut-load-btn');
agentShortcutLoadLabel = requireEl('#agent-shortcut-load-label');
agentShortcutLoadDD = requireEl('#agent-shortcut-load-dd');
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

createSettingsBootstrap({
  els: {
    settingsModal: editorSettingsModal,
    settingsClose: editorSettingsClose,
    menuEditorSettings: miEditorSettings,
    extManagerModal: editorExtManagerModal,
    extManagerClose: editorExtManagerClose,
    settingsExtStrip: editorSettingsExtStrip,
    themesModal: editorThemesModal,
    themesClose: editorThemesClose,
    themesList: editorThemesList,
    settingsThemeStrip: editorSettingsThemeStrip,
    settingsThemeSummary: editorSettingsThemeSummary,
    extConfigModal,
    extConfigTitle,
    extConfigForm,
    extConfigClose,
    extConfigCancel,
    extConfigSave,
    extManagerInstallBtn: editorExtManagerInstallBtn,
    extCustomSettingsInput,
    extCustomSettingsSave,
    extSummary: editorSettingsExtSummary,
    extManagerList: editorExtManagerList,
  },
  closeAllMenus,
  getEditorViewState: () => editorViewState,
  setEditorTheme: (themeId) => {
    editorViewState = editorViewState || {};
    editorViewState.theme = themeId;
  },
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  pickerAvailable: () => pickerController.pickerAvailable(),
  pickFile: (startPath) => pickFile(startPath),
  getStartPath: () => lastPickerPath || HOME_DIR,
  busRequest: (method, payload, timeoutMs) => window.__explorerRpc.request(method, payload, timeoutMs),
  busNotify: (method, payload) => window.__explorerRpc.notify(method, payload),
  reloadEditorFrame: _reloadEditorFrame,
  toast: (msg, ms) => host.toast(msg, ms),
});

function shouldUseLocalKeyboardViewportAdjustments() {
  try {
    return document.documentElement?.dataset?.shellMode !== 'mobile-tab';
  } catch (_) {
    return true;
  }
}

if (shouldUseLocalKeyboardViewportAdjustments()) {
  initVirtualKeyboardAdjustments({
    root,
    agentDrawer: agentDrawerEl,
    composer: agentComposer,
    transcript: agentTranscript,
    editorSurface: editorFrameEl,
  });
}


// ---------- Session telemetry ----------
async function fetchPersistedSessionState() {
  return sessionTelemetry.fetchPersistedSessionState();
}

function seedPersistedSessionState(snapshot) {
  return sessionTelemetry.seedPersistedSessionState(snapshot);
}

function initSessionStateContext(serverState) {
  sessionTelemetry.initSessionStateContext(serverState);
}

function queueSessionStateUpdate(partial = null) {
  sessionTelemetry.queueSessionStateUpdate(partial);
}

async function flushSessionState(force = false) {
  return sessionTelemetry.flushSessionState(force);
}

function syncSessionPath(extra = {}) {
  sessionTelemetry.syncSessionPath(extra);
}

// ---------- Edit Tracker ----------
const editTrackerController = createEditTrackerController({
  apiPost,
  getEditorViewState: () => editorViewState,
  getCurrentPath: () => currentPath,
  openFile: (path, opts) => openFile(path, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  statusEl: editTrackerStatusEl,
});
const fontScaleController = createFontScaleController({
  presets: FONT_SCALE_PRESETS,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  scheduleToolbarTitleClamp: (opts) => scheduleToolbarTitleClamp(opts),
  toast: (msg, kind) => host.toast(msg, kind),
});
function applyFontScale(scale) {
  fontScaleController.applyFontScale(scale);
}

function updateFontScaleMenuChecks(currentScale) {
  fontScaleController.updateFontScaleMenuChecks(currentScale);
}

// ---------- Editor state ----------
// Preferences are managed by backend; frontend displays state only (no caching)

let editorState = null;
let branchMenuHandle = null;
let agentDrawerHandle = null;
let sidebarShortcuts = null;
let _agentSettingsUiMutating = false;
let sessionState = {
  activeProject: null,
  currentPath: null,
  unsaved: false,
  lastSha256: null,
  updatedAt: null,
};
const sessionTelemetry = createSessionTelemetryController({
  apiPost,
  getActiveProjectFallback: () => cachedProjectRoot || (editorState && editorState.activeProject) || null,
  getCurrentPath: () => currentPath || null,
  getLastSha256: () => lastSha256,
  getUnsaved: () => !!unsaved,
});
sessionState = sessionTelemetry.sessionState;
let externalRefreshInProgress = false;
let _agentShortcutsCache = [];
let _agentShortcutEditingId = null;
let _agentShortcutEditingAssetName = null;
let _agentShortcutIframeMap = new Map();
let _lastShortcutUsageKey = '';
let _lastShortcutUsageStamp = 0;

function resetActiveFileState({ resetPicker = false } = {}) {
  fileWebSocketManager.closeWebSocket();
  currentPath = '';
  currentPathExists = false;
  if (resetPicker) lastPickerPath = HOME_DIR;
  currentModeLanguage = null;
  lastSha256 = null;
  lastSavedContent = '';
  markUnsaved(false);
  updatePathDisplay();
  syncSessionPath();
}

function _agentIconUrlFromName(name) {
  const safe = String(name || '').trim();
  if (!safe) return '';
  return `/api/app/file_editor_cm6/agent_icons/${encodeURIComponent(safe)}`;
}

function _firstGrapheme(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const it = seg.segment(value)[Symbol.iterator]();
      const first = it.next();
      if (first && first.value && first.value.segment) return first.value.segment;
    }
  } catch (_) {}
  return Array.from(value)[0] || '';
}

function _renderAgentIconInto(el, icon) {
  if (!el) return;
  el.textContent = '';
  const i = icon && typeof icon === 'object' ? icon : null;
  const kind = i && typeof i.kind === 'string' ? i.kind : '';
  if (kind === 'emoji') {
    const emoji = typeof i.emoji === 'string' ? i.emoji.trim() : '';
    if (emoji) {
      el.textContent = emoji;
    } else {
      _restoreAgentToggleIcon(el);
    }
    return;
  }
  if (kind === 'asset') {
    const name = typeof i.name === 'string' ? i.name.trim() : '';
    if (!name) {
      _restoreAgentToggleIcon(el);
      return;
    }
    const img = document.createElement('img');
    img.src = _agentIconUrlFromName(name);
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
    return;
  }
  _restoreAgentToggleIcon(el);
}

function _restoreAgentToggleIcon(el) {
  if (!el) return;
  const kind = el.dataset?.manifestKind || '';
  const value = el.dataset?.manifestValue || '';
  el.textContent = '';
  if (kind === 'image' && value) {
    const img = document.createElement('img');
    img.src = value;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
    return;
  }
  if (kind === 'emoji' && value) {
    el.textContent = value;
    return;
  }
  el.textContent = el.dataset?.defaultIcon || '';
}

function _applyAgentHeaderDisplay(uiPrefs, overrides = {}) {
  const iconEl = document.getElementById('agent-drawer-icon');
  const textEl = document.getElementById('agent-drawer-title-text');
  if (!iconEl || !textEl) return;
  const display = typeof uiPrefs?.[UI_PREF_KEY_AGENT_HEADER_DISPLAY] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_HEADER_DISPLAY].trim()
    : 'text';
  if (display === 'icon') {
    iconEl.style.display = 'inline-flex';
    textEl.style.display = 'none';
  } else if (display === 'text') {
    iconEl.style.display = 'none';
    textEl.style.display = '';
  } else {
    iconEl.style.display = 'inline-flex';
    textEl.style.display = '';
  }

  const shortcuts = Array.isArray(overrides.shortcuts)
    ? overrides.shortcuts
    : _collectSidebarShortcuts(uiPrefs);
  const active = overrides.active || _resolveActiveShortcut(uiPrefs, shortcuts);
  const shortcutIcon = active && active.icon && typeof active.icon === 'object' ? active.icon : null;
  const headerLabel = active && typeof active.label === 'string' && active.label.trim()
    ? active.label.trim()
    : 'Sidebar';
  textEl.textContent = headerLabel;
  if (shortcutIcon && shortcutIcon.kind && shortcutIcon.kind !== 'default') {
    _renderAgentIconInto(iconEl, shortcutIcon);
  } else {
    const fallbackText = _firstGrapheme(headerLabel);
    if (fallbackText) {
      iconEl.textContent = fallbackText;
      return;
    }
    _restoreAgentToggleIcon(iconEl);
  }
}

function _maybeUpdateShortcutLastUsed(uiPrefs, active, shortcuts) {
  if (!active || !active.key) return;
  const now = Date.now();
  if (_lastShortcutUsageKey === active.key && (now - _lastShortcutUsageStamp) < 800) return;
  const raw = Array.isArray(uiPrefs?.[UI_PREF_KEY_AGENT_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_AGENT_SHORTCUTS]
    : [];
  const idx = raw.findIndex((sc) => sc && typeof sc === 'object'
    && (sc.id === active.key || sc.url === active.key || sc.id === active.id || sc.url === active.url));
  if (idx < 0) return;
  const prevTs = Number(raw[idx]?.last_used || 0);
  if (Number.isFinite(prevTs) && (now - prevTs) < 800) {
    _lastShortcutUsageKey = active.key;
    _lastShortcutUsageStamp = now;
    return;
  }
  const next = raw.map((sc, i) => {
    if (i !== idx || !sc || typeof sc !== 'object') return sc;
    return { ...sc, last_used: now };
  });
  _lastShortcutUsageKey = active.key;
  _lastShortcutUsageStamp = now;
  _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_SHORTCUTS, next);
}

function _renderSidebarHeaderIconList(uiPrefs, overrides = {}) {
  const listEl = document.getElementById('agent-drawer-icon-list');
  if (!listEl) return;
  const shortcuts = Array.isArray(overrides.shortcuts)
    ? overrides.shortcuts
    : _collectSidebarShortcuts(uiPrefs);
  const active = overrides.active || _resolveActiveShortcut(uiPrefs, shortcuts);
  const activeKey = active?.key || '';
  const now = Date.now();

  const headerItems = shortcuts
    .filter((sc) => sc && sc.header && ((sc.icon && sc.icon.kind && sc.icon.kind !== 'default') || (sc.label && sc.label.trim())))
    .map((sc, idx) => ({
      ...sc,
      _sortTs: sc.last_used || (sc.key === activeKey ? now : 0),
      _idx: idx,
    }))
    .sort((a, b) => (b._sortTs - a._sortTs) || (a._idx - b._idx));

  listEl.innerHTML = '';
  if (!headerItems.length) {
    listEl.style.display = 'none';
    return;
  }
  listEl.style.display = 'flex';

  headerItems.forEach((sc) => {
    const btn = document.createElement('button');
    btn.className = 'agent-drawer__icon-btn';
    if (sc.key && sc.key === activeKey) {
      btn.classList.add('is-active');
    }
    btn.title = sc.label || sc.url || 'Shortcut';
    const fallbackText = _firstGrapheme(sc.label);
    const iconNode = _renderShortcutIconNode(sc.icon, null, fallbackText);
    if (!iconNode.textContent && !iconNode.childNodes.length) {
      return;
    }
    btn.appendChild(iconNode);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const targetId = sc.id || sc.url || sc.key;
      if (targetId) {
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT, targetId);
        setTimeout(() => { try { agentDrawerHandle?.open?.(); } catch (_) {} }, 120);
      }
    });
    listEl.appendChild(btn);
  });
}

function _ensureActiveShortcutSelection(uiPrefs, shortcuts) {
  const activeId = typeof uiPrefs?.[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT].trim()
    : '';
  const list = Array.isArray(shortcuts) ? shortcuts : _collectSidebarShortcuts(uiPrefs);
  if (!list.length) {
    return { active: null, activeId: '' };
  }
  const active = _resolveActiveShortcut(uiPrefs, list);
  if (active) {
    return { active, activeId: activeId || active.key };
  }
  const fallback = list[0];
  const nextId = fallback?.id || fallback?.url || fallback?.key || '';
  if (nextId && nextId !== activeId) {
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT, nextId);
  }
  return { active: fallback || null, activeId: nextId };
}

function _applyAgentToggleToolbar(uiPrefs, overrides = {}) {
  const btn = document.getElementById('fe-agent-toggle');
  if (!btn) return;
  const iconEl = btn.querySelector('.fe-agent-icon');
  if (!iconEl) return;

  const shortcuts = Array.isArray(overrides.shortcuts)
    ? overrides.shortcuts
    : _collectSidebarShortcuts(uiPrefs);
  const active = overrides.active || _resolveActiveShortcut(uiPrefs, shortcuts);
  const shortcutIcon = active && active.icon && typeof active.icon === 'object' ? active.icon : null;

  if (shortcutIcon && typeof shortcutIcon === 'object' && shortcutIcon.kind && shortcutIcon.kind !== 'default') {
    _renderAgentIconInto(iconEl, shortcutIcon);
    return;
  }
  _restoreAgentToggleIcon(iconEl);
}

function _applyAgentSettingsControls(uiPrefs) {
  const display = typeof uiPrefs?.[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_TOGGLE_DISPLAY].trim()
    : 'icon';
  const shortcuts = Array.isArray(uiPrefs?.[UI_PREF_KEY_AGENT_SHORTCUTS])
    ? uiPrefs[UI_PREF_KEY_AGENT_SHORTCUTS]
    : [];

  const headerDisplay = typeof uiPrefs?.[UI_PREF_KEY_AGENT_HEADER_DISPLAY] === 'string'
    ? uiPrefs[UI_PREF_KEY_AGENT_HEADER_DISPLAY].trim()
    : 'text';

  _agentSettingsUiMutating = true;
  try {
    // Toggle display radios
    try {
      const radios = document.querySelectorAll('input[name="agent-toggle-display"]');
      radios.forEach((r) => { r.checked = (r.value === display); });
    } catch (_) {}

    // Header display radios
    try {
      const headerRadios = document.querySelectorAll('input[name="agent-header-display"]');
      headerRadios.forEach((r) => { r.checked = (r.value === headerDisplay); });
    } catch (_) {}

    // Web workers toggle
    try {
      const wwToggle = document.getElementById('editor-settings-webworkers');
      if (wwToggle) wwToggle.checked = uiPrefs?.[UI_PREF_KEY_WEB_WORKERS_ENABLED] === true;
    } catch (_) {}

    _agentShortcutsCache = shortcuts.slice();
  } finally {
    _agentSettingsUiMutating = false;
  }

  const normalized = _collectSidebarShortcuts(uiPrefs);
  const ensured = _ensureActiveShortcutSelection(uiPrefs, normalized);
  _maybeUpdateShortcutLastUsed(uiPrefs, ensured.active, normalized);
  _applyAgentToggleToolbar(uiPrefs, { shortcuts: normalized, active: ensured.active });
  _applyAgentHeaderDisplay(uiPrefs, { shortcuts: normalized, active: ensured.active });
  _renderSidebarHeaderIconList(uiPrefs, { shortcuts: normalized, active: ensured.active });
  _syncSidebarIframes(uiPrefs, normalized, ensured.active);
}

function _updateSidebarSetupPlaceholder(uiPrefs, hasActiveOverride) {
  const placeholder = document.getElementById('sidebar-setup-placeholder');
  const stack = document.getElementById('sidebar-iframe-stack');
  if (!placeholder || !stack) return;
  const hasActive = typeof hasActiveOverride === 'boolean'
    ? hasActiveOverride
    : !!(_resolveActiveShortcut(uiPrefs)?.url);
  if (hasActive) {
    placeholder.style.display = 'none';
  } else {
    placeholder.style.display = 'flex';
  }
  stack.style.opacity = hasActive ? '1' : '0';
  stack.style.pointerEvents = hasActive ? 'auto' : 'none';
  stack.setAttribute('aria-hidden', hasActive ? 'false' : 'true');
}

function _sendAgentUiPrefUpdate(key, value) {
  if (!window.__explorerRpc) {
    host.toast('Explorer WebSocket is not connected yet.');
    return;
  }
  window.__explorerRpc.notify(EXPLORER_RPC_METHODS.prefsUiUpdate, { key, value });
}

function _ensureSidebarIframeLoaded(entry) {
  if (!entry || !entry.iframe || entry.loaded) return;
  if (!entry.url) return;
  entry.iframe.src = entry.url;
  entry.loaded = true;
}

function _setActiveSidebarIframe(activeKey, activeUrl, uiPrefs) {
  let hasActive = false;
  _agentShortcutIframeMap.forEach((entry, key) => {
    const isActive = !!(activeKey && activeUrl && key === activeKey);
    entry.iframe.classList.toggle('is-active', isActive);
    if (isActive) {
      _ensureSidebarIframeLoaded(entry);
      hasActive = true;
    }
  });
  _updateSidebarSetupPlaceholder(uiPrefs || _latestUiPrefs || {}, hasActive);
  return hasActive;
}

function _syncSidebarIframes(uiPrefs, shortcutsOverride, activeOverride) {
  const stack = document.getElementById('sidebar-iframe-stack');
  if (!stack) return;
  const shortcuts = Array.isArray(shortcutsOverride)
    ? shortcutsOverride
    : _collectSidebarShortcuts(uiPrefs);
  const desiredKeys = new Set(shortcuts.map((sc) => sc.key));

  _agentShortcutIframeMap.forEach((entry, key) => {
    if (!desiredKeys.has(key)) {
      try {
        entry.iframe.remove();
      } catch (_) {}
      _agentShortcutIframeMap.delete(key);
    }
  });

  shortcuts.forEach((sc) => {
    let entry = _agentShortcutIframeMap.get(sc.key);
    if (!entry) {
      const iframe = document.createElement('iframe');
      iframe.className = 'sidebar-iframe';
      iframe.setAttribute('data-shortcut-id', sc.key);
      iframe.setAttribute('loading', sc.load === 'eager' ? 'eager' : 'lazy');
      stack.appendChild(iframe);
      entry = { iframe, url: sc.url, loaded: false };
      _agentShortcutIframeMap.set(sc.key, entry);
    }
    const prevUrl = entry.url;
    entry.url = sc.url;
    entry.iframe.setAttribute('data-shortcut-id', sc.key);
    entry.iframe.setAttribute('data-shortcut-load', sc.load);
    entry.iframe.setAttribute('loading', sc.load === 'eager' ? 'eager' : 'lazy');
    if (entry.loaded && prevUrl && prevUrl !== sc.url) {
      entry.iframe.src = sc.url;
    }
    if (sc.load === 'eager') {
      _ensureSidebarIframeLoaded(entry);
    }
  });

  const active = activeOverride || _resolveActiveShortcut(uiPrefs, shortcuts);
  const activeKey = active ? active.key : '';
  const activeUrl = active ? active.url : '';
  _setActiveSidebarIframe(activeKey, activeUrl, uiPrefs);
}

function _renderShortcutIconNode(icon, sizePx = 16, fallbackText = '') {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  if (sizePx === null) {
    wrap.style.width = '100%';
    wrap.style.height = '100%';
  } else {
    wrap.style.width = `${sizePx}px`;
    wrap.style.height = `${sizePx}px`;
  }
  const i = icon && typeof icon === 'object' ? icon : null;
  if (!i) {
    if (fallbackText) wrap.textContent = fallbackText;
    return wrap;
  }
  if (i.kind === 'emoji') {
    wrap.textContent = String(i.emoji || '').trim();
    return wrap;
  }
  if (i.kind === 'asset') {
    const name = String(i.name || '').trim();
    if (!name) {
      if (fallbackText) wrap.textContent = fallbackText;
      return wrap;
    }
    const img = document.createElement('img');
    img.src = _agentIconUrlFromName(name);
    img.alt = '';
    if (sizePx !== null) {
      img.style.width = `${sizePx}px`;
      img.style.height = `${sizePx}px`;
      img.style.objectFit = 'contain';
    }
    wrap.appendChild(img);
  }
  if (!wrap.textContent && !wrap.childNodes.length && fallbackText) {
    wrap.textContent = fallbackText;
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
      const id = typeof sc?.id === 'string' ? sc.id : '';
      const activeId = id || url;
      if (!label || !url || !activeId) return;
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
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT, activeId);
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
  try { menuCoreController.closeAllMenus(); } catch (_) {}
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
  if (agentShortcutHeader) agentShortcutHeader.checked = false;
  _setAgentShortcutLoadValue('lazy');
  agentShortcutEmoji.value = '';
  agentShortcutIconPreview.textContent = '';
  _closeAgentShortcutLoadMenu();
}

function _showAgentShortcutEditor(entry) {
  agentShortcutsEditor.style.display = '';
  const e = entry && typeof entry === 'object' ? entry : {};
  _agentShortcutEditingId = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : null;
  agentShortcutLabel.value = typeof e.label === 'string' ? e.label : '';
  agentShortcutUrl.value = typeof e.url === 'string' ? e.url : '';
  if (agentShortcutHeader) agentShortcutHeader.checked = true;
  _setAgentShortcutLoadValue(e.load);

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

function _closeAgentShortcutLoadMenu() {
  if (!agentShortcutLoadDD) return;
  agentShortcutLoadDD.classList.remove('show');
  if (agentShortcutLoadBtn) {
    agentShortcutLoadBtn.setAttribute('aria-expanded', 'false');
  }
}

function _renderAgentShortcutLoadMenu() {
  if (!agentShortcutLoadDD) return;
  agentShortcutLoadDD.innerHTML = '';
  const current = _getAgentShortcutLoadValue();
  const options = [
    { value: 'lazy', label: 'Lazy' },
    { value: 'eager', label: 'Eager' },
  ];
  options.forEach((opt) => {
    const item = document.createElement('div');
    item.className = 'fe-dd-item';
    item.textContent = opt.label;
    item.dataset.checkable = 'true';
    setMenuChecked(item, opt.value === current);
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _setAgentShortcutLoadValue(opt.value);
      _closeAgentShortcutLoadMenu();
    });
    agentShortcutLoadDD.appendChild(item);
  });
}

function _openAgentShortcutLoadMenu() {
  if (!agentShortcutLoadDD) return;
  try { menuCoreController.closeAllMenus(); } catch (_) {}
  _renderAgentShortcutLoadMenu();
  agentShortcutLoadDD.classList.add('show');
  if (agentShortcutLoadBtn) {
    agentShortcutLoadBtn.setAttribute('aria-expanded', 'true');
  }
}

function _persistAgentShortcuts(nextList) {
  _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_SHORTCUTS, nextList);
  const activeId = typeof _latestUiPrefs?.[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT] === 'string'
    ? _latestUiPrefs[UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT].trim()
    : '';
  const hasActive = !!(activeId && Array.isArray(nextList) && nextList.some((sc) => sc && (sc.id === activeId || sc.url === activeId)));
  if (!hasActive) {
    const fallback = Array.isArray(nextList) && nextList.length
      ? (nextList[0].id || nextList[0].url || '')
      : '';
    _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_ACTIVE_SHORTCUT, fallback);
  }
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
  _agentRuntimeMode = 'iframe';
  return initSidebarIframe({
    url: config.url,
    allowAnyOrigin: true,
    hideDrawerHeader: false,
  });
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

  window.__agentHostBase = _deriveAgentHostBaseFromRuntimeUrl(config.url);
  connectCodexAppserverSocket(config.url);

  if (!agentDrawerHandle) {
    return config;
  }

  const nextMode = 'iframe';
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
    }
  }

  return config;
}

function _initAgentSettingsUI() {
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

  // Header display radios
  try {
    const headerRadios = document.querySelectorAll('input[name="agent-header-display"]');
    headerRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (_agentSettingsUiMutating) return;
        if (!r.checked) return;
        _sendAgentUiPrefUpdate(UI_PREF_KEY_AGENT_HEADER_DISPLAY, r.value);
      });
    });
  } catch (_) {}

  // Web workers toggle
  try {
    const wwToggle = document.getElementById('editor-settings-webworkers');
    if (wwToggle) {
      wwToggle.addEventListener('change', () => {
        if (_agentSettingsUiMutating) return;
        _sendAgentUiPrefUpdate(UI_PREF_KEY_WEB_WORKERS_ENABLED, wwToggle.checked);
      });
    }
  } catch (_) {}

  editorSettingsAgentShortcutsBtn.addEventListener('click', () => {
    _openAgentShortcutsModal();
  });
  if (sidebarSetupShortcutsBtn) {
    sidebarSetupShortcutsBtn.addEventListener('click', () => {
      _openAgentShortcutsModal();
    });
  }

  agentShortcutsClose.addEventListener('click', _closeAgentShortcutsModal);
  agentShortcutsModal.addEventListener('click', (ev) => {
    if (ev.target === agentShortcutsModal) _closeAgentShortcutsModal();
  });
  agentShortcutsAdd.addEventListener('click', () => _showAgentShortcutEditor({}));
  agentShortcutCancel.addEventListener('click', _hideAgentShortcutEditor);
  agentShortcutEmoji.addEventListener('input', _renderAgentShortcutPreview);
  agentShortcutLoadBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const wasOpen = agentShortcutLoadDD.classList.contains('show');
    if (wasOpen) {
      _closeAgentShortcutLoadMenu();
      return;
    }
    _openAgentShortcutLoadMenu();
  });

  agentShortcutIconBrowse.addEventListener('click', async () => {
    if (!window.__explorerRpc) {
      host.toast('Explorer connection unavailable');
      return;
    }
    const picked = await pickFile(lastPickerPath || HOME_DIR);
    if (!picked) return;
    try {
      const res = await window.__explorerRpc.request(EXPLORER_RPC_METHODS.prefsAgentIconVendor, { abs_path: picked }, 12000);
      if (res?.ok && res.name) {
        _agentShortcutEditingAssetName = res.name;
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
    const load = _getAgentShortcutLoadValue();
    const header = true;
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
    const existing = idx >= 0 ? next[idx] : null;
    const lastUsed = Number.isFinite(Number(existing?.last_used)) ? Number(existing.last_used) : 0;
    const entry = {
      id,
      kind: SHORTCUT_KIND_URL,
      app_id: '',
      label,
      url,
      icon,
      load,
      header,
      last_used: lastUsed,
    };
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

  // ── Adapter status indicator: right-click + long-press context menu ──
  try {
    const spinnerEl = document.getElementById('fe-lsp-spinner');
    if (spinnerEl) {
      let adapterLpTimer = null;
      let adapterSuppressUntil = 0;
      spinnerEl.addEventListener('click', (ev) => {
        if (Date.now() < adapterSuppressUntil) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          adapterSuppressUntil = 0;
        }
      }, true);
      spinnerEl.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openAdapterDropdown();
      });
      spinnerEl.addEventListener('touchstart', (ev) => {
        if (adapterLpTimer) clearTimeout(adapterLpTimer);
        adapterLpTimer = setTimeout(() => {
          adapterSuppressUntil = Date.now() + 900;
          _openAdapterDropdown();
        }, 520);
      }, { passive: true });
      const clearAdapterLp = () => { if (adapterLpTimer) { clearTimeout(adapterLpTimer); adapterLpTimer = null; } };
      spinnerEl.addEventListener('touchend', clearAdapterLp, { passive: true });
      spinnerEl.addEventListener('touchcancel', clearAdapterLp, { passive: true });
      document.addEventListener('click', (ev) => {
        const dd = document.getElementById('fe-adapter-dd');
        if (!dd || !dd.classList.contains('show')) return;
        if (ev.target.closest('#fe-lsp-spinner')) return;
        if (ev.target.closest('#fe-adapter-dd')) return;
        _closeAdapterDropdown();
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
    try {
      sidebarShortcuts?.applyUiPrefs?.(_latestUiPrefs);
    } catch (e) {
      console.warn('[Sidebar] Failed to apply sidebar prefs:', e);
    }
    if (agentDrawerHandle) {
      void _applyAgentRuntimeConfigFromUi(_latestUiPrefs);
    }
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
let editTrackerWS = null;
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let cm6NiceguiClientId = null;
var lastSha256 = null;
// Keep early bootstrap handlers from hitting TDZ on debounce constants.
try {
  if (typeof window.__feCursorStateDebounceMs !== 'number') window.__feCursorStateDebounceMs = 1000;
} catch (_) {}
let inflightOpId = null;
const AUTOSAVE_IDLE_DELAY = 1200; // manual saves / disabled autosave
const AUTOSAVE_ACTIVE_DELAY = 450; // faster loop while autosave is ON
let lastSaveTime = 0;
const SELF_ECHO_GRACE = 1800; // 1.8s grace period after save (avoid cursor jumps on slow typing)
const saveSocketController = createSaveSocketController({
  requestBackendFileSave: (payload) => uiIpcConnections.requestBackendFileSave(payload),
});
const autosaveRuntimeController = createAutosaveRuntimeController({
  idleDelayMs: AUTOSAVE_IDLE_DELAY,
  activeDelayMs: AUTOSAVE_ACTIVE_DELAY,
  getAutoSaveEnabled: () => !!(editorViewState?.autoSave),
  getNativeSelectionActive: () => !!nativeSelectionActive,
  getUnsaved: () => !!unsaved,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => !!currentPathExists,
  saveFile: (opts) => saveFile(opts),
  onAutosaveError: (err) => console.error('Autosave failed:', err),
});

// Use `var` so early Socket.IO events can't hit TDZ before initialization.
var lastScrollState = null;
var scrollStateTimer = null;
const CURSOR_STATE_DEBOUNCE = 1000; // ms

// ── Adapter dropdown (context menu on status indicator) ──────────────
const adapterUi = createAdapterUiController({
  closeAllMenus: () => menuCoreController.closeAllMenus(),
  spinnerSetStep: (msg) => hostStateRuntime.spinnerSetStep(msg),
  setWorkbenchAdapterState: ({ readyOk, connecting }) => {
    hostStateRuntime.setWorkbenchAdapterState({ readyOk, connecting });
  },
  toast: (msg, ms) => host.toast(msg, ms),
});
window.__feAdapterUi = adapterUi;

function _closeAdapterDropdown() {
  adapterUi.closeAdapterDropdown();
}

function _openAdapterDropdown() {
  adapterUi.openAdapterDropdown();
}

async function _requestAdapterRestart() {
  return adapterUi.requestAdapterRestart();
}

function _reloadEditorFrame() {
  adapterUi.reloadEditorFrame();
}

window.__cm6HandleLspStatusUpdate = adapterUi.handleLspStatusUpdate;

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


function markUnsaved(flag) {
  const next = !!flag;
  cacheStateBadge.dataset.state = next ? (cacheStateBadge.dataset.state || '') : '';
  unsaved = next;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
  syncSessionPath();
  if (!unsaved) autosaveRuntimeController.cancelAutosave();
  if (unsaved && editorViewState?.autoSave) {
    autosaveRuntimeController.scheduleAutosave();
  }
}

// ---------- API helpers ----------
const apiClient = createApiClient(api);
async function apiGet(path) {
  return apiClient.apiGet(path);
}
async function apiPost(path, body) {
  return apiClient.apiPost(path, body);
}

// Live draft/autosave propagation is handled by the dedicated editor Socket.IO channel.
const searchPanelController = createSearchPanelController({
  getCurrentPath: () => currentPath || null,
  getProjectRoot: () => cachedProjectRoot || null,
  requestBackendEditorFind: (payload) => uiIpcConnections.requestBackendEditorFind(payload),
  toast: (msg) => host.toast(msg),
});

// ---------- Unified Preference Management (Backend as Single Source of Truth) ----------
const preferencesController = createPreferencesController({
  apiPost: (path, body) => apiPost(path, body),
  requestBackendEditorPreferenceUpdate: (payload) => uiIpcConnections.requestBackendEditorPreferenceUpdate(payload),
  getClientId: () => cm6NiceguiClientId,
  setEditorViewState: (state) => { editorViewState = state; },
  setMenuChecked,
  applyFontScale: (scale) => applyFontScale(scale),
  getMenuItems: () => ({
    miToggleLines,
    miToggleSyntax,
    miToggleCloseBrackets,
    miToggleAutocomplete,
    miToggleShading,
    miToggleIndentGuides,
    miToggleWrap,
    miToggleAutosave,
    miToggleDiffs,
    miToggleDraftDiffs,
    miToggleColorPicker,
    miToggleReadonly,
    miToggleMinimap,
    miToggleStickyScroll,
    miTrackEdits,
    miTrackAgentSidebarEdits,
  }),
});

installPrefsSync({
  getClientId: () => cm6NiceguiClientId,
  setEditorViewState: (state) => { editorViewState = state; },
  applyStateToMenus: (state) => preferencesController.applyStateToMenus(state),
});

const recentsController = createRecentsController({
  recentFilesDD,
  recentFilesBtn,
  formatFileNameDisplay: (name) => formatFileNameDisplay(name),
  openFile: (path) => openFile(path),
});
recentsController.installWindowHook();

// Synchronize host + inline editor when a project is opened in the explorer.
// Called from explorer.ts via window.__cm6HandleProjectOpened(path).
const projectSwitchController = createProjectSwitchController({
  getTerminal: () => terminal,
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  resetHostState: () => {
    currentPath = '';
    currentPathExists = false;
    lastSha256 = null;
    lastSavedContent = '';
  },
  markUnsaved: (flag) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  syncEditorState: (forceRefresh) => editorStateController.syncEditorState(forceRefresh),
  broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
  getBranchMenuHandle: () => branchMenuHandle,
  reloadEditorSurface: () => window.location.reload(),
});

// Expose for explorer.ts (project:opened handler)
projectSwitchController.installWindowHook();

const editorStateController = createEditorStateController({
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  getCachedProjectRoot: () => cachedProjectRoot,
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
  getCurrentPath: () => currentPath,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  reconcileCurrentPath: (path) => { _applyHostActivePath(path, { forceToolbar: true }); },
  requestBackendEditorGitBaselines: (payload) => uiIpcConnections.requestBackendEditorGitBaselines(payload),
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  openFile: (path, opts) => openFile(path, opts),
});

editorStateController.installWindowHooks();

// ---------- WebSocket management ----------
const fileSyncHandler = createFileSyncHandler({
  getLastSaveTime: () => lastSaveTime,
  getInflightOpId: () => inflightOpId,
  selfEchoGraceMs: SELF_ECHO_GRACE,
  toAbsolute,
  homeDir: HOME_DIR,
  getCurrentPath: () => currentPath,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  updatePathDisplay: () => updatePathDisplay(),
  setLastSavedContent: (content) => { lastSavedContent = content; },
  getLastSha256: () => lastSha256,
  setLastSha256: (sha) => { lastSha256 = sha; },
  markUnsaved: (flag) => markUnsaved(flag),
  setStatus: (text) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  clearInflightOpId: () => { inflightOpId = null; },
});
const fileWebSocketManager = createFileWebSocketManager({
  ReconnectingWebSocket,
  clientId,
  setStatus: (msg) => { statusEl.textContent = msg; },
  clearStatus: (expected, delayMs) => {
    setTimeout(() => {
      if (statusEl.textContent === expected) statusEl.textContent = '';
    }, delayMs);
  },
  onMessage: (msg) => fileSyncHandler.handleWSMessage(msg),
});

// ---------- File ops ----------
const fileStatusController = createFileStatusController({
  runActiveBtn,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  isRunnableFile,
  toAbsolute,
  HOME_DIR,
  basename,
  setToolbarFileName: (name) => setToolbarFileName(name),
  setIndicatorInactive: (badge) => cacheIndicatorController.setIndicatorInactive(badge),
  setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
});
function updatePathDisplay() {
  fileStatusController.updatePathDisplay();
}

const cacheIndicatorController = createCacheIndicatorController({
  getCurrentPath: () => currentPath,
  getCachedProjectRoot: () => cachedProjectRoot,
  getCurrentProjectRoot: () => stateInitController.getCurrentProjectRoot(),
  apiDelete: (path) => api.delete(path),
  openFile: (path, opts) => openFile(path, opts),
  toast: (msg) => host.toast(msg),
  markUnsaved: (flag) => markUnsaved(flag),
  getRestoredSessionActive: () => restoredSessionActive,
});

function _applyCacheIndicatorImpl(info) {
  cacheIndicatorController.applyCacheIndicator(info);
}

applyCacheIndicator = _applyCacheIndicatorImpl;
cacheIndicatorController.installWindowHook();

const openFlowController = createOpenFlowController({
  setStatus: (text) => { statusEl.textContent = text; },
  ensureProjectContext: () => editorStateController.ensureProjectContext(),
  toAbsolute,
  homeDir: HOME_DIR,
  getRestoredSessionActive: () => !!restoredSessionActive,
  getCurrentPath: () => currentPath,
  setRestoredSessionActive: (flag) => { restoredSessionActive = flag; },
  setIndicatorInactive: () => cacheIndicatorController.setIndicatorInactive(cacheStateBadge),
  apiPost: (path, body) => apiPost(path, body),
  apiGet: (path) => apiGet(path),
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists) => { currentPathExists = exists; },
  setLastPickerPath: (path) => { lastPickerPath = path; },
  parentDir,
  setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
  detectLanguageFromFilename,
  setLastSha256: (sha) => { lastSha256 = sha; },
  requestBackendOpen: (payload) => uiIpcConnections.requestBackendFileOpen(payload),
  setLastSavedContent: (content) => { lastSavedContent = content; },
  awaitEditorOpen: (requestId, path, timeoutMs) => _awaitEditorOpen(requestId, path, timeoutMs),
  markUnsaved: (flag) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  getCachedProjectRoot: () => cachedProjectRoot,
  dispatchExplorerActiveFile: (rel) => {
    try {
      if (typeof window.__explorerHandleNotification === 'function') {
        window.__explorerHandleNotification(EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated, { rel });
      }
    } catch (_) {}
  },
  openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
  broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
  syncEditorState: (force) => editorStateController.syncEditorState(force),
  getSessionStateActiveProject: () => sessionState.activeProject || null,
  setSessionStateActiveProject: (path) => { sessionState.activeProject = path; },
  jumpToCurrentFileLine: (line, opts) => jumpToCurrentFileLine(line, opts),
  toast: (msg) => host.toast(msg),
});

async function openFile(path, options = {}) {
  return openFlowController.openFile(path, options);
}

const saveFlowController = createSaveFlowController({
  clientId,
  setInflightOpId: (id) => { inflightOpId = id; },
  setLastSaveTime: (ts) => { lastSaveTime = ts; },
  getLastSha256: () => lastSha256,
  setLastSha256: (sha) => { lastSha256 = sha; },
  setLastSavedContent: (content) => { lastSavedContent = content; },
  markUnsaved: (flag) => markUnsaved(flag),
  syncSessionPath: () => syncSessionPath(),
  apiPost: (path, body) => apiPost(path, body),
  apiGet: (path) => apiGet(path),
  saveFileViaEditorSocket: (payload, timeoutMs) => saveSocketController.saveFileViaEditorSocket(payload, timeoutMs),
  setStatus: (text) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  toast: (msg) => host.toast(msg),
  pickSaveTarget: () => pickerController.pickSaveTarget(),
  toAbsolute,
  homeDir: HOME_DIR,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists) => { currentPathExists = exists; },
  setLastPickerPath: (path) => { lastPickerPath = path; },
  setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
  parentDir,
  detectLanguageFromFilename,
  updatePathDisplay: () => updatePathDisplay(),
  openFile: (path, options) => openFile(path, options),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
  getCachedProjectRoot: () => cachedProjectRoot,
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
});

 // getAgentHostBase
async function saveFile(opts) {
  return saveFlowController.saveFile({
    currentPath,
    currentPathExists,
    isAutosave: !!(opts && opts.isAutosave),
    onMissingPath: () => saveFlowController.saveAsDialog(),
  });
}

const runFileController = createRunFileController({
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  isRunnableFile,
  setRunButtonDisabled: (flag) => { runActiveBtn.disabled = !!flag; },
  saveFile: () => saveFile(),
  openTerminal: async () => {
    if (terminal && typeof terminal.open === 'function') await terminal.open();
  },
  apiPost: (path, body) => apiPost(path, body),
  requestBackendRunActiveFile: (payload) => uiIpcConnections.requestBackendRunActiveFile(payload),
  basename,
  toast: (msg) => host.toast(msg),
  updateRunButtonState: () => fileStatusController.updateRunButtonState(),
});

// Autosave confirmation modal (constructed lazily)
const autosaveModalController = createAutosaveModalController();

// Watcher UI (extracted to src/host/ui/watcher-settings.js)
initWatcherUI(appContext);

sidebarShortcuts = initSidebarShortcutsSafe({
  initSidebarShortcuts,
  host,
  homeDir: HOME_DIR,
  pickFile,
  openDrawer: () => { try { agentDrawerHandle?.open?.(); } catch (_) {} },
  closeAllMenus,
  setMenuChecked,
  emitSidebarIpc: _emitSidebarIpc,
});

drainPendingWatcherEvents();

// Projects debug modal extracted to src/host/ui/projects-debug-modal.js

// ---------- Picker helpers (shared modal provided by framework) ----------
const pickerController = createPickerController({
  pickFileWithPicker,
  pickDirectoryWithPicker,
  pickSaveTargetWithPicker,
  pickerAvailable: () => pickerUiAvailable(),
  getCurrentPath: () => currentPath,
  getLastPickerPath: () => lastPickerPath,
  setLastPickerPath: (path) => { lastPickerPath = path; },
  homeDir: HOME_DIR,
  toAbsolute,
  parentDir,
  basename,
  toast: (m) => host.toast(m),
});
async function pickFile(startPath) {
  return pickerController.pickFile(startPath);
}

const jumpLineController = createJumpLineController({
  getCurrentPath: () => currentPath,
  requestBackendEditorJumpToLine: (payload) => uiIpcConnections.requestBackendEditorJumpToLine(payload),
  toast: (msg) => host.toast(msg),
});

// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line, options = {}) {
  return jumpLineController.jumpToCurrentFileLine(line, options);
}

// Expose for search overlay
window.jumpToCurrentFileLine = jumpToCurrentFileLine;

// ---------- Menu & keyboard wiring ----------
const menuCoreController = createMenuCoreController({
  menuFileDD,
  menuEditDD,
  menuEditorDD,
  menuViewDD,
  recentFilesDD,
  getAgentShortcutLoadDD: () => agentShortcutLoadDD,
  getAgentShortcutLoadBtn: () => agentShortcutLoadBtn,
  getBranchMenuHandle: () => branchMenuHandle,
  menuFileBtn,
  menuEditBtn,
  menuEditorBtn,
  menuViewBtn,
  recentFilesBtn,
  runActiveBtn,
  runCurrentFile: () => runFileController.runCurrentFile(),
});
menuCoreController.installPrimaryMenuButtons();

function closeAllMenus() {
  return menuCoreController.closeAllMenus();
}
function bindMenuToggle(el, action) {
  return menuCoreController.bindMenuToggle(el, action);
}

installBasicMenuActions({
  bindMenuToggle,
  els: {
    miNew,
    miOpen,
    miSave,
    miSaveAs,
    miClose,
    miQuit,
    miDebugProjects,
    miExportDiagnostics,
    miUndo,
    miRedo,
    miCut,
    miCopy,
    miPaste,
    miSelectAll,
    miFind,
    miGoto,
  },
  resetToNewFile: () => resetActiveFileState({ resetPicker: true }),
  pickFile: () => pickFile(),
  openFile: (path) => openFile(path),
  saveFile: () => saveFile(),
  saveAsDialog: () => saveFlowController.saveAsDialog(),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  clearOnQuit: () => resetActiveFileState(),
  showProjectsDebugModal,
  exportDiagnosticsToFile: () => exportDiagnosticsToFile(),
  triggerEditorSearchPanel: (reason, opts) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  toast: (msg) => host.toast(msg),
});

const miToggleMinimap = requireEl('#mi-toggle-minimap');
installSimplePreferenceMenuActions({
  bindMenuToggle,
  els: {
    miToggleLines,
    miToggleShading,
    miToggleIndentGuides,
    miToggleSyntax,
    miToggleCloseBrackets,
    miToggleAutocomplete,
    miToggleWrap,
    miToggleColorPicker,
    miToggleMinimap,
    miToggleStickyScroll,
  },
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  toast: (msg) => host.toast(msg),
});

installAdvancedMenuActions({
  bindMenuToggle,
  els: {
    miToggleAutosave,
    miToggleDiffs,
    miToggleDraftDiffs,
    miToggleReadonly,
    miTrackEdits,
    miTrackAgentSidebarEdits,
  },
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  setMenuChecked,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  showAutosaveModal: (fileLabel, hasOtherDrafts) => autosaveModalController.showAutosaveModal(fileLabel, hasOtherDrafts),
  basename,
  getUnsaved: () => !!unsaved,
  saveFile: () => saveFile(),
  apiPost: (path, body) => apiPost(path, body),
  markUnsaved: (flag) => markUnsaved(flag),
  toast: (msg, kind) => host.toast(msg, kind),
});

const { terminal, consoleDrawer, problemsPanel: drawerProblemsPanel } = initPanelsAndDrawer({
  createTerminalDrawer,
  createConsoleDrawer,
  createProblemsPanel,
  initDrawerAndShortcuts,
  bindMenuToggle,
  requireEl,
  hostToast: (msg) => host.toast(msg),
  setFontScale: (preset) => fontScaleController.setFontScale(preset),
  triggerEditorSearchPanel: (reason, opts) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  openFile: (path, opts) => openFile(path, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  saveFile: () => saveFile(),
  resetToNewFile: () => resetActiveFileState({ resetPicker: true }),
  openPickedFile: () => {
    pickFile().then((p) => { if (p) openFile(p); });
  },
});
problemsPanel = drawerProblemsPanel;

// ---------- State load/init ----------
// host.setTitle('Code CM6');
const stateInitController = createStateInitController({
  openFile: (path) => openFile(path),
  toast: (msg) => host.toast(msg),
  toAbsolute,
  getBaseDir: (projectRoot) => projectRoot || cachedProjectRoot || HOME_DIR,
  homeDir: HOME_DIR,
  syncEditorState: (force) => editorStateController.syncEditorState(force),
});
stateInitController.installOpenHooks();

runBootSequence(createBootSequenceDeps({
    initResponsiveLayout: () => initResponsiveLayout({ scheduleToolbarTitleClamp: (opts) => scheduleToolbarTitleClamp(opts) }),
    initToolbarTitleClampObservers: () => initToolbarTitleClampObservers(),
    loadLayoutPreferences: () => loadLayoutPreferences(),
    initResizeManager: () => initResizeManager(),
    initExplorerUI: () => initExplorerUI(),
    connectExplorerSocket: () => connectExplorerSocket(),
    connectUIIPC: () => connectUIIPC(),
    connectSidebarIPC: () => connectSidebarIPC(),
    ensureWorkbenchAdapterReady: () => hostStateRuntime.ensureWorkbenchAdapterReady(),
    initBranchMenu: () => initBranchMenu(),
    waitForInitialUiPrefs: (ms) => waitForInitialUiPrefs(ms),
    seedUiPrefsSnapshot: (prefs) => window.__cm6HandleUiPrefs({ ui: prefs || {} }),
    applySidebarUiPrefs: (prefs) => sidebarShortcuts?.applyUiPrefs?.(prefs || {}),
    applyAgentRuntimeConfigFromUi: (prefs) => _applyAgentRuntimeConfigFromUi(prefs),
    connectCodexAppserverSocket: (url) => connectCodexAppserverSocket(url),
    createAgentController: (cfg) => _createAgentController(cfg),
    syncEditorState: (force) => editorStateController.syncEditorState(force),
    hydrateEditorState: (state) => editorStateController.hydrateEditorState(state),
    broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
    refreshMenuState: () => preferencesController.refreshMenuState(),
    apiPost: (path, body) => apiPost(path, body),
    fetchPersistedSessionState: () => fetchPersistedSessionState(),
    seedPersistedSessionState: (snapshot) => seedPersistedSessionState(snapshot),
    initSessionStateContext: (serverState) => initSessionStateContext(serverState),
    queueSessionStateUpdate: (partial) => queueSessionStateUpdate(partial),
    resetSavedState: () => { lastSavedContent = ''; },
    markUnsaved: (flag) => markUnsaved(flag),
    setNoProjectState: (msg) => applyNoProjectState({
      statusEl,
      setToolbarFileName: (name) => setToolbarFileName(name),
      setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
      message: msg,
    }),
    getUrlSearch: () => window.location.search,
    toAbsolute,
    HOME_DIR,
    applyRestoredPathState: ({ restoredPath, serverState, restoredSha }) => applyRestoredPathState({
      restoredPath,
      serverState,
      restoredSha,
      parentDir,
      detectLanguageFromFilename,
      syncSessionPath: () => syncSessionPath(),
      setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
      setCurrentPathExists: (exists) => { currentPathExists = exists; },
      setLastPickerPath: (path) => { lastPickerPath = path; },
      setLastSha256: (sha) => { lastSha256 = sha; },
      setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
    }),
    openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
    updatePathDisplayFallbackLater: () => schedulePathDisplayFallback({
      getCurrentPath: () => currentPath,
      updatePathDisplay: () => updatePathDisplay(),
      delayMs: 2000,
    }),
    openFile: (path) => {
      lastPickerPath = parentDir(path);
      return openFile(path);
    },
    onOpenFileFailure: (e) => {
      host.toast(`Failed to open file: ${e.message}`);
      resetActiveFileState();
    },
    onNoRestoredPath: (serverState) => applyNoRestoredPathState({
      serverState,
      setStatus: (msg) => { statusEl.textContent = msg; },
    }),
    setBranchMenuHandle: (h) => { branchMenuHandle = h; },
    setAgentDrawerHandle: (h) => { agentDrawerHandle = h; },
    requestBackendBootSnapshot: (payload) => uiIpcConnections.requestBackendBootSnapshot(payload),
    mountInlineEditorHost: (snapshot) => bootInlineEditorHost(editorFrameEl, {
      ensureSocketIoLoaded,
      bootSnapshot: snapshot,
    }),
  })).then(() => {
  try { sidebarShortcuts?.init?.(); } catch (e) { console.warn('[Sidebar] init failed:', e); }

  const deferHydrate = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn)
    : (fn) => setTimeout(fn, 0);
  deferHydrate(() => {
    try {
      void ensureEditorFrameReady()
        .then(() => Promise.resolve(sidebarShortcuts?.hydrate?.()))
        .catch((e) => {
          console.warn('[Sidebar] deferred hydrate failed:', e);
        });
    } catch (e) {
      console.warn('[Sidebar] deferred hydrate failed:', e);
    }
  });
});

installHostExitGuard({
  installBeforeExitGuard,
  onBeforeExit: (cb) => host.onBeforeExit(cb),
  getUnsaved: () => !!unsaved,
  showConfirm: () => showConfirm(),
  toast: (msg) => host.toast(msg),
  flushSessionState: (force) => flushSessionState(force),
});

}
