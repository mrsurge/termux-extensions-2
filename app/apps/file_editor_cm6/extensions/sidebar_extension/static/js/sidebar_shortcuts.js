// app/apps/file_editor_cm6/extensions/sidebar_extension/static/js/sidebar_shortcuts.js
// Sidebar shortcuts + iframe stack orchestration (kept out of main.js).
//
// Owns:
// - UI prefs wiring (agentToggleDisplay / agentHeaderDisplay / agentShortcuts / agentActiveShortcutId)
// - Sidebar header icon list + title/icon rendering
// - Shortcuts editor modal (URL + framework_app)
// - Iframe stack lifecycle (lazy/eager) with framework app start-before-load

const EXTENSION_MANIFEST_URL = '/apps/file_editor_cm6/extensions/sidebar_extension/manifest.json';

const UI_PREF_KEY_ACTIVE = 'agentActiveShortcutId';
const UI_PREF_KEY_TOGGLE_DISPLAY = 'agentToggleDisplay';
const UI_PREF_KEY_HEADER_DISPLAY = 'agentHeaderDisplay';
const UI_PREF_KEY_SHORTCUTS = 'agentShortcuts';

const SHORTCUT_KIND_URL = 'url';
const SHORTCUT_KIND_FRAMEWORK_APP = 'framework_app';

const SHORTCUT_LOAD_LAZY = 'lazy';
const SHORTCUT_LOAD_EAGER = 'eager';
const SIDEBAR_SETUP_TITLE_DEFAULT = 'Side-bar setup';
const SIDEBAR_SETUP_HINT_DEFAULT = 'Add shortcuts to choose what loads in the side-bar.';

function _normStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function _firstGrapheme(text) {
  const value = _normStr(text);
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

function _normalizeLoad(raw) {
  const value = _normStr(raw).toLowerCase();
  return value === SHORTCUT_LOAD_EAGER ? SHORTCUT_LOAD_EAGER : SHORTCUT_LOAD_LAZY;
}

function _normalizeKind(raw) {
  const value = _normStr(raw).toLowerCase();
  if (value === SHORTCUT_KIND_URL) return SHORTCUT_KIND_URL;
  if (value === SHORTCUT_KIND_FRAMEWORK_APP) return SHORTCUT_KIND_FRAMEWORK_APP;
  return '';
}

function _normalizeEditorKind(raw) {
  const kind = _normalizeKind(raw);
  return kind || SHORTCUT_KIND_URL;
}

function _buildFrameworkAppUrl(appId) {
  const safe = _normStr(appId);
  if (!safe) return '';
  return `/app/${encodeURIComponent(safe)}?embed=1`;
}

async function _fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  let body = null;
  try {
    body = await resp.json();
  } catch (_) {}
  return { resp, body };
}

export function initSidebarShortcuts(options = {}) {
  const host = options.host || null;
  const pickFileFn = typeof options.pickFile === 'function' ? options.pickFile : null;
  const openDrawer = typeof options.openDrawer === 'function' ? options.openDrawer : null;
  const closeAllMenus = typeof options.closeAllMenus === 'function' ? options.closeAllMenus : null;
  const emitSidebarIpc = typeof options.emitSidebarIpc === 'function' ? options.emitSidebarIpc : null;
  const setMenuChecked =
    typeof options.setMenuChecked === 'function'
      ? options.setMenuChecked
      : (el, checked) => {
          if (!el) return;
          el.classList.toggle('fe-menu-item-checked', !!checked);
          el.setAttribute('aria-checked', checked ? 'true' : 'false');
        };

  const toast = (msg) => {
    try {
      if (host && typeof host.toast === 'function') host.toast(msg);
      else console.log(msg);
    } catch (_) {}
  };

  function _logAppDiscovery(step, data) {
    try {
      if (typeof data === 'undefined') {
        console.log(`[SidebarShortcuts][AppDiscovery] ${step}`);
      } else {
        console.log(`[SidebarShortcuts][AppDiscovery] ${step}`, data);
      }
    } catch (_) {}
  }

  function _warnAppDiscovery(step, data) {
    try {
      if (typeof data === 'undefined') {
        console.warn(`[SidebarShortcuts][AppDiscovery] ${step}`);
      } else {
        console.warn(`[SidebarShortcuts][AppDiscovery] ${step}`, data);
      }
    } catch (_) {}
  }

  // --- DOM elements (resolved on init) ---
  let agentToggleBtn = null;
  let agentToggleIconEl = null;

  let shortcutsModal = null;
  let shortcutsCloseBtn = null;
  let shortcutsAddBtn = null;
  let shortcutsListEl = null;
  let shortcutsEditorEl = null;

  let editorSettingsShortcutsBtn = null;
  let setupShortcutsBtn = null;

  let shortcutLabelInput = null;
  let shortcutUrlWrap = null;
  let shortcutUrlInput = null;
  let shortcutKindBtn = null;
  let shortcutKindLabel = null;
  let shortcutKindDD = null;
  let shortcutAppWrap = null;
  let shortcutAppBtn = null;
  let shortcutAppLabel = null;
  let shortcutAppDD = null;

  let shortcutLoadBtn = null;
  let shortcutLoadLabel = null;
  let shortcutLoadDD = null;
  let shortcutHeaderCheck = null;

  let shortcutEmojiInput = null;
  let shortcutIconBrowseBtn = null;
  let shortcutIconClearBtn = null;
  let shortcutIconPreview = null;
  let shortcutCancelBtn = null;
  let shortcutSaveBtn = null;

  let sidebarHeaderIconEl = null;
  let sidebarHeaderTitleEl = null;
  let sidebarHeaderIconGridEl = null;
  let sidebarHeaderIconMenuEl = null;
  let sidebarRefreshBtn = null;
  let sidebarRefreshMenuEl = null;
  let sidebarSetupPlaceholder = null;
  let sidebarSetupTitleEl = null;
  let sidebarSetupHintEl = null;
  let sidebarIframeStack = null;

  // --- internal state ---
  let _latestUiPrefs = {};
  let _settingsUiMutating = false;
  let _shortcutsCache = [];

  let _editingId = null;
  let _editingAssetName = null;
  let _editingKind = SHORTCUT_KIND_URL;
  let _editingAppId = '';
  let _lastPickerPath = '';

  let _iframeMap = new Map(); // key -> {iframe,url,loaded}
  let _activateSeq = 0;

  let _extensionManifestIcon = { kind: '', value: '', defaultIcon: '' };

  let _appsCache = null; // canonical apps catalog from /api/apps/catalog
  let _appsCacheAt = 0;
  let _runningCache = null; // Set(app_id)
  let _runningCacheAt = 0;
  let _startingApps = new Map(); // app_id -> Promise<boolean>
  let _frameworkEventsWs = null;
  let _frameworkEventsReconnectTimer = null;
  let _frameworkEventsBackoffMs = 600;
  let _frameworkEventsEnabled = false;
  let _appsEventsSource = null;
  let _appsChromeSeq = 0;
  let _headerIconMenuKey = '';
  let _refreshMenuLongPressTimer = null;
  let _sidebarEventListenerBound = false;

  function _requireEl(selector, scope = document) {
    const el = scope.querySelector(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
  }

  function _sendUiPrefUpdate(key, value) {
    if (typeof window.__explorerBusSend !== 'function') {
      toast('Explorer WebSocket is not connected yet.');
      return;
    }
    window.__explorerBusSend('prefs:updateUi', { key, value });
  }

  async function _ensureAppsCache(force = false) {
    const now = Date.now();
    _logAppDiscovery('apps-cache:begin', { force, hasCache: !!_appsCache, ageMs: now - _appsCacheAt });
    if (!force && _appsCache && (now - _appsCacheAt) < 2500) {
      _logAppDiscovery('apps-cache:hit', { count: Array.isArray(_appsCache) ? _appsCache.length : 0 });
      return _appsCache;
    }
    try {
      _logAppDiscovery('apps-cache:fetch:start', { url: '/api/apps/catalog' });
      const { resp, body } = await _fetchJson('/api/apps/catalog', { cache: 'no-store' });
      _logAppDiscovery('apps-cache:fetch:response', {
        ok: !!resp?.ok,
        status: resp?.status,
        hasBody: !!body,
        bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
      });
      const list = Array.isArray(body?.data) ? body.data : [];
      _logAppDiscovery('apps-cache:fetch:parsed', { count: list.length });
      _appsCache = list;
      _appsCacheAt = now;
      return list;
    } catch (e) {
      _warnAppDiscovery('apps-cache:fetch:error', { message: e?.message || String(e) });
      toast(e?.message || 'Failed to fetch app list');
      _appsCache = [];
      _appsCacheAt = now;
      return _appsCache;
    }
  }

  async function _ensureRunningCache(force = false) {
    const now = Date.now();
    _logAppDiscovery('running-cache:begin', { force, hasCache: !!_runningCache, ageMs: now - _runningCacheAt });
    if (!force && _runningCache && (now - _runningCacheAt) < 1500) {
      _logAppDiscovery('running-cache:hit', { count: _runningCache instanceof Set ? _runningCache.size : 0 });
      return _runningCache;
    }
    try {
      _logAppDiscovery('running-cache:fetch:start', { url: '/api/apps/running' });
      const { resp, body } = await _fetchJson('/api/apps/running', { cache: 'no-store' });
      _logAppDiscovery('running-cache:fetch:response', {
        ok: !!resp?.ok,
        status: resp?.status,
        hasBody: !!body,
      });
      const list = Array.isArray(body?.data) ? body.data : [];
      const set = new Set();
      list.forEach((rec) => {
        const id = _normStr(rec?.app_id);
        if (id) set.add(id);
      });
      _logAppDiscovery('running-cache:fetch:parsed', { runningCount: set.size });
      _runningCache = set;
      _runningCacheAt = now;
      return set;
    } catch (e) {
      _warnAppDiscovery('running-cache:fetch:error', { message: e?.message || String(e) });
      _runningCache = new Set();
      _runningCacheAt = now;
      return _runningCache;
    }
  }

  function _frameworkEventsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/events`;
  }

  function _appsEventsUrl() {
    return '/api/apps/events';
  }

  function _deriveAppIdFromShellEvent(evt) {
    const direct = _normStr(evt?.app_id || evt?.data?.app_id);
    if (direct) return direct;

    const label = _normStr(evt?.data?.label);
    if (label.startsWith('app-worker:')) return _normStr(label.slice('app-worker:'.length));
    if (label.startsWith('asgi-app:')) return _normStr(label.slice('asgi-app:'.length));

    const specId = _normStr(evt?.data?.spec_id);
    if (specId.startsWith('app:')) {
      const parts = specId.split(':');
      if (parts.length >= 2) return _normStr(parts[1]);
    }
    return '';
  }

  function _runningStateFromShellEvent(evt) {
    const type = _normStr(evt?.type).toLowerCase();
    const status = _normStr(evt?.data?.status).toLowerCase();

    if (type === 'shell.exited' || type === 'shell.removed') return false;
    if (type === 'shell.ready' || type === 'shell.spawned') return true;
    if (type === 'shell.created') {
      if (!status || status === 'running') return true;
      return null;
    }
    if (type === 'shell.updated') {
      if (!status) return null;
      return status === 'running';
    }
    return null;
  }

  function _invalidateFrameworkShortcutIframes(appId) {
    const id = _normStr(appId);
    if (!id) return;
    const shortcuts = _collectShortcuts(_latestUiPrefs || {});
    const active = _resolveActive(_latestUiPrefs || {}, shortcuts);
    let invalidatedActive = false;
    shortcuts.forEach((sc) => {
      if (!sc || sc.kind !== SHORTCUT_KIND_FRAMEWORK_APP) return;
      if (_normStr(sc.app_id) !== id) return;
      const entry = _iframeMap.get(sc.key);
      if (!entry) return;
      entry.loaded = false;
      try { entry.iframe.src = 'about:blank'; } catch (_) {}
      if (active && active.key === sc.key) invalidatedActive = true;
    });
    if (invalidatedActive) {
      _updateSetupPlaceholder(_latestUiPrefs || {}, false);
    }
  }

  function _applyRunningDelta(appId, isRunning) {
    const id = _normStr(appId);
    if (!id || typeof isRunning !== 'boolean') return;
    if (!(_runningCache instanceof Set)) _runningCache = new Set();

    const had = _runningCache.has(id);
    if (isRunning) _runningCache.add(id);
    else _runningCache.delete(id);
    if (had === isRunning) return;

    _runningCacheAt = Date.now();
    _renderHeaderIconGrid(_latestUiPrefs || {});

    // If any shortcut points at a backend that dies, invalidate those iframe entries.
    if (!isRunning) _invalidateFrameworkShortcutIframes(id);

    try {
      if (shortcutAppDD && shortcutAppDD.classList.contains('show')) {
        void _renderAppMenu();
      }
    } catch (_) {}
  }

  function _handleFrameworkShellEvent(raw) {
    let evt = raw;
    try {
      if (typeof evt === 'string') evt = JSON.parse(evt);
    } catch (_) {
      return;
    }
    if (!evt || typeof evt !== 'object') return;

    const appId = _deriveAppIdFromShellEvent(evt);
    if (!appId) return;

    const running = _runningStateFromShellEvent(evt);
    if (running === null) return;
    _applyRunningDelta(appId, running);
  }

  function _scheduleFrameworkEventsReconnect() {
    if (!_frameworkEventsEnabled) return;
    if (_frameworkEventsReconnectTimer) return;
    const waitMs = _frameworkEventsBackoffMs;
    _frameworkEventsBackoffMs = Math.min(15000, Math.floor(_frameworkEventsBackoffMs * 1.8));
    _frameworkEventsReconnectTimer = setTimeout(() => {
      _frameworkEventsReconnectTimer = null;
      _connectFrameworkEvents();
    }, waitMs);
  }

  function _connectFrameworkEvents() {
    if (!_frameworkEventsEnabled) return;
    if (_frameworkEventsWs && (
      _frameworkEventsWs.readyState === WebSocket.OPEN
      || _frameworkEventsWs.readyState === WebSocket.CONNECTING
    )) return;

    let ws = null;
    try {
      ws = new WebSocket(_frameworkEventsUrl());
    } catch (_) {
      _scheduleFrameworkEventsReconnect();
      return;
    }
    _frameworkEventsWs = ws;

    ws.addEventListener('open', () => {
      _frameworkEventsBackoffMs = 600;
      void _ensureRunningCache(true).then(() => {
        _renderHeaderIconGrid(_latestUiPrefs || {});
      });
    });

    ws.addEventListener('message', (ev) => {
      _handleFrameworkShellEvent(ev?.data);
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) {}
    });

    ws.addEventListener('close', () => {
      if (_frameworkEventsWs === ws) _frameworkEventsWs = null;
      _scheduleFrameworkEventsReconnect();
    });
  }

  function _setFrameworkEventsEnabled(enabled) {
    if (!enabled) {
      _frameworkEventsEnabled = false;
      if (_frameworkEventsReconnectTimer) {
        clearTimeout(_frameworkEventsReconnectTimer);
        _frameworkEventsReconnectTimer = null;
      }
      if (_frameworkEventsWs) {
        try { _frameworkEventsWs.close(); } catch (_) {}
        _frameworkEventsWs = null;
      }
      return;
    }
    _frameworkEventsEnabled = true;
    _connectFrameworkEvents();
  }

  function _handleAppsRegistryReload() {
    _appsCache = null;
    _appsCacheAt = 0;
    const seq = ++_appsChromeSeq;
    void _ensureAppsCache(true).then(() => {
      if (seq !== _appsChromeSeq) return;
      _refreshShortcutChrome();
      _renderHeaderIconGrid(_latestUiPrefs || {});
      if (shortcutAppDD && shortcutAppDD.classList.contains('show')) {
        void _renderAppMenu();
      }
    });
  }

  function _connectAppsEvents() {
    if (typeof window.EventSource !== 'function') return;
    if (_appsEventsSource) return;
    try {
      _appsEventsSource = new EventSource(_appsEventsUrl());
    } catch (_) {
      _appsEventsSource = null;
      return;
    }
    _appsEventsSource.addEventListener('registry_reloaded', () => {
      _handleAppsRegistryReload();
    });
    _appsEventsSource.onerror = () => {
      // EventSource handles reconnects.
    };
  }

  function _findAppManifest(appId) {
    const id = _normStr(appId);
    if (!id || !Array.isArray(_appsCache)) {
      _warnAppDiscovery('manifest:find:skipped', { appId: id, hasAppsCache: Array.isArray(_appsCache) });
      return null;
    }
    const found = _appsCache.find((a) => a && a.id === id) || null;
    _logAppDiscovery('manifest:find:result', { appId: id, found: !!found });
    return found;
  }

  function _resolveAppIconSrc(appManifest) {
    const raw = _normStr(appManifest?.icon_src);
    if (!raw) {
      _logAppDiscovery('icon-src:none', { appId: _normStr(appManifest?.id) });
      return '';
    }
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      _logAppDiscovery('icon-src:absolute', { appId: _normStr(appManifest?.id), iconSrc: raw });
      return raw;
    }
    const assetBaseUrl = _normStr(appManifest?.asset_base_url);
    if (assetBaseUrl) {
      const resolved = `${assetBaseUrl.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`;
      _logAppDiscovery('icon-src:asset-base', { appId: _normStr(appManifest?.id), iconSrc: resolved });
      return resolved;
    }
    const appDir = _normStr(appManifest?._dir);
    if (appDir) {
      const resolved = `/apps/${appDir}/${raw.replace(/^\/+/, '')}`;
      _logAppDiscovery('icon-src:resolved', { appId: _normStr(appManifest?.id), iconSrc: resolved });
      return resolved;
    }
    _logAppDiscovery('icon-src:raw', { appId: _normStr(appManifest?.id), iconSrc: raw });
    return raw;
  }

  function _manifestIconForApp(appId) {
    const m = _findAppManifest(appId);
    if (!m) {
      _warnAppDiscovery('manifest-icon:missing-manifest', { appId: _normStr(appId) });
      return null;
    }
    const iconSrc = _resolveAppIconSrc(m);
    if (iconSrc) {
      _logAppDiscovery('manifest-icon:image', { appId: _normStr(appId), iconSrc });
      return { kind: 'image', src: iconSrc };
    }
    const iconText = _normStr(m.icon_text);
    if (iconText) {
      _logAppDiscovery('manifest-icon:text', { appId: _normStr(appId), iconText });
      return { kind: 'text', text: iconText };
    }
    const iconEmoji = _normStr(m.icon_emoji);
    if (iconEmoji) {
      _logAppDiscovery('manifest-icon:emoji', { appId: _normStr(appId), iconEmoji });
      return { kind: 'emoji', emoji: iconEmoji };
    }
    _warnAppDiscovery('manifest-icon:none', { appId: _normStr(appId) });
    return null;
  }

  function _agentIconUrlFromName(name) {
    const safe = _normStr(name);
    if (!safe) return '';
    return `/api/app/file_editor_cm6/agent_icons/${encodeURIComponent(safe)}`;
  }

  function _renderIconNode(icon, sizePx = 16, fallbackText = '') {
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
      wrap.textContent = _normStr(i.emoji);
      return wrap;
    }

    if (i.kind === 'text') {
      wrap.textContent = _normStr(i.text);
      return wrap;
    }

    if (i.kind === 'asset') {
      const name = _normStr(i.name);
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
      return wrap;
    }

    if (i.kind === 'image') {
      const src = _normStr(i.src);
      if (!src) {
        if (fallbackText) wrap.textContent = fallbackText;
        return wrap;
      }
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      if (sizePx !== null) {
        img.style.width = `${sizePx}px`;
        img.style.height = `${sizePx}px`;
        img.style.objectFit = 'contain';
      }
      wrap.appendChild(img);
      return wrap;
    }

    if (fallbackText) wrap.textContent = fallbackText;
    return wrap;
  }

  function _applyExtensionManifestIcon(manifest) {
    const iconPath = _normStr(manifest?.icon);
    const iconEmoji = _normStr(manifest?.icon_emoji);

    const targets = [agentToggleIconEl, sidebarHeaderIconEl].filter(Boolean);
    if (!targets.length) return;

    targets.forEach((el) => {
      el.textContent = '';
      el.dataset.manifestKind = '';
      el.dataset.manifestValue = '';
    });

    if (iconPath) {
      const resolved = iconPath.startsWith('/')
        ? iconPath
        : `/apps/file_editor_cm6/${iconPath.replace(/^\/+/, '')}`;
      targets.forEach((el) => {
        const img = document.createElement('img');
        img.src = resolved;
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        el.appendChild(img);
        el.dataset.manifestKind = 'image';
        el.dataset.manifestValue = resolved;
      });
      _extensionManifestIcon = { kind: 'image', value: resolved, defaultIcon: '' };
      return;
    }

    if (iconEmoji) {
      targets.forEach((el) => {
        el.textContent = iconEmoji;
        el.dataset.manifestKind = 'emoji';
        el.dataset.manifestValue = iconEmoji;
      });
      _extensionManifestIcon = { kind: 'emoji', value: iconEmoji, defaultIcon: '' };
      return;
    }

    // No fallback here: leave empty and let CSS decide.
    _extensionManifestIcon = { kind: '', value: '', defaultIcon: '' };
  }

  async function _bootstrapExtensionManifest() {
    try {
      const { body } = await _fetchJson(EXTENSION_MANIFEST_URL, { cache: 'no-store' });
      if (body && typeof body === 'object') {
        _applyExtensionManifestIcon(body);
      }
    } catch (e) {
      console.warn('[Sidebar] Failed to load extension manifest:', e);
    }
  }

  function _restoreManifestIcon(el) {
    if (!el) return;
    const kind = _normStr(el.dataset?.manifestKind);
    const value = _normStr(el.dataset?.manifestValue);
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
  }

  function _renderIconInto(el, icon, fallbackIcon = null) {
    if (!el) return;
    el.textContent = '';

    const i = icon && typeof icon === 'object' ? icon : null;
    if (i && i.kind === 'emoji') {
      const emoji = _normStr(i.emoji);
      if (emoji) {
        el.textContent = emoji;
        return;
      }
    }
    if (i && i.kind === 'asset') {
      const name = _normStr(i.name);
      if (name) {
        const img = document.createElement('img');
        img.src = _agentIconUrlFromName(name);
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        el.appendChild(img);
        return;
      }
    }
    if (i && i.kind === 'image') {
      const src = _normStr(i.src);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        el.appendChild(img);
        return;
      }
    }

    if (fallbackIcon) {
      _renderIconInto(el, fallbackIcon, null);
      return;
    }
    _restoreManifestIcon(el);
  }

  function _collectShortcuts(uiPrefs) {
    const raw = Array.isArray(uiPrefs?.[UI_PREF_KEY_SHORTCUTS]) ? uiPrefs[UI_PREF_KEY_SHORTCUTS] : [];
    const out = [];
    raw.forEach((sc) => {
      if (!sc || typeof sc !== 'object') return;
      const kind = _normalizeKind(sc.kind);
      if (!kind) return;
      const appId = _normStr(sc.app_id);
      if (kind === SHORTCUT_KIND_FRAMEWORK_APP && !appId) return;
      const label = _normStr(sc.label);
      const url = _normStr(sc.url) || (kind === SHORTCUT_KIND_FRAMEWORK_APP ? _buildFrameworkAppUrl(appId) : '');
      if (!url) return;
      const id = _normStr(sc.id);
      const key = id || url;
      if (!key) return;
      out.push({
        key,
        id,
        kind,
        app_id: appId,
        label,
        url,
        icon: sc.icon || null,
        load: _normalizeLoad(sc.load),
        header: !!sc.header,
        last_used: Number.isFinite(Number(sc.last_used)) ? Number(sc.last_used) : 0,
      });
    });
    return out;
  }

  function _resolveActive(uiPrefs, shortcuts) {
    const activeId = _normStr(uiPrefs?.[UI_PREF_KEY_ACTIVE]);
    if (!activeId) return null;
    const list = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    return (
      list.find((sc) => sc && (sc.id === activeId || sc.url === activeId || sc.key === activeId))
      || null
    );
  }

  function getActiveUrl(uiPrefs) {
    const active = _resolveActive(uiPrefs || _latestUiPrefs || {});
    return active ? active.url : '';
  }

  function _ensureActiveSelection(uiPrefs, shortcuts) {
    const activeId = _normStr(uiPrefs?.[UI_PREF_KEY_ACTIVE]);
    const list = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    if (!list.length) return { active: null, activeId: '' };
    const active = _resolveActive(uiPrefs, list);
    if (active) return { active, activeId: activeId || active.key };
    const fallback = list[0];
    const nextId = fallback?.id || fallback?.url || fallback?.key || '';
    if (nextId && nextId !== activeId) {
      _sendUiPrefUpdate(UI_PREF_KEY_ACTIVE, nextId);
    }
    return { active: fallback || null, activeId: nextId };
  }

  function _applyToggleDisplay(uiPrefs) {
    const display = _normStr(uiPrefs?.[UI_PREF_KEY_TOGGLE_DISPLAY]) || 'icon';
    try {
      const radios = document.querySelectorAll('input[name="agent-toggle-display"]');
      radios.forEach((r) => { r.checked = (r.value === display); });
    } catch (_) {}
  }

  function _applyHeaderDisplayMode(uiPrefs) {
    const iconEl = sidebarHeaderIconEl;
    const textEl = sidebarHeaderTitleEl;
    if (!iconEl || !textEl) return;
    const display = _normStr(uiPrefs?.[UI_PREF_KEY_HEADER_DISPLAY]) || 'text';
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
  }

  function _effectiveShortcutIcon(sc) {
    const icon = sc && sc.icon && typeof sc.icon === 'object' ? sc.icon : null;
    if (icon && icon.kind && icon.kind !== 'default') return icon;
    if (sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      const mIcon = _manifestIconForApp(sc.app_id);
      if (mIcon) return mIcon;
    }
    return null;
  }

  function _refreshShortcutChrome() {
    const normalized = _collectShortcuts(_latestUiPrefs || {});
    const active = _resolveActive(_latestUiPrefs || {}, normalized);
    _applyToggleIcon(_latestUiPrefs || {}, normalized, active);
    _applyHeaderLabelAndIcon(_latestUiPrefs || {}, normalized, active);
    _renderHeaderIconGrid(_latestUiPrefs || {}, normalized, active);
    try {
      const dd = document.getElementById('fe-agent-dd');
      if (dd && dd.classList.contains('show')) _renderAgentDropdown();
    } catch (_) {}
    try {
      if (shortcutsModal && shortcutsModal.classList.contains('show')) _renderShortcutsList();
    } catch (_) {}
  }

  function _applyToggleIcon(uiPrefs, shortcuts, active) {
    if (!agentToggleIconEl) return;
    const resolvedShortcuts = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const icon = _effectiveShortcutIcon(resolvedActive);
    if (icon) {
      _renderIconInto(agentToggleIconEl, icon, null);
      return;
    }
    _restoreManifestIcon(agentToggleIconEl);
  }

  function _applyHeaderLabelAndIcon(uiPrefs, shortcuts, active) {
    if (!sidebarHeaderIconEl || !sidebarHeaderTitleEl) return;
    const resolvedShortcuts = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const headerLabel = resolvedActive && _normStr(resolvedActive.label) ? _normStr(resolvedActive.label) : 'Sidebar';
    sidebarHeaderTitleEl.textContent = headerLabel;

    const icon = _effectiveShortcutIcon(resolvedActive);
    if (icon) {
      _renderIconInto(sidebarHeaderIconEl, icon, null);
      return;
    }
    const fallbackText = _firstGrapheme(headerLabel);
    if (fallbackText) {
      sidebarHeaderIconEl.textContent = fallbackText;
      return;
    }
    _restoreManifestIcon(sidebarHeaderIconEl);
  }

  function _collectHeaderItems(resolvedShortcuts) {
    return resolvedShortcuts
      .filter((sc) => sc && sc.header)
      .map((sc) => ({ ...sc }));
  }

  function _closeHeaderIconMenu() {
    if (!sidebarHeaderIconMenuEl) return;
    sidebarHeaderIconMenuEl.classList.remove('show');
    sidebarHeaderIconMenuEl.innerHTML = '';
    sidebarHeaderIconMenuEl.style.left = '';
    sidebarHeaderIconMenuEl.style.top = '';
    sidebarHeaderIconMenuEl.dataset.shortcutKey = '';
    _headerIconMenuKey = '';
  }

  function _closeRefreshMenu() {
    if (!sidebarRefreshMenuEl) return;
    sidebarRefreshMenuEl.classList.remove('show');
    sidebarRefreshMenuEl.innerHTML = '';
  }

  function _emitSidebarControl(type, payload = {}) {
    const message = {
      type: _normStr(type),
      payload: (payload && typeof payload === 'object') ? payload : {},
    };
    if (!message.type) return;
    if (emitSidebarIpc) {
      emitSidebarIpc('sidebar:event', message);
    } else {
      try {
        window.dispatchEvent(new CustomEvent('cm6:sidebar-event', { detail: message }));
      } catch (_) {}
    }
  }

  function _openRefreshMenu(anchorEl) {
    if (!sidebarRefreshMenuEl || !anchorEl) return;
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    _closeAgentDropdown();
    _closeHeaderIconMenu();
    _closeRefreshMenu();

    const menu = sidebarRefreshMenuEl;
    const flush = document.createElement('div');
    flush.className = 'fe-dd-item';
    flush.textContent = 'Flush active item cache';
    flush.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _closeRefreshMenu();
      _emitSidebarControl('refresh_active', { flushCache: true, source: 'sidebar_refresh_menu' });
    });
    menu.appendChild(flush);

    menu.classList.add('show');
  }

  function _findRawShortcutIndex(sc) {
    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS]) ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS] : [];
    const key = _normStr(sc?.key);
    const id = _normStr(sc?.id);
    const url = _normStr(sc?.url);
    return raw.findIndex((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const entryId = _normStr(entry.id);
      const entryUrl = _normStr(entry.url);
      if (key && (entryId === key || entryUrl === key)) return true;
      if (id && entryId === id) return true;
      if (url && entryUrl === url) return true;
      return false;
    });
  }

  function _setShortcutHeaderFlag(sc, enabled) {
    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS]) ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS] : [];
    const idx = _findRawShortcutIndex(sc);
    if (idx < 0) return;
    const current = !!raw[idx]?.header;
    const nextVal = !!enabled;
    if (current === nextVal) return;
    const next = raw.map((entry, i) => {
      if (i !== idx || !entry || typeof entry !== 'object') return entry;
      return { ...entry, header: nextVal };
    });
    _persistShortcuts(next);
  }

  function _persistHeaderOrder(orderedKeys) {
    const order = Array.isArray(orderedKeys)
      ? orderedKeys.map((key) => _normStr(key)).filter((key) => !!key)
      : [];
    if (!order.length) return;

    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS]) ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS] : [];
    if (!raw.length) return;

    const headerRecords = [];
    const headerByKey = new Map();
    raw.forEach((entry) => {
      if (!entry || typeof entry !== 'object' || !entry.header) return;
      const key = _normStr(entry.id) || _normStr(entry.url);
      if (!key) return;
      const record = { key, entry };
      headerRecords.push(record);
      if (!headerByKey.has(key)) headerByKey.set(key, record);
    });
    if (headerRecords.length < 2) return;

    const reordered = [];
    const seen = new Set();
    order.forEach((key) => {
      if (seen.has(key)) return;
      const record = headerByKey.get(key);
      if (!record) return;
      reordered.push(record);
      seen.add(key);
    });
    headerRecords.forEach((record) => {
      if (seen.has(record.key)) return;
      reordered.push(record);
      seen.add(record.key);
    });
    if (reordered.length !== headerRecords.length) return;

    let changed = false;
    for (let i = 0; i < headerRecords.length; i += 1) {
      if (headerRecords[i].key !== reordered[i].key) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    let cursor = 0;
    const next = raw.map((entry) => {
      if (!entry || typeof entry !== 'object' || !entry.header) return entry;
      const key = _normStr(entry.id) || _normStr(entry.url);
      if (!key) return entry;
      const replacement = reordered[cursor]?.entry || entry;
      cursor += 1;
      return replacement;
    });
    _persistShortcuts(next);
  }

  async function _quitFrameworkApp(appId) {
    const id = _normStr(appId);
    if (!id) return false;
    try {
      const { resp, body } = await _fetchJson(`/api/apps/${encodeURIComponent(id)}/quit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp?.ok || !body?.ok) {
        const detail = body?.detail || body?.error || `Failed to stop app ${id}`;
        if (resp?.status === 404) {
          toast(`${id} is not running`);
        } else {
          throw new Error(detail);
        }
      } else {
        toast(`Stopped ${id}`);
      }
      if (!(_runningCache instanceof Set)) _runningCache = new Set();
      _runningCache.delete(id);
      _runningCacheAt = Date.now();
      _invalidateFrameworkShortcutIframes(id);
      _refreshShortcutChrome();
      return true;
    } catch (e) {
      toast(e?.message || `Failed to stop app ${id}`);
      return false;
    }
  }

  function _openHeaderIconMenu(anchorEl, sc) {
    if (!sidebarHeaderIconMenuEl || !anchorEl || !sc) return;
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    _closeAgentDropdown();
    _closeRefreshMenu();
    _closeHeaderIconMenu();

    const menu = sidebarHeaderIconMenuEl;
    const label = _normStr(sc?.label) || _normStr(sc?.app_id) || _normStr(sc?.url) || 'Shortcut';

    const title = document.createElement('div');
    title.className = 'fe-dd-item';
    title.style.opacity = '0.72';
    title.style.cursor = 'default';
    title.textContent = label;
    title.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    menu.appendChild(title);

    const addSeparator = () => {
      const sep = document.createElement('div');
      sep.className = 'fe-dd-separator';
      sep.style.margin = '4px 0';
      menu.appendChild(sep);
    };

    const appId = _normStr(sc?.kind === SHORTCUT_KIND_FRAMEWORK_APP ? sc?.app_id : '');
    if (appId) {
      addSeparator();
      const kill = document.createElement('div');
      kill.className = 'fe-dd-item';
      kill.textContent = 'Kill app';
      kill.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        await _quitFrameworkApp(appId);
      });
      menu.appendChild(kill);
    }

    addSeparator();
    const remove = document.createElement('div');
    remove.className = 'fe-dd-item';
    remove.textContent = 'Remove from header';
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _closeHeaderIconMenu();
      _setShortcutHeaderFlag(sc, false);
    });
    menu.appendChild(remove);

    const parent = menu.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const baseLeft = Math.max(0, Math.round(anchorRect.left - parentRect.left));
    const baseTop = Math.max(0, Math.round(anchorRect.bottom - parentRect.top + 4));
    menu.style.left = `${baseLeft}px`;
    menu.style.top = `${baseTop}px`;
    menu.dataset.shortcutKey = _normStr(sc?.key);
    _headerIconMenuKey = _normStr(sc?.key);
    menu.classList.add('show');

    requestAnimationFrame(() => {
      if (!menu.classList.contains('show')) return;
      const menuRect = menu.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      let left = baseLeft;
      if (menuRect.right > bounds.right) {
        left -= Math.ceil(menuRect.right - bounds.right) + 6;
      }
      if (left < 0) left = 0;
      menu.style.left = `${left}px`;
    });
  }

  function _renderHeaderIconGrid(uiPrefs, shortcuts, active) {
    const gridEl = sidebarHeaderIconGridEl;
    if (!gridEl) return;

    const resolvedShortcuts = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const activeKey = resolvedActive?.key || '';
    const headerItems = _collectHeaderItems(resolvedShortcuts);
    const runningSet = _runningCache instanceof Set ? _runningCache : new Set();
    const isMobileLayout = !!document.querySelector('.fe-root.layout-mobile');

    gridEl.innerHTML = '';
    if (!headerItems.length && !isMobileLayout) {
      gridEl.style.display = 'none';
      _closeHeaderIconMenu();
      return;
    }
    gridEl.style.display = 'flex';

    let headerDragState = null;
    let dropBeforeCell = null;
    let dropAfterCell = null;
    let dropInsertionIndex = -1;
    const renderedHeaderItems = [];

    const clearDropMarkers = () => {
      if (dropBeforeCell) {
        dropBeforeCell.style.boxShadow = '';
        dropBeforeCell = null;
      }
      if (dropAfterCell) {
        dropAfterCell.style.borderInlineEnd = '';
        dropAfterCell = null;
      }
    };

    const getCells = () => Array.from(gridEl.querySelectorAll('.agent-drawer__icon-cell'));

    const computeInsertion = (clientX, sourceCell) => {
      const cells = getCells().filter((cell) => cell !== sourceCell);
      let insertion = cells.length;
      for (let i = 0; i < cells.length; i += 1) {
        const rect = cells[i].getBoundingClientRect();
        const mid = rect.left + (rect.width / 2);
        if (clientX <= mid) {
          insertion = i;
          break;
        }
      }
      return { cells, insertion };
    };

    const updateDragTarget = (clientX) => {
      if (!headerDragState || !headerDragState.dragging || !headerDragState.cell) return;
      clearDropMarkers();
      const { cells, insertion } = computeInsertion(clientX, headerDragState.cell);
      dropInsertionIndex = insertion;
      if (insertion < cells.length) {
        const cell = cells[insertion];
        cell.style.boxShadow = 'inset 2px 0 0 rgba(120,170,255,0.95)';
        dropBeforeCell = cell;
      } else if (cells.length) {
        const cell = cells[cells.length - 1];
        cell.style.borderInlineEnd = '2px solid rgba(120,170,255,0.95)';
        dropAfterCell = cell;
      }
    };

    const beginDrag = (state) => {
      if (!state || !state.cell || !state.btn) return;
      state.dragging = true;
      state.cell.classList.add('is-dragging');
      state.cell.style.opacity = '0.72';
      state.cell.style.transform = 'scale(0.985)';
      state.btn.style.cursor = 'grabbing';
      dropInsertionIndex = state.fromIndex;
    };

    const finishDrag = (commit) => {
      if (!headerDragState) return;
      const state = headerDragState;
      clearDropMarkers();
      state.cell.classList.remove('is-dragging');
      state.cell.style.opacity = '';
      state.cell.style.transform = '';
      state.btn.style.cursor = 'grab';
      if (commit && state.dragging) {
        const moving = renderedHeaderItems[state.fromIndex];
        if (moving) {
          const withoutSource = renderedHeaderItems.filter((_, idx) => idx !== state.fromIndex);
          const insertion = Number.isInteger(dropInsertionIndex) ? dropInsertionIndex : state.fromIndex;
          const bounded = Math.max(0, Math.min(withoutSource.length, insertion));
          const next = withoutSource.slice();
          next.splice(bounded, 0, moving);
          const nextKeys = next.map((item) => _normStr(item?.key)).filter((key) => !!key);
          _persistHeaderOrder(nextKeys);
        }
      }
      headerDragState = null;
      dropInsertionIndex = -1;
    };

    if (isMobileLayout) {
      const cell = document.createElement('div');
      cell.className = 'agent-drawer__icon-cell agent-drawer__icon-cell--explorer';

      const btn = document.createElement('button');
      btn.className = 'agent-drawer__icon-btn';
      btn.title = 'Open Explorer';
      btn.setAttribute('aria-label', 'Open Explorer');
      btn.textContent = '☰';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
        const explorerBtn = document.getElementById('fe-drawer-open');
        if (explorerBtn && typeof explorerBtn.click === 'function') {
          explorerBtn.click();
          return;
        }
        const root = document.querySelector('.fe-root');
        if (root) root.classList.add('drawer-open');
      });

      const dot = document.createElement('span');
      dot.className = 'agent-drawer__running-dot is-placeholder';
      dot.setAttribute('aria-hidden', 'true');

      cell.appendChild(btn);
      cell.appendChild(dot);
      gridEl.appendChild(cell);
    }

    headerItems.forEach((sc) => {
      const effectiveIcon = _effectiveShortcutIcon(sc);
      const fallbackText = _firstGrapheme(sc.label);
      const iconNode = _renderIconNode(effectiveIcon, null, fallbackText);
      if (!iconNode || (!iconNode.textContent && !iconNode.childNodes.length)) return;

      const cell = document.createElement('div');
      cell.className = 'agent-drawer__icon-cell';

      const btn = document.createElement('button');
      btn.className = 'agent-drawer__icon-btn';
      if (sc.key && sc.key === activeKey) btn.classList.add('is-active');
      btn.title = sc.label || sc.url || 'Shortcut';
      btn.style.touchAction = 'none';
      btn.style.cursor = 'grab';
      btn.appendChild(iconNode);

      const renderedIndex = renderedHeaderItems.length;
      renderedHeaderItems.push(sc);
      cell.dataset.headerIndex = String(renderedIndex);

      let longPressTimer = null;
      let suppressUntil = 0;
      let pointerId = null;
      let startX = 0;
      let startY = 0;

      const clearLp = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      const clearPointer = () => {
        pointerId = null;
        startX = 0;
        startY = 0;
      };

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (Date.now() < suppressUntil) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          suppressUntil = 0;
          return;
        }
        _closeHeaderIconMenu();
        const targetId = sc.id || sc.url || sc.key;
        if (!targetId) return;
        _sendUiPrefUpdate(UI_PREF_KEY_ACTIVE, targetId);
        if (openDrawer) {
          setTimeout(() => { try { openDrawer(); } catch (_) {} }, 120);
        }
      });

      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openHeaderIconMenu(btn, sc);
      });

      btn.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        if (ev.pointerType !== 'mouse' && typeof ev.button === 'number' && ev.button !== 0) return;
        const fromIndex = Number(cell.dataset.headerIndex);
        if (!Number.isInteger(fromIndex) || fromIndex < 0) return;
        if (headerDragState) finishDrag(false);
        pointerId = ev.pointerId;
        startX = ev.clientX;
        startY = ev.clientY;
        headerDragState = {
          cell,
          btn,
          fromIndex,
          dragging: false,
        };
        if (ev.pointerType === 'touch') {
          clearLp();
          longPressTimer = setTimeout(() => {
            if (!headerDragState || headerDragState.btn !== btn || headerDragState.dragging) return;
            suppressUntil = Date.now() + 900;
            finishDrag(false);
            _openHeaderIconMenu(btn, sc);
          }, 520);
        }
        try { btn.setPointerCapture(ev.pointerId); } catch (_) {}
      });

      btn.addEventListener('pointermove', (ev) => {
        if (ev.pointerId !== pointerId) return;
        if (!headerDragState || headerDragState.btn !== btn) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!headerDragState.dragging) {
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          clearLp();
          beginDrag(headerDragState);
        }
        ev.preventDefault();
        ev.stopPropagation();
        updateDragTarget(ev.clientX);
      }, { passive: false });

      const endPointer = (ev, commit) => {
        if (ev.pointerId !== pointerId) return;
        clearLp();
        if (headerDragState && headerDragState.btn === btn) {
          if (headerDragState.dragging) {
            ev.preventDefault();
            ev.stopPropagation();
            suppressUntil = Date.now() + 900;
            finishDrag(commit);
          } else {
            finishDrag(false);
          }
        }
        clearPointer();
      };

      btn.addEventListener('pointerup', (ev) => endPointer(ev, true));
      btn.addEventListener('pointercancel', (ev) => endPointer(ev, false));
      btn.addEventListener('lostpointercapture', (ev) => {
        if (ev.pointerId !== pointerId) return;
        clearLp();
        if (headerDragState && headerDragState.btn === btn) finishDrag(false);
        clearPointer();
      });

      const dot = document.createElement('span');
      dot.className = 'agent-drawer__running-dot';
      if (sc.key && sc.key === activeKey) dot.classList.add('is-active');
      const appId = _normStr(sc.kind === SHORTCUT_KIND_FRAMEWORK_APP ? sc.app_id : '');
      if (appId) {
        const isRunning = runningSet.has(appId);
        dot.classList.add(isRunning ? 'is-up' : 'is-down');
        dot.title = `${sc.label || appId}: ${isRunning ? 'Running' : 'Not running'}`;
      } else {
        dot.classList.add('is-placeholder');
        dot.setAttribute('aria-hidden', 'true');
      }

      cell.appendChild(btn);
      cell.appendChild(dot);
      gridEl.appendChild(cell);
    });

    if (!renderedHeaderItems.length) {
      gridEl.style.display = 'none';
      _closeHeaderIconMenu();
      return;
    }

    const openKey = _normStr(_headerIconMenuKey || sidebarHeaderIconMenuEl?.dataset?.shortcutKey);
    if (openKey && !renderedHeaderItems.some((sc) => _normStr(sc?.key) === openKey)) {
      _closeHeaderIconMenu();
    }
  }

  function _setSetupPlaceholderMode(mode, shortcut) {
    if (!sidebarSetupPlaceholder) return;
    const titleEl = sidebarSetupTitleEl
      || sidebarSetupPlaceholder.querySelector('.sidebar-setup__title');
    const hintEl = sidebarSetupHintEl
      || sidebarSetupPlaceholder.querySelector('.sidebar-setup__hint');
    if (!titleEl || !hintEl) return;

    if (mode === 'loading') {
      const label = _normStr(shortcut?.label) || _normStr(shortcut?.app_id) || 'app';
      titleEl.textContent = 'Starting side-bar app…';
      hintEl.textContent = `Starting ${label}.`;
      sidebarSetupPlaceholder.dataset.mode = 'loading';
      return;
    }

    titleEl.textContent = SIDEBAR_SETUP_TITLE_DEFAULT;
    hintEl.textContent = SIDEBAR_SETUP_HINT_DEFAULT;
    sidebarSetupPlaceholder.dataset.mode = 'setup';
  }

  function _updateSetupPlaceholder(uiPrefs, hasActiveOverride, mode = 'setup', shortcut = null) {
    if (!sidebarSetupPlaceholder || !sidebarIframeStack) return;
    const hasActive = typeof hasActiveOverride === 'boolean'
      ? hasActiveOverride
      : !!(_resolveActive(uiPrefs)?.url);

    if (hasActive) _setSetupPlaceholderMode('setup', null);
    else _setSetupPlaceholderMode(mode, shortcut);

    if (hasActive) {
      sidebarSetupPlaceholder.style.display = 'none';
    } else {
      sidebarSetupPlaceholder.style.display = 'flex';
    }
    sidebarIframeStack.style.opacity = hasActive ? '1' : '0';
    sidebarIframeStack.style.pointerEvents = hasActive ? 'auto' : 'none';
    sidebarIframeStack.setAttribute('aria-hidden', hasActive ? 'false' : 'true');
  }

  async function _ensureFrameworkAppRunning(appId) {
    const id = _normStr(appId);
    if (!id) return false;
    const existing = _startingApps.get(id);
    if (existing) {
      try {
        return await existing;
      } catch (_) {
        return false;
      }
    }
    const startPromise = (async () => {
      try {
        const { resp, body } = await _fetchJson(`/api/apps/${encodeURIComponent(id)}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!resp.ok || !body?.ok) {
          const detail = body?.detail || body?.error || `Failed to start app ${id}`;
          throw new Error(detail);
        }
        // refresh running cache opportunistically
        try {
          const set = await _ensureRunningCache(true);
          set.add(id);
          _renderHeaderIconGrid(_latestUiPrefs || {});
        } catch (_) {}
        return true;
      } catch (e) {
        toast(e?.message || `Failed to start app ${id}`);
        return false;
      } finally {
        _startingApps.delete(id);
      }
    })();
    _startingApps.set(id, startPromise);
    return await startPromise;
  }

  function _configureShortcutIframeElement(iframe, sc) {
    if (!iframe || !sc) return;
    iframe.className = 'sidebar-iframe';
    iframe.setAttribute('data-shortcut-id', sc.key);
    iframe.setAttribute('data-shortcut-load', sc.load);
    iframe.setAttribute('loading', sc.load === SHORTCUT_LOAD_EAGER ? 'eager' : 'lazy');
  }

  function _replaceShortcutIframe(sc, entry) {
    if (!sidebarIframeStack || !sc || !entry || !entry.iframe) return entry;
    const nextIframe = document.createElement('iframe');
    _configureShortcutIframeElement(nextIframe, sc);
    if (entry.iframe.classList.contains('is-active')) {
      nextIframe.classList.add('is-active');
    }
    try {
      entry.iframe.replaceWith(nextIframe);
    } catch (_) {
      return entry;
    }
    const nextEntry = { iframe: nextIframe, url: _normStr(sc.url), loaded: false };
    _iframeMap.set(sc.key, nextEntry);
    return nextEntry;
  }

  async function _ensureIframeLoadedForShortcut(sc, entry, options = {}) {
    if (!sc || !entry || !entry.iframe) return false;
    const url = _normStr(sc.url);
    if (!url) return false;
    const forceReload = !!options.forceReload;

    if (sc.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      const forceRunningCheck = !!options.forceRunningCheck;
      const onBeforeStart = typeof options.onBeforeStart === 'function' ? options.onBeforeStart : null;
      const appId = _normStr(sc.app_id);
      if (!appId) return false;

      let isRunning = false;
      if (forceRunningCheck || !entry.loaded) {
        try {
          const set = await _ensureRunningCache(true);
          isRunning = !!(set instanceof Set && set.has(appId));
        } catch (_) {
          isRunning = false;
        }
      } else {
        return true;
      }

      let startedNow = false;
      if (!isRunning) {
        try { onBeforeStart?.(); } catch (_) {}
        const ok = await _ensureFrameworkAppRunning(appId);
        if (!ok) {
          entry.loaded = false;
          try { entry.iframe.src = 'about:blank'; } catch (_) {}
          return false;
        }
        startedNow = true;
      }

      if (forceReload || !entry.loaded || startedNow) {
        entry.iframe.src = url;
        entry.loaded = true;
      }
      return true;
    }

    if (!forceReload && entry.loaded) return true;
    entry.iframe.src = url;
    entry.loaded = true;
    return true;
  }

  async function _refreshActiveShortcut(options = {}) {
    const flushCache = !!options.flushCache;
    const uiPrefs = _latestUiPrefs || {};
    const shortcuts = _collectShortcuts(uiPrefs);
    const active = _resolveActive(uiPrefs, shortcuts);
    if (!active || !active.key) {
      _updateSetupPlaceholder(uiPrefs, false, 'setup');
      return false;
    }

    let entry = _iframeMap.get(active.key);
    if (!entry) {
      await _syncIframesAndActivate(uiPrefs, shortcuts, active);
      entry = _iframeMap.get(active.key);
    }
    if (!entry || !entry.iframe) return false;

    if (flushCache) {
      entry = _replaceShortcutIframe(active, entry);
    }

    if (active.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      _updateSetupPlaceholder(uiPrefs, false, 'loading', active);
    }
    const ok = await _ensureIframeLoadedForShortcut(active, entry, {
      forceReload: true,
      forceRunningCheck: active.kind === SHORTCUT_KIND_FRAMEWORK_APP,
      onBeforeStart: () => _updateSetupPlaceholder(uiPrefs, false, 'loading', active),
    });
    _updateSetupPlaceholder(uiPrefs, !!ok, ok ? 'ready' : 'setup', active);
    return !!ok;
  }

  async function _syncIframesAndActivate(uiPrefs, shortcuts, active) {
    const seq = ++_activateSeq;
    const stack = sidebarIframeStack;
    if (!stack) return;

    const resolvedShortcuts = Array.isArray(shortcuts) ? shortcuts : _collectShortcuts(uiPrefs);
    const desiredKeys = new Set(resolvedShortcuts.map((sc) => sc.key));

    _iframeMap.forEach((entry, key) => {
      if (!desiredKeys.has(key)) {
        try { entry.iframe.remove(); } catch (_) {}
        _iframeMap.delete(key);
      }
    });

    // Ensure app metadata is available for default icons (best-effort).
    void _ensureAppsCache(false);

    // Create iframes for shortcuts.
    resolvedShortcuts.forEach((sc) => {
      let entry = _iframeMap.get(sc.key);
      if (!entry) {
        const iframe = document.createElement('iframe');
        _configureShortcutIframeElement(iframe, sc);
        stack.appendChild(iframe);
        entry = { iframe, url: sc.url, loaded: false };
        _iframeMap.set(sc.key, entry);
      }
      const prevUrl = entry.url;
      entry.url = sc.url;
      _configureShortcutIframeElement(entry.iframe, sc);

      if (entry.loaded && prevUrl && prevUrl !== sc.url) {
        entry.iframe.src = sc.url;
      }
    });

    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const activeKey = resolvedActive ? resolvedActive.key : '';

    // Eager load (best-effort). For framework apps this will start apps too.
    const eager = resolvedShortcuts.filter((sc) => sc && sc.load === SHORTCUT_LOAD_EAGER);
    for (const sc of eager) {
      const entry = _iframeMap.get(sc.key);
      if (!entry) continue;
      void _ensureIframeLoadedForShortcut(sc, entry);
    }

    // Mark active + lazy-load active.
    let hasActive = false;
    _iframeMap.forEach((entry, key) => {
      const isActive = !!(activeKey && key === activeKey);
      entry.iframe.classList.toggle('is-active', isActive);
      if (isActive) hasActive = true;
    });

    let activeReady = false;
    if (hasActive && resolvedActive) {
      const entry = _iframeMap.get(resolvedActive.key);
      if (entry) {
        if (resolvedActive.kind === SHORTCUT_KIND_FRAMEWORK_APP && !entry.loaded) {
          _updateSetupPlaceholder(
            uiPrefs || _latestUiPrefs || {},
            false,
            'loading',
            resolvedActive,
          );
        }
        const ok = await _ensureIframeLoadedForShortcut(resolvedActive, entry, {
          forceRunningCheck: resolvedActive.kind === SHORTCUT_KIND_FRAMEWORK_APP,
          onBeforeStart: () => _updateSetupPlaceholder(
            uiPrefs || _latestUiPrefs || {},
            false,
            'loading',
            resolvedActive,
          ),
        });
        if (seq !== _activateSeq) return;
        activeReady = !!ok && !!entry.loaded;
      }
    }

    _updateSetupPlaceholder(uiPrefs || _latestUiPrefs || {}, activeReady);
  }

  // --- Shortcut editor UI ---

  function _setLoadValue(value) {
    const normalized = _normalizeLoad(value);
    if (shortcutLoadBtn) shortcutLoadBtn.dataset.value = normalized;
    if (shortcutLoadLabel) shortcutLoadLabel.textContent = normalized === SHORTCUT_LOAD_EAGER ? 'Eager' : 'Lazy';
  }

  function _getLoadValue() {
    const raw = shortcutLoadBtn?.dataset?.value;
    return _normalizeLoad(raw);
  }

  function _closeLoadMenu() {
    if (!shortcutLoadDD) return;
    shortcutLoadDD.classList.remove('show');
    if (shortcutLoadBtn) shortcutLoadBtn.setAttribute('aria-expanded', 'false');
  }

  function _renderLoadMenu() {
    if (!shortcutLoadDD) return;
    shortcutLoadDD.innerHTML = '';
    const current = _getLoadValue();
    const opts = [
      { value: SHORTCUT_LOAD_LAZY, label: 'Lazy' },
      { value: SHORTCUT_LOAD_EAGER, label: 'Eager' },
    ];
    opts.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = opt.label;
      item.dataset.checkable = 'true';
      setMenuChecked(item, opt.value === current);
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _setLoadValue(opt.value);
        _closeLoadMenu();
      });
      shortcutLoadDD.appendChild(item);
    });
  }

  function _openLoadMenu() {
    if (!shortcutLoadDD) return;
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    _renderLoadMenu();
    shortcutLoadDD.classList.add('show');
    if (shortcutLoadBtn) shortcutLoadBtn.setAttribute('aria-expanded', 'true');
  }

  function _setKind(kind) {
    _editingKind = _normalizeEditorKind(kind);
    if (shortcutKindBtn) shortcutKindBtn.dataset.value = _editingKind;
    if (shortcutKindLabel) {
      shortcutKindLabel.textContent = _editingKind === SHORTCUT_KIND_FRAMEWORK_APP ? 'App' : 'URL';
    }
    if (shortcutUrlWrap) shortcutUrlWrap.style.display = _editingKind === SHORTCUT_KIND_URL ? '' : 'none';
    if (shortcutAppWrap) shortcutAppWrap.style.display = _editingKind === SHORTCUT_KIND_FRAMEWORK_APP ? '' : 'none';
    _renderIconPreview();
  }

  function _getKind() {
    const raw = shortcutKindBtn?.dataset?.value;
    return _normalizeEditorKind(raw);
  }

  function _closeKindMenu() {
    if (!shortcutKindDD) return;
    shortcutKindDD.classList.remove('show');
    if (shortcutKindBtn) shortcutKindBtn.setAttribute('aria-expanded', 'false');
  }

  function _renderKindMenu() {
    if (!shortcutKindDD) return;
    shortcutKindDD.innerHTML = '';
    const current = _getKind();
    const opts = [
      { value: SHORTCUT_KIND_URL, label: 'URL' },
      { value: SHORTCUT_KIND_FRAMEWORK_APP, label: 'App' },
    ];
    opts.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = opt.label;
      item.dataset.checkable = 'true';
      setMenuChecked(item, opt.value === current);
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _setKind(opt.value);
        _closeKindMenu();
      });
      shortcutKindDD.appendChild(item);
    });
  }

  function _openKindMenu() {
    if (!shortcutKindDD) return;
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    _renderKindMenu();
    shortcutKindDD.classList.add('show');
    if (shortcutKindBtn) shortcutKindBtn.setAttribute('aria-expanded', 'true');
  }

  function _closeAppMenu() {
    if (!shortcutAppDD) return;
    shortcutAppDD.classList.remove('show');
    if (shortcutAppBtn) shortcutAppBtn.setAttribute('aria-expanded', 'false');
  }

  function _applyEditingApp(appId, appsList) {
    const id = _normStr(appId);
    _editingAppId = id;
    if (shortcutAppBtn) shortcutAppBtn.dataset.value = id;
    const found = Array.isArray(appsList) ? appsList.find((a) => a && a.id === id) : null;
    if (shortcutAppLabel) shortcutAppLabel.textContent = found ? (found.name || found.id) : (id || 'Select app…');

    // If label is blank, adopt the app name.
    const currentLabel = _normStr(shortcutLabelInput?.value);
    if (!currentLabel && found && shortcutLabelInput) {
      shortcutLabelInput.value = found.name || found.id || '';
    }

    // URL is computed for framework apps (kept in prefs for stability).
    if (shortcutUrlInput && _editingKind === SHORTCUT_KIND_FRAMEWORK_APP) {
      shortcutUrlInput.value = _buildFrameworkAppUrl(id);
    }

    _renderIconPreview();
  }

  async function _renderAppMenu() {
    if (!shortcutAppDD) {
      _warnAppDiscovery('app-menu:render:aborted-no-dropdown');
      return;
    }
    _logAppDiscovery('app-menu:render:start');
    shortcutAppDD.innerHTML = '';

    let apps = [];
    const current = _normStr(shortcutAppBtn?.dataset?.value);
    try {
      apps = await _ensureAppsCache(true);
    } catch (e) {
      _warnAppDiscovery('app-menu:render:prefetch-error', { message: e?.message || String(e) });
    }
    const running = new Set(
      (Array.isArray(apps) ? apps : [])
        .filter((a) => !!a?.running)
        .map((a) => _normStr(a?.id))
        .filter(Boolean)
    );
    _logAppDiscovery('app-menu:render:data', {
      appsCount: Array.isArray(apps) ? apps.length : 0,
      runningCount: running instanceof Set ? running.size : 0,
      current,
    });

    if (!apps.length) {
      _warnAppDiscovery('app-menu:render:no-apps');
      const empty = document.createElement('div');
      empty.className = 'fe-dd-item';
      empty.style.opacity = '0.7';
      empty.textContent = 'No apps found';
      shortcutAppDD.appendChild(empty);
      return;
    }

    const orderedApps = apps.slice().sort((a, b) => {
      const an = _normStr(a?.name) || _normStr(a?.id);
      const bn = _normStr(b?.name) || _normStr(b?.id);
      return an.localeCompare(bn, undefined, { sensitivity: 'base', numeric: true });
    });
    _logAppDiscovery('app-menu:render:order', {
      ids: orderedApps.map((a) => _normStr(a?.id)).filter(Boolean),
    });

    let rendered = 0;
    orderedApps.forEach((app, idx) => {
      try {
        const id = _normStr(app?.id);
        if (!id) {
          _warnAppDiscovery('app-menu:render:skip-missing-id', { index: idx, app });
          return;
        }
        const name = _normStr(app?.name) || id;
        _logAppDiscovery('app-menu:render:item:start', { index: idx, id, name });

        const item = document.createElement('div');
        item.className = 'fe-dd-item';
        item.style.display = 'flex';
        item.style.gap = '8px';
        item.style.alignItems = 'center';
        item.dataset.checkable = 'true';
        setMenuChecked(item, id === current);

        try {
          const icon = _manifestIconForApp(id);
          _logAppDiscovery('app-menu:render:item:icon', { id, iconKind: _normStr(icon?.kind) || '' });
          const iconNode = _renderIconNode(icon, 16);
          if (iconNode) item.appendChild(iconNode);
        } catch (iconErr) {
          _warnAppDiscovery('app-menu:render:item:icon-error', { id, message: iconErr?.message || String(iconErr) });
        }

        const text = document.createElement('span');
        text.textContent = name;
        item.appendChild(text);

        if (running && running.has(id)) {
          _logAppDiscovery('app-menu:render:item:running', { id });
          const badge = document.createElement('span');
          badge.textContent = 'running';
          badge.style.fontSize = '0.72rem';
          badge.style.opacity = '0.65';
          badge.style.marginLeft = 'auto';
          item.appendChild(badge);
        }

        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          _logAppDiscovery('app-menu:select', { id });
          _applyEditingApp(id, orderedApps);
          _closeAppMenu();
        });

        shortcutAppDD.appendChild(item);
        rendered += 1;
        _logAppDiscovery('app-menu:render:item:done', { index: idx, id });
      } catch (e) {
        _warnAppDiscovery('app-menu:render:item:error', {
          index: idx,
          appId: _normStr(app?.id),
          message: e?.message || String(e),
        });
      }
    });
    _logAppDiscovery('app-menu:render:done', {
      rendered,
      dropdownChildCount: shortcutAppDD.childElementCount,
      clientHeight: shortcutAppDD.clientHeight,
      scrollHeight: shortcutAppDD.scrollHeight,
      canScroll: shortcutAppDD.scrollHeight > shortcutAppDD.clientHeight,
    });
  }

  function _openAppMenu() {
    if (!shortcutAppDD) {
      _warnAppDiscovery('app-menu:open:aborted-no-dropdown');
      return;
    }
    _logAppDiscovery('app-menu:open:start');
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    void _renderAppMenu();
    shortcutAppDD.classList.add('show');
    if (shortcutAppBtn) shortcutAppBtn.setAttribute('aria-expanded', 'true');
    _logAppDiscovery('app-menu:open:shown');
  }

  function _renderIconPreview() {
    if (!shortcutIconPreview) return;
    shortcutIconPreview.textContent = '';

    if (_editingAssetName) {
      const img = document.createElement('img');
      img.src = _agentIconUrlFromName(_editingAssetName);
      img.alt = '';
      img.style.width = '18px';
      img.style.height = '18px';
      img.style.objectFit = 'contain';
      shortcutIconPreview.appendChild(img);
      return;
    }

    const em = _normStr(shortcutEmojiInput?.value);
    if (em) {
      shortcutIconPreview.textContent = em;
      return;
    }

    if (_editingKind === SHORTCUT_KIND_FRAMEWORK_APP) {
      const icon = _manifestIconForApp(_editingAppId);
      if (icon) {
        const node = _renderIconNode(icon, 18);
        if (node) shortcutIconPreview.appendChild(node);
        return;
      }
    }
  }

  function _hideEditor() {
    if (!shortcutsEditorEl) return;
    shortcutsEditorEl.style.display = 'none';
    _editingId = null;
    _editingAssetName = null;
    _editingAppId = '';
    _setKind(SHORTCUT_KIND_URL);
    if (shortcutLabelInput) shortcutLabelInput.value = '';
    if (shortcutUrlInput) shortcutUrlInput.value = '';
    if (shortcutHeaderCheck) shortcutHeaderCheck.checked = false;
    _setLoadValue(SHORTCUT_LOAD_LAZY);
    if (shortcutEmojiInput) shortcutEmojiInput.value = '';
    if (shortcutIconPreview) shortcutIconPreview.textContent = '';
    _closeLoadMenu();
    _closeKindMenu();
    _closeAppMenu();
  }

  function _showEditor(entry) {
    if (!shortcutsEditorEl) return;
    shortcutsEditorEl.style.display = '';
    const e = entry && typeof entry === 'object' ? entry : {};
    _editingId = _normStr(e.id) || null;
    if (shortcutLabelInput) shortcutLabelInput.value = _normStr(e.label);
    if (shortcutUrlInput) shortcutUrlInput.value = _normStr(e.url);
    if (shortcutHeaderCheck) shortcutHeaderCheck.checked = !!e.header;
    _setLoadValue(e.load);

    _editingAssetName = null;
    _editingAppId = _normStr(e.app_id);
    _setKind(e.kind);

    if (shortcutAppBtn) shortcutAppBtn.dataset.value = _editingAppId;
    if (shortcutAppLabel) shortcutAppLabel.textContent = _editingAppId ? _editingAppId : 'Select app…';
    if (shortcutEmojiInput) shortcutEmojiInput.value = '';

    const icon = e.icon && typeof e.icon === 'object' ? e.icon : null;
    if (icon && icon.kind === 'emoji' && shortcutEmojiInput) {
      shortcutEmojiInput.value = _normStr(icon.emoji);
    } else if (icon && icon.kind === 'asset') {
      _editingAssetName = _normStr(icon.name) || null;
    }

    if (_editingKind === SHORTCUT_KIND_FRAMEWORK_APP && _editingAppId) {
      void _ensureAppsCache(true).then((apps) => _applyEditingApp(_editingAppId, apps));
    }

    _renderIconPreview();
  }

  function _persistShortcuts(nextList) {
    _sendUiPrefUpdate(UI_PREF_KEY_SHORTCUTS, nextList);

    const activeId = _normStr(_latestUiPrefs?.[UI_PREF_KEY_ACTIVE]);
    const hasActive = !!(
      activeId
      && Array.isArray(nextList)
      && nextList.some((sc) => sc && (sc.id === activeId || sc.url === activeId))
    );
    if (!hasActive) {
      const fallback = Array.isArray(nextList) && nextList.length ? (_normStr(nextList[0].id) || _normStr(nextList[0].url)) : '';
      _sendUiPrefUpdate(UI_PREF_KEY_ACTIVE, fallback);
    }
  }

  function _renderShortcutsList() {
    if (!shortcutsListEl) return;
    shortcutsListEl.innerHTML = '';
    const shortcuts = Array.isArray(_shortcutsCache) ? _shortcutsCache.slice() : [];
    if (!shortcuts.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '0.7';
      empty.textContent = 'No shortcuts yet.';
      shortcutsListEl.appendChild(empty);
      return;
    }

    let dragState = null;
    let dropBeforeRow = null;
    let dropAfterRow = null;
    let dropInsertionIndex = -1;

    const clearDropMarkers = () => {
      if (dropBeforeRow) {
        dropBeforeRow.style.boxShadow = '';
        dropBeforeRow = null;
      }
      if (dropAfterRow) {
        dropAfterRow.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
        dropAfterRow = null;
      }
    };

    const getRows = () => Array.from(shortcutsListEl.querySelectorAll('[data-shortcut-row="1"]'));

    const computeInsertion = (clientY, sourceRow) => {
      const rows = getRows().filter((row) => row !== sourceRow);
      let insertion = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        const mid = rect.top + (rect.height / 2);
        if (clientY <= mid) {
          insertion = i;
          break;
        }
      }
      return { rows, insertion };
    };

    const updateDragTarget = (clientY) => {
      if (!dragState || !dragState.dragging || !dragState.row) return;
      clearDropMarkers();
      const { rows, insertion } = computeInsertion(clientY, dragState.row);
      dropInsertionIndex = insertion;
      if (insertion < rows.length) {
        const row = rows[insertion];
        row.style.boxShadow = 'inset 0 2px 0 rgba(120,170,255,0.95)';
        dropBeforeRow = row;
      } else if (rows.length) {
        const row = rows[rows.length - 1];
        row.style.borderBottom = '2px solid rgba(120,170,255,0.95)';
        dropAfterRow = row;
      }
    };

    const finishDrag = (commit) => {
      if (!dragState) return;
      const state = dragState;
      clearDropMarkers();
      try {
        if (state.mouseMoveHandler) document.removeEventListener('mousemove', state.mouseMoveHandler);
        if (state.mouseUpHandler) document.removeEventListener('mouseup', state.mouseUpHandler);
        if (state.touchMoveHandler) document.removeEventListener('touchmove', state.touchMoveHandler);
        if (state.touchEndHandler) document.removeEventListener('touchend', state.touchEndHandler);
        if (state.touchCancelHandler) document.removeEventListener('touchcancel', state.touchCancelHandler);
      } catch (_) {}
      state.row.style.opacity = '';
      state.row.style.transform = '';
      state.row.classList.remove('is-dragging');
      state.handle.style.cursor = 'grab';
      if (commit && state.dragging) {
        const withoutSource = shortcuts.filter((_, idx) => idx !== state.fromIndex);
        const insertion = Number.isInteger(dropInsertionIndex) ? dropInsertionIndex : state.fromIndex;
        const bounded = Math.max(0, Math.min(withoutSource.length, insertion));
        const next = withoutSource.slice();
        next.splice(bounded, 0, shortcuts[state.fromIndex]);
        _persistShortcuts(next);
      }
      dragState = null;
      dropInsertionIndex = -1;
    };

    const beginDrag = (state) => {
      if (!state || !state.row || !state.handle) return;
      state.dragging = true;
      state.row.style.opacity = '0.72';
      state.row.style.transform = 'scale(0.995)';
      state.row.classList.add('is-dragging');
      state.handle.style.cursor = 'grabbing';
      dropInsertionIndex = state.fromIndex;
    };

    const bindDragHandle = (row, handle, idx) => {
      handle.style.touchAction = 'none';
      handle.style.cursor = 'grab';

      handle.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (dragState) finishDrag(false);
        dragState = {
          row,
          handle,
          fromIndex: idx,
          dragging: false,
          mouseMoveHandler: null,
          mouseUpHandler: null,
          touchMoveHandler: null,
          touchEndHandler: null,
          touchCancelHandler: null,
        };
        beginDrag(dragState);
        updateDragTarget(ev.clientY);
        dragState.mouseMoveHandler = (moveEv) => {
          if (!dragState || dragState.handle !== handle) return;
          moveEv.preventDefault();
          updateDragTarget(moveEv.clientY);
        };
        dragState.mouseUpHandler = (upEv) => {
          if (!dragState || dragState.handle !== handle) return;
          upEv.preventDefault();
          finishDrag(true);
        };
        document.addEventListener('mousemove', dragState.mouseMoveHandler);
        document.addEventListener('mouseup', dragState.mouseUpHandler);
      });

      handle.addEventListener('touchstart', (ev) => {
        const touch = ev.changedTouches && ev.changedTouches[0];
        if (!touch) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (dragState) finishDrag(false);
        dragState = {
          row,
          handle,
          fromIndex: idx,
          dragging: false,
          touchId: touch.identifier,
          mouseMoveHandler: null,
          mouseUpHandler: null,
          touchMoveHandler: null,
          touchEndHandler: null,
          touchCancelHandler: null,
        };
        beginDrag(dragState);
        updateDragTarget(touch.clientY);

        const getTrackedTouch = (touches) => {
          if (!touches) return null;
          for (let i = 0; i < touches.length; i += 1) {
            if (touches[i].identifier === dragState?.touchId) return touches[i];
          }
          return null;
        };

        dragState.touchMoveHandler = (moveEv) => {
          if (!dragState || dragState.handle !== handle) return;
          const t = getTrackedTouch(moveEv.touches) || getTrackedTouch(moveEv.changedTouches);
          if (!t) return;
          moveEv.preventDefault();
          updateDragTarget(t.clientY);
        };
        dragState.touchEndHandler = (endEv) => {
          if (!dragState || dragState.handle !== handle) return;
          const t = getTrackedTouch(endEv.changedTouches);
          if (!t) return;
          endEv.preventDefault();
          finishDrag(true);
        };
        dragState.touchCancelHandler = (cancelEv) => {
          if (!dragState || dragState.handle !== handle) return;
          const t = getTrackedTouch(cancelEv.changedTouches);
          if (!t) return;
          cancelEv.preventDefault();
          finishDrag(false);
        };
        document.addEventListener('touchmove', dragState.touchMoveHandler, { passive: false });
        document.addEventListener('touchend', dragState.touchEndHandler, { passive: false });
        document.addEventListener('touchcancel', dragState.touchCancelHandler, { passive: false });
      }, { passive: false });
    };

    shortcuts.forEach((sc, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'center';
      row.style.padding = '6px 0';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
      row.dataset.shortcutRow = '1';

      const effectiveIcon = _effectiveShortcutIcon(sc);
      row.appendChild(_renderIconNode(effectiveIcon, 18));

      const meta = document.createElement('div');
      meta.style.flex = '1';
      const title = document.createElement('div');
      title.textContent = sc.label || '(no label)';
      const url = document.createElement('div');
      url.style.fontSize = '0.78rem';
      url.style.opacity = '0.7';
      url.textContent = sc.kind === SHORTCUT_KIND_FRAMEWORK_APP
        ? `App: ${_normStr(sc.app_id) || '(unset)'}`
        : (sc.url || '');
      meta.appendChild(title);
      meta.appendChild(url);
      row.appendChild(meta);

      const mkBtn = (text) => {
        const b = document.createElement('button');
        b.className = 'fe-btn';
        b.textContent = text;
        return b;
      };

      const dragHandle = mkBtn('↕');
      dragHandle.title = 'Drag to reorder';
      dragHandle.setAttribute('aria-label', 'Drag to reorder');
      bindDragHandle(row, dragHandle, idx);
      row.appendChild(dragHandle);

      const edit = mkBtn('Edit');
      edit.addEventListener('click', () => _showEditor(sc));
      row.appendChild(edit);

      const del = mkBtn('Delete');
      del.addEventListener('click', () => {
        const next = shortcuts.slice();
        next.splice(idx, 1);
        _persistShortcuts(next);
        _hideEditor();
      });
      row.appendChild(del);

      shortcutsListEl.appendChild(row);
    });
  }

  function _openShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.classList.add('show');
    shortcutsModal.setAttribute('aria-hidden', 'false');
    _renderShortcutsList();
  }

  function _closeShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.classList.remove('show');
    shortcutsModal.setAttribute('aria-hidden', 'true');
    _hideEditor();
  }

  function _closeAgentDropdown() {
    const dd = document.getElementById('fe-agent-dd');
    if (!dd) return;
    dd.classList.remove('show');
  }

  function _renderAgentDropdown() {
    const dd = document.getElementById('fe-agent-dd');
    if (!dd) return;
    dd.innerHTML = '';

    const display = _normStr(_latestUiPrefs?.[UI_PREF_KEY_TOGGLE_DISPLAY]) || 'icon';
    const shortcuts = Array.isArray(_shortcutsCache) ? _shortcutsCache : [];

    if (!shortcuts.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-dd-item';
      empty.style.opacity = '0.7';
      empty.textContent = 'No shortcuts';
      dd.appendChild(empty);
    } else {
      shortcuts.forEach((sc) => {
        const label = _normStr(sc?.label);
        const url = _normStr(sc?.url);
        const id = _normStr(sc?.id);
        const activeId = id || url;
        if (!label || !url || !activeId) return;

        const item = document.createElement('div');
        item.className = 'fe-dd-item';
        item.style.display = 'flex';
        item.style.gap = '8px';
        item.style.alignItems = 'center';

        if (display === 'icon' || display === 'both') {
          item.appendChild(_renderIconNode(_effectiveShortcutIcon(sc), 16));
        }
        if (display === 'text' || display === 'both') {
          const text = document.createElement('span');
          text.textContent = label;
          item.appendChild(text);
        } else {
          item.title = label;
        }

        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          _closeAgentDropdown();
          _sendUiPrefUpdate(UI_PREF_KEY_ACTIVE, activeId);
          if (openDrawer) setTimeout(() => { try { openDrawer(); } catch (_) {} }, 120);
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
      _openShortcutsModal();
    });
    dd.appendChild(manage);
  }

  function _openAgentDropdown() {
    const dd = document.getElementById('fe-agent-dd');
    if (!dd) return;
    try { if (closeAllMenus) closeAllMenus(); } catch (_) {}
    _closeHeaderIconMenu();
    _closeRefreshMenu();
    _renderAgentDropdown();
    dd.classList.add('show');
  }

  function _bindAgentDropdownInteractions() {
    const agentBtn = agentToggleBtn;
    if (!agentBtn) return;

    document.addEventListener('click', (ev) => {
      const dd = document.getElementById('fe-agent-dd');
      if (!dd || !dd.classList.contains('show')) return;
      if (ev.target.closest('#fe-agent-toggle')) return;
      if (ev.target.closest('#fe-agent-dd')) return;
      _closeAgentDropdown();
    }, false);

    document.addEventListener('click', (ev) => {
      if (!sidebarHeaderIconMenuEl || !sidebarHeaderIconMenuEl.classList.contains('show')) return;
      if (ev.target.closest('#agent-drawer-icon-menu')) return;
      if (ev.target.closest('.agent-drawer__icon-btn')) return;
      _closeHeaderIconMenu();
    }, false);

    document.addEventListener('click', (ev) => {
      if (!sidebarRefreshMenuEl || !sidebarRefreshMenuEl.classList.contains('show')) return;
      if (ev.target.closest('#agent-refresh-menu')) return;
      if (ev.target.closest('#agent-refresh-active')) return;
      _closeRefreshMenu();
    }, false);
  }

  function applyUiPrefs(uiPrefs) {
    const ui = uiPrefs && typeof uiPrefs === 'object' ? uiPrefs : {};
    _latestUiPrefs = { ...ui };

    _settingsUiMutating = true;
    try {
      _applyToggleDisplay(_latestUiPrefs);
      _applyHeaderDisplayMode(_latestUiPrefs);
      _shortcutsCache = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
        ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS].slice()
        : [];
    } finally {
      _settingsUiMutating = false;
    }

    const normalized = _collectShortcuts(_latestUiPrefs);
    const ensured = _ensureActiveSelection(_latestUiPrefs, normalized);
    _applyToggleIcon(_latestUiPrefs, normalized, ensured.active);
    _applyHeaderLabelAndIcon(_latestUiPrefs, normalized, ensured.active);
    _renderHeaderIconGrid(_latestUiPrefs, normalized, ensured.active);
    void _syncIframesAndActivate(_latestUiPrefs, normalized, ensured.active);

    // Keep open UI surfaces in sync.
    try {
      const dd = document.getElementById('fe-agent-dd');
      if (dd && dd.classList.contains('show')) _renderAgentDropdown();
    } catch (_) {}
    try {
      if (shortcutsModal && shortcutsModal.classList.contains('show')) _renderShortcutsList();
    } catch (_) {}

    // If we have any framework-app shortcuts, ensure the app list is loaded so
    // default (manifest) icons can replace placeholder chrome.
    try {
      const needsApps = normalized.some((sc) => sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP);
      if (needsApps) {
        const seq = ++_appsChromeSeq;
        void _ensureAppsCache(false).then(() => {
          if (seq !== _appsChromeSeq) return;
          _refreshShortcutChrome();
        });
      }
    } catch (_) {}

    const needsRunning = normalized.some((sc) => (
      sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP && _normStr(sc.app_id)
    ));
    _setFrameworkEventsEnabled(needsRunning);
    if (needsRunning) {
      void _ensureRunningCache(false).then(() => {
        _renderHeaderIconGrid(_latestUiPrefs || {});
      });
    } else {
      _renderHeaderIconGrid(_latestUiPrefs || {});
    }
  }

  async function init() {
    // Resolve core DOM.
    agentToggleBtn = document.getElementById('fe-agent-toggle');
    agentToggleIconEl = agentToggleBtn?.querySelector('.fe-agent-icon') || null;

    sidebarHeaderIconEl = document.getElementById('agent-drawer-icon');
    sidebarHeaderTitleEl = document.getElementById('agent-drawer-title-text');
    sidebarHeaderIconGridEl = document.getElementById('agent-drawer-icon-grid');
    sidebarHeaderIconMenuEl = document.getElementById('agent-drawer-icon-menu');
    sidebarRefreshBtn = document.getElementById('agent-refresh-active');
    sidebarRefreshMenuEl = document.getElementById('agent-refresh-menu');
    sidebarSetupPlaceholder = document.getElementById('sidebar-setup-placeholder');
    sidebarSetupTitleEl = sidebarSetupPlaceholder?.querySelector('.sidebar-setup__title') || null;
    sidebarSetupHintEl = sidebarSetupPlaceholder?.querySelector('.sidebar-setup__hint') || null;
    sidebarIframeStack = document.getElementById('sidebar-iframe-stack');

    shortcutsModal = document.getElementById('agent-shortcuts-modal');
    shortcutsCloseBtn = document.getElementById('agent-shortcuts-close');
    shortcutsAddBtn = document.getElementById('agent-shortcuts-add');
    shortcutsListEl = document.getElementById('agent-shortcuts-list');
    shortcutsEditorEl = document.getElementById('agent-shortcuts-editor');

    editorSettingsShortcutsBtn = document.getElementById('editor-settings-agent-shortcuts');
    setupShortcutsBtn = document.getElementById('sidebar-setup-shortcuts');

    shortcutLabelInput = document.getElementById('agent-shortcut-label');
    shortcutUrlWrap = document.getElementById('agent-shortcut-target-url');
    shortcutUrlInput = document.getElementById('agent-shortcut-url');
    shortcutKindBtn = document.getElementById('agent-shortcut-kind-btn');
    shortcutKindLabel = document.getElementById('agent-shortcut-kind-label');
    shortcutKindDD = document.getElementById('agent-shortcut-kind-dd');
    shortcutAppWrap = document.getElementById('agent-shortcut-target-app');
    shortcutAppBtn = document.getElementById('agent-shortcut-app-btn');
    shortcutAppLabel = document.getElementById('agent-shortcut-app-label');
    shortcutAppDD = document.getElementById('agent-shortcut-app-dd');

    shortcutLoadBtn = document.getElementById('agent-shortcut-load-btn');
    shortcutLoadLabel = document.getElementById('agent-shortcut-load-label');
    shortcutLoadDD = document.getElementById('agent-shortcut-load-dd');
    shortcutHeaderCheck = document.getElementById('agent-shortcut-header');

    shortcutEmojiInput = document.getElementById('agent-shortcut-emoji');
    shortcutIconBrowseBtn = document.getElementById('agent-shortcut-icon-browse');
    shortcutIconClearBtn = document.getElementById('agent-shortcut-icon-clear');
    shortcutIconPreview = document.getElementById('agent-shortcut-icon-preview');
    shortcutCancelBtn = document.getElementById('agent-shortcut-cancel');
    shortcutSaveBtn = document.getElementById('agent-shortcut-save');

    // Hide URL/app rows until kind is selected (defaults to URL).
    _setKind(SHORTCUT_KIND_URL);

    // Extension manifest icon for the toggle/header defaults.
    void _bootstrapExtensionManifest();
    // App list for framework-app shortcuts (icons + picker).
    void _ensureAppsCache(false);
    void _ensureRunningCache(false);
    _connectAppsEvents();

    // Settings radios: update prefs.
    try {
      const radios = document.querySelectorAll('input[name="agent-toggle-display"]');
      radios.forEach((r) => {
        r.addEventListener('change', () => {
          if (_settingsUiMutating) return;
          if (!r.checked) return;
          _sendUiPrefUpdate(UI_PREF_KEY_TOGGLE_DISPLAY, r.value);
        });
      });
    } catch (_) {}

    try {
      const headerRadios = document.querySelectorAll('input[name="agent-header-display"]');
      headerRadios.forEach((r) => {
        r.addEventListener('change', () => {
          if (_settingsUiMutating) return;
          if (!r.checked) return;
          _sendUiPrefUpdate(UI_PREF_KEY_HEADER_DISPLAY, r.value);
        });
      });
    } catch (_) {}

    if (editorSettingsShortcutsBtn) editorSettingsShortcutsBtn.addEventListener('click', _openShortcutsModal);
    if (setupShortcutsBtn) setupShortcutsBtn.addEventListener('click', _openShortcutsModal);
    if (shortcutsCloseBtn) shortcutsCloseBtn.addEventListener('click', _closeShortcutsModal);
    if (sidebarRefreshBtn) {
      let refreshPointerId = null;
      let refreshStartX = 0;
      let refreshStartY = 0;
      let refreshSuppressUntil = 0;
      const clearRefreshLongPress = () => {
        if (_refreshMenuLongPressTimer) {
          clearTimeout(_refreshMenuLongPressTimer);
          _refreshMenuLongPressTimer = null;
        }
      };
      sidebarRefreshBtn.addEventListener('click', (ev) => {
        if (Date.now() < refreshSuppressUntil) {
          ev.preventDefault();
          ev.stopPropagation();
          refreshSuppressUntil = 0;
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        _closeRefreshMenu();
        _emitSidebarControl('refresh_active', { flushCache: false, source: 'sidebar_refresh_button' });
      });
      sidebarRefreshBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openRefreshMenu(sidebarRefreshBtn);
      });
      sidebarRefreshBtn.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        refreshPointerId = ev.pointerId;
        refreshStartX = ev.clientX;
        refreshStartY = ev.clientY;
        if (ev.pointerType === 'touch') {
          clearRefreshLongPress();
          _refreshMenuLongPressTimer = setTimeout(() => {
            _refreshMenuLongPressTimer = null;
            if (refreshPointerId !== ev.pointerId) return;
            refreshSuppressUntil = Date.now() + 900;
            _openRefreshMenu(sidebarRefreshBtn);
          }, 520);
        }
      });
      const endRefreshPointer = (ev) => {
        if (refreshPointerId !== ev.pointerId) return;
        clearRefreshLongPress();
        refreshPointerId = null;
        refreshStartX = 0;
        refreshStartY = 0;
      };
      sidebarRefreshBtn.addEventListener('pointermove', (ev) => {
        if (refreshPointerId !== ev.pointerId) return;
        if (Math.abs(ev.clientX - refreshStartX) > 8 || Math.abs(ev.clientY - refreshStartY) > 8) {
          clearRefreshLongPress();
        }
      }, { passive: true });
      sidebarRefreshBtn.addEventListener('pointerup', endRefreshPointer);
      sidebarRefreshBtn.addEventListener('pointercancel', endRefreshPointer);
    }
    if (shortcutsModal) {
      shortcutsModal.addEventListener('click', (ev) => {
        if (ev.target === shortcutsModal) _closeShortcutsModal();
      });
    }
    if (shortcutsAddBtn) shortcutsAddBtn.addEventListener('click', () => _showEditor({}));

    if (shortcutCancelBtn) shortcutCancelBtn.addEventListener('click', _hideEditor);

    if (shortcutEmojiInput) shortcutEmojiInput.addEventListener('input', _renderIconPreview);

    if (shortcutLoadBtn) {
      shortcutLoadBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutLoadDD?.classList.contains('show');
        if (wasOpen) _closeLoadMenu();
        else _openLoadMenu();
      });
    }

    if (shortcutKindBtn) {
      shortcutKindBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutKindDD?.classList.contains('show');
        if (wasOpen) _closeKindMenu();
        else _openKindMenu();
      });
    }

    if (shortcutAppBtn) {
      shortcutAppBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutAppDD?.classList.contains('show');
        if (wasOpen) _closeAppMenu();
        else _openAppMenu();
      });
    }

    if (shortcutIconBrowseBtn) {
      shortcutIconBrowseBtn.addEventListener('click', async () => {
        if (typeof window.__explorerBusRequest !== 'function') {
          toast('Explorer connection unavailable');
          return;
        }
        if (!pickFileFn) {
          toast('File picker unavailable');
          return;
        }
        const base = _lastPickerPath || options.homeDir || '';
        const picked = await pickFileFn(base);
        if (!picked) return;
        _lastPickerPath = picked;
        try {
          const res = await window.__explorerBusRequest('prefs:vendorAgentIcon', { abs_path: picked }, 12000);
          if (res?.payload?.ok && res.payload.name) {
            _editingAssetName = res.payload.name;
            if (shortcutEmojiInput) shortcutEmojiInput.value = '';
            _renderIconPreview();
          }
        } catch (e) {
          toast(e?.message || 'Failed to vendor icon');
        }
      });
    }

    if (shortcutIconClearBtn) {
      shortcutIconClearBtn.addEventListener('click', () => {
        _editingAssetName = null;
        if (shortcutEmojiInput) shortcutEmojiInput.value = '';
        _renderIconPreview();
      });
    }

    if (shortcutSaveBtn) {
      shortcutSaveBtn.addEventListener('click', () => {
        const label = _normStr(shortcutLabelInput?.value);
        const kind = _getKind();
        const load = _getLoadValue();
        const header = !!shortcutHeaderCheck?.checked;

        let appId = '';
        let url = '';
        if (kind === SHORTCUT_KIND_FRAMEWORK_APP) {
          appId = _normStr(shortcutAppBtn?.dataset?.value) || _editingAppId;
          if (!appId) {
            toast('App is required');
            return;
          }
          url = _buildFrameworkAppUrl(appId);
          if (shortcutUrlInput) shortcutUrlInput.value = url;
        } else {
          url = _normStr(shortcutUrlInput?.value);
        }

        if (!label || !url) {
          toast(kind === SHORTCUT_KIND_FRAMEWORK_APP ? 'Label and App are required' : 'Label and URL are required');
          return;
        }

        const id = _editingId || `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        let icon = null;
        if (_editingAssetName) {
          icon = { kind: 'asset', name: _editingAssetName };
        } else {
          const em = _normStr(shortcutEmojiInput?.value);
          if (em) icon = { kind: 'emoji', emoji: em };
        }

        const next = Array.isArray(_shortcutsCache) ? _shortcutsCache.slice() : [];
        const idx = next.findIndex((x) => x && x.id === id);
        const existing = idx >= 0 ? next[idx] : null;
        const lastUsed = Number.isFinite(Number(existing?.last_used)) ? Number(existing.last_used) : 0;

        const entry = {
          id,
          kind,
          app_id: kind === SHORTCUT_KIND_FRAMEWORK_APP ? appId : '',
          label,
          url,
          icon,
          load,
          header,
          last_used: lastUsed,
        };

        if (idx >= 0) next[idx] = entry;
        else next.push(entry);
        _persistShortcuts(next);
        _hideEditor();
      });
    }

    _bindAgentDropdownInteractions();

    if (!_sidebarEventListenerBound) {
      window.addEventListener('cm6:sidebar-event', (ev) => {
        const data = ev?.detail;
        if (!data || typeof data !== 'object') return;
        if (_normStr(data.type) !== 'refresh_active') return;
        const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
        void _refreshActiveShortcut({
          flushCache: !!payload.flushCache,
        });
      });
      _sidebarEventListenerBound = true;
    }
  }

  return { init, applyUiPrefs, getActiveUrl };
}
