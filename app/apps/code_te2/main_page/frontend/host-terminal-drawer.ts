// app/apps/code_te2/main_page/frontend/host-terminal-drawer.ts

import {
  SOCKET_IO_NAMESPACES,
  SOCKET_IO_PATHS,
  fileEditorSocketQuery,
} from '../../src/rpc/socketio-topology.ts';
import { clampTerminalDrawerHeight } from './ui/drawer-sizing.ts';
import {
  bindTerminalSpecialKeyTarget,
  publishTerminalSpecialKeyFocus,
} from '../../src/mobile-input/terminal-special-key-bridge.ts';
import {
  coerceTerminalBytes,
  coerceTerminalOffset,
  coerceTerminalOutput,
  reconcileTerminalOutput,
  type TerminalOutputRecord,
} from './terminal-output-projection.ts';

/**
 * Terminal drawer for the code editor.
 * Embeds xterm.js with WebSocket PTY streaming.
 * 
 * Lifecycle:
 *   - Drawer close: Terminal stays alive, just hidden
 *   - X button click: Destroys the terminal shell permanently
 *   - Drawer reopen: Reconnects to existing shell or creates new one
 */

interface TerminalDrawerOptions {
  onReady?: () => void;
  getCurrentProjectPath?: () => string | null;
  emitImeIntent?: (active: boolean, params?: Record<string, unknown>) => void;
}

interface TerminalDrawerController {
  open: () => Promise<void>;
  openDrawer: () => void;
  activateTerminal: () => Promise<void>;
  close: () => void;
  toggle: () => void;
  destroy: () => Promise<void>;
  closeAndDisconnect: () => void;
  isOpen: () => boolean;
}

interface TerminalShell {
  id: string;
  display_label?: string | null;
  title?: string | null;
  status?: string | null;
}

interface TerminalShellListData {
  active_shell_id: string | null;
  shells: TerminalShell[];
}

interface TerminalSocket {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendBuffer?: unknown[];
  emit: (
    event: string,
    payload?: unknown,
    acknowledgement?: (payload: unknown) => void,
  ) => void;
  readonly volatile: {
    emit: (event: string, payload?: unknown) => void;
  };
  on: (event: string, handler: (payload?: unknown) => void) => void;
}

interface SocketIoClient {
  (namespace: string, options?: Record<string, unknown>): TerminalSocket;
}

interface PendingTerminalRequest {
  reject: (error: Error) => void;
  timer: number;
}

interface TerminalRequestResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

interface XtermFitAddon {
  fit: () => void;
}

interface XtermFitAddonCtor {
  new (): XtermFitAddon;
}

interface XtermFitAddonNamespace {
  FitAddon?: XtermFitAddonCtor;
}

interface XtermTerminal {
  cols: number;
  rows: number;
  element?: HTMLElement;
  buffer?: {
    active?: {
      viewportY?: number;
      getLine?: (row: number) => {
        getCell?: (column: number) => { getWidth?: () => number } | undefined;
      } | undefined;
    };
  };
  input?: (data: string) => void;
  options: {
    fontSize?: number;
    [key: string]: unknown;
  };
  textarea?: HTMLTextAreaElement;
  clear: () => void;
  clearSelection?: () => void;
  dispose: () => void;
  focus: () => void;
  getSelection?: () => string;
  getSelectionPosition?: () => {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | undefined;
  hasSelection?: () => boolean;
  loadAddon: (addon: XtermFitAddon) => void;
  onData: (handler: (data: string) => void) => void;
  onResize: (handler: (size: { cols: number; rows: number }) => void) => XtermDisposable;
  onScroll?: (handler: (viewportY: number) => void) => XtermDisposable;
  onSelectionChange: (handler: () => void) => XtermDisposable;
  open: (container: HTMLElement) => void;
  reset: () => void;
  scrollLines: (lines: number) => void;
  select?: (column: number, row: number, length: number) => void;
  selectAll?: () => void;
  paste?: (data: string) => void;
  attachCustomTouchEventHandler?: (handler: (event: TouchEvent, isScrollGesture: boolean) => boolean) => XtermDisposable;
  setOption?: (name: string, value: unknown) => void;
  write: (data: string | Uint8Array) => void;
}

interface XtermDisposable {
  dispose(): void;
}

interface TerminalTouchSelectionApi {
  attach(terminal: XtermTerminal): XtermDisposable;
}

interface XtermTerminalCtor {
  new (options: Record<string, unknown>): XtermTerminal;
}

interface TerminalRuntimeWindow extends Window {
  FitAddon?: XtermFitAddonCtor | XtermFitAddonNamespace;
  Terminal?: XtermTerminalCtor;
  __fileEditorCm6DrawerTouchToMouseLoaded?: boolean;
  __fileEditorCm6TerminalHelpersActive?: boolean;
  te2TerminalTouchSelection?: TerminalTouchSelectionApi;
  ctrl?: boolean;
  io?: SocketIoClient;
  term?: XtermTerminal;
}

const MAX_PENDING_TERMINAL_OUTPUT_BYTES = 1024 * 1024;

function asHTMLElement(value: Element | null): HTMLElement | null {
  return value instanceof HTMLElement ? value : null;
}

function asButtonElement(value: HTMLElement | null): HTMLButtonElement | null {
  return value instanceof HTMLButtonElement ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function coerceShell(value: unknown): TerminalShell | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  if (!id) return null;
  return {
    id,
    display_label: typeof value.display_label === 'string' ? value.display_label : null,
    title: typeof value.title === 'string' ? value.title : null,
    status: typeof value.status === 'string' ? value.status : null,
  };
}

function coerceShells(value: unknown): TerminalShell[] {
  if (!Array.isArray(value)) return [];
  return value.map(coerceShell).filter((shell): shell is TerminalShell => !!shell);
}

function coerceShellListData(value: unknown): TerminalShellListData {
  if (!isRecord(value)) return { active_shell_id: null, shells: [] };
  return {
    active_shell_id: optionalString(value.active_shell_id),
    shells: coerceShells(value.shells),
  };
}

export function createTerminalDrawer(options: TerminalDrawerOptions = {}): TerminalDrawerController {
  const {
    onReady = () => {},
    getCurrentProjectPath = () => null,
    emitImeIntent = () => {},
  } = options;

  let term: XtermTerminal | null = null;
  let ws: TerminalSocket | null = null;
  let shellId: string | null = null;
  let fitAddon: XtermFitAddon | null = null;
  let isOpen = false;
  let isFullscreen = false;
  let lastShellId: string | null = null;
  let shellHistoryPrimed = false;
  let bindGeneration = 0;
  let desiredShellId: string | null = 'auto';
  let socketRegistered = false;
  let pendingOutput: TerminalOutputRecord[] = [];
  let pendingOutputBytes = 0;
  let appliedOutputOffset = 0;
  let lastResizeSent: string | null = null;
  let fitRaf: number | null = null;
  let fitFramesRemaining = 0;
  let viewportHandlersInstalled = false;
  let resizeObserver: ResizeObserver | null = null;
  let touchSelectionDisposable: XtermDisposable | null = null;
  let startupSizing = false;
  let startupFitTimer: number | null = null;
  const pendingTerminalRequests = new Map<string, PendingTerminalRequest>();

  const drawer = document.getElementById('terminal-drawer');
  const container = document.getElementById('terminal-container');
  const header = asHTMLElement(drawer?.querySelector('.terminal-header') ?? null);
  const resizeHandle = asHTMLElement(document.querySelector('.resize-handle--terminal'));
  const shellToggle = asHTMLElement(drawer?.querySelector('#terminal-shell-toggle') ?? null);
  const shellMenu = asHTMLElement(drawer?.querySelector('#terminal-shell-menu') ?? null);
  const toggleBtn = asHTMLElement(document.getElementById('terminal-toggle'));
  const collapseBtn = asHTMLElement(document.getElementById('terminal-collapse'));
  const fullscreenBtn = asHTMLElement(document.getElementById('terminal-fullscreen'));
  const newBtn = asHTMLElement(document.getElementById('terminal-new'));
  const zoomOutBtn = asHTMLElement(document.getElementById('terminal-zoom-out'));
  const zoomInBtn = asHTMLElement(document.getElementById('terminal-zoom-in'));
  const copyBtn = asButtonElement(asHTMLElement(document.getElementById('terminal-copy')));

  let shellMenuOpen = false;
  const FONT_SIZE_MIN = 10;
  const FONT_SIZE_MAX = 28;
  const FONT_SIZE_STEP = 1;
  const HELPER_BASE_URL = '/apps/code_te2/vendor/android-terminalapp-assets-js';
  let vendoredCtrlFocusCleanup: (() => void) | null = null;

  function emitTerminalImeIntent(active: boolean, trigger: string): void {
    try {
      emitImeIntent(active, {
        source: 'terminal_drawer',
        surface: 'code_te2.terminal_drawer',
        trigger,
      });
    } catch (_) {}
  }

  function formatShellLabel(id: string | null | undefined): string {
    if (!id) return 'Terminal';
    return `Terminal ${String(id).slice(-4)}`;
  }

  function formatShellDisplayLabel(shell: TerminalShell | null | undefined): string {
    if (!shell) return 'Terminal';
    if (shell.display_label) return String(shell.display_label);
    if (shell.title) return `${String(shell.title).trim()}/${String(shell.id || '').slice(-4)}`;
    if (shell.id) return `Terminal/${String(shell.id).slice(-4)}`;
    return 'Terminal';
  }

  function setTerminalResizeHandleActive(active: boolean): void {
    if (!(resizeHandle instanceof HTMLElement)) return;
    resizeHandle.hidden = !active;
    resizeHandle.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  function setDrawerCollapsedState(collapsed: boolean): void {
    if (!(drawer instanceof HTMLElement)) return;
    drawer.classList.toggle('terminal-drawer--collapsed', !!collapsed);
  }

  function isShellExited(shell: TerminalShell | null | undefined): boolean {
    const status = String(shell?.status || '').trim().toLowerCase();
    return !!(status && status !== 'live');
  }

  function setShellToggleShell(activeShell: TerminalShell | null, activeIdFallback: string | null): void {
    if (!shellToggle) return;
    if (activeShell) {
      shellToggle.textContent = formatShellDisplayLabel(activeShell);
      shellToggle.classList.toggle('terminal-shell-toggle-exited', isShellExited(activeShell));
      return;
    }
    if (activeIdFallback) {
      shellToggle.textContent = `Terminal/${String(activeIdFallback).slice(-4)}`;
      shellToggle.classList.remove('terminal-shell-toggle-exited');
      return;
    }
    shellToggle.textContent = 'Terminal';
    shellToggle.classList.remove('terminal-shell-toggle-exited');
  }

  function getCurrentFontSize(): number {
    try {
      const size = term?.options?.fontSize;
      if (typeof size === 'number' && Number.isFinite(size)) return size;
    } catch (_) {}
    return 14;
  }

  function applyFontSize(size: number): void {
    if (!term) return;
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
    try {
      term.options.fontSize = clamped;
    } catch (err) {
      try {
        term.setOption?.('fontSize', clamped);
      } catch (_) {}
    }

    if (zoomOutBtn) zoomOutBtn.title = `Zoom out (${clamped}px)`;
    if (zoomInBtn) zoomInBtn.title = `Zoom in (${clamped}px)`;

    requestFit(6);
  }

  function getTerminalCols(): number {
    return Math.max(1, Number(term?.cols) || 0);
  }

  function getTerminalRows(): number {
    return Math.max(1, Number(term?.rows) || 0);
  }

  function syncTerminalSize(force = false): void {
    if (!hasBoundShell() || !term || !ws) return;
    if (startupSizing && !force) return;
    const cols = getTerminalCols();
    const rows = getTerminalRows();
    if (!cols || !rows) return;
    const key = `${shellId}:${cols}x${rows}`;
    if (!force && lastResizeSent === key) return;
    lastResizeSent = key;
    ws.volatile.emit('terminal:resize', { cols, rows });
  }

  function requestFit(frames = 8): void {
    if (!term || !fitAddon || !isOpen || startupSizing) return;
    fitFramesRemaining = Math.max(fitFramesRemaining, Math.max(1, Number(frames) || 1));
    if (fitRaf !== null) return;

    const step = () => {
      fitRaf = null;
      if (!term || !fitAddon || !isOpen) return;
      try {
        fitAddon.fit();
      } catch (_) {
        return;
      }
      syncTerminalSize();
      fitFramesRemaining = Math.max(0, fitFramesRemaining - 1);
      if (fitFramesRemaining > 0) {
        fitRaf = requestAnimationFrame(step);
      }
    };

    fitRaf = requestAnimationFrame(step);
  }

  function installViewportHandlers(): void {
    if (viewportHandlersInstalled) return;
    viewportHandlersInstalled = true;
    window.addEventListener('resize', () => requestFit(8), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => requestFit(10), { passive: true });
      window.visualViewport.addEventListener('scroll', () => requestFit(4), { passive: true });
    }
  }

  function clearStartupFitTimer(): void {
    if (startupFitTimer !== null) {
      clearTimeout(startupFitTimer);
      startupFitTimer = null;
    }
  }

  function getDrawerHeightTransitionMs(): number {
    if (!drawer || typeof window.getComputedStyle !== 'function') return 0;
    try {
      const style = window.getComputedStyle(drawer);
      const props = String(style.transitionProperty || '').split(',').map((part) => part.trim());
      const durations = String(style.transitionDuration || '').split(',').map((part) => part.trim());
      const delays = String(style.transitionDelay || '').split(',').map((part) => part.trim());

      const parseMs = (value: unknown): number => {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        if (raw.endsWith('ms')) return Number.parseFloat(raw.slice(0, -2)) || 0;
        if (raw.endsWith('s')) return (Number.parseFloat(raw.slice(0, -1)) || 0) * 1000;
        return Number.parseFloat(raw) || 0;
      };

      let maxMs = 0;
      const count = Math.max(props.length, durations.length, delays.length);
      for (let index = 0; index < count; index += 1) {
        const prop = props[index] ?? props[props.length - 1] ?? '';
        if (prop && prop !== 'all' && prop !== 'height') continue;
        const durationMs = parseMs(durations[index] ?? durations[durations.length - 1] ?? 0);
        const delayMs = parseMs(delays[index] ?? delays[delays.length - 1] ?? 0);
        maxMs = Math.max(maxMs, durationMs + delayMs);
      }
      return Math.max(0, Math.round(maxMs));
    } catch (_) {
      return 0;
    }
  }

  function scheduleStartupResizeSync(reason = 'open'): void {
    if (!term || !fitAddon || !isOpen) return;
    startupSizing = true;
    clearStartupFitTimer();

    const settleMs = getDrawerHeightTransitionMs();
    const waitMs = Math.max(0, settleMs + 34);

    startupFitTimer = setTimeout(() => {
      startupFitTimer = null;
      if (!term || !fitAddon || !isOpen) {
        startupSizing = false;
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!term || !fitAddon || !isOpen) {
            startupSizing = false;
            return;
          }
          try {
            fitAddon.fit();
          } catch (_) {
            startupSizing = false;
            return;
          }
          lastResizeSent = null;
          startupSizing = false;
          syncTerminalSize(true);
          console.log(`Terminal startup resize synced after ${reason}`);
        });
      });
    }, waitMs);
  }

  function applyTerminalOutput(record: TerminalOutputRecord): boolean {
    if (!term) return false;
    const reconciliation = reconcileTerminalOutput(appliedOutputOffset, record);
    if (reconciliation.kind === 'gap') return false;
    if (reconciliation.kind === 'write' && reconciliation.data.byteLength) {
      term.write(reconciliation.data);
    }
    appliedOutputOffset = reconciliation.nextOffset;
    return true;
  }

  function requestOutputProjectionRebind(reason: string): void {
    console.warn('Terminal output projection requires rebind:', reason);
    shellHistoryPrimed = false;
    pendingOutput = [];
    pendingOutputBytes = 0;
    appliedOutputOffset = 0;
    socketRegistered = false;
    emitTerminalRegister(shellId || desiredShellId || 'auto');
  }

  function flushPendingOutput(): void {
    if (!term || !pendingOutput.length) return;
    const queued = pendingOutput;
    pendingOutput = [];
    pendingOutputBytes = 0;
    for (const record of queued) {
      if (!applyTerminalOutput(record)) {
        requestOutputProjectionRebind(
          `expected byte ${appliedOutputOffset}, received ${record.startOffset}`,
        );
        return;
      }
    }
  }

  function updateCopyButtonState(): void {
    if (!copyBtn) return;
    let hasSelection = false;
    try { hasSelection = !!(term && term.hasSelection && term.hasSelection()); } catch (_) {}
    copyBtn.disabled = !hasSelection;
  }

  async function copySelection(): Promise<void> {
    if (!term) return;
    let text = '';
    try { text = term.getSelection?.() || ''; } catch (_) {}
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      updateCopyButtonState();
      if (copyBtn) {
        const original = copyBtn.title;
        copyBtn.title = 'Copied';
        setTimeout(() => { copyBtn.title = original || 'Copy selection'; }, 700);
      }
    } catch (err) {
      console.warn('Failed to copy selection:', err);
    }
  }

  function terminalRequestId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function rejectPendingTerminalRequests(message: string): void {
    for (const pending of pendingTerminalRequests.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    pendingTerminalRequests.clear();
  }

  function terminalRequest<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000,
  ): Promise<T> {
    const socket = ws;
    if (!socket?.connected) {
      return Promise.reject(new Error('Terminal socket is disconnected'));
    }
    const id = terminalRequestId();
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingTerminalRequests.delete(id);
        reject(new Error(`Terminal request timed out: ${method}`));
      }, timeoutMs);
      pendingTerminalRequests.set(id, { reject, timer });
      socket.emit('terminal:request', { id, method, params }, (rawResponse) => {
        const pending = pendingTerminalRequests.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        pendingTerminalRequests.delete(id);
        const response = isRecord(rawResponse)
          ? rawResponse as unknown as TerminalRequestResponse<T>
          : null;
        if (!response || response.id !== id) {
          reject(new Error('Terminal response id mismatch'));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || `Terminal request failed: ${method}`));
          return;
        }
        resolve(response.result as T);
      });
    });
  }

  async function fetchShellList(): Promise<TerminalShellListData> {
    try {
      return coerceShellListData(await terminalRequest<unknown>('shells.get'));
    } catch (err) {
      console.warn('Failed to request terminal shells:', err);
    }
    return { active_shell_id: null, shells: [] };
  }

  function setShellMenuOpen(open: boolean): void {
    shellMenuOpen = !!open;
    if (shellMenu) {
      shellMenu.classList.toggle('open', shellMenuOpen);
    }
    if (shellToggle) {
      shellToggle.setAttribute('aria-expanded', shellMenuOpen ? 'true' : 'false');
    }
  }

  function renderShellMenu(shells: TerminalShell[], activeId: string | null): void {
    if (!shellMenu) return;
    shellMenu.innerHTML = '';

    (shells || []).forEach((s) => {
      const row = document.createElement('div');
      row.className = 'terminal-shell-item' + (s.id === activeId ? ' active' : '');
      row.dataset.id = s.id;
      row.classList.toggle('terminal-shell-item-exited', isShellExited(s));

      const label = document.createElement('span');
      label.className = 'terminal-shell-item-label';
      label.textContent = formatShellDisplayLabel(s);

      const edit = document.createElement('button');
      edit.className = 'terminal-shell-item-edit';
      edit.type = 'button';
      edit.dataset.id = s.id;
      edit.textContent = '✏️';
      edit.title = 'Set terminal title';

      const close = document.createElement('button');
      close.className = 'terminal-shell-item-close';
      close.type = 'button';
      close.dataset.id = s.id;
      close.textContent = '✕';
      close.title = 'Close terminal';

      row.appendChild(edit);
      row.appendChild(label);
      row.appendChild(close);

      // Activate on label/row click (ignore close button clicks).
      row.addEventListener('click', async (ev) => {
        if (ev.target === close) return;
        try {
          await terminalRequest('shell.activate', { shell_id: s.id });
        } catch (err) {
          console.warn('Failed to activate terminal shell:', err);
        } finally {
          setShellMenuOpen(false);
        }
      });

      close.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const closingActive = s.id === activeId;
        try {
          await terminalRequest('shell.remove', { shell_id: s.id });
        } catch (err) {
          console.warn('Failed to close terminal shell:', err);
        } finally {
          // If there are still live shells, keep the drawer open and ensure
          // backend "active" points to a live shell so reconnect doesn't spawn
          // a new one. If no live shells remain, close the drawer and prevent
          // auto-reconnect from creating a new shell.
          const data = await fetchShellList();
          const shells = data?.shells || [];
          const liveShells = shells.filter((sh) => !isShellExited(sh));

          if (liveShells.length === 0) {
            try {
              closeAndDisconnect();
            } catch (_) {}
            return;
          }

          const backendActive = data?.active_shell_id || null;
          const backendActiveIsLive = !!(backendActive && liveShells.some((sh) => sh.id === backendActive));
          const nextLiveId = backendActiveIsLive ? backendActive : (liveShells[0]?.id || null);

          if (nextLiveId && (closingActive || !backendActiveIsLive)) {
            try {
              await terminalRequest('shell.activate', { shell_id: nextLiveId });
            } catch (err) {
              console.warn('Failed to activate fallback terminal shell:', err);
            }
          }

          await refreshShellMenu();
        }
      });

      edit.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const current = (s.title || '').trim();
        const next = await window.teUI.dialog.prompt(
          'Terminal title (max 16 chars). Leave blank to clear.',
          current,
        );
        if (next === null) return;
        const trimmed = String(next).trim();
        if (trimmed && trimmed.length > 16) {
          await window.teUI.dialog.alert('Title must be 16 characters or less.');
          return;
        }
        try {
          await terminalRequest('shell.title', { shell_id: s.id, title: trimmed });
        } catch (err) {
          console.warn('Failed to set terminal title:', err);
        } finally {
          await refreshShellMenu();
        }
      });

      shellMenu.appendChild(row);
    });
  }

  async function refreshShellMenu() {
    const data = await fetchShellList();
    const activeId = data.active_shell_id || shellId;
    renderShellMenu(data.shells, activeId);
    const activeShell = (data.shells || []).find((s) => s.id === activeId);
    setShellToggleShell(activeShell || null, activeId);
  }

  if (shellToggle) {
    shellToggle.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const nextOpen = !shellMenuOpen;
      if (nextOpen) {
        try { await refreshShellMenu(); } catch (_) {}
      }
      setShellMenuOpen(nextOpen);
    });
  }

  // Close menu on outside clicks.
  document.addEventListener('click', (ev) => {
    if (!shellMenuOpen) return;
    if (header && ev.target instanceof Node && header.contains(ev.target)) return;
    setShellMenuOpen(false);
  });

  function closeAndDisconnect(): void {
    // Close UI (do NOT destroy shells). Used for project hot-switches.
    try {
      close();
    } catch (_) {}

    setShellMenuOpen(false);

    // Drop the socket so a future open() establishes a fresh bind.
    if (ws) {
      try { ws.disconnect(); } catch (_) {}
      ws = null;
    }
    rejectPendingTerminalRequests('Terminal drawer disconnected');

    // Force fresh history priming on next shell_id message.
    shellId = null;
    lastShellId = null;
    shellHistoryPrimed = false;
    pendingOutput = [];
    pendingOutputBytes = 0;
    appliedOutputOffset = 0;
    bindGeneration = 0;
    desiredShellId = 'auto';
    socketRegistered = false;
    if (shellToggle) {
      shellToggle.textContent = 'Terminal';
    }
  }

  /**
   * Load xterm.js dynamically
   */
  async function loadXterm(): Promise<XtermTerminalCtor> {
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow.Terminal) {
      return runtimeWindow.Terminal;
    }

    await Promise.all([
      loadScript('/static/vendor/xterm/xterm.js'),
      loadStylesheet('/static/vendor/xterm/xterm.css'),
    ]);

    // Load FitAddon after Terminal is loaded
    await loadScript('/static/vendor/xterm/addon-fit.js');

    if (!runtimeWindow.Terminal) throw new Error('Terminal constructor not loaded');
    return runtimeWindow.Terminal;
  }

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadHelperScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = (event) => {
        script.remove();
        reject(event);
      };
      document.head.appendChild(script);
    });
  }

  function helperUrl(name: string, fresh = false): string {
    const url = `${HELPER_BASE_URL}/${name}`;
    if (!fresh) return url;
    return `${url}?ts=${Date.now()}`;
  }

  function getRuntimeWindow(): TerminalRuntimeWindow {
    return window as TerminalRuntimeWindow;
  }

  function getTermTextarea(currentTerm: XtermTerminal | null): HTMLTextAreaElement | null {
    const textarea = currentTerm?.textarea;
    return textarea instanceof HTMLTextAreaElement ? textarea : null;
  }

  function clearDrawerCtrlFocusBinding(): void {
    if (!vendoredCtrlFocusCleanup) return;
    try {
      vendoredCtrlFocusCleanup();
    } catch (_) {}
    vendoredCtrlFocusCleanup = null;
  }

  async function ensureDrawerTouchToMouseHelper(): Promise<void> {
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow.__fileEditorCm6DrawerTouchToMouseLoaded) return;
    await loadHelperScript(helperUrl('touch_to_mouse_handler.js'));
    runtimeWindow.__fileEditorCm6DrawerTouchToMouseLoaded = true;
  }

  function attachDrawerTouchSelection(currentTerm: XtermTerminal): XtermDisposable | null {
    const api = getRuntimeWindow().te2TerminalTouchSelection;
    if (!api) {
      console.warn('Terminal touch selection helper unavailable');
      return null;
    }
    return api.attach(currentTerm);
  }

  function sendTerminalInput(data: string): void {
    if (hasBoundShell()) {
      ws?.volatile.emit('terminal:input', { data });
    }
  }

  async function bindDrawerVendoredCtrlHandler(currentTerm: XtermTerminal | null): Promise<void> {
    if (!currentTerm) return;
    const runtimeWindow = getRuntimeWindow();
    currentTerm.input = sendTerminalInput;
    runtimeWindow.term = currentTerm;
    runtimeWindow.ctrl = !!runtimeWindow.ctrl;
    await loadHelperScript(helperUrl('ctrl_key_handler.js', true));
  }

  function installDrawerVendoredCtrlFocusBinding(currentTerm: XtermTerminal | null): void {
    clearDrawerCtrlFocusBinding();
    const textarea = getTermTextarea(currentTerm);
    if (!textarea || !currentTerm) return;
    const handleFocus = () => {
      publishTerminalSpecialKeyFocus(window, true);
      emitTerminalImeIntent(true, 'textarea_focus');
      void bindDrawerVendoredCtrlHandler(currentTerm).catch((err) => {
        console.warn('Failed to rebind vendored ctrl helper:', err);
      });
    };
    const handleBlur = () => {
      publishTerminalSpecialKeyFocus(window, false);
      emitTerminalImeIntent(false, 'textarea_blur');
    };
    textarea.addEventListener('focus', handleFocus, true);
    textarea.addEventListener('blur', handleBlur, true);
    vendoredCtrlFocusCleanup = () => {
      textarea.removeEventListener('focus', handleFocus, true);
      textarea.removeEventListener('blur', handleBlur, true);
    };
  }

  const disposeTerminalSpecialKeyTarget = bindTerminalSpecialKeyTarget(
    window,
    () => isOpen ? getTermTextarea(term) : null,
  );
  window.addEventListener('pagehide', disposeTerminalSpecialKeyTarget, {
    once: true,
  });

  function setDrawerHelperFocusActive(active: boolean): void {
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.__fileEditorCm6TerminalHelpersActive = !!active;
    if (active && term) {
      runtimeWindow.term = term;
      void bindDrawerVendoredCtrlHandler(term).catch((err) => {
        console.warn('Failed to bind vendored ctrl helper:', err);
      });
      return;
    }
    runtimeWindow.ctrl = false;
    runtimeWindow.term = undefined;
  }

  function loadStylesheet(href: string): Promise<void> {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      document.head.appendChild(link);
    });
  }

  async function ensureSocketIoClient(): Promise<SocketIoClient> {
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow.io) return runtimeWindow.io;
    await loadScript('/static/vendor/socket.io.min.js');
    if (runtimeWindow.io) return runtimeWindow.io;
    throw new Error('Failed to load Socket.IO client');
  }

  /**
   * Destroy the terminal shell permanently
   */
  async function destroyShell(): Promise<void> {
    if (!shellId) return;

    const currentShellId = shellId;
    try {
      await terminalRequest('shell.destroy', { shell_id: currentShellId });
      shellId = null;
      lastShellId = null;
      shellHistoryPrimed = false;
      pendingOutput = [];
      pendingOutputBytes = 0;
      appliedOutputOffset = 0;
      desiredShellId = 'auto';
      socketRegistered = false;
      console.log('Destroyed shell:', currentShellId);
    } catch (err) {
      console.error('Failed to destroy terminal shell:', err);
    }
  }

  function socketConnected(): boolean {
    return !!(ws && ws.connected);
  }

  function hasBoundShell(): boolean {
    return !!(socketConnected() && shellId && desiredShellId && shellId === desiredShellId);
  }

  function emitTerminalRegister(requestedShellId = 'auto'): void {
    desiredShellId = String(requestedShellId || 'auto').trim() || 'auto';
    if (!socketConnected()) {
      socketRegistered = false;
      return;
    }
    ws?.emit('terminal:register', {
      shellId: desiredShellId,
      client_id: 'terminal-drawer',
      cols: getTerminalCols(),
      rows: getTerminalRows(),
    });
    socketRegistered = false;
  }

  async function ensureTerminalSocket(): Promise<TerminalSocket> {
    if (ws) {
      if (ws.connected) return ws;
      try { ws.connect(); } catch (_) {}
      return ws;
    }

    const io = await ensureSocketIoClient();
    const socket = io(SOCKET_IO_NAMESPACES.terminal, {
      path: SOCKET_IO_PATHS.terminal,
      transports: ['websocket'],
      query: fileEditorSocketQuery(),
    });

    socket.on('connect', () => {
      console.log('Terminal Socket.IO connected');
      socketRegistered = false;
      if (desiredShellId) {
        emitTerminalRegister(desiredShellId);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Terminal Socket.IO disconnected', reason);
      socketRegistered = false;
      rejectPendingTerminalRequests(`Terminal socket disconnected: ${String(reason || 'disconnect')}`);
      if (socket.sendBuffer) socket.sendBuffer.length = 0;
    });

    socket.on('terminal:shell_id', (msg) => {
      const receivedShellId = isRecord(msg) ? optionalString(msg.shell_id) : null;
      if (!receivedShellId) return;
      const receivedGeneration = isRecord(msg) && typeof msg.bind_generation === 'number'
        ? msg.bind_generation
        : 0;
      const isNewShell = receivedShellId !== lastShellId || receivedGeneration !== bindGeneration;
      shellId = receivedShellId;
      bindGeneration = receivedGeneration;
      desiredShellId = receivedShellId;
      socketRegistered = true;
      lastResizeSent = null;
      console.log('Received shell ID from server:', shellId);

      if (isNewShell) {
        try {
          term?.reset();
        } catch (_) {
          try { term?.clear(); } catch (_) {}
        }
        shellHistoryPrimed = false;
        pendingOutput = [];
        pendingOutputBytes = 0;
        appliedOutputOffset = 0;
      }
      lastShellId = receivedShellId;
      if (term) {
        void bindDrawerVendoredCtrlHandler(term).catch((err) => {
          console.warn('Failed to bind vendored ctrl helper:', err);
        });
      }
    });

    socket.on('terminal:history', (msg) => {
      if (!term || !isRecord(msg)) return;
      const historyShellId = optionalString(msg.shell_id);
      const historyGeneration = typeof msg.bind_generation === 'number'
        ? msg.bind_generation
        : 0;
      if (historyShellId !== shellId || historyGeneration !== bindGeneration) return;
      if (msg.ok === false) {
        console.error('Failed to load terminal screen checkpoint:', msg.error || 'unknown error');
        return;
      }
      const checkpoint = typeof msg.checkpoint_ansi === 'string' ? msg.checkpoint_ansi : '';
      const parserPending = coerceTerminalBytes(msg.pending_bytes);
      const checkpointOffset = coerceTerminalOffset(msg.output_offset);
      if (checkpointOffset === null || !parserPending) {
        requestOutputProjectionRebind('checkpoint is missing offset or parser state');
        return;
      }
      if (checkpoint) term.write(checkpoint);
      if (parserPending.byteLength) term.write(parserPending);
      appliedOutputOffset = checkpointOffset;
      console.log('Applied terminal screen checkpoint at byte', checkpointOffset);
      shellHistoryPrimed = true;
      flushPendingOutput();
      scheduleStartupResizeSync('history-prime');
    });

    socket.on('terminal:shell_list', (msg) => {
      try {
        const data = coerceShellListData(msg);
        renderShellMenu(data.shells, data.active_shell_id || shellId);
        const activeShellId = data.active_shell_id || shellId;
        const activeShell = data.shells.find((s) => s.id === activeShellId);
        setShellToggleShell(activeShell || null, activeShellId);
      } catch (_) {}
    });

    socket.on('terminal:output', (msg) => {
      if (!term || !isRecord(msg) || optionalString(msg.shell_id) !== shellId) return;
      const record = coerceTerminalOutput(msg);
      if (!record) {
        requestOutputProjectionRebind('received malformed live output');
        return;
      }
      if (!shellHistoryPrimed) {
        pendingOutput.push(record);
        pendingOutputBytes += record.data.byteLength;
        if (pendingOutputBytes > MAX_PENDING_TERMINAL_OUTPUT_BYTES) {
          requestOutputProjectionRebind('pending live output exceeded 1 MiB');
        }
        return;
      }
      if (!applyTerminalOutput(record)) {
        requestOutputProjectionRebind(
          `expected byte ${appliedOutputOffset}, received ${record.startOffset}`,
        );
      }
    });

    socket.on('terminal:closed', async (msg) => {
      console.warn('Terminal closed:', msg);
      const closedShellId = isRecord(msg) ? optionalString(msg.shell_id) : null;
      if (closedShellId && closedShellId === shellId) {
        shellId = null;
        bindGeneration = 0;
        shellHistoryPrimed = false;
        desiredShellId = 'auto';
        socketRegistered = false;
        lastResizeSent = null;
        pendingOutput = [];
        pendingOutputBytes = 0;
        appliedOutputOffset = 0;
      } else if (!closedShellId) {
        socketRegistered = false;
      }
      try {
        await refreshShellMenu();
      } catch (_) {}
    });

    socket.on('terminal:rebind_required', () => {
      shellId = null;
      bindGeneration = 0;
      shellHistoryPrimed = false;
      socketRegistered = false;
      lastResizeSent = null;
      pendingOutput = [];
      pendingOutputBytes = 0;
      appliedOutputOffset = 0;
      emitTerminalRegister('auto');
    });

    socket.on('terminal:error', (msg) => {
      const message = isRecord(msg) && typeof msg.message === 'string' ? msg.message : msg;
      console.error('Terminal error:', message);
    });

    ws = socket;
    return socket;
  }

  /**
   * Initialize xterm.js instance
   */
  async function initTerminal(): Promise<XtermTerminal> {
    if (!(container instanceof HTMLElement)) {
      throw new Error('Terminal container not found');
    }
    const Terminal = await loadXterm();

    // FitAddon might be nested in exports object or directly on window
    const fitAddonExport = getRuntimeWindow().FitAddon;
    const FitAddon = typeof fitAddonExport === 'function'
      ? fitAddonExport
      : fitAddonExport?.FitAddon;
    if (!FitAddon) {
      console.error('Available on window:', Object.keys(window).filter((key) => key.includes('Fit')));
      throw new Error('FitAddon not loaded');
    }

    const nextTerm = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: '#0b0f1a',
        foreground: '#e5e7eb',
      },
    });
    term = nextTerm;

    fitAddon = new FitAddon();
    nextTerm.loadAddon(fitAddon);
    nextTerm.open(container);
    installViewportHandlers();
    await ensureDrawerTouchToMouseHelper();
    touchSelectionDisposable = attachDrawerTouchSelection(nextTerm);
    await bindDrawerVendoredCtrlHandler(nextTerm);
    installDrawerVendoredCtrlFocusBinding(nextTerm);

    container.addEventListener('pointerdown', () => {
      emitTerminalImeIntent(true, 'pointerdown');
      setDrawerHelperFocusActive(true);
      void bindDrawerVendoredCtrlHandler(nextTerm).catch((err) => {
        console.warn('Failed to bind vendored ctrl helper:', err);
      });
      try { nextTerm.focus(); } catch (_) {}
    }, { passive: true });

    // Send user input to PTY
    nextTerm.onData((data) => {
      sendTerminalInput(data);
    });

    // Selection-driven UI affordances.
    nextTerm.onSelectionChange(() => {
      updateCopyButtonState();
    });
    updateCopyButtonState();

    // Handle terminal resize
    nextTerm.onResize(({ cols, rows }) => {
      console.log('Terminal resized:', cols, 'x', rows, 'shellId:', shellId);
      if (startupSizing) return;
      if (hasBoundShell()) {
        syncTerminalSize();
      } else {
        console.warn('No shellId yet, skipping resize');
      }
    });

    // Fit terminal when drawer size changes
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      requestFit(8);
    });
    resizeObserver.observe(container);

    return nextTerm;
  }

  /** Open only the shared drawer shell; this must not create a PTY. */
  function openDrawer(): void {
    if (isOpen) return;
    if (!(drawer instanceof HTMLElement)) return;

    setDrawerCollapsedState(false);
    drawer.classList.add('open');
    setTerminalResizeHandleActive(true);
    isOpen = true;
  }

  /** Activate the terminal surface and lazily create its renderer/session. */
  async function activateTerminal(): Promise<void> {
    openDrawer();
    setDrawerHelperFocusActive(true);
    startupSizing = true;

    if (!term) {
      await initTerminal();
    } else {
      if (!touchSelectionDisposable) {
        touchSelectionDisposable = attachDrawerTouchSelection(term);
      }
      await bindDrawerVendoredCtrlHandler(term);
      installDrawerVendoredCtrlFocusBinding(term);
    }

    await ensureTerminalSocket();
    emitTerminalRegister(shellId || 'auto');
  }

  /** Open the drawer with the terminal explicitly selected. */
  async function open(): Promise<void> {
    openDrawer();
    await activateTerminal();
  }

  /**
   * Close the terminal drawer (terminal stays alive)
   */
  function close(): void {
    if (!isOpen) return;
    if (!(drawer instanceof HTMLElement)) return;

    drawer.classList.remove('open');
    setDrawerCollapsedState(true);
    setTerminalResizeHandleActive(true);
    isOpen = false;
    publishTerminalSpecialKeyFocus(window, false);
    emitTerminalImeIntent(false, 'drawer_close');
    setDrawerHelperFocusActive(false);
    touchSelectionDisposable?.dispose();
    touchSelectionDisposable = null;
    startupSizing = false;
    clearStartupFitTimer();
    lastResizeSent = null;
    // Note: Terminal shell and WebSocket stay alive!
  }

  /**
   * Permanently destroy the terminal
   */
  async function destroy(): Promise<void> {
    console.log('Terminal destroy() called');
    
    // Send destroy command to backend FIRST (before UI cleanup)
    await destroyShell();
    
    // Close drawer UI
    close();
    
    // Close WebSocket (backend already terminated shell)
    if (ws) {
      try { ws.disconnect(); } catch (_) {}
      ws = null;
    }
    
    // Dispose xterm instance
    if (term) {
      touchSelectionDisposable?.dispose();
      touchSelectionDisposable = null;
      term.dispose();
      term = null;
    }
    clearDrawerCtrlFocusBinding();
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.term = undefined;
    runtimeWindow.ctrl = false;
    setDrawerHelperFocusActive(false);
    resizeObserver?.disconnect();
    resizeObserver = null;
    clearStartupFitTimer();
    startupSizing = false;
    if (fitRaf !== null) {
      cancelAnimationFrame(fitRaf);
      fitRaf = null;
    }
    fitFramesRemaining = 0;
    
    if (container instanceof HTMLElement) {
      container.innerHTML = '';
    }
    console.log('Terminal destroy() complete');
  }

  /**
   * Toggle drawer open/closed
   */
  function toggle(): void {
    if (isOpen) {
      close();
    } else {
      void open();
    }
  }

  /**
   * Toggle fullscreen mode
   */
  function toggleFullscreen(): void {
    if (!(drawer instanceof HTMLElement)) return;
    isFullscreen = !isFullscreen;
    drawer.classList.toggle('fullscreen', isFullscreen);
    
    // Update button icon
    if (fullscreenBtn) {
      fullscreenBtn.textContent = isFullscreen ? '⛶' : '⛶';
      fullscreenBtn.title = isFullscreen ? 'Exit drawer fullscreen' : 'Toggle drawer fullscreen';
      fullscreenBtn.setAttribute(
        'aria-label',
        isFullscreen ? 'Exit drawer fullscreen' : 'Toggle drawer fullscreen',
      );
    }

    window.dispatchEvent(new Event('resize'));
    
    // Refit terminal after resize
    if (fitAddon && isOpen) {
      lastResizeSent = null;
      scheduleStartupResizeSync('fullscreen');
    }
  }

  /**
   * Enable manual resize by dragging header
   */
  function enableManualResize(): void {
    if (!header || !drawer) return;

    let startY = 0;
    let startHeight = 0;
    let isResizing = false;

    header.addEventListener('mousedown', (e: MouseEvent) => {
      // Only resize on header background, not interactive controls
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('.terminal-shell-dropdown')) return;
      if (target?.tagName === 'BUTTON') return;
      
      isResizing = true;
      startY = e.clientY;
      startHeight = drawer.offsetHeight;
      
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaY = startY - e.clientY;
      const mobileLayout = document.querySelector('.fe-root')
        ?.classList.contains('layout-mobile') === true;
      const newHeight = clampTerminalDrawerHeight(
        startHeight + deltaY,
        100,
        mobileLayout,
        window.innerHeight - 40,
      );
      
      drawer.style.height = `${newHeight}px`;
      
      // Refit terminal during resize
      if (fitAddon && isOpen) {
        try { fitAddon.fit(); } catch (_) {}
        syncTerminalSize();
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      
      isResizing = false;
      document.body.style.cursor = '';
      
      // Send final size to backend
      lastResizeSent = null;
      requestFit(6);
      syncTerminalSize(true);
    });
  }

  // Wire up UI events
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggle);
  }

  if (newBtn) {
    newBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await terminalRequest('shell.create');
      } catch (err) {
        console.warn('Failed to create new terminal shell:', err);
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', close);
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      applyFontSize(getCurrentFontSize() - FONT_SIZE_STEP);
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      applyFontSize(getCurrentFontSize() + FONT_SIZE_STEP);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await copySelection();
    });
  }

  setDrawerCollapsedState(!drawer?.classList.contains('open'));
  setTerminalResizeHandleActive(
    !!(drawer?.classList.contains('open') || drawer?.classList.contains('terminal-drawer--collapsed'))
  );

  // Enable draggable resize
  enableManualResize();

  // Notify ready
  onReady();

  return {
    open,
    openDrawer,
    activateTerminal,
    close,
    toggle,
    destroy,
    closeAndDisconnect,
    isOpen: () => isOpen,
  };
}
