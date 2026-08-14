// app/apps/code_te2/main_page/frontend/sidebar-shortcuts/runtime.ts
// Sidebar app-window/plain-entry iframe stack orchestration (kept out of main.js).
//
// Owns:
// - UI prefs wiring (agent* preference names remain compatibility storage)
// - Sidebar header icon list + title/icon rendering
// - Plain URL slot dialog
// - Iframe stack lifecycle (lazy/eager) with framework app start-before-load

import { EXPLORER_RPC_METHODS } from "../../../src/explorer/rpc/contract.ts";
import {
  notifyExplorerRpc,
  requestExplorerRpc,
} from "../../../src/explorer/rpc/client.ts";
import {
  SIDEBAR_IPC_RPC_METHODS,
  SIDEBAR_IPC_RPC_NOTIFICATIONS,
} from "../../../src/sidebar_ipc/rpc_contract.ts";
import {
  UI_IPC_RPC_METHODS,
  type UiIpcRpcMethod,
} from "../../../src/ui_ipc/rpc_contract.ts";
import {
  EXTENSION_MANIFEST_URL,
  SHORTCUT_KIND_FRAMEWORK_APP,
  SHORTCUT_KIND_URL,
  SHORTCUT_LOAD_EAGER,
  SHORTCUT_LOAD_LAZY,
  SIDEBAR_DOCK_DEBUG_NUMBERS_FLAG,
  SIDEBAR_SHORTCUT_VERSION_PARAM,
  SIDEBAR_SETUP_HINT_DEFAULT,
  SIDEBAR_SETUP_TITLE_DEFAULT,
  UI_PREF_KEY_ACTIVE,
  UI_PREF_KEY_HEADER_DISPLAY,
  UI_PREF_KEY_SHORTCUTS,
  UI_PREF_KEY_TOGGLE_DISPLAY,
} from "./constants.ts";
import {
  configureDevToolsTargetNavigation,
  devToolsTargetWindowName,
  runProfileRuntimeMetadata,
  shouldRecreateDevToolsTargetFrame,
} from "./devtools-target.ts";
import {
  deriveAppIdFromShellEvent as _deriveAppIdFromShellEvent,
  frameworkEventsUrl as _frameworkEventsUrl,
  parseShellEvent,
  runningStateFromShellEvent as _runningStateFromShellEvent,
  shellPayload,
} from "./framework-events.ts";
import {
  agentIconUrlFromName as _agentIconUrlFromName,
  renderIconNode as _renderIconNode,
} from "./icons.ts";
import {
  collectShortcuts as collectShortcutsFromPrefs,
  pickMruShortcut as pickMruShortcutFromModel,
} from "./shortcut-model.ts";
import {
  activateSidebarPresentation,
  bindSidebarAgentPresentation,
  clearSidebarPresentationForeground,
  emptySidebarPresentationState,
  loadSidebarPresentationState,
  reconcileSidebarPresentationState,
  reorderSidebarPresentationState,
  resolveSidebarMentionTarget,
  saveSidebarPresentationState,
  setSidebarPresentationMode,
  sidebarPresentationStatesEqual,
  type SidebarClientPresentationState,
} from "./presentation-state.ts";
import {
  releaseRunTargetSurface,
  prepareRunTargetUrl,
} from './run-target-resolver.ts';
import type {
  FrameworkAppManifest,
  IframeEntry,
  SidebarAppDockSlot,
  SidebarShortcut,
  SidebarShortcutPreference,
  SidebarShortcutsOptions,
  SidebarShortcutsRuntime,
  ShortcutIcon,
  ShortcutKind,
  ShortcutLoad,
  UnknownRecord,
} from "./types.ts";
import {
  asRecord,
  buildFrameworkAppUrl as _buildFrameworkAppUrl,
  fetchJson as _fetchJson,
  firstGrapheme as _firstGrapheme,
  normalizeEditorKind as _normalizeEditorKind,
  normalizeKind as _normalizeKind,
  normalizeLoad as _normalizeLoad,
  normStr as _normStr,
} from "./utils.ts";

interface MenuCheckable extends HTMLElement {
  dataset: DOMStringMap & { value?: string };
}

interface HeaderDragState {
  cell: HTMLElement;
  btn: HTMLElement;
  fromIndex: number;
  dragging: boolean;
  pointerId?: number | null;
}

interface ShortcutListDragState {
  row: HTMLElement;
  handle: HTMLElement;
  fromIndex: number;
  dragging: boolean;
  touchId?: number;
  mouseMoveHandler: ((ev: MouseEvent) => void) | null;
  mouseUpHandler: ((ev: MouseEvent) => void) | null;
  touchMoveHandler: ((ev: TouchEvent) => void) | null;
  touchEndHandler: ((ev: TouchEvent) => void) | null;
  touchCancelHandler: ((ev: TouchEvent) => void) | null;
}

interface ShortcutIframeLoadOptions extends UnknownRecord {
  forceReload?: boolean;
  onBeforeStart?: () => void;
}

interface SidebarRuntimeEventWindow {
  __codeTe2SidebarRuntimeReady?: boolean;
  __codeTe2PendingSidebarEvents?: UnknownRecord[];
}

type ElectronSidebarSurfaceAction =
  | "attach"
  | "console"
  | "devtools"
  | "refresh"
  | "stop";

interface ElectronSidebarSurfaceDescriptor {
  version: 1;
  hostId: string;
  surfaceId: string;
  presentationId: string;
  label: string;
  url: string;
  windowName: string;
  appId: string;
  projectPath: string;
  profileId: string;
  shellId: string;
  devRuntime: boolean;
  devTools: boolean;
  consoleWorkerId: string;
}

interface ElectronSidebarSurfaceEvent {
  type: "closed" | "action";
  hostId: string;
  surfaceId: string;
  presentationId: string;
  action?: ElectronSidebarSurfaceAction;
}

interface ElectronSidebarSurfaceBridge {
  detachSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    options?: { focus?: boolean },
  ): Promise<{ ok: true; presentationId: string }>;
  focusSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }>;
  closeSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: true }>;
  reconcileSidebarSurfaces(surfaceIds: string[]): Promise<{ ok: true }>;
  onSidebarSurfaceEvent(
    listener: (event: ElectronSidebarSurfaceEvent) => void,
  ): () => void;
}

interface ElectronSidebarSurfaceWindow extends Window {
  te2Electron?: ElectronSidebarSurfaceBridge;
}

const SIDEBAR_LAUNCHER_ICON_SRC =
  "/apps/code_te2/static/icons/sidebar-launcher.svg";
const SIDEBAR_SELF_APP_ID = "code_te2";
const LEGACY_SIDEBAR_ACTIVE_SHORTCUT_SET = "sidebar.activeShortcut.set";
const LEGACY_SIDEBAR_ACTIVE_SHORTCUT_REFRESH = "sidebar.activeShortcut.refresh";

function errorMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || fallback)
    : fallback;
}

function eventTargetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function shortcutVersion(value: unknown): string {
  const version = _normStr(value);
  return version ? version : "";
}

function versionedShortcutUrl(url: string, version: unknown): string {
  const stamp = shortcutVersion(version);
  if (!stamp) return url;
  try {
    const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
    const isProtocolRelative = url.startsWith("//");
    const origin = window.location.origin || "http://localhost";
    const parsed = new URL(url, origin);
    parsed.searchParams.set(SIDEBAR_SHORTCUT_VERSION_PARAM, stamp);
    if (!hasExplicitScheme && !isProtocolRelative) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch (_) {
    const hashIndex = url.indexOf("#");
    const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
    const sep = base.includes("?")
      ? base.endsWith("?") || base.endsWith("&")
        ? ""
        : "&"
      : "?";
    return `${base}${sep}${encodeURIComponent(SIDEBAR_SHORTCUT_VERSION_PARAM)}=${encodeURIComponent(stamp)}${hash}`;
  }
}

export function initSidebarShortcuts(
  options: SidebarShortcutsOptions = {},
): SidebarShortcutsRuntime {
  const host = options.host || null;
  const pickFileFn =
    typeof options.pickFile === "function" ? options.pickFile : null;
  const openDrawer =
    typeof options.openDrawer === "function" ? options.openDrawer : null;
  const closeAllMenus =
    typeof options.closeAllMenus === "function" ? options.closeAllMenus : null;
  const emitSidebarUiRequest =
    typeof options.emitSidebarUiRequest === "function"
      ? options.emitSidebarUiRequest
      : null;
  const emitSidebarRpcRequest =
    typeof options.emitSidebarRpcRequest === "function"
      ? options.emitSidebarRpcRequest
      : null;
  const getClientId =
    typeof options.getClientId === "function" ? options.getClientId : () => "";
  const getWindowId =
    typeof options.getWindowId === "function" ? options.getWindowId : () => "";
  const setMenuChecked =
    typeof options.setMenuChecked === "function"
      ? options.setMenuChecked
      : (el: HTMLElement | null, checked: boolean) => {
          if (!el) return;
          el.classList.toggle("fe-menu-item-checked", !!checked);
          el.setAttribute("aria-checked", checked ? "true" : "false");
        };

  const toast = (msg: string) => {
    try {
      if (host && typeof host.toast === "function") host.toast(msg);
      else console.log(msg);
    } catch (_) {}
  };

  function _logAppDiscovery(_step: string, _data: UnknownRecord = {}) {}

  function _warnAppDiscovery(_step: string, _data: UnknownRecord = {}) {}

  // --- DOM elements (resolved on init) ---
  let agentToggleBtn: HTMLElement | null = null;

  let shortcutsModal: HTMLElement | null = null;
  let shortcutsCloseBtn: HTMLElement | null = null;
  let shortcutsAddBtn: HTMLElement | null = null;
  let shortcutsListEl: HTMLElement | null = null;
  let shortcutsEditorEl: HTMLElement | null = null;

  let editorSettingsModalEl: HTMLElement | null = null;
  let editorSettingsShortcutsBtn: HTMLElement | null = null;
  let setupShortcutsBtn: HTMLElement | null = null;

  let shortcutLabelInput: HTMLInputElement | null = null;
  let shortcutUrlWrap: HTMLElement | null = null;
  let shortcutUrlInput: HTMLInputElement | null = null;
  let shortcutKindBtn: HTMLElement | null = null;
  let shortcutKindLabel: HTMLElement | null = null;
  let shortcutKindDD: HTMLElement | null = null;
  let shortcutAppWrap: HTMLElement | null = null;
  let shortcutAppBtn: HTMLElement | null = null;
  let shortcutAppLabel: HTMLElement | null = null;
  let shortcutAppDD: HTMLElement | null = null;

  let shortcutLoadBtn: HTMLElement | null = null;
  let shortcutLoadLabel: HTMLElement | null = null;
  let shortcutLoadDD: HTMLElement | null = null;

  let shortcutEmojiInput: HTMLInputElement | null = null;
  let shortcutIconBrowseBtn: HTMLElement | null = null;
  let shortcutIconClearBtn: HTMLElement | null = null;
  let shortcutIconPreview: HTMLElement | null = null;
  let shortcutCancelBtn: HTMLElement | null = null;
  let shortcutSaveBtn: HTMLElement | null = null;

  let sidebarHeaderIconEl: HTMLElement | null = null;
  let sidebarHeaderTitleEl: HTMLElement | null = null;
  let sidebarHeaderIconGridEl: HTMLElement | null = null;
  let sidebarHeaderIconMenuEl: HTMLElement | null = null;
  let sidebarRefreshBtn: HTMLElement | null = null;
  let sidebarRefreshMenuEl: HTMLElement | null = null;
  let sidebarSetupPlaceholder: HTMLElement | null = null;
  let sidebarSetupTitleEl: HTMLElement | null = null;
  let sidebarSetupHintEl: HTMLElement | null = null;
  let sidebarIframeStack: HTMLElement | null = null;

  // --- internal state ---
  let _latestUiPrefs: UnknownRecord = {};
  let _settingsUiMutating = false;
  let _shortcutsCache: SidebarShortcutPreference[] = [];
  let _appDockSlots: SidebarAppDockSlot[] = [];

  let _editingId: string | null = null;
  let _editingKey = "";
  let _editingHostId = "";
  let _editingAssetName: string | null = null;
  let _editingKind: ShortcutKind = SHORTCUT_KIND_URL;
  let _editingAppId = "";
  let _lastPickerPath = "";
  let _clientActiveShortcutId = "";
  let _clientActiveWindowHostId = "";
  let _pendingActivatedWindowHostId = "";
  let _presentationState = emptySidebarPresentationState();
  let _presentationStateLoaded = false;
  let _presentationStateLoadPromise: Promise<void> | null = null;
  let _presentationPersistQueue: Promise<void> = Promise.resolve();
  let _detachedPresentationIds = new Map<string, string>();
  let _detachPromises = new Map<string, Promise<boolean>>();
  let _electronSurfaceEventsUnsubscribe: (() => void) | null = null;
  let _lastShortcutUsageKey = "";
  let _lastShortcutUsageStamp = 0;

  let _iframeMap = new Map<string, IframeEntry>(); // key -> {iframe,url,loaded}
  let _activateSeq = 0;

  let _extensionManifestIcon: ShortcutIcon = {
    kind: "",
    value: "",
    defaultIcon: "",
  };

  let _appsCache: FrameworkAppManifest[] | null = null; // canonical apps catalog from /api/apps/catalog
  let _runningCache: Set<string> | null = null; // Set(app_id)
  let _runningCachePrimed = false;
  let _startingApps = new Map<string, Promise<boolean>>(); // app_id -> Promise<boolean>
  let _frameworkEventsWs: WebSocket | null = null;
  let _frameworkEventsReconnectTimer: ReturnType<typeof setTimeout> | null =
    null;
  let _frameworkEventsBackoffMs = 600;
  let _frameworkEventsEnabled = false;
  let _appsChromeSeq = 0;
  let _headerIconMenuKey = "";
  let _refreshMenuLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let _sidebarEventListenerBound = false;
  let _appsStateReadyPromise: Promise<void> | null = null;
  let _appsStateReadyResolve: (() => void) | null = null;
  let _lightInitDone = false;
  let _hydrated = false;
  let _hydratePromise: Promise<void> | null = null;

  function _requireEl<T extends Element = HTMLElement>(
    selector: string,
    scope: ParentNode = document,
  ): T {
    const el = scope.querySelector(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el as T;
  }

  function _sendUiPrefUpdate(key: string, value: unknown) {
    if (
      !notifyExplorerRpc(EXPLORER_RPC_METHODS.prefsUiUpdate, { key, value })
    ) {
      toast("Explorer WebSocket is not connected yet.");
      return;
    }
  }

  async function _ensureAppsCache(force: boolean = false) {
    _setFrameworkEventsEnabled(true);
    if (!force && Array.isArray(_appsCache)) {
      return _appsCache;
    }
    await _ensureAppsStateReady();
    return Array.isArray(_appsCache) ? _appsCache : [];
  }

  async function _ensureRunningCache(force: boolean = false) {
    _setFrameworkEventsEnabled(true);
    if (!force && _runningCachePrimed && _runningCache instanceof Set) {
      return _runningCache;
    }
    await _ensureAppsStateReady();
    return _runningCache instanceof Set ? _runningCache : new Set();
  }

  function _ensureAppsStateReadyPromise() {
    if (_appsStateReadyPromise) return _appsStateReadyPromise;
    _appsStateReadyPromise = new Promise((resolve) => {
      _appsStateReadyResolve = resolve;
    });
    return _appsStateReadyPromise;
  }

  function _resolveAppsStateReady() {
    const resolve = _appsStateReadyResolve;
    _appsStateReadyResolve = null;
    if (resolve) resolve();
  }

  async function _ensureAppsStateReady() {
    _ensureAppsStateReadyPromise();
    await _appsStateReadyPromise;
  }

  function _invalidateFrameworkShortcutIframes(appId: unknown) {
    const id = _normStr(appId);
    if (!id) return;
    const shortcuts = _collectVisibleShortcuts(_latestUiPrefs || {});
    const active = _resolveActive(_latestUiPrefs || {}, shortcuts);
    let invalidatedActive = false;
    shortcuts.forEach((sc) => {
      if (!sc || sc.kind !== SHORTCUT_KIND_FRAMEWORK_APP) return;
      if (_normStr(sc.app_id) !== id) return;
      const entry = _iframeMap.get(sc.key);
      if (!entry) return;
      entry.loaded = false;
      try {
        entry.iframe.src = "about:blank";
      } catch (_) {}
      if (active && active.key === sc.key) invalidatedActive = true;
    });
    if (invalidatedActive) {
      _updateSetupPlaceholder(_latestUiPrefs || {}, false);
    }
  }

  function _applyRunningDelta(appId: unknown, isRunning: unknown) {
    const id = _normStr(appId);
    if (!id || typeof isRunning !== "boolean") return;
    if (!(_runningCache instanceof Set)) _runningCache = new Set();

    const had = _runningCache.has(id);
    if (isRunning) _runningCache.add(id);
    else _runningCache.delete(id);
    if (had === isRunning) return;

    _refreshShortcutChrome();
    if (isRunning) _ensureRunningFrameworkShortcutIframesLoaded();

    // If a framework app entry points at a backend that dies, invalidate those iframes.
    if (!isRunning) _invalidateFrameworkShortcutIframes(id);

    try {
      if (shortcutAppDD && shortcutAppDD.classList.contains("show")) {
        void _renderAppMenu();
      }
    } catch (_) {}
  }

  function _handleFrameworkShellEvent(raw: unknown) {
    const evt = parseShellEvent(raw);
    if (!evt) return;

    const type = _normStr(evt.type);
    const payload = shellPayload(evt);

    if (type === "apps_snapshot" || type === "catalog_snapshot") {
      const catalog = Array.isArray(payload?.catalog)
        ? (payload.catalog as FrameworkAppManifest[])
        : [];
      const runningIds = Array.isArray(payload?.running_ids)
        ? payload.running_ids.map((id) => _normStr(id)).filter((id) => !!id)
        : [];
      _appsCache = catalog;
      _runningCache = new Set(runningIds);
      _runningCachePrimed = true;
      _resolveAppsStateReady();
      _refreshShortcutChrome();
      _ensureRunningFrameworkShortcutIframesLoaded();
      try {
        if (shortcutAppDD && shortcutAppDD.classList.contains("show")) {
          void _renderAppMenu();
        }
      } catch (_) {}
      return;
    }

    if (type === "app_running_changed") {
      const appId = _normStr(payload?.app_id);
      if (!appId) return;
      _applyRunningDelta(appId, !!payload?.running);
    }
  }

  function _scheduleFrameworkEventsReconnect() {
    if (!_frameworkEventsEnabled) return;
    if (_frameworkEventsReconnectTimer) return;
    const waitMs = _frameworkEventsBackoffMs;
    _frameworkEventsBackoffMs = Math.min(
      15000,
      Math.floor(_frameworkEventsBackoffMs * 1.8),
    );
    _frameworkEventsReconnectTimer = setTimeout(() => {
      _frameworkEventsReconnectTimer = null;
      _connectFrameworkEvents();
    }, waitMs);
  }

  function _connectFrameworkEvents() {
    if (!_frameworkEventsEnabled) return;
    if (
      _frameworkEventsWs &&
      (_frameworkEventsWs.readyState === WebSocket.OPEN ||
        _frameworkEventsWs.readyState === WebSocket.CONNECTING)
    )
      return;

    let ws = null;
    try {
      ws = new WebSocket(_frameworkEventsUrl());
    } catch (_) {
      _scheduleFrameworkEventsReconnect();
      return;
    }
    _frameworkEventsWs = ws;

    ws.addEventListener("open", () => {
      _frameworkEventsBackoffMs = 600;
    });

    ws.addEventListener("message", (ev) => {
      _handleFrameworkShellEvent(ev?.data);
    });

    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch (_) {}
    });

    ws.addEventListener("close", () => {
      if (_frameworkEventsWs === ws) _frameworkEventsWs = null;
      _scheduleFrameworkEventsReconnect();
    });
  }

  function _setFrameworkEventsEnabled(enabled: boolean) {
    if (!enabled) {
      _frameworkEventsEnabled = false;
      if (_frameworkEventsReconnectTimer) {
        clearTimeout(_frameworkEventsReconnectTimer);
        _frameworkEventsReconnectTimer = null;
      }
      if (_frameworkEventsWs) {
        try {
          _frameworkEventsWs.close();
        } catch (_) {}
        _frameworkEventsWs = null;
      }
      return;
    }
    _frameworkEventsEnabled = true;
    _connectFrameworkEvents();
  }

  function _handleAppsRegistryReload() {
    // Registry changes arrive through the apps state websocket snapshot path.
  }

  function _findAppManifest(appId: unknown) {
    const id = _normStr(appId);
    if (!id || !Array.isArray(_appsCache)) {
      _warnAppDiscovery("manifest:find:skipped", {
        appId: id,
        hasAppsCache: Array.isArray(_appsCache),
      });
      return null;
    }
    const found = _appsCache.find((a) => a && a.id === id) || null;
    _logAppDiscovery("manifest:find:result", { appId: id, found: !!found });
    return found;
  }

  function _appManifestIsStateful(
    appManifest: FrameworkAppManifest | null,
  ): boolean {
    if (!appManifest || typeof appManifest !== "object") return false;
    if (typeof appManifest.stateful === "boolean") return appManifest.stateful;
    const sidebarState = appManifest.sidebar_state;
    return !!(
      sidebarState &&
      typeof sidebarState === "object" &&
      (sidebarState as UnknownRecord).enabled !== false
    );
  }

  function _resolveAppIconSrc(appManifest: FrameworkAppManifest | null) {
    const raw = _normStr(appManifest?.icon_src);
    if (!raw) {
      _logAppDiscovery("icon-src:none", { appId: _normStr(appManifest?.id) });
      return "";
    }
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("/")
    ) {
      _logAppDiscovery("icon-src:absolute", {
        appId: _normStr(appManifest?.id),
        iconSrc: raw,
      });
      return raw;
    }
    const assetBaseUrl = _normStr(appManifest?.asset_base_url);
    if (assetBaseUrl) {
      const resolved = `${assetBaseUrl.replace(/\/+$/, "")}/${raw.replace(/^\/+/, "")}`;
      _logAppDiscovery("icon-src:asset-base", {
        appId: _normStr(appManifest?.id),
        iconSrc: resolved,
      });
      return resolved;
    }
    const appDir = _normStr(appManifest?._dir);
    if (appDir) {
      const resolved = `/apps/${appDir}/${raw.replace(/^\/+/, "")}`;
      _logAppDiscovery("icon-src:resolved", {
        appId: _normStr(appManifest?.id),
        iconSrc: resolved,
      });
      return resolved;
    }
    _logAppDiscovery("icon-src:raw", {
      appId: _normStr(appManifest?.id),
      iconSrc: raw,
    });
    return raw;
  }

  function _manifestIconForApp(appId: unknown) {
    const m = _findAppManifest(appId);
    if (!m) {
      _warnAppDiscovery("manifest-icon:missing-manifest", {
        appId: _normStr(appId),
      });
      return null;
    }
    const iconSrc = _resolveAppIconSrc(m);
    if (iconSrc) {
      _logAppDiscovery("manifest-icon:image", {
        appId: _normStr(appId),
        iconSrc,
      });
      return { kind: "image", src: iconSrc };
    }
    const iconText = _normStr(m.icon_text);
    if (iconText) {
      _logAppDiscovery("manifest-icon:text", {
        appId: _normStr(appId),
        iconText,
      });
      return { kind: "text", text: iconText };
    }
    const iconEmoji = _normStr(m.icon_emoji);
    if (iconEmoji) {
      _logAppDiscovery("manifest-icon:emoji", {
        appId: _normStr(appId),
        iconEmoji,
      });
      return { kind: "emoji", emoji: iconEmoji };
    }
    _warnAppDiscovery("manifest-icon:none", { appId: _normStr(appId) });
    return null;
  }

  function _dockDebugNumbersEnabled(): boolean {
    const truthy = new Set(["1", "true", "yes", "on"]);
    try {
      const fromQuery = new URLSearchParams(window.location.search).get(
        SIDEBAR_DOCK_DEBUG_NUMBERS_FLAG,
      );
      if (fromQuery !== null) return truthy.has(fromQuery.trim().toLowerCase());
    } catch (_) {}
    try {
      const fromStorage = window.localStorage?.getItem(
        SIDEBAR_DOCK_DEBUG_NUMBERS_FLAG,
      );
      if (fromStorage !== null)
        return truthy.has(String(fromStorage).trim().toLowerCase());
    } catch (_) {}
    try {
      const fromDataset = document.documentElement?.dataset?.sidebarDockNumbers;
      if (fromDataset !== undefined)
        return truthy.has(String(fromDataset).trim().toLowerCase());
    } catch (_) {}
    return false;
  }

  function _applyExtensionManifestIcon(manifest: UnknownRecord) {
    const iconPath = _normStr(manifest?.icon);
    const iconEmoji = _normStr(manifest?.icon_emoji);

    const targets = [sidebarHeaderIconEl].filter(
      (el): el is HTMLElement => !!el,
    );
    if (!targets.length) return;

    targets.forEach((el) => {
      el.textContent = "";
      el.dataset.manifestKind = "";
      el.dataset.manifestValue = "";
    });

    if (iconPath) {
      const resolved = iconPath.startsWith("/")
        ? iconPath
        : `/apps/code_te2/${iconPath.replace(/^\/+/, "")}`;
      targets.forEach((el) => {
        const img = document.createElement("img");
        img.src = resolved;
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        el.appendChild(img);
        el.dataset.manifestKind = "image";
        el.dataset.manifestValue = resolved;
      });
      _extensionManifestIcon = {
        kind: "image",
        value: resolved,
        defaultIcon: "",
      };
      return;
    }

    if (iconEmoji) {
      targets.forEach((el) => {
        el.textContent = iconEmoji;
        el.dataset.manifestKind = "emoji";
        el.dataset.manifestValue = iconEmoji;
      });
      _extensionManifestIcon = {
        kind: "emoji",
        value: iconEmoji,
        defaultIcon: "",
      };
      return;
    }

    // No fallback here: leave empty and let CSS decide.
    _extensionManifestIcon = { kind: "", value: "", defaultIcon: "" };
  }

  async function _bootstrapExtensionManifest() {
    try {
      const { body } = await _fetchJson(EXTENSION_MANIFEST_URL, {
        cache: "no-store",
      });
      if (body && typeof body === "object") {
        _applyExtensionManifestIcon(asRecord(body));
      }
    } catch (e) {
      console.warn("[Sidebar] Failed to load extension manifest:", e);
    }
  }

  function _restoreManifestIcon(el: HTMLElement | null) {
    if (!el) return;
    const kind = _normStr(el.dataset?.manifestKind);
    const value = _normStr(el.dataset?.manifestValue);
    el.textContent = "";
    if (kind === "image" && value) {
      const img = document.createElement("img");
      img.src = value;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      el.appendChild(img);
      return;
    }
    if (kind === "emoji" && value) {
      el.textContent = value;
      return;
    }
  }

  function _renderIconInto(
    el: HTMLElement | null,
    icon: unknown,
    fallbackIcon: SidebarShortcut | null = null,
  ) {
    if (!el) return;
    el.textContent = "";

    const i =
      icon && typeof icon === "object" && !Array.isArray(icon)
        ? (icon as ShortcutIcon)
        : null;
    if (i && i.kind === "emoji") {
      const emoji = _normStr(i.emoji);
      if (emoji) {
        el.textContent = emoji;
        return;
      }
    }
    if (i && i.kind === "asset") {
      const name = _normStr(i.name);
      if (name) {
        const img = document.createElement("img");
        img.src = _agentIconUrlFromName(name);
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        el.appendChild(img);
        return;
      }
    }
    if (i && i.kind === "image") {
      const src = _normStr(i.src);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
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

  function _collectShortcuts(uiPrefs: UnknownRecord) {
    return collectShortcutsFromPrefs(uiPrefs as UnknownRecord);
  }

  function _windowHostId(
    win: SidebarAppDockSlot | UnknownRecord | null,
  ): string {
    return _normStr(win?.host_id || win?.hostId);
  }

  function _windowKey(win: SidebarAppDockSlot | UnknownRecord | null): string {
    const hostId = _windowHostId(win);
    return hostId ? `dock:${hostId}` : "";
  }

  function _dockHostIdFromKey(value: unknown): string {
    const raw = _normStr(value);
    return raw.startsWith("dock:") ? raw.slice("dock:".length) : raw;
  }

  function _findAppDockSlot(value: unknown): SidebarAppDockSlot | null {
    const raw = _normStr(value);
    if (!raw) return null;
    const hostId = raw.startsWith("dock:")
      ? raw.slice("dock:".length)
      : raw.startsWith("stateful:")
        ? raw.slice("stateful:".length)
        : raw;
    return _appDockSlots.find((win) => _windowHostId(win) === hostId) || null;
  }

  function _appDockSlotIsStateful(
    win: SidebarAppDockSlot | UnknownRecord | null,
  ): boolean {
    if (!win || typeof win !== "object") return false;
    if (typeof win.stateful === "boolean") return win.stateful;
    return !!(
      win.token_id ||
      win.tokenId ||
      win.console_worker_id ||
      win.consoleWorkerId
    );
  }

  function _appDockSlotToEntry(
    win: SidebarAppDockSlot,
  ): SidebarShortcut | null {
    const hostId = _windowHostId(win);
    const url = _normStr(win.url);
    const restoreUrl = _normStr(win.restore_url || win.restoreUrl);
    const appId = _normStr(win.app_id || win.appId);
    const kind = _normStr(win.kind).toLowerCase();
    if (!hostId || !url) return null;
    if (
      kind === SHORTCUT_KIND_URL ||
      (!appId && _normStr(win.state_kind || win.stateKind) === "url")
    ) {
      const label =
        _normStr(win.label) || _normStr(win.title) || _deriveUrlLabel(url);
      const state = asRecord(win.query_state || win.queryState || win.state);
      return {
        id: _windowKey(win),
        key: _windowKey(win),
        kind: SHORTCUT_KIND_URL,
        app_id: "",
        label,
        url,
        version: _normStr(win.version),
        icon:
          win.icon && typeof win.icon === "object"
            ? (win.icon as ShortcutIcon)
            : null,
        load: _normalizeLoad(win.load || SHORTCUT_LOAD_LAZY),
        last_used: Number(win.updated_at || win.updatedAt || 0),
        dock: true,
        stateful: false,
        state: { ...state, url },
        state_kind: "url",
        stateKind: "url",
        host_id: hostId,
        restore_url: restoreUrl || url,
        restoreUrl: restoreUrl || url,
        readiness: win.readiness || null,
        dev_tools: win.dev_tools === true || win.devTools === true,
        devTools: win.dev_tools === true || win.devTools === true,
        devtools_target_id: _normStr(
          win.devtools_target_id || win.devToolsTargetId,
        ),
        devToolsTargetId: _normStr(
          win.devtools_target_id || win.devToolsTargetId,
        ),
        devtools_target_label: _normStr(
          win.devtools_target_label || win.devToolsTargetLabel,
        ),
        devToolsTargetLabel: _normStr(
          win.devtools_target_label || win.devToolsTargetLabel,
        ),
        run_target_route: win.run_target_route || win.runTargetRoute,
        runTargetRoute: win.run_target_route || win.runTargetRoute,
        run_profile_surface:
          win.run_profile_surface || win.runProfileSurface,
        runProfileSurface:
          win.run_profile_surface || win.runProfileSurface,
        webview_surface: win.webview_surface || win.webviewSurface,
        webviewSurface: win.webview_surface || win.webviewSurface,
      };
    }
    if (!appId) return null;
    const label =
      _normStr(win.label) || _normStr(win.title) || _normStr(win.path) || appId;
    const icon =
      win.icon && typeof win.icon === "object"
        ? win.icon
        : _manifestIconForApp(appId);
    const stateful = _appDockSlotIsStateful(win);
    return {
      id: _windowKey(win),
      key: _windowKey(win),
      kind: SHORTCUT_KIND_FRAMEWORK_APP,
      app_id: appId,
      label,
      url,
      version: "",
      icon: icon && typeof icon === "object" ? (icon as ShortcutIcon) : null,
      load: _normalizeLoad(win.load || SHORTCUT_LOAD_EAGER),
      last_used: Number(win.updated_at || win.updatedAt || 0),
      dock: true,
      stateful,
      host_id: hostId,
      base_url: _normStr(win.base_url || win.baseUrl),
      restore_url: restoreUrl,
      restoreUrl,
      readiness: win.readiness || null,
    };
  }

  function _collectAppDockEntries(): SidebarShortcut[] {
    return _appDockSlots
      .map((win) => _appDockSlotToEntry(win))
      .filter((win): win is SidebarShortcut => !!win);
  }

  function _shortcutMatchesValue(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
    value: unknown,
  ): boolean {
    const id = _normStr(value);
    if (!sc || !id) return false;
    return (
      (!!sc.id && sc.id === id) ||
      (!!sc.url && sc.url === id) ||
      (!!sc.key && sc.key === id)
    );
  }

  function _collectUrlEntries(uiPrefs: UnknownRecord): SidebarShortcut[] {
    return _collectShortcuts(uiPrefs);
  }

  function _collectVisibleShortcuts(uiPrefs: UnknownRecord): SidebarShortcut[] {
    const appDockEntries = _collectAppDockEntries().filter((shortcut) => {
      const hostId = _normStr(shortcut.host_id);
      return !hostId || _presentationModeForHost(hostId) !== "hidden";
    });
    const activeUrlId = _normStr(_clientActiveShortcutId);
    if (!activeUrlId) return appDockEntries;
    const activeUrlEntry = _collectUrlEntries(uiPrefs).filter((sc) =>
      _shortcutMatchesValue(sc, activeUrlId),
    );
    return [...appDockEntries, ...activeUrlEntry];
  }

  function _isStatefulDockEntry(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): boolean {
    return !!(
      sc &&
      (sc as SidebarShortcut).dock &&
      (sc as SidebarShortcut).stateful
    );
  }

  function _isAppDockEntry(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): boolean {
    return !!(
      sc &&
      (sc as SidebarShortcut).dock &&
      sc.kind === SHORTCUT_KIND_FRAMEWORK_APP &&
      _normStr((sc as SidebarShortcut).host_id)
    );
  }

  function _isUrlSlotEntry(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): boolean {
    return !!(
      sc &&
      sc.kind === SHORTCUT_KIND_URL &&
      (_normStr((sc as SidebarShortcut).host_id) ||
        _normStr(sc.id) ||
        _normStr(sc.url) ||
        _normStr(sc.key))
    );
  }

  function _extensionWebviewSurface(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): UnknownRecord {
    if (!sc) return {};
    return asRecord(
      (sc as SidebarShortcut).webview_surface ||
        (sc as SidebarShortcut).webviewSurface,
    );
  }

  function _isExtensionWebviewEntry(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): boolean {
    return _normStr(_extensionWebviewSurface(sc).dto) === "ExtensionWebviewSurface";
  }

  function _appReadinessStatus(appId: unknown): string {
    const id = _normStr(appId);
    if (!id || !Array.isArray(_appsCache)) return "";
    const app = _appsCache.find((item) => item && _normStr(item.id) === id);
    const readiness = asRecord(app?.readiness);
    const raw = _normStr(readiness.status).toLowerCase();
    if (raw === "loading") return "starting";
    if (raw === "ok" || raw === "up" || raw === "serving") return "ready";
    return raw;
  }

  function _dockReadinessStatus(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ): string {
    if (!_isStatefulDockEntry(sc)) return "ready";
    const appStatus = _appReadinessStatus((sc as SidebarShortcut).app_id);
    if (appStatus) return appStatus;
    const hostId = _normStr((sc as SidebarShortcut).host_id);
    const win = _findAppDockSlot(hostId);
    const readiness =
      win?.readiness && typeof win.readiness === "object"
        ? win.readiness
        : null;
    const shortcutReadiness = asRecord((sc as SidebarShortcut).readiness);
    return _normStr(
      readiness?.status || shortcutReadiness.status || "starting",
    ).toLowerCase();
  }

  function _resolveActive(
    uiPrefs: UnknownRecord,
    shortcuts: SidebarShortcut[] | null = null,
  ) {
    const activeWindow = _findAppDockSlot(_clientActiveWindowHostId);
    if (
      activeWindow &&
      _presentationModeForHost(_windowHostId(activeWindow)) !== "hidden"
    ) {
      const entry = _appDockSlotToEntry(activeWindow);
      if (entry) return entry;
    }
    const list = Array.isArray(shortcuts)
      ? shortcuts
      : _collectVisibleShortcuts(uiPrefs);
    const explicitUrlId = _normStr(_clientActiveShortcutId);
    if (explicitUrlId) {
      const explicit = list.find((sc) =>
        _shortcutMatchesValue(sc, explicitUrlId),
      );
      if (explicit) return explicit;
    }
    const persistedActiveId = _normStr(uiPrefs?.[UI_PREF_KEY_ACTIVE]);
    if (persistedActiveId) {
      const dockActive = list.find((sc) =>
        _shortcutMatchesValue(sc, persistedActiveId),
      );
      if (dockActive) return dockActive;
    }
    return null;
  }

  function getActiveUrl(uiPrefs: UnknownRecord) {
    const active = _resolveActive(uiPrefs || _latestUiPrefs || {});
    return active ? active.url : "";
  }

  function _pickMruShortcut(shortcuts: SidebarShortcut[] | null) {
    return pickMruShortcutFromModel(Array.isArray(shortcuts) ? shortcuts : []);
  }

  function _ensureActiveSelection(
    uiPrefs: UnknownRecord,
    shortcuts: SidebarShortcut[] | null,
  ) {
    const activeWindow = _findAppDockSlot(_clientActiveWindowHostId);
    if (
      activeWindow &&
      _presentationModeForHost(_windowHostId(activeWindow)) !== "hidden"
    ) {
      const entry = _appDockSlotToEntry(activeWindow);
      if (entry) return { active: entry, activeId: entry.key };
    }
    const list = Array.isArray(shortcuts)
      ? shortcuts
      : _collectVisibleShortcuts(uiPrefs);
    const active = _resolveActive(uiPrefs, list);
    if (active) {
      const activeId = active.id || active.url || active.key || "";
      return { active, activeId };
    }
    const appDockDefault = _pickMruShortcut(list.filter(_isAppDockEntry));
    if (appDockDefault) {
      const activeId =
        appDockDefault.id || appDockDefault.url || appDockDefault.key || "";
      return { active: appDockDefault, activeId };
    }
    return { active: null, activeId: "" };
  }

  function _applyToggleDisplay(uiPrefs: UnknownRecord) {
    const display = _normStr(uiPrefs?.[UI_PREF_KEY_TOGGLE_DISPLAY]) || "icon";
    try {
      const radios = (editorSettingsModalEl || document).querySelectorAll<HTMLInputElement>(
        'input[name="agent-toggle-display"]',
      );
      radios.forEach((r) => {
        r.checked = r.value === display;
      });
    } catch (_) {}
  }

  function _applyHeaderDisplayMode(uiPrefs: UnknownRecord) {
    const iconEl = sidebarHeaderIconEl;
    const textEl = sidebarHeaderTitleEl;
    if (!iconEl || !textEl) return;
    const display = _normStr(uiPrefs?.[UI_PREF_KEY_HEADER_DISPLAY]) || "text";
    if (display === "icon") {
      iconEl.style.display = "inline-flex";
      textEl.style.display = "none";
    } else if (display === "text") {
      iconEl.style.display = "none";
      textEl.style.display = "";
    } else {
      iconEl.style.display = "inline-flex";
      textEl.style.display = "";
    }
  }

  function _effectiveShortcutIcon(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ) {
    const icon = sc && sc.icon && typeof sc.icon === "object" ? sc.icon : null;
    if (icon && icon.kind && icon.kind !== "default") return icon;
    if (sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      const mIcon = _manifestIconForApp(sc.app_id);
      if (mIcon) return mIcon;
    }
    return null;
  }

  function _refreshShortcutChrome() {
    const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
    const active = _resolveActive(_latestUiPrefs || {}, normalized);
    _applyHeaderLabelAndIcon(_latestUiPrefs || {}, normalized, active);
    _renderHeaderIconGrid(_latestUiPrefs || {}, normalized, active);
    try {
      const dd = document.getElementById("fe-agent-dd");
      if (dd && dd.classList.contains("show")) _renderAgentDropdown();
    } catch (_) {}
    try {
      if (shortcutsModal && shortcutsModal.classList.contains("show"))
        _renderShortcutsList();
    } catch (_) {}
  }

  function _applyHeaderLabelAndIcon(
    uiPrefs: UnknownRecord,
    shortcuts: SidebarShortcut[] | null,
    active: SidebarShortcut | null,
  ) {
    if (!sidebarHeaderIconEl || !sidebarHeaderTitleEl) return;
    const resolvedShortcuts = Array.isArray(shortcuts)
      ? shortcuts
      : _collectVisibleShortcuts(uiPrefs);
    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const headerLabel =
      resolvedActive && _normStr(resolvedActive.label)
        ? _normStr(resolvedActive.label)
        : "Sidebar";
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

  function _collectHeaderItems(resolvedShortcuts: SidebarShortcut[]) {
    const list = Array.isArray(resolvedShortcuts) ? resolvedShortcuts : [];
    return list.filter((sc) => !!sc).map((sc) => ({ ...sc }));
  }

  function _maybeUpdateShortcutLastUsed(shortcutId: unknown) {
    const nextId = _normStr(shortcutId);
    if (!nextId) return;

    const now = Date.now();
    if (_lastShortcutUsageKey === nextId && now - _lastShortcutUsageStamp < 800)
      return;

    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
      ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS]
      : [];
    const idx = raw.findIndex((sc) => {
      if (!sc || typeof sc !== "object") return false;
      const id = _normStr(sc.id);
      const url = _normStr(sc.url);
      return id === nextId || url === nextId;
    });
    if (idx < 0) return;

    const prevTs = Number(raw[idx]?.last_used || 0);
    if (Number.isFinite(prevTs) && now - prevTs < 800) {
      _lastShortcutUsageKey = nextId;
      _lastShortcutUsageStamp = now;
      return;
    }

    const next = raw.map((sc, i) => {
      if (i !== idx || !sc || typeof sc !== "object") return sc;
      return { ...sc, last_used: now };
    });
    _lastShortcutUsageKey = nextId;
    _lastShortcutUsageStamp = now;
    _sendUiPrefUpdate(UI_PREF_KEY_SHORTCUTS, next);
  }

  function _shortcutMatches(
    candidate: unknown,
    shortcut: SidebarShortcut | null,
  ): boolean {
    if (!shortcut || !candidate || typeof candidate !== "object") return false;
    const sc = candidate as UnknownRecord;
    const candidateId = _normStr(sc.id);
    const candidateUrl = _normStr(sc.url);
    return (
      (!!shortcut.id && candidateId === shortcut.id) ||
      (!!shortcut.url && candidateUrl === shortcut.url) ||
      (!!shortcut.key &&
        (candidateId === shortcut.key || candidateUrl === shortcut.key))
    );
  }

  function _deriveUrlLabel(url: unknown): string {
    const raw = _normStr(url);
    if (!raw) return "URL";
    try {
      const parsed = new URL(raw, window.location.origin);
      const label =
        parsed.hostname ||
        parsed.pathname.replace(/^\/+/, "") ||
        parsed.href ||
        raw;
      return _normStr(label) || raw;
    } catch (_) {
      return raw;
    }
  }

  function _bumpShortcutVersion(
    shortcut: SidebarShortcut | null,
  ): SidebarShortcut | null {
    if (!shortcut) return null;
    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
      ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS]
      : [];
    const nextVersion = String(Date.now());
    let changed = false;
    const next = raw.map((sc) => {
      if (!_shortcutMatches(sc, shortcut)) return sc;
      changed = true;
      return { ...(sc as UnknownRecord), version: nextVersion };
    });
    if (!changed) return { ...shortcut, version: nextVersion };

    _latestUiPrefs = { ..._latestUiPrefs, [UI_PREF_KEY_SHORTCUTS]: next };
    _shortcutsCache = next.filter(
      (sc): sc is SidebarShortcutPreference => !!sc && typeof sc === "object",
    );
    _sendUiPrefUpdate(UI_PREF_KEY_SHORTCUTS, next);
    const refreshed = _resolveActive(
      _latestUiPrefs,
      _collectVisibleShortcuts(_latestUiPrefs),
    );
    return refreshed || { ...shortcut, version: nextVersion };
  }

  function _closeHeaderIconMenu() {
    if (!sidebarHeaderIconMenuEl) return;
    sidebarHeaderIconMenuEl.classList.remove("show");
    sidebarHeaderIconMenuEl.innerHTML = "";
    sidebarHeaderIconMenuEl.style.left = "";
    sidebarHeaderIconMenuEl.style.top = "";
    sidebarHeaderIconMenuEl.dataset.shortcutKey = "";
    _headerIconMenuKey = "";
  }

  function _closeRefreshMenu() {
    if (!sidebarRefreshMenuEl) return;
    sidebarRefreshMenuEl.classList.remove("show");
    sidebarRefreshMenuEl.innerHTML = "";
  }

  function _requestSidebarControl(
    method: UiIpcRpcMethod,
    payload: UnknownRecord = {},
  ) {
    const message = {
      type: _normStr(method),
      payload: payload && typeof payload === "object" ? payload : {},
    };
    if (!message.type) return;
    if (emitSidebarUiRequest) {
      emitSidebarUiRequest(method, message.payload);
    } else {
      try {
        window.dispatchEvent(
          new CustomEvent("code-te2:sidebar-event", { detail: message }),
        );
      } catch (_) {}
    }
  }

  function _queuePresentationStatePersist() {
    if (!_presentationStateLoaded) return;
    const snapshot = _presentationState;
    _presentationPersistQueue = _presentationPersistQueue
      .catch(() => {})
      .then(() => saveSidebarPresentationState(snapshot))
      .catch((error: unknown) => {
        console.warn("[Sidebar] presentation state persist failed", error);
      });
  }

  function _commitPresentationState(
    next: SidebarClientPresentationState,
    options: { persist?: boolean } = {},
  ): boolean {
    if (sidebarPresentationStatesEqual(_presentationState, next)) return false;
    _presentationState = next;
    _clientActiveWindowHostId = next.foregroundHostId;
    if (next.foregroundHostId) _clientActiveShortcutId = "";
    if (options.persist !== false) _queuePresentationStatePersist();
    return true;
  }

  function _slotIsAgent(slot: SidebarAppDockSlot | null): boolean {
    if (!slot) return false;
    const appId = _normStr(slot.app_id || slot.appId)
      .toLowerCase()
      .replaceAll("_", "-");
    const stateKind = _normStr(slot.state_kind || slot.stateKind).toLowerCase();
    return appId === "als" || appId === "als-rs" || stateKind === "conversation";
  }

  function _newPresentationId(hostId: string): string {
    const randomId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `inline:${hostId}:${randomId}`;
  }

  function _newDetachedPresentationId(hostId: string): string {
    const randomId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `detached:${hostId}:${randomId}`;
  }

  function _electronSurfaceBridge(): ElectronSidebarSurfaceBridge | null {
    const bridge = (window as ElectronSidebarSurfaceWindow).te2Electron;
    return bridge && typeof bridge.detachSidebarSurface === "function"
      ? bridge
      : null;
  }

  function _surfaceIdForShortcut(sc: SidebarShortcut): string {
    const surface = asRecord(
      sc.run_profile_surface ||
        sc.runProfileSurface ||
        sc.webview_surface ||
        sc.webviewSurface,
    );
    const hostId = _normStr(sc.host_id) || sc.key;
    return _normStr(surface.surfaceId) || `sidebar:${hostId}`;
  }

  function _extensionWebviewPresentationUrl(
    sc: SidebarShortcut,
    rawUrl: string,
    presentationId: string,
    includeWindowId: boolean,
  ): string {
    const surface = _extensionWebviewSurface(sc);
    if (_normStr(surface.dto) !== "ExtensionWebviewSurface") return rawUrl;
    const clientInstanceId = _normStr(getClientId());
    const normalizedPresentationId = _normStr(presentationId);
    if (!clientInstanceId || !normalizedPresentationId) {
      throw new Error("Extension webview presentation identity is incomplete");
    }
    const parsed = new URL(rawUrl, window.location.href);
    parsed.searchParams.set("clientInstanceId", clientInstanceId);
    parsed.searchParams.set("presentationId", normalizedPresentationId);
    const windowId = includeWindowId ? _normStr(getWindowId()) : "";
    if (windowId) parsed.searchParams.set("windowId", windowId);
    else parsed.searchParams.delete("windowId");
    return parsed.href;
  }

  function _presentationModeForHost(hostId: string) {
    return _presentationState.presentations[hostId] || "embedded";
  }

  function _isDetachedShortcut(sc: SidebarShortcut): boolean {
    const hostId = _normStr(sc.host_id);
    return !!(
      hostId &&
      _electronSurfaceBridge() &&
      _presentationModeForHost(hostId) === "detached"
    );
  }

  function _detachedSurfaceDescriptor(
    sc: SidebarShortcut,
    url: string,
    presentationId: string,
  ): ElectronSidebarSurfaceDescriptor {
    const hostId = _normStr(sc.host_id);
    const slot = _findAppDockSlot(hostId);
    const surface = asRecord(sc.run_profile_surface || sc.runProfileSurface);
    const readiness = asRecord(slot?.readiness);
    const runtime = runProfileRuntimeMetadata(sc);
    return {
      version: 1,
      hostId,
      surfaceId: _surfaceIdForShortcut(sc),
      presentationId,
      label: _normStr(sc.label) || _normStr(sc.app_id) || "Sidebar surface",
      url: new URL(url, window.location.href).href,
      windowName: devToolsTargetWindowName(sc),
      appId: _normStr(sc.app_id),
      projectPath: _normStr(surface.projectPath),
      profileId: _normStr(surface.profileId),
      shellId: _normStr(surface.shellId),
      devRuntime: runtime?.devRuntime === true,
      devTools: runtime?.devTools === true,
      consoleWorkerId: _normStr(
        slot?.console_worker_id ||
          slot?.consoleWorkerId ||
          readiness.console_worker_id ||
          readiness.consoleWorkerId,
      ),
    };
  }

  async function _ensureDetachedShortcut(
    sc: SidebarShortcut,
    focus: boolean,
  ): Promise<boolean> {
    const bridge = _electronSurfaceBridge();
    const hostId = _normStr(sc.host_id);
    if (!bridge || !hostId) return false;
    const existing = _detachPromises.get(hostId);
    if (existing) {
      const ready = await existing;
      if (ready && focus) {
        await bridge.focusSidebarSurface(
          _surfaceIdForShortcut(sc),
          _detachedPresentationIds.get(hostId),
        );
      }
      return ready;
    }
    const pending = (async () => {
      if (
        sc.kind === SHORTCUT_KIND_FRAMEWORK_APP &&
        !(await _ensureFrameworkAppRunning(sc.app_id))
      ) {
        return false;
      }
      const entry = _iframeMap.get(sc.key) || null;
      const fallbackUrl = _shortcutFrameUrl(sc, entry);
      if (!fallbackUrl) return false;
      const presentationId =
        _detachedPresentationIds.get(hostId) ||
        _newDetachedPresentationId(hostId);
      const runtime = runProfileRuntimeMetadata(sc);
      const loadUrl = await prepareRunTargetUrl(
        sc.run_target_route || sc.runTargetRoute,
        _extensionWebviewPresentationUrl(
          sc,
          fallbackUrl,
          presentationId,
          false,
        ),
        runtime,
      );
      const result = await bridge.detachSidebarSurface(
        _detachedSurfaceDescriptor(sc, loadUrl, presentationId),
        { focus },
      );
      if (result.ok !== true || result.presentationId !== presentationId) {
        throw new Error("Electron detached surface returned a stale presentation");
      }
      _detachedPresentationIds.set(hostId, presentationId);
      _commitPresentationState(
        setSidebarPresentationMode(_presentationState, hostId, "detached"),
      );
      _publishPresentationIdentity(hostId, presentationId);
      _bindAgentPresentationIfCurrent(hostId, presentationId);
      if (entry) {
        try {
          entry.iframe.remove();
        } catch (_) {}
        _iframeMap.delete(sc.key);
      }
      return true;
    })()
      .catch((error: unknown) => {
        toast(errorMessage(error, "Failed to detach Sidebar surface"));
        return false;
      })
      .finally(() => {
        _detachPromises.delete(hostId);
      });
    _detachPromises.set(hostId, pending);
    return pending;
  }

  function _reattachDetachedShortcut(event: ElectronSidebarSurfaceEvent): void {
    const currentPresentationId = _detachedPresentationIds.get(event.hostId);
    if (!currentPresentationId || currentPresentationId !== event.presentationId) {
      return;
    }
    _detachedPresentationIds.delete(event.hostId);
    if (_presentationModeForHost(event.hostId) === "hidden") {
      _publishPresentationIdentity(event.hostId, "");
      return;
    }
    _commitPresentationState(
      setSidebarPresentationMode(_presentationState, event.hostId, "embedded"),
    );
    const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
    const ensured = _ensureActiveSelection(_latestUiPrefs || {}, normalized);
    void _syncIframesAndActivate(
      _latestUiPrefs || {},
      normalized,
      ensured.active,
    );
  }

  function _refreshAfterPresentationChange(): void {
    const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
    const ensured = _ensureActiveSelection(_latestUiPrefs || {}, normalized);
    _applyHeaderLabelAndIcon(_latestUiPrefs || {}, normalized, ensured.active);
    _renderHeaderIconGrid(_latestUiPrefs || {}, normalized, ensured.active);
    void _syncIframesAndActivate(
      _latestUiPrefs || {},
      normalized,
      ensured.active,
    );
  }

  function _hideExtensionWebview(sc: SidebarShortcut): void {
    const hostId = _normStr(sc.host_id);
    if (!hostId) return;
    let next = setSidebarPresentationMode(_presentationState, hostId, "hidden");
    if (next.foregroundHostId === hostId) {
      next = clearSidebarPresentationForeground(next);
    }
    _commitPresentationState(next);
    _publishPresentationIdentity(hostId, "");
    const entry = _iframeMap.get(sc.key);
    if (entry) {
      entry.iframe.remove();
      _iframeMap.delete(sc.key);
    }
    const presentationId = _detachedPresentationIds.get(hostId);
    _detachedPresentationIds.delete(hostId);
    const bridge = _electronSurfaceBridge();
    if (presentationId && bridge) {
      void bridge.closeSidebarSurface(_surfaceIdForShortcut(sc), presentationId);
    }
    _clientActiveWindowHostId = "";
    _refreshAfterPresentationChange();
  }

  function _handleElectronSurfaceEvent(event: ElectronSidebarSurfaceEvent): void {
    if (!event || typeof event !== "object") return;
    if (event.type === "closed") {
      _reattachDetachedShortcut(event);
      return;
    }
    if (event.type !== "action") return;
    if (event.action === "console") {
      document.getElementById("mi-toggle-console")?.click();
      return;
    }
    if (event.action !== "stop") return;
    const slot = _findAppDockSlot(event.hostId);
    const surface = asRecord(slot?.run_profile_surface || slot?.runProfileSurface);
    const projectPath = _normStr(surface.projectPath);
    const profileId = _normStr(surface.profileId);
    if (!projectPath || !profileId) return;
    _requestSidebarControl(UI_IPC_RPC_METHODS.hostRunProfileStop, {
      projectPath,
      profileId,
      shellId: _normStr(surface.shellId),
      source: "electron_detached_surface",
    });
  }

  function _reconcileElectronDetachedSurfaces(
    slots: SidebarAppDockSlot[],
  ): void {
    const bridge = _electronSurfaceBridge();
    if (!bridge || !_presentationStateLoaded) return;
    const liveHostIds = new Set(slots.map((slot) => _windowHostId(slot)));
    for (const hostId of [..._detachedPresentationIds.keys()]) {
      if (!liveHostIds.has(hostId)) _detachedPresentationIds.delete(hostId);
    }
    const surfaceIds = slots
      .map((slot) => _appDockSlotToEntry(slot))
      .filter((sc): sc is SidebarShortcut => !!sc)
      .filter(
        (sc) =>
          _presentationModeForHost(_normStr(sc.host_id)) === "detached",
      )
      .map((sc) => _surfaceIdForShortcut(sc));
    void bridge.reconcileSidebarSurfaces(surfaceIds).catch((error: unknown) => {
      console.warn("[Sidebar] detached surface reconcile failed", error);
    });
  }

  function _presentationIdForHost(hostId: string): string {
    return (
      _detachedPresentationIds.get(hostId) ||
      _iframeMap.get(`dock:${hostId}`)?.presentationId ||
      ""
    );
  }

  function _publishPresentationIdentity(
    hostId: string,
    presentationId: string,
  ): void {
    if (!hostId || !emitSidebarRpcRequest) return;
    emitSidebarRpcRequest(
      SIDEBAR_IPC_RPC_METHODS.windowPresentationUpdate,
      {
        hostId,
        host_id: hostId,
        presentationId,
        presentation_id: presentationId,
        source: "sidebar_presentation",
      },
    );
  }

  function publishPresentationIdentities(): void {
    _iframeMap.forEach((entry, key) => {
      if (!key.startsWith("dock:")) return;
      _publishPresentationIdentity(key.slice("dock:".length), entry.presentationId);
    });
    _detachedPresentationIds.forEach((presentationId, hostId) => {
      _publishPresentationIdentity(hostId, presentationId);
    });
  }

  function getMentionTarget() {
    if (!_presentationStateLoaded) return null;
    const agentHostIds = _appDockSlots
      .filter((slot) => _slotIsAgent(slot))
      .map((slot) => _windowHostId(slot))
      .filter(Boolean);
    const presentationIds = Object.fromEntries(
      agentHostIds.map((hostId) => [hostId, _presentationIdForHost(hostId)]),
    );
    const target = resolveSidebarMentionTarget(
      _presentationState,
      getClientId(),
      agentHostIds,
      presentationIds,
    );
    if (
      target &&
      (_presentationState.lastAgentHostId !== target.hostId ||
        _presentationState.lastAgentPresentationId !== target.presentationId)
    ) {
      _commitPresentationState(
        activateSidebarPresentation(_presentationState, target.hostId, {
          agent: true,
          presentationId: target.presentationId,
        }),
      );
    }
    return target;
  }

  function _bindAgentPresentationIfCurrent(
    hostId: string,
    presentationId: string,
  ) {
    if (!_presentationStateLoaded || !_slotIsAgent(_findAppDockSlot(hostId))) {
      return;
    }
    _commitPresentationState(
      bindSidebarAgentPresentation(
        _presentationState,
        hostId,
        presentationId,
      ),
    );
  }

  function _sortAppDockSlotsByPresentationOrder(
    slots: SidebarAppDockSlot[],
  ): SidebarAppDockSlot[] {
    const byHostId = new Map(
      slots
        .map((slot) => [_windowHostId(slot), slot] as const)
        .filter(([hostId]) => !!hostId),
    );
    return _presentationState.order
      .map((hostId) => byHostId.get(hostId) || null)
      .filter((slot): slot is SidebarAppDockSlot => !!slot);
  }

  function _reconcilePresentationWithDockSlots(
    slots: SidebarAppDockSlot[],
    options: { notifyFallback?: boolean } = {},
  ): SidebarAppDockSlot[] {
    if (!_presentationStateLoaded) {
      return slots.slice().sort((left, right) =>
        _windowHostId(left).localeCompare(_windowHostId(right)),
      );
    }
    const previousForeground = _presentationState.foregroundHostId;
    const nextHostIds = new Set(
      slots.map((slot) => _windowHostId(slot)).filter(Boolean),
    );
    for (const previousSlot of _appDockSlots) {
      const previousHostId = _windowHostId(previousSlot);
      if (!previousHostId || nextHostIds.has(previousHostId)) continue;
      const previousShortcut = _appDockSlotToEntry(previousSlot);
      if (previousShortcut) {
        _releaseRunProfileSurface(_runProfileSurfaceId(previousShortcut));
      }
      _detachedPresentationIds.delete(previousHostId);
    }
    const next = reconcileSidebarPresentationState(
      _presentationState,
      slots.map((slot) => _windowHostId(slot)).filter(Boolean),
    );
    _commitPresentationState(next);
    const ordered = _sortAppDockSlotsByPresentationOrder(slots);
    _reconcileElectronDetachedSurfaces(ordered);
    if (
      options.notifyFallback !== false &&
      previousForeground &&
      previousForeground !== next.foregroundHostId &&
      next.foregroundHostId
    ) {
      _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowActivate, {
        hostId: next.foregroundHostId,
        host_id: next.foregroundHostId,
        source: "sidebar_ledger_fallback",
      });
    }
    return ordered;
  }

  async function _ensurePresentationStateLoaded(): Promise<void> {
    if (_presentationStateLoaded) return;
    if (_presentationStateLoadPromise) return _presentationStateLoadPromise;
    _presentationStateLoadPromise = (async () => {
      try {
        _presentationState = await loadSidebarPresentationState();
      } catch (error) {
        console.warn("[Sidebar] presentation state load failed", error);
        _presentationState = emptySidebarPresentationState();
      }
      _presentationStateLoaded = true;
      _appDockSlots = _reconcilePresentationWithDockSlots(_appDockSlots, {
        notifyFallback: false,
      });
      _clientActiveWindowHostId = _presentationState.foregroundHostId;
      _presentationStateLoadPromise = null;
    })();
    return _presentationStateLoadPromise;
  }

  function _setClientActiveShortcut(
    shortcutId: unknown,
    options: UnknownRecord = {},
  ) {
    const nextId = _normStr(shortcutId);
    const activeWindow = _findAppDockSlot(nextId);
    if (activeWindow) {
      const hostId = _windowHostId(activeWindow);
      const prevWindowId = _clientActiveWindowHostId;
      if (_presentationStateLoaded) {
        const currentMode = _presentationModeForHost(hostId);
        const visibleState = setSidebarPresentationMode(
          _presentationState,
          hostId,
          currentMode === "hidden" ? "embedded" : currentMode,
        );
        _commitPresentationState(
          activateSidebarPresentation(visibleState, hostId, {
            agent: _slotIsAgent(activeWindow),
            presentationId: _presentationIdForHost(hostId),
          }),
        );
      } else {
        _clientActiveWindowHostId = hostId;
      }
      const activeDockShortcut = _appDockSlotToEntry(activeWindow);
      if (
        activeDockShortcut &&
        _presentationModeForHost(hostId) === "detached"
      ) {
        void _ensureDetachedShortcut(activeDockShortcut, true);
      }
      _clientActiveShortcutId = "";
      if (options.emit && hostId && hostId !== prevWindowId) {
        _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowActivate, {
          hostId,
          host_id: hostId,
          source: options.source || "sidebar_shortcuts",
        });
      }
      if (!_hydrated) return;
      const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
      const ensured = _ensureActiveSelection(_latestUiPrefs || {}, normalized);
      _applyHeaderLabelAndIcon(
        _latestUiPrefs || {},
        normalized,
        ensured.active,
      );
      _renderHeaderIconGrid(_latestUiPrefs || {}, normalized, ensured.active);
      void _syncIframesAndActivate(
        _latestUiPrefs || {},
        normalized,
        ensured.active,
      );
      return;
    }

    const prevId = _clientActiveShortcutId;
    _clientActiveShortcutId = nextId;
    if (nextId) {
      _clientActiveWindowHostId = "";
      if (_presentationStateLoaded) {
        _commitPresentationState(
          clearSidebarPresentationForeground(_presentationState),
        );
      }
    }

    if (options.updateLastUsed && nextId) {
      _maybeUpdateShortcutLastUsed(nextId);
    }

    if (options.emit && nextId !== prevId) {
      _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarActiveShortcutSet, {
        shortcutId: nextId,
        source: options.source || "sidebar_shortcuts",
      });
    }

    if (!_hydrated) return;

    const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
    const ensured = _ensureActiveSelection(_latestUiPrefs || {}, normalized);
    _applyHeaderLabelAndIcon(_latestUiPrefs || {}, normalized, ensured.active);
    _renderHeaderIconGrid(_latestUiPrefs || {}, normalized, ensured.active);
    void _syncIframesAndActivate(
      _latestUiPrefs || {},
      normalized,
      ensured.active,
    );

    try {
      const dd = document.getElementById("fe-agent-dd");
      if (dd && dd.classList.contains("show")) _renderAgentDropdown();
    } catch (_) {}
  }

  function _openRefreshMenu(anchorEl: HTMLElement | null) {
    if (!sidebarRefreshMenuEl || !anchorEl) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _closeAgentDropdown();
    _closeHeaderIconMenu();
    _closeRefreshMenu();

    const uiPrefs = _latestUiPrefs || {};
    const active = _resolveActive(uiPrefs, _collectVisibleShortcuts(uiPrefs));
    const menu = sidebarRefreshMenuEl;
    const flush = document.createElement("div");
    flush.className = "fe-dd-item";
    flush.textContent = "Flush active item cache";
    flush.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _closeRefreshMenu();
      void _refreshActiveShortcut({ flushCache: true });
    });
    menu.appendChild(flush);

    if (
      active &&
      active.kind === SHORTCUT_KIND_FRAMEWORK_APP &&
      _normStr(active.app_id)
    ) {
      const restart = document.createElement("div");
      restart.className = "fe-dd-item";
      restart.textContent = "Restart app";
      restart.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _closeRefreshMenu();
        void _restartActiveFrameworkShortcut();
      });
      menu.appendChild(restart);
    }

    menu.classList.add("show");
  }

  function _findRawShortcutIndex(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ) {
    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
      ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS]
      : [];
    const key = _normStr(sc?.key);
    const id = _normStr(sc?.id);
    const url = _normStr(sc?.url);
    return raw.findIndex((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const entryId = _normStr(entry.id);
      const entryUrl = _normStr(entry.url);
      if (key && (entryId === key || entryUrl === key)) return true;
      if (id && entryId === id) return true;
      if (url && entryUrl === url) return true;
      return false;
    });
  }

  function _persistHeaderOrder(orderedKeys: unknown) {
    const order = Array.isArray(orderedKeys)
      ? orderedKeys.map((key) => _normStr(key)).filter((key) => !!key)
      : [];
    if (!order.length) return;

    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
      ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS]
      : [];
    if (!raw.length) return;

    const records: Array<{ key: string; entry: SidebarShortcutPreference }> =
      [];
    const byKey = new Map<
      string,
      { key: string; entry: SidebarShortcutPreference }
    >();
    raw.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const key = _normStr(entry.id) || _normStr(entry.url);
      if (!key) return;
      const record = { key, entry };
      records.push(record);
      if (!byKey.has(key)) byKey.set(key, record);
    });
    if (records.length < 2) return;

    const reordered: Array<{ key: string; entry: SidebarShortcutPreference }> =
      [];
    const seen = new Set<string>();
    order.forEach((key) => {
      if (seen.has(key)) return;
      const record = byKey.get(key);
      if (!record) return;
      reordered.push(record);
      seen.add(key);
    });
    records.forEach((record) => {
      if (seen.has(record.key)) return;
      reordered.push(record);
      seen.add(record.key);
    });
    if (reordered.length !== records.length) return;

    let changed = false;
    for (let i = 0; i < records.length; i += 1) {
      if (records[i].key !== reordered[i].key) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const next = reordered.map((record) => record.entry);
    _persistShortcuts(next);
  }

  function _persistDockOrder(orderedKeys: unknown): boolean {
    const hostIds: string[] = [];
    if (Array.isArray(orderedKeys)) {
      for (const key of orderedKeys) {
        const slot = _findAppDockSlot(key);
        if (!slot) return false;
        const hostId = _windowHostId(slot);
        if (hostId) hostIds.push(hostId);
      }
    }
    if (!hostIds.length) return false;
    if (!_presentationStateLoaded) return false;
    const next = reorderSidebarPresentationState(_presentationState, hostIds);
    if (!_commitPresentationState(next)) return true;
    _appDockSlots = _sortAppDockSlotsByPresentationOrder(_appDockSlots);
    _applyUiPrefsHydrated();
    return true;
  }

  function _removeShortcut(
    sc: SidebarShortcut | SidebarShortcutPreference | null,
    options: UnknownRecord = {},
  ) {
    const raw = Array.isArray(_latestUiPrefs?.[UI_PREF_KEY_SHORTCUTS])
      ? _latestUiPrefs[UI_PREF_KEY_SHORTCUTS]
      : [];
    const idx = _findRawShortcutIndex(sc);
    if (idx < 0) return;
    const next = raw.slice();
    next.splice(idx, 1);
    _persistShortcuts(next, options);
  }

  async function _quitFrameworkApp(appId: unknown) {
    const id = _normStr(appId);
    if (!id) return false;
    try {
      const { resp, body } = await _fetchJson<UnknownRecord>(
        `/api/apps/${encodeURIComponent(id)}/quit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!resp?.ok || !body?.ok) {
        const detail =
          body?.detail || body?.error || `Failed to stop app ${id}`;
        if (resp?.status === 404) {
          toast(`${id} is not running`);
        } else {
          throw new Error(String(detail));
        }
      } else {
        toast(`Stopped ${id}`);
      }
      if (!(_runningCache instanceof Set)) _runningCache = new Set();
      _runningCache.delete(id);
      _runningCachePrimed = true;
      _invalidateFrameworkShortcutIframes(id);
      _refreshShortcutChrome();
      return true;
    } catch (e) {
      toast(errorMessage(e, `Failed to stop app ${id}`));
      return false;
    }
  }

  async function _restartFrameworkApp(appId: unknown) {
    const id = _normStr(appId);
    if (!id) return false;
    try {
      _startingApps.delete(id);
      const stop = await _fetchJson<UnknownRecord>(
        `/api/apps/${encodeURIComponent(id)}/quit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!stop.resp.ok || !stop.body?.ok) {
        const detail =
          stop.body?.detail || stop.body?.error || `Failed to stop app ${id}`;
        if (stop.resp.status !== 404) throw new Error(String(detail));
      }
      _applyRunningDelta(id, false);

      const start = await _fetchJson<UnknownRecord>(
        `/api/apps/${encodeURIComponent(id)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!start.resp.ok || !start.body?.ok) {
        const detail =
          start.body?.detail ||
          start.body?.error ||
          `Failed to start app ${id}`;
        throw new Error(String(detail));
      }
      _applyRunningDelta(id, true);
      toast(`Restarted ${id}`);
      return true;
    } catch (e) {
      toast(errorMessage(e, `Failed to restart app ${id}`));
      return false;
    }
  }

  function _openHeaderIconMenu(
    anchorEl: HTMLElement | null,
    sc: SidebarShortcut | SidebarShortcutPreference | null,
  ) {
    if (!sidebarHeaderIconMenuEl || !anchorEl || !sc) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _closeAgentDropdown();
    _closeRefreshMenu();
    _closeHeaderIconMenu();

    const menu = sidebarHeaderIconMenuEl;
    const label =
      _normStr(sc?.label) ||
      _normStr(sc?.app_id) ||
      _normStr(sc?.url) ||
      "Sidebar entry";

    const title = document.createElement("div");
    title.className = "fe-dd-item";
    title.style.opacity = "0.72";
    title.style.cursor = "default";
    title.textContent = label;
    title.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    menu.appendChild(title);

    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.className = "fe-dd-separator";
      sep.style.margin = "4px 0";
      menu.appendChild(sep);
    };

    const appId = _normStr(
      sc?.kind === SHORTCUT_KIND_FRAMEWORK_APP ? sc?.app_id : "",
    );
    const dockHostId = _isAppDockEntry(sc)
      ? _normStr((sc as SidebarShortcut).host_id)
      : "";
    const isUrlSlot = _isUrlSlotEntry(sc);
    const runProfileSurface = asRecord(
      (sc as SidebarShortcut).run_profile_surface ||
        (sc as SidebarShortcut).runProfileSurface,
    );
    const extensionSurface = _extensionWebviewSurface(sc);
    const extensionSurfaceKind = _normStr(extensionSurface.surfaceKind) || "view";
    const presentationHostId = _normStr((sc as SidebarShortcut).host_id);
    const electronBridge = _electronSurfaceBridge();
    if (presentationHostId && electronBridge) {
      addSeparator();
      const surfaceAction = document.createElement("div");
      surfaceAction.className = "fe-dd-item";
      const isDetached =
        _presentationModeForHost(presentationHostId) === "detached";
      surfaceAction.textContent = isDetached ? "Attach" : "Detach";
      surfaceAction.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        if (!isDetached) {
          void _ensureDetachedShortcut(sc as SidebarShortcut, true).then(() => {
            const normalized = _collectVisibleShortcuts(_latestUiPrefs || {});
            const ensured = _ensureActiveSelection(
              _latestUiPrefs || {},
              normalized,
            );
            void _syncIframesAndActivate(
              _latestUiPrefs || {},
              normalized,
              ensured.active,
            );
          });
          return;
        }
        const presentationId =
          _detachedPresentationIds.get(presentationHostId) || "";
        void electronBridge
          .closeSidebarSurface(
            _surfaceIdForShortcut(sc as SidebarShortcut),
            presentationId,
          )
          .then(() => {
            _reattachDetachedShortcut({
              type: "closed",
              hostId: presentationHostId,
              surfaceId: _surfaceIdForShortcut(sc as SidebarShortcut),
              presentationId,
            });
          });
      });
      menu.appendChild(surfaceAction);
    }
    if (appId) {
      addSeparator();
      const kill = document.createElement("div");
      kill.className = "fe-dd-item";
      kill.textContent = "Kill app";
      kill.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        await _quitFrameworkApp(appId);
      });
      menu.appendChild(kill);
    }

    addSeparator();
    if (isUrlSlot && _isExtensionWebviewEntry(sc)) {
      const extensionAction = document.createElement("div");
      extensionAction.className = "fe-dd-item";
      extensionAction.textContent = extensionSurfaceKind === "panel"
        ? "Close extension panel"
        : "Hide extension view";
      extensionAction.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        if (extensionSurfaceKind === "panel") {
          _requestSidebarControl(
            UI_IPC_RPC_METHODS.hostExtensionWebviewDispose,
            {
              surfaceId: _normStr(extensionSurface.surfaceId),
              source: "header_icon_menu",
            },
          );
        } else {
          _hideExtensionWebview(sc as SidebarShortcut);
        }
      });
      menu.appendChild(extensionAction);
    } else if (isUrlSlot) {
      const urlHostId = _normStr((sc as SidebarShortcut).host_id);
      const runProfileId = _normStr(runProfileSurface.profileId);
      const runProfileProject = _normStr(runProfileSurface.projectPath);
      const runProfileShellId = _normStr(runProfileSurface.shellId);
      if (runProfileId && runProfileProject) {
        const stopProfile = document.createElement("div");
        stopProfile.className = "fe-dd-item";
        stopProfile.textContent = `Stop ${runProfileId}`;
        stopProfile.addEventListener("click", (ev) => {
          ev.stopPropagation();
          _closeHeaderIconMenu();
          _requestSidebarControl(UI_IPC_RPC_METHODS.hostRunProfileStop, {
            projectPath: runProfileProject,
            profileId: runProfileId,
            shellId: runProfileShellId,
            source: "sidebar_run_profile_surface",
          });
        });
        menu.appendChild(stopProfile);
      }
      const changeUrl = document.createElement("div");
      changeUrl.className = "fe-dd-item";
      changeUrl.textContent = "Change URL";
      changeUrl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        _openUrlDialog(sc);
      });
      menu.appendChild(changeUrl);

      const closeUrlSlot = document.createElement("div");
      closeUrlSlot.className = "fe-dd-item";
      closeUrlSlot.textContent = "Close URL slot";
      closeUrlSlot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        if (urlHostId) {
          _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowClose, {
            hostId: urlHostId,
            host_id: urlHostId,
            source: "header_icon_menu",
          });
        } else {
          _removeShortcut(sc, { activateDefault: false });
        }
      });
      menu.appendChild(closeUrlSlot);
    } else if (dockHostId) {
      const closeWindow = document.createElement("div");
      closeWindow.className = "fe-dd-item";
      closeWindow.textContent = "Close dock slot";
      closeWindow.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowClose, {
          hostId: dockHostId,
          host_id: dockHostId,
          source: "header_icon_menu",
        });
      });
      menu.appendChild(closeWindow);
    } else {
      const remove = document.createElement("div");
      remove.className = "fe-dd-item";
      remove.textContent = "Remove entry";
      remove.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        _removeShortcut(sc);
      });
      menu.appendChild(remove);
    }

    const parent = menu.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const baseLeft = Math.max(0, Math.round(anchorRect.left - parentRect.left));
    const baseTop = Math.max(
      0,
      Math.round(anchorRect.bottom - parentRect.top + 4),
    );
    menu.style.left = `${baseLeft}px`;
    menu.style.top = `${baseTop}px`;
    menu.dataset.shortcutKey = _normStr(sc?.key);
    _headerIconMenuKey = _normStr(sc?.key);
    menu.classList.add("show");

    requestAnimationFrame(() => {
      if (!menu.classList.contains("show")) return;
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

  async function _openLauncherMenu(anchorEl: HTMLElement | null) {
    if (!sidebarHeaderIconMenuEl || !anchorEl) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _closeAgentDropdown();
    _closeRefreshMenu();
    _closeHeaderIconMenu();

    const menu = sidebarHeaderIconMenuEl;
    const title = document.createElement("div");
    title.className = "fe-dd-item";
    title.style.opacity = "0.72";
    title.style.cursor = "default";
    title.textContent = "App drawer";
    menu.appendChild(title);

    const loading = document.createElement("div");
    loading.className = "fe-dd-item";
    loading.style.opacity = "0.7";
    loading.textContent = "Loading apps…";
    menu.appendChild(loading);

    const parent = menu.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const baseLeft = Math.max(0, Math.round(anchorRect.left - parentRect.left));
    const baseTop = Math.max(
      0,
      Math.round(anchorRect.bottom - parentRect.top + 4),
    );
    menu.style.left = `${baseLeft}px`;
    menu.style.top = `${baseTop}px`;
    menu.dataset.shortcutKey = "__launcher__";
    _headerIconMenuKey = "__launcher__";
    menu.classList.add("show");

    let apps: FrameworkAppManifest[] = [];
    try {
      apps = await _ensureAppsCache(true);
    } catch (e) {
      loading.textContent = errorMessage(e, "Failed to load apps");
      return;
    }
    if (
      !menu.classList.contains("show") ||
      _headerIconMenuKey !== "__launcher__"
    )
      return;
    loading.remove();

    const launcherApps = apps
      .filter((app) => {
        const id = _normStr(app?.id);
        return !!id && id !== SIDEBAR_SELF_APP_ID;
      })
      .sort((a, b) => {
        const an = _normStr(a?.name) || _normStr(a?.id);
        const bn = _normStr(b?.name) || _normStr(b?.id);
        return an.localeCompare(bn, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      });

    if (!launcherApps.length) {
      const empty = document.createElement("div");
      empty.className = "fe-dd-item";
      empty.style.opacity = "0.7";
      empty.textContent = "No launcher apps";
      menu.appendChild(empty);
    }

    launcherApps.forEach((app) => {
      const id = _normStr(app.id);
      if (!id) return;
      const item = document.createElement("div");
      item.className = "fe-dd-item";
      item.style.display = "flex";
      item.style.gap = "8px";
      item.style.alignItems = "center";
      item.style.justifyContent = "space-between";
      const icon = _manifestIconForApp(id);
      const node = _renderIconNode(icon, 16, _firstGrapheme(app.name || id));
      const labelWrap = document.createElement("span");
      labelWrap.style.display = "inline-flex";
      labelWrap.style.alignItems = "center";
      labelWrap.style.gap = "8px";
      if (node) labelWrap.appendChild(node);
      const text = document.createElement("span");
      text.textContent = _normStr(app.name) || id;
      labelWrap.appendChild(text);
      item.appendChild(labelWrap);
      const badge = document.createElement("span");
      badge.style.fontSize = "0.72rem";
      badge.style.opacity = "0.62";
      badge.textContent = _appManifestIsStateful(app) ? "state" : "base";
      item.appendChild(badge);
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _closeHeaderIconMenu();
        _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowCreate, {
          appId: id,
          app_id: id,
          source: "sidebar_launcher",
          activate: true,
        });
      });
      menu.appendChild(item);
    });

    const extensionViews = _collectAppDockEntries()
      .filter((shortcut) => _isExtensionWebviewEntry(shortcut))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
        numeric: true,
      }));
    if (extensionViews.length) {
      const extensionSeparator = document.createElement("div");
      extensionSeparator.className = "fe-dd-separator";
      extensionSeparator.style.margin = "4px 0";
      menu.appendChild(extensionSeparator);

      const extensionTitle = document.createElement("div");
      extensionTitle.className = "fe-dd-item";
      extensionTitle.style.opacity = "0.72";
      extensionTitle.style.cursor = "default";
      extensionTitle.textContent = "Extension views";
      menu.appendChild(extensionTitle);

      extensionViews.forEach((shortcut) => {
        const hostId = _normStr(shortcut.host_id);
        if (!hostId) return;
        const item = document.createElement("div");
        item.className = "fe-dd-item";
        item.style.display = "flex";
        item.style.gap = "8px";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        const labelWrap = document.createElement("span");
        labelWrap.style.display = "inline-flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
        const icon = _renderIconNode(
          _effectiveShortcutIcon(shortcut),
          16,
          _firstGrapheme(shortcut.label),
        );
        if (icon) labelWrap.appendChild(icon);
        const text = document.createElement("span");
        text.textContent = shortcut.label;
        labelWrap.appendChild(text);
        item.appendChild(labelWrap);
        const badge = document.createElement("span");
        badge.style.fontSize = "0.72rem";
        badge.style.opacity = "0.62";
        badge.textContent = _presentationModeForHost(hostId) === "hidden"
          ? "hidden"
          : "open";
        item.appendChild(badge);
        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          _closeHeaderIconMenu();
          _setClientActiveShortcut(hostId, {
            emit: true,
            source: "extension_app_drawer",
          });
        });
        menu.appendChild(item);
      });
    }

    const sep = document.createElement("div");
    sep.className = "fe-dd-separator";
    sep.style.margin = "4px 0";
    menu.appendChild(sep);

    const addUrl = document.createElement("div");
    addUrl.className = "fe-dd-item";
    addUrl.textContent = "URL";
    addUrl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _closeHeaderIconMenu();
      _openUrlDialog({ kind: SHORTCUT_KIND_URL, load: SHORTCUT_LOAD_LAZY });
    });
    menu.appendChild(addUrl);
  }

  function _renderHeaderIconGrid(
    uiPrefs: UnknownRecord,
    shortcuts: SidebarShortcut[] | null,
    active: SidebarShortcut | null,
  ) {
    const gridEl = sidebarHeaderIconGridEl;
    if (!gridEl) return;

    const resolvedShortcuts = Array.isArray(shortcuts)
      ? shortcuts
      : _collectVisibleShortcuts(uiPrefs);
    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const activeKey = resolvedActive?.key || "";
    const headerItems = _collectHeaderItems(resolvedShortcuts).filter(
      (sc) => _isAppDockEntry(sc) || _isUrlSlotEntry(sc),
    );
    const runningSet = _runningCache instanceof Set ? _runningCache : new Set();
    const isMobileLayout = !!document.querySelector(".fe-root.layout-mobile");
    const dockDebugNumbers = _dockDebugNumbersEnabled();

    gridEl.innerHTML = "";
    gridEl.style.display = "flex";

    let headerDragState: HeaderDragState | null = null;
    let dropBeforeCell: HTMLElement | null = null;
    let dropAfterCell: HTMLElement | null = null;
    let dropInsertionIndex = -1;
    const renderedHeaderItems: SidebarShortcut[] = [];

    const clearDropMarkers = () => {
      if (dropBeforeCell) {
        dropBeforeCell.style.boxShadow = "";
        dropBeforeCell = null;
      }
      if (dropAfterCell) {
        dropAfterCell.style.borderInlineEnd = "";
        dropAfterCell = null;
      }
    };

    const getCells = () =>
      Array.from(
        gridEl.querySelectorAll<HTMLElement>(".agent-drawer__icon-cell"),
      );

    const computeInsertion = (clientX: number, sourceCell: HTMLElement) => {
      const cells = getCells().filter((cell) => cell !== sourceCell);
      let insertion = cells.length;
      for (let i = 0; i < cells.length; i += 1) {
        const rect = cells[i].getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (clientX <= mid) {
          insertion = i;
          break;
        }
      }
      return { cells, insertion };
    };

    const updateDragTarget = (clientX: number) => {
      if (
        !headerDragState ||
        !headerDragState.dragging ||
        !headerDragState.cell
      )
        return;
      clearDropMarkers();
      const { cells, insertion } = computeInsertion(
        clientX,
        headerDragState.cell,
      );
      dropInsertionIndex = insertion;
      if (insertion < cells.length) {
        const cell = cells[insertion];
        cell.style.boxShadow = "inset 2px 0 0 rgba(120,170,255,0.95)";
        dropBeforeCell = cell;
      } else if (cells.length) {
        const cell = cells[cells.length - 1];
        cell.style.borderInlineEnd = "2px solid rgba(120,170,255,0.95)";
        dropAfterCell = cell;
      }
    };

    const beginDrag = (state: HeaderDragState | null) => {
      if (!state || !state.cell || !state.btn) return;
      state.dragging = true;
      state.cell.classList.add("is-dragging");
      state.cell.style.opacity = "0.72";
      state.cell.style.transform = "scale(0.985)";
      state.btn.style.cursor = "grabbing";
      dropInsertionIndex = state.fromIndex;
    };

    const finishDrag = (commit: boolean) => {
      if (!headerDragState) return;
      const state = headerDragState;
      clearDropMarkers();
      state.cell.classList.remove("is-dragging");
      state.cell.style.opacity = "";
      state.cell.style.transform = "";
      state.btn.style.cursor = "grab";
      if (commit && state.dragging) {
        const moving = renderedHeaderItems[state.fromIndex];
        if (moving) {
          const withoutSource = renderedHeaderItems.filter(
            (_, idx) => idx !== state.fromIndex,
          );
          const insertion = Number.isInteger(dropInsertionIndex)
            ? dropInsertionIndex
            : state.fromIndex;
          const bounded = Math.max(
            0,
            Math.min(withoutSource.length, insertion),
          );
          const next = withoutSource.slice();
          next.splice(bounded, 0, moving);
          const nextKeys = next
            .map((item) => _normStr(item?.key))
            .filter((key) => !!key);
          if (!_persistDockOrder(nextKeys)) _persistHeaderOrder(nextKeys);
        }
      }
      headerDragState = null;
      dropInsertionIndex = -1;
    };

    if (isMobileLayout) {
      const cell = document.createElement("div");
      cell.className =
        "agent-drawer__icon-cell agent-drawer__icon-cell--explorer";

      const btn = document.createElement("button");
      btn.className = "agent-drawer__icon-btn";
      btn.title = "Open Explorer";
      btn.setAttribute("aria-label", "Open Explorer");
      btn.textContent = "☰";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeHeaderIconMenu();
        try {
          if (closeAllMenus) closeAllMenus();
        } catch (_) {}
        const explorerBtn = document.getElementById("fe-drawer-open");
        if (explorerBtn && typeof explorerBtn.click === "function") {
          explorerBtn.click();
          return;
        }
        const root = document.querySelector(".fe-root");
        if (root) root.classList.add("drawer-open");
      });

      const dot = document.createElement("span");
      dot.className = "agent-drawer__running-dot is-placeholder";
      dot.setAttribute("aria-hidden", "true");

      cell.appendChild(btn);
      cell.appendChild(dot);
      gridEl.appendChild(cell);
    }

    const launcherCell = document.createElement("div");
    launcherCell.className =
      "agent-drawer__icon-cell agent-drawer__icon-cell--launcher";
    const launcherBtn = document.createElement("button");
    launcherBtn.className = "agent-drawer__icon-btn";
    launcherBtn.title = "Open app drawer";
    launcherBtn.setAttribute("aria-label", "Open app drawer");
    launcherBtn.style.cursor = "pointer";
    if (dockDebugNumbers) {
      launcherBtn.textContent = "0";
    } else {
      const launcherImg = document.createElement("img");
      launcherImg.src = SIDEBAR_LAUNCHER_ICON_SRC;
      launcherImg.alt = "";
      launcherImg.setAttribute("aria-hidden", "true");
      launcherBtn.appendChild(launcherImg);
    }
    launcherBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void _openLauncherMenu(launcherBtn);
    });
    launcherCell.appendChild(launcherBtn);
    const launcherDot = document.createElement("span");
    launcherDot.className = "agent-drawer__running-dot is-placeholder";
    launcherDot.setAttribute("aria-hidden", "true");
    launcherCell.appendChild(launcherDot);
    gridEl.appendChild(launcherCell);

    headerItems.forEach((sc) => {
      const renderedIndex = renderedHeaderItems.length;
      const effectiveIcon = _effectiveShortcutIcon(sc);
      const fallbackText = _firstGrapheme(sc.label);
      const debugText = String(renderedIndex + 1);
      const iconNode = dockDebugNumbers
        ? _renderIconNode({ kind: "text", text: debugText }, null, debugText)
        : _renderIconNode(effectiveIcon, null, fallbackText);
      if (!iconNode || (!iconNode.textContent && !iconNode.childNodes.length))
        return;

      const cell = document.createElement("div");
      cell.className = "agent-drawer__icon-cell";

      const btn = document.createElement("button");
      btn.className = "agent-drawer__icon-btn";
      if (sc.key && sc.key === activeKey) btn.classList.add("is-active");
      btn.title = sc.label || sc.url || "Sidebar entry";
      btn.style.touchAction = "none";
      btn.style.cursor = "grab";
      btn.appendChild(iconNode);

      renderedHeaderItems.push(sc);
      cell.dataset.headerIndex = String(renderedIndex);

      let longPressTimer: ReturnType<typeof setTimeout> | null = null;
      let suppressUntil = 0;
      let pointerId: number | null = null;
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

      btn.addEventListener("click", (ev) => {
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
        _setClientActiveShortcut(targetId, {
          emit: true,
          source: "header_icon",
          updateLastUsed: true,
        });
        if (openDrawer) {
          setTimeout(() => {
            try {
              openDrawer();
            } catch (_) {}
          }, 120);
        }
      });

      btn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openHeaderIconMenu(btn, sc);
      });

      btn.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        if (
          ev.pointerType !== "mouse" &&
          typeof ev.button === "number" &&
          ev.button !== 0
        )
          return;
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
        if (ev.pointerType === "touch") {
          clearLp();
          longPressTimer = setTimeout(() => {
            if (
              !headerDragState ||
              headerDragState.btn !== btn ||
              headerDragState.dragging
            )
              return;
            suppressUntil = Date.now() + 900;
            finishDrag(false);
            _openHeaderIconMenu(btn, sc);
          }, 520);
        }
        try {
          btn.setPointerCapture(ev.pointerId);
        } catch (_) {}
      });

      btn.addEventListener(
        "pointermove",
        (ev) => {
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
        },
        { passive: false },
      );

      const endPointer = (ev: PointerEvent, commit: boolean) => {
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

      btn.addEventListener("pointerup", (ev) => endPointer(ev, true));
      btn.addEventListener("pointercancel", (ev) => endPointer(ev, false));
      btn.addEventListener("lostpointercapture", (ev) => {
        if (ev.pointerId !== pointerId) return;
        clearLp();
        if (headerDragState && headerDragState.btn === btn) finishDrag(false);
        clearPointer();
      });

      const dot = document.createElement("span");
      dot.className = "agent-drawer__running-dot";
      if (sc.key && sc.key === activeKey) dot.classList.add("is-active");
      const appId = _normStr(
        sc.kind === SHORTCUT_KIND_FRAMEWORK_APP ? sc.app_id : "",
      );
      if (_isStatefulDockEntry(sc)) {
        const readinessStatus = _dockReadinessStatus(sc);
        if (readinessStatus === "ready") {
          dot.classList.add("is-up");
        } else if (
          readinessStatus === "error" ||
          readinessStatus === "stopped"
        ) {
          dot.classList.add("is-down");
        } else {
          dot.classList.add("is-starting");
        }
        dot.title = `${sc.label || appId || "App window"}: ${readinessStatus || "starting"}`;
      } else if (appId) {
        const isRunning = runningSet.has(appId);
        dot.classList.add(isRunning ? "is-up" : "is-down");
        dot.title = `${sc.label || appId}: ${isRunning ? "Running" : "Not running"}`;
      } else {
        dot.classList.add("is-placeholder");
        dot.setAttribute("aria-hidden", "true");
      }

      cell.appendChild(btn);
      cell.appendChild(dot);
      gridEl.appendChild(cell);
    });

    if (!renderedHeaderItems.length && !launcherCell.isConnected) {
      gridEl.style.display = "none";
      _closeHeaderIconMenu();
      return;
    }

    const openKey = _normStr(
      _headerIconMenuKey || sidebarHeaderIconMenuEl?.dataset?.shortcutKey,
    );
    if (
      openKey &&
      openKey !== "__launcher__" &&
      !renderedHeaderItems.some((sc) => _normStr(sc?.key) === openKey)
    ) {
      _closeHeaderIconMenu();
    }
  }

  function _setSetupPlaceholderMode(
    mode: string,
    shortcut: SidebarShortcut | SidebarShortcutPreference | null,
  ) {
    if (!sidebarSetupPlaceholder) return;
    const titleEl =
      sidebarSetupTitleEl ||
      sidebarSetupPlaceholder.querySelector(".sidebar-setup__title");
    const hintEl =
      sidebarSetupHintEl ||
      sidebarSetupPlaceholder.querySelector(".sidebar-setup__hint");
    if (!titleEl || !hintEl) return;

    if (mode === "loading") {
      const label =
        _normStr(shortcut?.label) || _normStr(shortcut?.app_id) || "app";
      titleEl.textContent = "Starting sidebar app window...";
      hintEl.textContent = `Starting ${label} as a sidebar app window.`;
      sidebarSetupPlaceholder.dataset.mode = "loading";
      return;
    }

    if (mode === "waiting_ready") {
      const label =
        _normStr(shortcut?.label) || _normStr(shortcut?.app_id) || "app";
      titleEl.textContent = "Waiting for app readiness...";
      hintEl.textContent = `${label} is loaded; waiting for its backend readiness POST.`;
      sidebarSetupPlaceholder.dataset.mode = "waiting_ready";
      return;
    }

    titleEl.textContent = SIDEBAR_SETUP_TITLE_DEFAULT;
    hintEl.textContent = SIDEBAR_SETUP_HINT_DEFAULT;
    sidebarSetupPlaceholder.dataset.mode = "setup";
  }

  function _updateSetupPlaceholder(
    uiPrefs: UnknownRecord,
    hasActiveOverride: boolean | null,
    mode: string = "setup",
    shortcut: SidebarShortcut | null = null,
  ) {
    if (!sidebarSetupPlaceholder || !sidebarIframeStack) return;
    const hasActive =
      typeof hasActiveOverride === "boolean"
        ? hasActiveOverride
        : !!_resolveActive(uiPrefs)?.url;

    if (hasActive) _setSetupPlaceholderMode("setup", null);
    else _setSetupPlaceholderMode(mode, shortcut);

    if (hasActive) {
      sidebarSetupPlaceholder.style.display = "none";
    } else {
      sidebarSetupPlaceholder.style.display = "flex";
    }
    sidebarIframeStack.style.opacity = hasActive ? "1" : "0";
    sidebarIframeStack.style.pointerEvents = hasActive ? "auto" : "none";
    sidebarIframeStack.setAttribute(
      "aria-hidden",
      hasActive ? "false" : "true",
    );
  }

  async function _ensureFrameworkAppRunning(appId: unknown) {
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
        const { resp, body } = await _fetchJson<UnknownRecord>(
          `/api/apps/${encodeURIComponent(id)}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );
        if (!resp.ok || !body?.ok) {
          const detail =
            body?.detail || body?.error || `Failed to start app ${id}`;
          throw new Error(String(detail));
        }
        _applyRunningDelta(id, true);
        return true;
      } catch (e) {
        toast(errorMessage(e, `Failed to start app ${id}`));
        return false;
      } finally {
        _startingApps.delete(id);
      }
    })();
    _startingApps.set(id, startPromise);
    return await startPromise;
  }

  function _configureShortcutIframeElement(
    iframe: HTMLIFrameElement,
    sc: SidebarShortcut,
    initialUrl = "",
  ): string {
    if (!iframe || !sc) return "";
    iframe.className = "sidebar-iframe";
    iframe.setAttribute("data-shortcut-id", sc.key);
    iframe.setAttribute("data-shortcut-load", sc.load);
    iframe.setAttribute(
      "loading",
      sc.load === SHORTCUT_LOAD_EAGER ? "eager" : "lazy",
    );
    return configureDevToolsTargetNavigation(iframe, sc, initialUrl);
  }

  function _runProfileSurfaceId(sc: SidebarShortcut): string {
    const surface = asRecord(sc.run_profile_surface || sc.runProfileSurface);
    return _normStr(surface.surfaceId);
  }

  function _releaseRunProfileSurface(surfaceId: string): void {
    if (!surfaceId) return;
    void releaseRunTargetSurface(surfaceId).catch(() => {});
  }

  function _replaceShortcutIframe(
    sc: SidebarShortcut,
    entry: IframeEntry,
    initialUrl = "",
  ) {
    if (!sidebarIframeStack || !sc || !entry || !entry.iframe) return entry;
    const nextIframe = document.createElement("iframe");
    const devToolsName = _configureShortcutIframeElement(
      nextIframe,
      sc,
      initialUrl,
    );
    if (entry.iframe.classList.contains("is-active")) {
      nextIframe.classList.add("is-active");
    }
    try {
      entry.iframe.replaceWith(nextIframe);
    } catch (_) {
      return entry;
    }
    entry.iframe = nextIframe;
    entry.url = initialUrl || _shortcutFrameUrl(sc, null, { forceReload: true });
    entry.loaded = !!initialUrl;
    entry.presentationId = _newPresentationId(
      _normStr(sc.host_id) || sc.key,
    );
    entry.devToolsName = devToolsName;
    entry.runProfileSurfaceId = _runProfileSurfaceId(sc);
    entry.version = shortcutVersion(sc.version);
    _iframeMap.set(sc.key, entry);
    if (_isAppDockEntry(sc)) {
      _publishPresentationIdentity(
        _normStr(sc.host_id),
        entry.presentationId,
      );
      _bindAgentPresentationIfCurrent(
        _normStr(sc.host_id),
        entry.presentationId,
      );
    }
    return entry;
  }

  function _loadShortcutIframe(
    sc: SidebarShortcut,
    entry: IframeEntry,
    loadUrl: string,
    replace: boolean,
  ) {
    if (entry.devToolsName && replace) {
      // Gecko must see the target marker and final URL when it creates the
      // child browsing context; append-blank-then-navigate can skip injection.
      _replaceShortcutIframe(sc, entry, loadUrl);
      return;
    }
    entry.url = loadUrl;
    entry.version = shortcutVersion(sc.version);
    entry.iframe.src = loadUrl;
    entry.loaded = true;
  }

  function _shortcutRestoreUrl(sc: SidebarShortcut | null): string {
    return _normStr(sc?.restore_url || sc?.restoreUrl);
  }

  function _shortcutFrameUrl(
    sc: SidebarShortcut,
    entry: IframeEntry | null = null,
    options: ShortcutIframeLoadOptions = {},
  ): string {
    const liveUrl = _normStr(sc.url);
    const restoreUrl = _shortcutRestoreUrl(sc);
    const forceReload = !!options.forceReload;
    if (!forceReload && entry?.loaded && _normStr(entry.url)) {
      return _normStr(entry.url);
    }
    return versionedShortcutUrl(restoreUrl || liveUrl, sc.version);
  }

  async function _ensureIframeLoadedForShortcut(
    sc: SidebarShortcut,
    entry: IframeEntry,
    options: ShortcutIframeLoadOptions = {},
  ) {
    if (!sc || !entry || !entry.iframe) return false;
    const url = _shortcutFrameUrl(sc, entry, options);
    if (!url) return false;
    const forceReload = !!options.forceReload;
    let loadUrl = _extensionWebviewPresentationUrl(
      sc,
      url,
      entry.presentationId,
      true,
    );
    const runtimeMetadata = runProfileRuntimeMetadata(sc);
    if (
      sc.kind === SHORTCUT_KIND_URL &&
      ((sc.run_target_route || sc.runTargetRoute) || runtimeMetadata?.devRuntime === true)
    ) {
      try {
        loadUrl = await prepareRunTargetUrl(
          sc.run_target_route || sc.runTargetRoute,
          url,
          runtimeMetadata,
        );
      } catch (error) {
        entry.loaded = false;
        options.onBeforeStart?.();
        toast(errorMessage(error, 'Run target relay failed'));
        return false;
      }
    }

    if (sc.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      const onBeforeStart =
        typeof options.onBeforeStart === "function"
          ? options.onBeforeStart
          : null;
      const appId = _normStr(sc.app_id);
      if (!appId) return false;

      if (
        !forceReload &&
        entry.loaded &&
        _runningCachePrimed &&
        _runningCache instanceof Set &&
        _runningCache.has(appId)
      ) {
        return true;
      }

      let isRunning = false;
      try {
        const set = _runningCachePrimed
          ? _runningCache
          : await _ensureRunningCache(false);
        isRunning = !!(set instanceof Set && set.has(appId));
      } catch (_) {
        isRunning = false;
      }

      let startedNow = false;
      if (!isRunning) {
        try {
          onBeforeStart?.();
        } catch (_) {}
        const ok = await _ensureFrameworkAppRunning(appId);
        if (!ok) {
          entry.loaded = false;
          try {
            entry.iframe.src = "about:blank";
          } catch (_) {}
          return false;
        }
        startedNow = true;
      }

      if (forceReload || !entry.loaded || startedNow) {
        _loadShortcutIframe(sc, entry, loadUrl, forceReload || !entry.loaded);
      }
      return true;
    }

    if (!forceReload && entry.loaded && entry.url === loadUrl) return true;
    _loadShortcutIframe(
      sc,
      entry,
      loadUrl,
      forceReload || !entry.loaded || entry.url !== loadUrl,
    );
    return true;
  }

  function _ensureRunningFrameworkShortcutIframesLoaded(
    shortcutsOverride: SidebarShortcut[] | null = null,
  ) {
    const shortcuts = Array.isArray(shortcutsOverride)
      ? shortcutsOverride
      : _collectVisibleShortcuts(_latestUiPrefs || {});
    const runningSet = _runningCache instanceof Set ? _runningCache : null;
    if (!runningSet || !runningSet.size) return;

    shortcuts.forEach((sc) => {
      if (!sc || sc.kind !== SHORTCUT_KIND_FRAMEWORK_APP) return;
      const appId = _normStr(sc.app_id);
      if (!appId || !runningSet.has(appId)) return;
      const entry = _iframeMap.get(sc.key);
      if (!entry) return;
      void _ensureIframeLoadedForShortcut(sc, entry);
    });
  }

  async function _refreshActiveShortcut(options: UnknownRecord = {}) {
    const flushCache = !!options.flushCache;
    const uiPrefs = _latestUiPrefs || {};
    const shortcuts = _collectVisibleShortcuts(uiPrefs);
    let active = _resolveActive(uiPrefs, shortcuts);
    if (!active || !active.key) {
      _updateSetupPlaceholder(uiPrefs, false, "setup");
      return false;
    }

    let entry = _iframeMap.get(active.key);
    if (!entry) {
      await _syncIframesAndActivate(uiPrefs, shortcuts, active);
      entry = _iframeMap.get(active.key);
    }
    if (!entry || !entry.iframe) return false;

    if (flushCache) {
      active = _bumpShortcutVersion(active) || active;
      entry = _replaceShortcutIframe(active, entry);
    }

    if (active.kind === SHORTCUT_KIND_FRAMEWORK_APP) {
      _updateSetupPlaceholder(uiPrefs, false, "loading", active);
    }
    const ok = await _ensureIframeLoadedForShortcut(active, entry, {
      forceReload: true,
      forceRunningCheck: active.kind === SHORTCUT_KIND_FRAMEWORK_APP,
      onBeforeStart: () =>
        _updateSetupPlaceholder(uiPrefs, false, "loading", active),
    });
    _updateSetupPlaceholder(uiPrefs, !!ok, ok ? "ready" : "setup", active);
    return !!ok;
  }

  async function _restartActiveFrameworkShortcut() {
    const uiPrefs = _latestUiPrefs || {};
    const shortcuts = _collectVisibleShortcuts(uiPrefs);
    let active = _resolveActive(uiPrefs, shortcuts);
    if (
      !active ||
      active.kind !== SHORTCUT_KIND_FRAMEWORK_APP ||
      !_normStr(active.app_id)
    ) {
      return false;
    }
    _updateSetupPlaceholder(uiPrefs, false, "loading", active);

    const restarted = await _restartFrameworkApp(active.app_id);
    if (!restarted) {
      _updateSetupPlaceholder(uiPrefs, false, "setup", active);
      return false;
    }

    let entry = _iframeMap.get(active.key);
    if (!entry) {
      await _syncIframesAndActivate(uiPrefs, shortcuts, active);
      entry = _iframeMap.get(active.key);
    }
    if (!entry || !entry.iframe) {
      _updateSetupPlaceholder(uiPrefs, false, "setup", active);
      return false;
    }
    active = _bumpShortcutVersion(active) || active;
    entry = _replaceShortcutIframe(active, entry);
    const ok = await _ensureIframeLoadedForShortcut(active, entry, {
      forceReload: true,
      forceRunningCheck: true,
      onBeforeStart: () =>
        _updateSetupPlaceholder(uiPrefs, false, "loading", active),
    });
    _updateSetupPlaceholder(uiPrefs, !!ok, ok ? "ready" : "setup", active);
    return !!ok;
  }

  async function _syncIframesAndActivate(
    uiPrefs: UnknownRecord,
    shortcuts: SidebarShortcut[] | null,
    active: SidebarShortcut | null,
  ) {
    const seq = ++_activateSeq;
    const stack = sidebarIframeStack;
    if (!stack) return;

    const resolvedShortcuts = Array.isArray(shortcuts)
      ? shortcuts
      : _collectVisibleShortcuts(uiPrefs);
    const desiredKeys = new Set(resolvedShortcuts.map((sc) => sc.key));
    const detachedKeys = new Set(
      resolvedShortcuts.filter(_isDetachedShortcut).map((sc) => sc.key),
    );

    _iframeMap.forEach((entry, key) => {
      if (!desiredKeys.has(key) || detachedKeys.has(key)) {
        if (!detachedKeys.has(key) && key.startsWith("dock:")) {
          _publishPresentationIdentity(key.slice("dock:".length), "");
        }
        if (!detachedKeys.has(key)) {
          _releaseRunProfileSurface(entry.runProfileSurfaceId);
        }
        try {
          entry.iframe.remove();
        } catch (_) {}
        _iframeMap.delete(key);
      }
    });

    // Ensure app metadata is available for default icons (best-effort).
    void _ensureAppsCache(false);

    // Create iframes for app dock slots and active URL slots.
    resolvedShortcuts.forEach((sc) => {
      if (detachedKeys.has(sc.key)) {
        void _ensureDetachedShortcut(sc, false);
        return;
      }
      let entry = _iframeMap.get(sc.key);
      if (!entry) {
        const iframe = document.createElement("iframe");
        const devToolsName = _configureShortcutIframeElement(iframe, sc);
        stack.appendChild(iframe);
        const presentationId = _newPresentationId(
          _normStr(sc.host_id) || sc.key,
        );
        entry = {
          iframe,
          url: _shortcutFrameUrl(sc, null),
          loaded: false,
          presentationId,
          devToolsName,
          runProfileSurfaceId: _runProfileSurfaceId(sc),
          version: shortcutVersion(sc.version),
        };
        _iframeMap.set(sc.key, entry);
        if (_isAppDockEntry(sc)) {
          _publishPresentationIdentity(
            _normStr(sc.host_id),
            presentationId,
          );
          _bindAgentPresentationIfCurrent(
            _normStr(sc.host_id),
            presentationId,
          );
        }
      } else if (
        shouldRecreateDevToolsTargetFrame(
          entry.devToolsName,
          entry.loaded,
          sc,
        )
      ) {
        const wasLoaded = entry.loaded;
        entry = _replaceShortcutIframe(sc, entry);
        if (wasLoaded) {
          void _ensureIframeLoadedForShortcut(sc, entry, { forceReload: true });
        }
      }
      const loadUrl = _shortcutFrameUrl(sc, entry);
      const prevUrl = entry.url;
      const nextSurfaceId = _runProfileSurfaceId(sc);
      if (
        entry.runProfileSurfaceId &&
        entry.runProfileSurfaceId !== nextSurfaceId
      ) {
        _releaseRunProfileSurface(entry.runProfileSurfaceId);
      }
      entry.runProfileSurfaceId = nextSurfaceId;
      const nextVersion = shortcutVersion(sc.version);
      const versionChanged = entry.version !== nextVersion;
      entry.version = nextVersion;
      entry.url = loadUrl;
      entry.devToolsName = _configureShortcutIframeElement(entry.iframe, sc);

      // WBA owns extension HTML revisions inside its stable trusted wrapper.
      if (
        entry.loaded &&
        versionChanged &&
        !_isExtensionWebviewEntry(sc)
      ) {
        void _ensureIframeLoadedForShortcut(sc, entry, { forceReload: true });
      } else if (entry.loaded && prevUrl && prevUrl !== loadUrl) {
        void _ensureIframeLoadedForShortcut(sc, entry, { forceReload: true });
      }
    });

    const resolvedActive = active || _resolveActive(uiPrefs, resolvedShortcuts);
    const activeKey = resolvedActive ? resolvedActive.key : "";

    // Eager load (best-effort). For framework apps this will start apps too.
    const eager = resolvedShortcuts.filter(
      (sc) =>
        sc &&
        sc.load === SHORTCUT_LOAD_EAGER &&
        !detachedKeys.has(sc.key),
    );
    for (const sc of eager) {
      const entry = _iframeMap.get(sc.key);
      if (!entry) continue;
      void _ensureIframeLoadedForShortcut(sc, entry);
    }

    _ensureRunningFrameworkShortcutIframesLoaded(resolvedShortcuts);

    // Mark active + lazy-load active.
    let hasActive = false;
    _iframeMap.forEach((entry, key) => {
      const isActive = !!(activeKey && key === activeKey);
      entry.iframe.classList.toggle("is-active", isActive);
      if (isActive) hasActive = true;
    });

    let activeReady = false;
    if (resolvedActive && detachedKeys.has(resolvedActive.key)) {
      activeReady = true;
    } else if (hasActive && resolvedActive) {
      const entry = _iframeMap.get(resolvedActive.key);
      if (entry) {
        if (
          resolvedActive.kind === SHORTCUT_KIND_FRAMEWORK_APP &&
          !entry.loaded
        ) {
          _updateSetupPlaceholder(
            uiPrefs || _latestUiPrefs || {},
            false,
            "loading",
            resolvedActive,
          );
        }
        const ok = await _ensureIframeLoadedForShortcut(resolvedActive, entry, {
          forceRunningCheck:
            resolvedActive.kind === SHORTCUT_KIND_FRAMEWORK_APP,
          onBeforeStart: () =>
            _updateSetupPlaceholder(
              uiPrefs || _latestUiPrefs || {},
              false,
              "loading",
              resolvedActive,
            ),
        });
        if (seq !== _activateSeq) return;
        activeReady = !!ok && !!entry.loaded;
      }
    }

    _updateSetupPlaceholder(
      uiPrefs || _latestUiPrefs || {},
      activeReady,
      "setup",
      resolvedActive || null,
    );
  }

  // --- Shortcut editor UI ---

  function _setLoadValue(value: unknown) {
    const normalized = _normalizeLoad(value);
    if (shortcutLoadBtn) shortcutLoadBtn.dataset.value = normalized;
    if (shortcutLoadLabel)
      shortcutLoadLabel.textContent =
        normalized === SHORTCUT_LOAD_EAGER ? "Eager" : "Lazy";
  }

  function _getLoadValue() {
    const raw = shortcutLoadBtn?.dataset?.value;
    return _normalizeLoad(raw);
  }

  function _closeLoadMenu() {
    if (!shortcutLoadDD) return;
    shortcutLoadDD.classList.remove("show");
    if (shortcutLoadBtn) shortcutLoadBtn.setAttribute("aria-expanded", "false");
  }

  function _renderLoadMenu() {
    if (!shortcutLoadDD) return;
    shortcutLoadDD.innerHTML = "";
    const current = _getLoadValue();
    const opts = [
      { value: SHORTCUT_LOAD_LAZY, label: "Lazy" },
      { value: SHORTCUT_LOAD_EAGER, label: "Eager" },
    ];
    opts.forEach((opt) => {
      const item = document.createElement("div");
      item.className = "fe-dd-item";
      item.textContent = opt.label;
      item.dataset.checkable = "true";
      setMenuChecked(item, opt.value === current);
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _setLoadValue(opt.value);
        _closeLoadMenu();
      });
      (shortcutLoadDD as HTMLElement).appendChild(item);
    });
  }

  function _openLoadMenu() {
    if (!shortcutLoadDD) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _renderLoadMenu();
    shortcutLoadDD.classList.add("show");
    if (shortcutLoadBtn) shortcutLoadBtn.setAttribute("aria-expanded", "true");
  }

  function _setKind(kind: unknown) {
    _editingKind = _normalizeEditorKind(kind);
    if (shortcutKindBtn) shortcutKindBtn.dataset.value = _editingKind;
    if (shortcutKindLabel) {
      shortcutKindLabel.textContent =
        _editingKind === SHORTCUT_KIND_FRAMEWORK_APP ? "App" : "URL";
    }
    if (shortcutUrlWrap)
      shortcutUrlWrap.style.display =
        _editingKind === SHORTCUT_KIND_URL ? "" : "none";
    if (shortcutAppWrap)
      shortcutAppWrap.style.display =
        _editingKind === SHORTCUT_KIND_FRAMEWORK_APP ? "" : "none";
    _renderIconPreview();
  }

  function _getKind() {
    const raw = shortcutKindBtn?.dataset?.value;
    return _normalizeEditorKind(raw);
  }

  function _closeKindMenu() {
    if (!shortcutKindDD) return;
    shortcutKindDD.classList.remove("show");
    if (shortcutKindBtn) shortcutKindBtn.setAttribute("aria-expanded", "false");
  }

  function _renderKindMenu() {
    if (!shortcutKindDD) return;
    shortcutKindDD.innerHTML = "";
    const current = _getKind();
    const opts = [
      { value: SHORTCUT_KIND_URL, label: "URL" },
      { value: SHORTCUT_KIND_FRAMEWORK_APP, label: "App" },
    ];
    opts.forEach((opt) => {
      const item = document.createElement("div");
      item.className = "fe-dd-item";
      item.textContent = opt.label;
      item.dataset.checkable = "true";
      setMenuChecked(item, opt.value === current);
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _setKind(opt.value);
        _closeKindMenu();
      });
      (shortcutKindDD as HTMLElement).appendChild(item);
    });
  }

  function _openKindMenu() {
    if (!shortcutKindDD) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _renderKindMenu();
    shortcutKindDD.classList.add("show");
    if (shortcutKindBtn) shortcutKindBtn.setAttribute("aria-expanded", "true");
  }

  function _closeAppMenu() {
    if (!shortcutAppDD) return;
    shortcutAppDD.classList.remove("show");
    if (shortcutAppBtn) shortcutAppBtn.setAttribute("aria-expanded", "false");
  }

  function _applyEditingApp(
    appId: unknown,
    appsList: FrameworkAppManifest[] | null,
  ) {
    const id = _normStr(appId);
    _editingAppId = id;
    if (shortcutAppBtn) shortcutAppBtn.dataset.value = id;
    const found = Array.isArray(appsList)
      ? appsList.find((a) => a && a.id === id)
      : null;
    if (shortcutAppLabel)
      shortcutAppLabel.textContent = found
        ? _normStr(found.name) || _normStr(found.id)
        : id || "Select app…";

    // If label is blank, adopt the app name.
    const currentLabel = _normStr(shortcutLabelInput?.value);
    if (!currentLabel && found && shortcutLabelInput) {
      shortcutLabelInput.value =
        _normStr(found.name) || _normStr(found.id) || "";
    }

    // URL is computed for framework apps (kept in prefs for stability).
    if (shortcutUrlInput && _editingKind === SHORTCUT_KIND_FRAMEWORK_APP) {
      shortcutUrlInput.value = _buildFrameworkAppUrl(id);
    }

    _renderIconPreview();
  }

  async function _renderAppMenu() {
    if (!shortcutAppDD) {
      _warnAppDiscovery("app-menu:render:aborted-no-dropdown");
      return;
    }
    _logAppDiscovery("app-menu:render:start");
    shortcutAppDD.innerHTML = "";

    let apps: FrameworkAppManifest[] = [];
    const current = _normStr(shortcutAppBtn?.dataset?.value);
    try {
      apps = await _ensureAppsCache(true);
    } catch (e) {
      _warnAppDiscovery("app-menu:render:prefetch-error", {
        message: errorMessage(e, String(e)),
      });
    }
    const running = new Set(
      (Array.isArray(apps) ? apps : [])
        .filter((a) => !!a?.running)
        .map((a) => _normStr(a?.id))
        .filter(Boolean),
    );
    _logAppDiscovery("app-menu:render:data", {
      appsCount: Array.isArray(apps) ? apps.length : 0,
      runningCount: running instanceof Set ? running.size : 0,
      current,
    });

    if (!apps.length) {
      _warnAppDiscovery("app-menu:render:no-apps");
      const empty = document.createElement("div");
      empty.className = "fe-dd-item";
      empty.style.opacity = "0.7";
      empty.textContent = "No apps found";
      shortcutAppDD.appendChild(empty);
      return;
    }

    const orderedApps = apps.slice().sort((a, b) => {
      const an = _normStr(a?.name) || _normStr(a?.id);
      const bn = _normStr(b?.name) || _normStr(b?.id);
      return an.localeCompare(bn, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    _logAppDiscovery("app-menu:render:order", {
      ids: orderedApps.map((a) => _normStr(a?.id)).filter(Boolean),
    });

    let rendered = 0;
    orderedApps.forEach((app, idx) => {
      try {
        const id = _normStr(app?.id);
        if (!id) {
          _warnAppDiscovery("app-menu:render:skip-missing-id", {
            index: idx,
            app,
          });
          return;
        }
        const name = _normStr(app?.name) || id;
        _logAppDiscovery("app-menu:render:item:start", {
          index: idx,
          id,
          name,
        });

        const item = document.createElement("div");
        item.className = "fe-dd-item";
        item.style.display = "flex";
        item.style.gap = "8px";
        item.style.alignItems = "center";
        item.dataset.checkable = "true";
        setMenuChecked(item, id === current);

        try {
          const icon = _manifestIconForApp(id);
          _logAppDiscovery("app-menu:render:item:icon", {
            id,
            iconKind: _normStr(icon?.kind) || "",
          });
          const iconNode = _renderIconNode(icon, 16);
          if (iconNode) item.appendChild(iconNode);
        } catch (iconErr) {
          _warnAppDiscovery("app-menu:render:item:icon-error", {
            id,
            message: errorMessage(iconErr, String(iconErr)),
          });
        }

        const text = document.createElement("span");
        text.textContent = name;
        item.appendChild(text);

        if (running && running.has(id)) {
          _logAppDiscovery("app-menu:render:item:running", { id });
          const badge = document.createElement("span");
          badge.textContent = "running";
          badge.style.fontSize = "0.72rem";
          badge.style.opacity = "0.65";
          badge.style.marginLeft = "auto";
          item.appendChild(badge);
        }

        item.addEventListener("click", (ev) => {
          ev.stopPropagation();
          _logAppDiscovery("app-menu:select", { id });
          _applyEditingApp(id, orderedApps);
          _closeAppMenu();
        });

        (shortcutAppDD as HTMLElement).appendChild(item);
        rendered += 1;
        _logAppDiscovery("app-menu:render:item:done", { index: idx, id });
      } catch (e) {
        _warnAppDiscovery("app-menu:render:item:error", {
          index: idx,
          appId: _normStr(app?.id),
          message: errorMessage(e, String(e)),
        });
      }
    });
    _logAppDiscovery("app-menu:render:done", {
      rendered,
      dropdownChildCount: shortcutAppDD.childElementCount,
      clientHeight: shortcutAppDD.clientHeight,
      scrollHeight: shortcutAppDD.scrollHeight,
      canScroll: shortcutAppDD.scrollHeight > shortcutAppDD.clientHeight,
    });
  }

  function _openAppMenu() {
    if (!shortcutAppDD) {
      _warnAppDiscovery("app-menu:open:aborted-no-dropdown");
      return;
    }
    _logAppDiscovery("app-menu:open:start");
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    void _renderAppMenu();
    shortcutAppDD.classList.add("show");
    if (shortcutAppBtn) shortcutAppBtn.setAttribute("aria-expanded", "true");
    _logAppDiscovery("app-menu:open:shown");
  }

  function _renderIconPreview() {
    if (!shortcutIconPreview) return;
    shortcutIconPreview.textContent = "";

    if (_editingAssetName) {
      const img = document.createElement("img");
      img.src = _agentIconUrlFromName(_editingAssetName);
      img.alt = "";
      img.style.width = "18px";
      img.style.height = "18px";
      img.style.objectFit = "contain";
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
    shortcutsEditorEl.style.display = "none";
    _editingId = null;
    _editingKey = "";
    _editingHostId = "";
    _editingAssetName = null;
    _editingAppId = "";
    _setKind(SHORTCUT_KIND_URL);
    if (shortcutLabelInput) shortcutLabelInput.value = "";
    if (shortcutUrlInput) shortcutUrlInput.value = "";
    _setLoadValue(SHORTCUT_LOAD_LAZY);
    if (shortcutEmojiInput) shortcutEmojiInput.value = "";
    if (shortcutIconPreview) shortcutIconPreview.textContent = "";
    _closeLoadMenu();
    _closeKindMenu();
    _closeAppMenu();
  }

  function _showEditor(
    entry: SidebarShortcut | SidebarShortcutPreference | UnknownRecord = {},
  ) {
    if (!shortcutsEditorEl) return;
    shortcutsEditorEl.style.display = "";
    const e = asRecord(entry);
    _editingId = _normStr(e.id) || null;
    _editingKey = _normStr(e.key) || _normStr(e.id) || _normStr(e.url);
    _editingHostId =
      _normStr(e.host_id || e.hostId) ||
      (_editingKey.startsWith("dock:")
        ? _editingKey.slice("dock:".length)
        : "");
    if (shortcutLabelInput) shortcutLabelInput.value = _normStr(e.label);
    if (shortcutUrlInput) shortcutUrlInput.value = _normStr(e.url);
    _setLoadValue(e.load);

    _editingAssetName = null;
    _editingAppId = _normStr(e.app_id);
    _setKind(e.kind);

    if (shortcutAppBtn) shortcutAppBtn.dataset.value = _editingAppId;
    if (shortcutAppLabel)
      shortcutAppLabel.textContent = _editingAppId
        ? _editingAppId
        : "Select app…";
    if (shortcutEmojiInput) shortcutEmojiInput.value = "";

    const icon =
      e.icon && typeof e.icon === "object" && !Array.isArray(e.icon)
        ? (e.icon as ShortcutIcon)
        : null;
    if (icon && icon.kind === "emoji" && shortcutEmojiInput) {
      shortcutEmojiInput.value = _normStr(icon.emoji);
    } else if (icon && icon.kind === "asset") {
      _editingAssetName = _normStr(icon.name) || null;
    }

    if (_editingKind === SHORTCUT_KIND_FRAMEWORK_APP && _editingAppId) {
      void _ensureAppsCache(true).then((apps) =>
        _applyEditingApp(_editingAppId, apps),
      );
    }

    _renderIconPreview();
  }

  function _persistShortcuts(
    nextList: SidebarShortcutPreference[],
    options: UnknownRecord = {},
  ) {
    _latestUiPrefs = { ..._latestUiPrefs, [UI_PREF_KEY_SHORTCUTS]: nextList };
    _shortcutsCache = nextList.filter(
      (sc): sc is SidebarShortcutPreference => !!sc && typeof sc === "object",
    );
    _sendUiPrefUpdate(UI_PREF_KEY_SHORTCUTS, nextList);

    const activeId =
      _normStr(_clientActiveShortcutId) ||
      _normStr(_latestUiPrefs?.[UI_PREF_KEY_ACTIVE]);
    const hasActive = !!(
      activeId &&
      Array.isArray(nextList) &&
      nextList.some((sc) => sc && (sc.id === activeId || sc.url === activeId))
    );
    if (!hasActive) {
      const activateDefault = options.activateDefault !== false;
      const defaultActive =
        activateDefault && Array.isArray(nextList) && nextList.length
          ? _normStr(nextList[0].id) || _normStr(nextList[0].url)
          : "";
      _setClientActiveShortcut(defaultActive, {
        emit: true,
        source: "shortcut_persist",
      });
    }
  }

  function _renderShortcutsList() {
    if (!shortcutsListEl) return;
    shortcutsListEl.innerHTML = "";
    const shortcuts = Array.isArray(_shortcutsCache)
      ? _shortcutsCache.slice()
      : [];
    if (!shortcuts.length) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.7";
      empty.textContent = "No plain URL entries yet.";
      shortcutsListEl.appendChild(empty);
      return;
    }

    let dragState: ShortcutListDragState | null = null;
    let dropBeforeRow: HTMLElement | null = null;
    let dropAfterRow: HTMLElement | null = null;
    let dropInsertionIndex = -1;

    const clearDropMarkers = () => {
      if (dropBeforeRow) {
        dropBeforeRow.style.boxShadow = "";
        dropBeforeRow = null;
      }
      if (dropAfterRow) {
        dropAfterRow.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
        dropAfterRow = null;
      }
    };

    const getRows = () =>
      Array.from(
        (shortcutsListEl as HTMLElement).querySelectorAll<HTMLElement>(
          '[data-shortcut-row="1"]',
        ),
      );

    const computeInsertion = (clientY: number, sourceRow: HTMLElement) => {
      const rows = getRows().filter((row) => row !== sourceRow);
      let insertion = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY <= mid) {
          insertion = i;
          break;
        }
      }
      return { rows, insertion };
    };

    const updateDragTarget = (clientY: number) => {
      if (!dragState || !dragState.dragging || !dragState.row) return;
      clearDropMarkers();
      const { rows, insertion } = computeInsertion(clientY, dragState.row);
      dropInsertionIndex = insertion;
      if (insertion < rows.length) {
        const row = rows[insertion];
        row.style.boxShadow = "inset 0 2px 0 rgba(120,170,255,0.95)";
        dropBeforeRow = row;
      } else if (rows.length) {
        const row = rows[rows.length - 1];
        row.style.borderBottom = "2px solid rgba(120,170,255,0.95)";
        dropAfterRow = row;
      }
    };

    const finishDrag = (commit: boolean) => {
      if (!dragState) return;
      const state = dragState;
      clearDropMarkers();
      try {
        if (state.mouseMoveHandler)
          document.removeEventListener("mousemove", state.mouseMoveHandler);
        if (state.mouseUpHandler)
          document.removeEventListener("mouseup", state.mouseUpHandler);
        if (state.touchMoveHandler)
          document.removeEventListener("touchmove", state.touchMoveHandler);
        if (state.touchEndHandler)
          document.removeEventListener("touchend", state.touchEndHandler);
        if (state.touchCancelHandler)
          document.removeEventListener("touchcancel", state.touchCancelHandler);
      } catch (_) {}
      state.row.style.opacity = "";
      state.row.style.transform = "";
      state.row.classList.remove("is-dragging");
      state.handle.style.cursor = "grab";
      if (commit && state.dragging) {
        const withoutSource = shortcuts.filter(
          (_, idx) => idx !== state.fromIndex,
        );
        const insertion = Number.isInteger(dropInsertionIndex)
          ? dropInsertionIndex
          : state.fromIndex;
        const bounded = Math.max(0, Math.min(withoutSource.length, insertion));
        const next = withoutSource.slice();
        next.splice(bounded, 0, shortcuts[state.fromIndex]);
        _persistShortcuts(next);
      }
      dragState = null;
      dropInsertionIndex = -1;
    };

    const beginDrag = (state: ShortcutListDragState | null) => {
      if (!state || !state.row || !state.handle) return;
      state.dragging = true;
      state.row.style.opacity = "0.72";
      state.row.style.transform = "scale(0.995)";
      state.row.classList.add("is-dragging");
      state.handle.style.cursor = "grabbing";
      dropInsertionIndex = state.fromIndex;
    };

    const bindDragHandle = (
      row: HTMLElement,
      handle: HTMLElement,
      idx: number,
    ) => {
      handle.style.touchAction = "none";
      handle.style.cursor = "grab";

      handle.addEventListener("mousedown", (ev: MouseEvent) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (dragState) finishDrag(false);
        const state: ShortcutListDragState = {
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
        dragState = state;
        beginDrag(state);
        updateDragTarget(ev.clientY);
        state.mouseMoveHandler = (moveEv: MouseEvent) => {
          if (!dragState || dragState.handle !== handle) return;
          moveEv.preventDefault();
          updateDragTarget(moveEv.clientY);
        };
        state.mouseUpHandler = (upEv: MouseEvent) => {
          if (!dragState || dragState.handle !== handle) return;
          upEv.preventDefault();
          finishDrag(true);
        };
        document.addEventListener("mousemove", state.mouseMoveHandler);
        document.addEventListener("mouseup", state.mouseUpHandler);
      });

      handle.addEventListener(
        "touchstart",
        (ev: TouchEvent) => {
          const touch = ev.changedTouches && ev.changedTouches[0];
          if (!touch) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (dragState) finishDrag(false);
          const state: ShortcutListDragState = {
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
          dragState = state;
          beginDrag(state);
          updateDragTarget(touch.clientY);

          const getTrackedTouch = (touches: TouchList | null) => {
            if (!touches) return null;
            for (let i = 0; i < touches.length; i += 1) {
              if (touches[i].identifier === dragState?.touchId)
                return touches[i];
            }
            return null;
          };

          state.touchMoveHandler = (moveEv: TouchEvent) => {
            if (!dragState || dragState.handle !== handle) return;
            const t =
              getTrackedTouch(moveEv.touches) ||
              getTrackedTouch(moveEv.changedTouches);
            if (!t) return;
            moveEv.preventDefault();
            updateDragTarget(t.clientY);
          };
          state.touchEndHandler = (endEv: TouchEvent) => {
            if (!dragState || dragState.handle !== handle) return;
            const t = getTrackedTouch(endEv.changedTouches);
            if (!t) return;
            endEv.preventDefault();
            finishDrag(true);
          };
          state.touchCancelHandler = (cancelEv: TouchEvent) => {
            if (!dragState || dragState.handle !== handle) return;
            const t = getTrackedTouch(cancelEv.changedTouches);
            if (!t) return;
            cancelEv.preventDefault();
            finishDrag(false);
          };
          document.addEventListener("touchmove", state.touchMoveHandler, {
            passive: false,
          });
          document.addEventListener("touchend", state.touchEndHandler, {
            passive: false,
          });
          document.addEventListener("touchcancel", state.touchCancelHandler, {
            passive: false,
          });
        },
        { passive: false },
      );
    };

    shortcuts.forEach((sc, idx) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "10px";
      row.style.alignItems = "center";
      row.style.padding = "6px 0";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
      row.dataset.shortcutRow = "1";

      const effectiveIcon = _effectiveShortcutIcon(sc);
      row.appendChild(_renderIconNode(effectiveIcon, 18));

      const meta = document.createElement("div");
      meta.style.flex = "1";
      const title = document.createElement("div");
      title.textContent = sc.label || "(no label)";
      const url = document.createElement("div");
      url.style.fontSize = "0.78rem";
      url.style.opacity = "0.7";
      url.textContent =
        sc.kind === SHORTCUT_KIND_FRAMEWORK_APP
          ? `App: ${_normStr(sc.app_id) || "(unset)"}`
          : sc.url || "";
      meta.appendChild(title);
      meta.appendChild(url);
      row.appendChild(meta);

      const mkBtn = (text: string) => {
        const b = document.createElement("button");
        b.className = "fe-btn";
        b.textContent = text;
        return b;
      };

      const dragHandle = mkBtn("↕");
      dragHandle.title = "Drag to reorder";
      dragHandle.setAttribute("aria-label", "Drag to reorder");
      bindDragHandle(row, dragHandle, idx);
      row.appendChild(dragHandle);

      const edit = mkBtn("Edit");
      edit.addEventListener("click", () => _showEditor(sc));
      row.appendChild(edit);

      const del = mkBtn("Delete");
      del.addEventListener("click", () => {
        const next = shortcuts.slice();
        next.splice(idx, 1);
        _persistShortcuts(next);
        _hideEditor();
      });
      row.appendChild(del);

      (shortcutsListEl as HTMLElement).appendChild(row);
    });
  }

  function _openUrlDialog(
    entry: SidebarShortcut | SidebarShortcutPreference | UnknownRecord = {},
  ) {
    if (!shortcutsModal) return;
    shortcutsModal.classList.add("show");
    shortcutsModal.setAttribute("aria-hidden", "false");
    _showEditor(entry);
    try {
      requestAnimationFrame(() => shortcutUrlInput?.focus());
    } catch (_) {}
  }

  function _openShortcutsModal() {
    _openUrlDialog({});
  }

  function _closeShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.classList.remove("show");
    shortcutsModal.setAttribute("aria-hidden", "true");
    _hideEditor();
  }

  function _closeAgentDropdown() {
    const dd = document.getElementById("fe-agent-dd");
    if (!dd) return;
    dd.classList.remove("show");
  }

  function _renderAgentDropdown() {
    const dd = document.getElementById("fe-agent-dd");
    if (!dd) return;
    dd.innerHTML = "";

    const display =
      _normStr(_latestUiPrefs?.[UI_PREF_KEY_TOGGLE_DISPLAY]) || "icon";
    const shortcuts = Array.isArray(_shortcutsCache) ? _shortcutsCache : [];
    const appDockEntries = _collectAppDockEntries();

    if (!shortcuts.length && !appDockEntries.length) {
      const empty = document.createElement("div");
      empty.className = "fe-dd-item";
      empty.style.opacity = "0.7";
      empty.textContent = "No sidebar items";
      dd.appendChild(empty);
    } else {
      const items: Array<SidebarShortcut | SidebarShortcutPreference> = [
        ...appDockEntries,
        ...shortcuts,
      ];
      items.forEach((sc) => {
        const label = _normStr(sc?.label);
        const url = _normStr(sc?.url);
        const id = _normStr(sc?.id);
        const activeId = id || url;
        if (!label || !url || !activeId) return;

        const item = document.createElement("div");
        item.className = "fe-dd-item";
        item.style.display = "flex";
        item.style.gap = "8px";
        item.style.alignItems = "center";

        if (display === "icon" || display === "both") {
          item.appendChild(_renderIconNode(_effectiveShortcutIcon(sc), 16));
        }
        if (display === "text" || display === "both") {
          const text = document.createElement("span");
          text.textContent = label;
          item.appendChild(text);
        } else {
          item.title = label;
        }

        item.addEventListener("click", (ev) => {
          ev.stopPropagation();
          _closeAgentDropdown();
          _setClientActiveShortcut(activeId, {
            emit: true,
            source: "agent_dropdown",
            updateLastUsed: true,
          });
          if (openDrawer)
            setTimeout(() => {
              try {
                openDrawer();
              } catch (_) {}
            }, 120);
        });
        dd.appendChild(item);
      });
    }

    const sep = document.createElement("div");
    sep.className = "fe-dd-separator";
    sep.style.margin = "6px 0";
    dd.appendChild(sep);

    const manage = document.createElement("div");
    manage.className = "fe-dd-item";
    manage.textContent = "URL";
    manage.addEventListener("click", (ev) => {
      ev.stopPropagation();
      _closeAgentDropdown();
      _openUrlDialog({});
    });
    dd.appendChild(manage);
  }

  function _openAgentDropdown() {
    const dd = document.getElementById("fe-agent-dd");
    if (!dd) return;
    try {
      if (closeAllMenus) closeAllMenus();
    } catch (_) {}
    _closeHeaderIconMenu();
    _closeRefreshMenu();
    _renderAgentDropdown();
    dd.classList.add("show");
  }

  function _bindAgentDropdownInteractions() {
    const agentBtn = agentToggleBtn;
    if (!agentBtn) return;

    document.addEventListener(
      "click",
      (ev) => {
        const dd = document.getElementById("fe-agent-dd");
        if (!dd || !dd.classList.contains("show")) return;
        const target = eventTargetElement(ev);
        if (target?.closest("#fe-agent-toggle")) return;
        if (target?.closest("#fe-agent-dd")) return;
        _closeAgentDropdown();
      },
      false,
    );

    document.addEventListener(
      "click",
      (ev) => {
        if (
          !sidebarHeaderIconMenuEl ||
          !sidebarHeaderIconMenuEl.classList.contains("show")
        )
          return;
        const target = eventTargetElement(ev);
        if (target?.closest("#agent-drawer-icon-menu")) return;
        if (target?.closest(".agent-drawer__icon-btn")) return;
        _closeHeaderIconMenu();
      },
      false,
    );

    document.addEventListener(
      "click",
      (ev) => {
        if (
          !sidebarRefreshMenuEl ||
          !sidebarRefreshMenuEl.classList.contains("show")
        )
          return;
        const target = eventTargetElement(ev);
        if (target?.closest("#agent-refresh-menu")) return;
        if (target?.closest("#agent-refresh-active")) return;
        _closeRefreshMenu();
      },
      false,
    );
  }

  function _stageUiPrefs(uiPrefs: UnknownRecord) {
    const ui = uiPrefs && typeof uiPrefs === "object" ? uiPrefs : {};
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
  }

  function _applyUiPrefsHydrated() {
    if (!_hydrated) return;

    const normalized = _collectVisibleShortcuts(_latestUiPrefs);
    const ensured = _ensureActiveSelection(_latestUiPrefs, normalized);
    _applyHeaderLabelAndIcon(_latestUiPrefs, normalized, ensured.active);
    _renderHeaderIconGrid(_latestUiPrefs, normalized, ensured.active);
    void _syncIframesAndActivate(_latestUiPrefs, normalized, ensured.active);

    // Keep open UI surfaces in sync.
    try {
      const dd = document.getElementById("fe-agent-dd");
      if (dd && dd.classList.contains("show")) _renderAgentDropdown();
    } catch (_) {}
    try {
      if (shortcutsModal && shortcutsModal.classList.contains("show"))
        _renderShortcutsList();
    } catch (_) {}

    // If legacy framework-app shortcut entries exist, load the app list so
    // default (manifest) icons can replace placeholder chrome.
    try {
      const needsApps = normalized.some(
        (sc) => sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP,
      );
      if (needsApps) {
        const seq = ++_appsChromeSeq;
        void _ensureAppsCache(false).then(() => {
          if (seq !== _appsChromeSeq) return;
          _refreshShortcutChrome();
        });
      }
    } catch (_) {}

    const needsFrameworkState = normalized.some(
      (sc) =>
        sc && sc.kind === SHORTCUT_KIND_FRAMEWORK_APP && _normStr(sc.app_id),
    );
    if (needsFrameworkState) {
      _setFrameworkEventsEnabled(true);
      if (!Array.isArray(_appsCache) || !_runningCachePrimed) {
        void Promise.all([
          _ensureAppsCache(false),
          _ensureRunningCache(false),
        ]).then(() => {
          _refreshShortcutChrome();
        });
      }
    }
  }

  function applyUiPrefs(uiPrefs: UnknownRecord) {
    _stageUiPrefs(uiPrefs);
    if (!_hydrated) return;
    _applyUiPrefsHydrated();
  }

  function _appDockSlotsFromLedgerPayload(
    payload: UnknownRecord,
  ): SidebarAppDockSlot[] {
    const slots = asRecord(payload.slots);
    if (Object.keys(slots).length) {
      return Object.keys(slots)
        .map((hostId) => asRecord(slots[hostId]))
        .filter(
          (item): item is SidebarAppDockSlot =>
            !!_normStr(item.host_id || item.hostId),
        );
    }

    // One-turn migration tolerance for the earlier draft array shape.
    return Array.isArray(payload.windows)
      ? payload.windows.filter(
          (item): item is SidebarAppDockSlot =>
            !!item && typeof item === "object",
        )
      : [];
  }

  function _applyAppDockLedgerPayload(payload: UnknownRecord) {
    const windows = _appDockSlotsFromLedgerPayload(payload);
    _appDockSlots = _reconcilePresentationWithDockSlots(windows);
    if (
      _pendingActivatedWindowHostId &&
      _findAppDockSlot(_pendingActivatedWindowHostId)
    ) {
      const hostId = _pendingActivatedWindowHostId;
      _pendingActivatedWindowHostId = "";
      _setClientActiveShortcut(hostId, { emit: false });
      return;
    }
    if (!_hydrated) return;
    _applyUiPrefsHydrated();
  }

  async function hydrate() {
    if (_hydratePromise) return _hydratePromise;
    if (_hydrated) return;
    _hydratePromise = (async () => {
      try {
        await _ensurePresentationStateLoaded();
        await _bootstrapExtensionManifest();
      } finally {
        _setFrameworkEventsEnabled(true);
        _hydrated = true;
        _applyUiPrefsHydrated();
        _hydratePromise = null;
      }
    })();
    return _hydratePromise;
  }

  async function init() {
    const electronBridge = _electronSurfaceBridge();
    if (electronBridge && !_electronSurfaceEventsUnsubscribe) {
      _electronSurfaceEventsUnsubscribe = electronBridge.onSidebarSurfaceEvent(
        _handleElectronSurfaceEvent,
      );
      window.addEventListener(
        "beforeunload",
        () => {
          _electronSurfaceEventsUnsubscribe?.();
          _electronSurfaceEventsUnsubscribe = null;
        },
        { once: true },
      );
    }
    // Resolve core DOM.
    agentToggleBtn = document.getElementById("fe-agent-toggle");

    sidebarHeaderIconEl = document.getElementById("agent-drawer-icon");
    sidebarHeaderTitleEl = document.getElementById("agent-drawer-title-text");
    sidebarHeaderIconGridEl = document.getElementById("agent-drawer-icon-grid");
    sidebarHeaderIconMenuEl = document.getElementById("agent-drawer-icon-menu");
    sidebarRefreshBtn = document.getElementById("agent-refresh-active");
    sidebarRefreshMenuEl = document.getElementById("agent-refresh-menu");
    sidebarSetupPlaceholder = document.getElementById(
      "sidebar-setup-placeholder",
    );
    sidebarSetupTitleEl =
      sidebarSetupPlaceholder?.querySelector(".sidebar-setup__title") || null;
    sidebarSetupHintEl =
      sidebarSetupPlaceholder?.querySelector(".sidebar-setup__hint") || null;
    sidebarIframeStack = document.getElementById("sidebar-iframe-stack");

    editorSettingsModalEl = document.getElementById("editor-settings-modal");
    shortcutsModal = document.getElementById("agent-shortcuts-modal");
    shortcutsCloseBtn = document.getElementById("agent-shortcuts-close");
    shortcutsAddBtn = document.getElementById("agent-shortcuts-add");
    shortcutsListEl = document.getElementById("agent-shortcuts-list");
    shortcutsEditorEl = document.getElementById("agent-shortcuts-editor");

    editorSettingsShortcutsBtn = document.getElementById(
      "editor-settings-agent-shortcuts",
    );
    setupShortcutsBtn = document.getElementById("sidebar-setup-shortcuts");

    shortcutLabelInput = document.getElementById(
      "agent-shortcut-label",
    ) as HTMLInputElement | null;
    shortcutUrlWrap = document.getElementById("agent-shortcut-target-url");
    shortcutUrlInput = document.getElementById(
      "agent-shortcut-url",
    ) as HTMLInputElement | null;
    shortcutKindBtn = document.getElementById("agent-shortcut-kind-btn");
    shortcutKindLabel = document.getElementById("agent-shortcut-kind-label");
    shortcutKindDD = document.getElementById("agent-shortcut-kind-dd");
    shortcutAppWrap = document.getElementById("agent-shortcut-target-app");
    shortcutAppBtn = document.getElementById("agent-shortcut-app-btn");
    shortcutAppLabel = document.getElementById("agent-shortcut-app-label");
    shortcutAppDD = document.getElementById("agent-shortcut-app-dd");

    shortcutLoadBtn = document.getElementById("agent-shortcut-load-btn");
    shortcutLoadLabel = document.getElementById("agent-shortcut-load-label");
    shortcutLoadDD = document.getElementById("agent-shortcut-load-dd");
    shortcutEmojiInput = document.getElementById(
      "agent-shortcut-emoji",
    ) as HTMLInputElement | null;
    shortcutIconBrowseBtn = document.getElementById(
      "agent-shortcut-icon-browse",
    );
    shortcutIconClearBtn = document.getElementById("agent-shortcut-icon-clear");
    shortcutIconPreview = document.getElementById(
      "agent-shortcut-icon-preview",
    );
    shortcutCancelBtn = document.getElementById("agent-shortcut-cancel");
    shortcutSaveBtn = document.getElementById("agent-shortcut-save");

    // Hide URL/app rows until kind is selected (defaults to URL).
    _setKind(SHORTCUT_KIND_URL);

    // Settings radios: update prefs.
    try {
      const radios = (editorSettingsModalEl || document).querySelectorAll<HTMLInputElement>(
        'input[name="agent-toggle-display"]',
      );
      radios.forEach((r) => {
        r.addEventListener("change", () => {
          if (_settingsUiMutating) return;
          if (!r.checked) return;
          _sendUiPrefUpdate(UI_PREF_KEY_TOGGLE_DISPLAY, r.value);
        });
      });
    } catch (_) {}

    try {
      const headerRadios = (editorSettingsModalEl || document).querySelectorAll<HTMLInputElement>(
        'input[name="agent-header-display"]',
      );
      headerRadios.forEach((r) => {
        r.addEventListener("change", () => {
          if (_settingsUiMutating) return;
          if (!r.checked) return;
          _sendUiPrefUpdate(UI_PREF_KEY_HEADER_DISPLAY, r.value);
        });
      });
    } catch (_) {}

    if (editorSettingsShortcutsBtn)
      editorSettingsShortcutsBtn.addEventListener("click", _openShortcutsModal);
    if (setupShortcutsBtn) {
      setupShortcutsBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void _openLauncherMenu(setupShortcutsBtn);
      });
    }
    if (shortcutsCloseBtn)
      shortcutsCloseBtn.addEventListener("click", _closeShortcutsModal);
    if (sidebarRefreshBtn) {
      let refreshPointerId: number | null = null;
      let refreshStartX = 0;
      let refreshStartY = 0;
      let refreshSuppressUntil = 0;
      const clearRefreshLongPress = () => {
        if (_refreshMenuLongPressTimer) {
          clearTimeout(_refreshMenuLongPressTimer);
          _refreshMenuLongPressTimer = null;
        }
      };
      sidebarRefreshBtn.addEventListener("click", (ev) => {
        if (Date.now() < refreshSuppressUntil) {
          ev.preventDefault();
          ev.stopPropagation();
          refreshSuppressUntil = 0;
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        _closeRefreshMenu();
        void _refreshActiveShortcut({ flushCache: false });
      });
      sidebarRefreshBtn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _openRefreshMenu(sidebarRefreshBtn);
      });
      sidebarRefreshBtn.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        refreshPointerId = ev.pointerId;
        refreshStartX = ev.clientX;
        refreshStartY = ev.clientY;
        if (ev.pointerType === "touch") {
          clearRefreshLongPress();
          _refreshMenuLongPressTimer = setTimeout(() => {
            _refreshMenuLongPressTimer = null;
            if (refreshPointerId !== ev.pointerId) return;
            refreshSuppressUntil = Date.now() + 900;
            _openRefreshMenu(sidebarRefreshBtn);
          }, 520);
        }
      });
      const endRefreshPointer = (ev: PointerEvent) => {
        if (refreshPointerId !== ev.pointerId) return;
        clearRefreshLongPress();
        refreshPointerId = null;
        refreshStartX = 0;
        refreshStartY = 0;
      };
      sidebarRefreshBtn.addEventListener(
        "pointermove",
        (ev) => {
          if (refreshPointerId !== ev.pointerId) return;
          if (
            Math.abs(ev.clientX - refreshStartX) > 8 ||
            Math.abs(ev.clientY - refreshStartY) > 8
          ) {
            clearRefreshLongPress();
          }
        },
        { passive: true },
      );
      sidebarRefreshBtn.addEventListener("pointerup", endRefreshPointer);
      sidebarRefreshBtn.addEventListener("pointercancel", endRefreshPointer);
    }
    if (shortcutsModal) {
      shortcutsModal.addEventListener("click", (ev) => {
        if (ev.target === shortcutsModal) _closeShortcutsModal();
      });
    }
    if (shortcutsAddBtn)
      shortcutsAddBtn.addEventListener("click", () => _showEditor({}));

    if (shortcutCancelBtn)
      shortcutCancelBtn.addEventListener("click", _closeShortcutsModal);

    if (shortcutEmojiInput)
      shortcutEmojiInput.addEventListener("input", _renderIconPreview);

    if (shortcutLoadBtn) {
      shortcutLoadBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutLoadDD?.classList.contains("show");
        if (wasOpen) _closeLoadMenu();
        else _openLoadMenu();
      });
    }

    if (shortcutKindBtn) {
      shortcutKindBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutKindDD?.classList.contains("show");
        if (wasOpen) _closeKindMenu();
        else _openKindMenu();
      });
    }

    if (shortcutAppBtn) {
      shortcutAppBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasOpen = shortcutAppDD?.classList.contains("show");
        if (wasOpen) _closeAppMenu();
        else _openAppMenu();
      });
    }

    if (shortcutIconBrowseBtn) {
      shortcutIconBrowseBtn.addEventListener("click", async () => {
        if (
          typeof (window as unknown as { __explorerBusRequest?: unknown })
            .__explorerBusRequest !== "function"
        ) {
          toast("Explorer connection unavailable");
          return;
        }
        if (!pickFileFn) {
          toast("File picker unavailable");
          return;
        }
        const base = _lastPickerPath || options.homeDir || "";
        const picked = await pickFileFn(base);
        if (!picked) return;
        _lastPickerPath = picked;
        try {
          const res = await requestExplorerRpc(
            EXPLORER_RPC_METHODS.prefsAgentIconVendor,
            { abs_path: picked },
            12000,
          );
          if (res?.ok && res.name) {
            _editingAssetName = _normStr(res.name);
            if (shortcutEmojiInput) shortcutEmojiInput.value = "";
            _renderIconPreview();
          }
        } catch (e) {
          toast(errorMessage(e, "Failed to vendor icon"));
        }
      });
    }

    if (shortcutIconClearBtn) {
      shortcutIconClearBtn.addEventListener("click", () => {
        _editingAssetName = null;
        if (shortcutEmojiInput) shortcutEmojiInput.value = "";
        _renderIconPreview();
      });
    }

    if (shortcutSaveBtn) {
      shortcutSaveBtn.addEventListener("click", () => {
        const url = _normStr(shortcutUrlInput?.value);
        if (!url) {
          toast("URL is required");
          return;
        }
        const label =
          _normStr(shortcutLabelInput?.value) || _deriveUrlLabel(url);

        const hostId = _editingHostId;
        _requestSidebarControl(UI_IPC_RPC_METHODS.sidebarWindowCreate, {
          kind: SHORTCUT_KIND_URL,
          hostId,
          host_id: hostId,
          label,
          title: label,
          url,
          restoreUrl: url,
          restore_url: url,
          load: _getLoadValue(),
          stateKind: "url",
          state_kind: "url",
          queryState: { url },
          query_state: { url },
          source: "url_dialog",
          activate: true,
        });
        _closeShortcutsModal();
      });
    }

    _bindAgentDropdownInteractions();

    if (!_sidebarEventListenerBound) {
      window.addEventListener("code-te2:sidebar-event", (ev: Event) => {
        const data = (ev as CustomEvent<UnknownRecord>).detail;
        if (!data || typeof data !== "object") return;
        const eventType = _normStr(data.type);
        if (eventType === LEGACY_SIDEBAR_ACTIVE_SHORTCUT_SET) {
          const payload = asRecord(data.payload);
          const shortcutId = _normStr(
            payload.shortcutId || payload.activeShortcutId,
          );
          if (shortcutId) _setClientActiveShortcut(shortcutId, { emit: false });
          return;
        }
        if (eventType === SIDEBAR_IPC_RPC_NOTIFICATIONS.clientState) {
          // Backend client state is coordination metadata, not presentation
          // authority. Foreground and ordering remain local to this host.
          return;
        }
        if (eventType === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowsChanged) {
          _applyAppDockLedgerPayload(asRecord(data.payload));
          return;
        }
        if (eventType === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowActivated) {
          const payload = asRecord(data.payload);
          const hostId = _normStr(payload.hostId || payload.host_id);
          if (hostId) {
            if (_findAppDockSlot(hostId)) {
              _setClientActiveShortcut(hostId, { emit: false });
            } else {
              _pendingActivatedWindowHostId = hostId;
            }
          }
          return;
        }
        if (
          eventType === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowReadinessChanged
        ) {
          const payload = asRecord(data.payload);
          const state = asRecord(payload.state);
          if (
            (state.slots && typeof state.slots === "object") ||
            Array.isArray(state.windows)
          ) {
            _applyAppDockLedgerPayload(state);
          }
          return;
        }
        if (
          eventType !== SIDEBAR_IPC_RPC_NOTIFICATIONS.activeShortcutRefresh &&
          eventType !== LEGACY_SIDEBAR_ACTIVE_SHORTCUT_REFRESH
        )
          return;
        const payload = asRecord(data.payload);
        void _refreshActiveShortcut({
          flushCache: !!payload.flushCache,
        });
      });
      _sidebarEventListenerBound = true;
      const runtimeWindow = window as unknown as SidebarRuntimeEventWindow;
      const pendingEvents = Array.isArray(
        runtimeWindow.__codeTe2PendingSidebarEvents,
      )
        ? runtimeWindow.__codeTe2PendingSidebarEvents.splice(0)
        : [];
      runtimeWindow.__codeTe2PendingSidebarEvents = [];
      runtimeWindow.__codeTe2SidebarRuntimeReady = true;
      pendingEvents.forEach((detail) => {
        try {
          window.dispatchEvent(
            new CustomEvent("code-te2:sidebar-event", { detail }),
          );
        } catch (_) {}
      });
    }

    _lightInitDone = true;
    if (_latestUiPrefs && Object.keys(_latestUiPrefs).length > 0) {
      _stageUiPrefs(_latestUiPrefs);
    }
  }

  return {
    init,
    hydrate,
    applyUiPrefs,
    getActiveUrl,
    getMentionTarget,
    publishPresentationIdentities,
  };
}
