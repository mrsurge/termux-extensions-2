import ReconnectingWebSocket from 'reconnecting-websocket';
import { decode as decodeMessagePack, encode as encodeMessagePack } from '@msgpack/msgpack';
import {
  getConsoleBridgeStatus,
  initConsoleBridge,
} from 'te2-console-bridge';
import {
  TERMINAL_LIFECYCLE_CODEC,
  TERMINAL_LIFECYCLE_NAMESPACE,
  TERMINAL_LIFECYCLE_PATH,
  TerminalLifecycleClient,
  type TerminalLifecycleSocket,
  type TerminalShellRecord as ShellRecord,
  type TerminalShellSnapshot,
} from './terminal-lifecycle-client';
import {
  dispatchSyntheticTerminalKey,
  dispatchSyntheticTerminalText,
  isMobileUserAgent,
  MINIBAR_INTERACTION_GUARD_MS,
  shouldSuppressMinibarInteraction,
  TERMINAL_KEYS,
  TerminalModifierState,
  type CtrlMode,
  type TerminalKeyModifiers,
  type SyntheticTerminalKey,
} from './mobile-special-keys';
import { bindPointerHoldRepeat } from './pointer-hold-repeat';

interface AppApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

interface HostBridge {
  toast?: (message: string) => void;
}

interface TeDialogApi {
  alert(message: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
}

declare global {
  interface Window {
    teUI: {
      dialog: TeDialogApi;
    };
  }
}

interface SidebarCwdPayload {
  cwd: string;
  reason?: string;
  ts?: number;
}

interface SidebarWindowStatePayload {
  state?: {
    shell_id?: string;
    cwd?: string;
    reset?: boolean;
    requested_shell_id?: string;
    url?: string;
    query_state?: Record<string, string>;
  };
}

interface LifecycleSnapshotResult {
  snapshot: TerminalShellSnapshot;
}

interface LifecycleShellMutationResult extends LifecycleSnapshotResult {
  shell_id: string;
}

interface ClientAttachMessage {
  type: 'attach';
  request_id: string;
  shell_id: string;
  cols: number;
  rows: number;
}

interface ClientInputMessage {
  type: 'input';
  data: Uint8Array;
}

interface ClientResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface ClientDestroyMessage {
  type: 'destroy';
}

interface ClientPingMessage {
  type: 'ping';
  request_id: string;
}

type ClientMessage = ClientAttachMessage | ClientInputMessage | ClientResizeMessage | ClientDestroyMessage | ClientPingMessage;

interface ServerCheckpointFrame {
  type: 'checkpoint';
  request_id: string;
  shell_id: string;
  sequence: number;
  cols: number;
  rows: number;
  scrollback: number;
  state: Uint8Array;
}

interface ServerOutputFrame {
  type: 'output';
  sequence: number;
  data: Uint8Array;
}

interface ServerExitFrame {
  type: 'exit';
  sequence: number;
  exit_code?: number | null;
  reason?: string;
}

interface ServerErrorFrame {
  type: 'error';
  code?: string;
  message?: string;
  fatal?: boolean;
}

interface ServerPongFrame {
  type: 'pong';
  request_id?: string;
}

type ServerFrame = ServerCheckpointFrame | ServerOutputFrame | ServerExitFrame | ServerErrorFrame | ServerPongFrame;

interface UiRefs {
  list: HTMLElement;
  listContainer: HTMLElement;
  showExited: HTMLInputElement;
  terminalContainer: HTMLElement;
  keys: HTMLElement;
  drawerOverlay: HTMLElement;
  btnMenu: HTMLButtonElement;
  btnNew: HTMLButtonElement;
  btnRefresh: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  btnKill: HTMLButtonElement;
  btnRemove: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  keyToggle: HTMLButtonElement;
  title: HTMLElement;
  status: HTMLElement;
  termContainer: HTMLElement;
  keyEsc: HTMLButtonElement;
  keyMinibar: HTMLButtonElement;
  keyDash: HTMLButtonElement;
  keyHome: HTMLButtonElement;
  keyUp: HTMLButtonElement;
  keyEnd: HTMLButtonElement;
  keyPageUp: HTMLButtonElement;
  keyTab: HTMLButtonElement;
  keyCtrl: HTMLButtonElement;
  keyAlt: HTMLButtonElement;
  keyLeft: HTMLButtonElement;
  keyDown: HTMLButtonElement;
  keyRight: HTMLButtonElement;
  keyPageDown: HTMLButtonElement;
}

interface XtermTheme {
  background?: string;
  cursor?: string;
}

interface XtermOptions {
  convertEol?: boolean;
  cursorBlink?: boolean;
  scrollback?: number;
  fontFamily?: string;
  fontSize?: number;
  theme?: XtermTheme;
}

interface XtermDisposable {
  dispose(): void;
}

interface XtermAddonLike {
  dispose?(): void;
  activate?(terminal: XtermTerminalLike): void;
}

interface XtermFitAddonLike extends XtermAddonLike {
  fit(): void;
}

interface XtermFitAddonConstructor {
  new (): XtermFitAddonLike;
}

interface XtermWebFontsAddonLike extends XtermAddonLike {
  loadFonts(fonts?: (string | FontFace)[]): Promise<FontFace[]>;
  relayout(): Promise<void>;
}

interface XtermWebFontsAddonConstructor {
  new (initialRelayout?: boolean): XtermWebFontsAddonLike;
}

interface XtermWebFontsAddonNamespace {
  WebFontsAddon?: XtermWebFontsAddonConstructor;
  loadFonts?: (fonts?: (string | FontFace)[]) => Promise<FontFace[]>;
}

interface XtermTerminalLike {
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
  options: { fontSize?: number };
  open(container: HTMLElement): void;
  focus(): void;
  dispose(): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  scrollToBottom(): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  loadAddon(addon: XtermAddonLike): void;
  onData(handler: (data: string) => void): XtermDisposable;
  onResize(handler: (event: { cols: number; rows: number }) => void): XtermDisposable;
  onScroll?(handler: (viewportY: number) => void): XtermDisposable;
  onSelectionChange?(handler: () => void): XtermDisposable;
  hasSelection?(): boolean;
  getSelection?(): string;
  getSelectionPosition?(): {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | undefined;
  select?(column: number, row: number, length: number): void;
  selectAll?(): void;
  clearSelection?(): void;
  paste?(data: string): void;
  scrollLines?(lines: number): void;
  attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void;
  attachCustomInputEventHandler?(handler: (event: InputEvent) => boolean): XtermDisposable;
  attachCustomTouchEventHandler?(handler: (event: TouchEvent, isScrollGesture: boolean) => boolean): XtermDisposable;
  setOption?(key: string, value: unknown): void;
}

interface TerminalTouchSelectionApi {
  attach(terminal: XtermTerminalLike): XtermDisposable;
}

type VendoredCtrlTerminal = XtermTerminalLike & {
  input?: (data: string) => void;
  textarea?: HTMLTextAreaElement | null;
};

interface XtermTerminalConstructor {
  new (options?: XtermOptions): XtermTerminalLike;
}

interface SocketIoSocketLike {
  connected?: boolean;
  connect?: () => void;
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

type SocketIoFactory = (
  namespace: string,
  options?: Record<string, unknown>,
) => SocketIoSocketLike;

interface AppState {
  shells: ShellRecord[];
  shellGeneration: string;
  shellRevision: number;
  shellsReady: boolean;
  activeId: string | null;
  ws: ReconnectingWebSocket | null;
  wsDesiredId: string | null;
  attachRequestId: string | null;
  checkpointReady: boolean;
  lastSeqApplied: number;
  term: XtermTerminalLike | null;
  fitAddon: XtermFitAddonLike | null;
  doFit: (() => void) | null;
  fitRaf: number | null;
  fitFramesRemaining: number;
  lastResizeSent: string | null;
  resizeObserver: ResizeObserver | null;
  touchSelection: XtermDisposable | null;
  mode: 'list' | 'terminal';
  showExited: boolean;
  specialKeysVisible: boolean;
  modifiers: TerminalModifierState;
  ctrlFocusCleanup: (() => void) | null;
  inputBuffer: string;
  inputBatchMode: InputBatchMode | null;
  inputBufferStartedAt: number | null;
  inputFlushTimer: number | null;
  inputLastChunk: string | null;
  inputLastChunkAt: number | null;
  encoder: TextEncoder;
}

interface SidebarStateContext {
  enabled: boolean;
  hostId: string;
  tokenId: string;
  consoleWorkerId: string;
  initialShellId: string;
  initialCwd: string;
}

type InputBatchMode = 'normal' | 'fast' | 'repeat';

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 1;
const FONT_SIZE_STORAGE_KEY = 'te2_terminal_font_size';
const TERMINAL_WEB_FONT_FAMILY = 'JetBrains Mono';
const TERMINAL_FONT_FAMILY = `"${TERMINAL_WEB_FONT_FAMILY}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
const INPUT_NORMAL_DELAY_MS = 16;
const INPUT_NORMAL_MAX_HOLD_MS = 48;
const INPUT_FAST_DELAY_MS = 24;
const INPUT_FAST_MAX_HOLD_MS = 72;
const INPUT_REPEAT_DELAY_MS = 64;
const INPUT_REPEAT_MAX_HOLD_MS = 176;
const INPUT_REPEAT_GAP_MS = 42;
const INPUT_FLUSH_THRESHOLD = 1024;
const HELPER_BASE_URL = '/apps/terminal/vendor/android-terminalapp-assets-js';
const CTRL_STATE_EVENT = 'android-terminalapp-ctrl-state';
const TERMINAL_STREAM_CODEC = 'msgpack-v1';
const UI_IPC_RPC_EVENT = 'rpc';
const UI_IPC_RPC_CODEC = 'msgpack-v1';
const UI_IPC_IME_FOCUS = 'ui.ime.focus';
const UI_IPC_IME_BLUR = 'ui.ime.blur';
let terminalConsoleBridgeInitialized = false;
let terminalUiIpcSocket: SocketIoSocketLike | null = null;
let terminalUiIpcConnectWarningShown = false;

function getSocketIoGlobal(): unknown {
  return (window as Window & { io?: unknown }).io;
}

function getSocketIoFactory(): SocketIoFactory | null {
  const io = getSocketIoGlobal();
  return typeof io === 'function' ? io as SocketIoFactory : null;
}

function getXtermGlobal(): XtermTerminalConstructor | null {
  return ((window as Window & { Terminal?: XtermTerminalConstructor }).Terminal) ?? null;
}

function getFitAddonGlobal(): XtermFitAddonConstructor | null {
  const fitGlobal = (window as Window & { FitAddon?: XtermFitAddonConstructor | { FitAddon?: XtermFitAddonConstructor } }).FitAddon;
  if (!fitGlobal) return null;
  if (typeof fitGlobal === 'function') return fitGlobal;
  return fitGlobal.FitAddon ?? null;
}

function getWebFontsAddonGlobal(): XtermWebFontsAddonConstructor | null {
  const fontsGlobal = (window as Window & {
    WebFontsAddon?: XtermWebFontsAddonConstructor | XtermWebFontsAddonNamespace;
  }).WebFontsAddon;
  if (!fontsGlobal) return null;
  if (typeof fontsGlobal === 'function') return fontsGlobal;
  return fontsGlobal.WebFontsAddon ?? null;
}

function getRuntimeWindow(): Window & {
  io?: unknown;
  Terminal?: XtermTerminalConstructor;
  FitAddon?: XtermFitAddonConstructor | { FitAddon?: XtermFitAddonConstructor };
  WebFontsAddon?: XtermWebFontsAddonConstructor | XtermWebFontsAddonNamespace;
  __terminalTestingTouchToMouseLoaded?: boolean;
  te2TerminalTouchSelection?: TerminalTouchSelectionApi;
  __androidTerminalCtrlDesired?: boolean;
  __androidTerminalSetCtrl?: (active: boolean) => void;
  __te2MobileCtrlLocked?: boolean;
  ctrl?: boolean;
  term?: VendoredCtrlTerminal | null;
} {
  return window as Window & {
    io?: unknown;
    Terminal?: XtermTerminalConstructor;
    FitAddon?: XtermFitAddonConstructor | { FitAddon?: XtermFitAddonConstructor };
    WebFontsAddon?: XtermWebFontsAddonConstructor | XtermWebFontsAddonNamespace;
    __terminalTestingTouchToMouseLoaded?: boolean;
    te2TerminalTouchSelection?: TerminalTouchSelectionApi;
    __androidTerminalCtrlDesired?: boolean;
    __androidTerminalSetCtrl?: (active: boolean) => void;
    __te2MobileCtrlLocked?: boolean;
    ctrl?: boolean;
    term?: VendoredCtrlTerminal | null;
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (event) => reject(event);
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

async function ensureTouchToMouseHelper(): Promise<void> {
  const runtimeWindow = getRuntimeWindow();
  if (runtimeWindow.__terminalTestingTouchToMouseLoaded) return;
  await loadHelperScript(helperUrl('touch_to_mouse_handler.js'));
  runtimeWindow.__terminalTestingTouchToMouseLoaded = true;
}

function attachTouchSelection(terminal: XtermTerminalLike): XtermDisposable | null {
  const api = getRuntimeWindow().te2TerminalTouchSelection;
  if (!api) {
    console.warn('[terminal] touch selection helper unavailable');
    return null;
  }
  return api.attach(terminal);
}

async function ensureSocketIoClient(): Promise<void> {
  if (getSocketIoGlobal()) return;
  await loadScript('/static/vendor/socket.io.min.js');
  if (!getSocketIoGlobal()) {
    throw new Error('Failed to load Socket.IO client');
  }
}

async function ensureTerminalConsoleBridge(workerId = ''): Promise<void> {
  if (terminalConsoleBridgeInitialized) return;
  try {
    await ensureSocketIoClient();
    const inheritedWorkerId = workerId.trim();
    const bridge = initConsoleBridge(
      inheritedWorkerId
        ? {
            workerLabel: 'terminal',
            workerId: inheritedWorkerId,
          }
        : {
            workerLabel: 'terminal',
            uniquePerWindow: true,
          },
    );
    if (bridge) {
      terminalConsoleBridgeInitialized = true;
      console.info('[terminal] console bridge ready', bridge.workerId);
    }
  } catch (error) {
    console.warn('[terminal] failed to init console bridge', error);
  }
}

async function ensureUiIpcSocket(): Promise<SocketIoSocketLike | null> {
  if (terminalUiIpcSocket) {
    if (!terminalUiIpcSocket.connected) {
      try {
        terminalUiIpcSocket.connect?.();
      } catch {
        // IME hints are best-effort.
      }
    }
    return terminalUiIpcSocket;
  }

  try {
    await ensureSocketIoClient();
    const io = getSocketIoFactory();
    if (!io) return null;
    const socket = io('/ui_ipc', {
      path: '/ui_ipc_ws/socket.io',
      transports: ['websocket'],
      query: {
        app_id: 'code_te2',
        source: 'terminal_app',
      },
      auth: { rpcCodec: UI_IPC_RPC_CODEC },
    });
    socket.on('connect_error', (error: unknown) => {
      if (terminalUiIpcConnectWarningShown) return;
      terminalUiIpcConnectWarningShown = true;
      console.warn('[terminal] UI IPC IME relay unavailable', error);
    });
    terminalUiIpcSocket = socket;
    return socket;
  } catch (error) {
    if (!terminalUiIpcConnectWarningShown) {
      terminalUiIpcConnectWarningShown = true;
      console.warn('[terminal] UI IPC IME relay unavailable', error);
    }
    return null;
  }
}

function emitTerminalImeIntent(active: boolean, trigger: string): void {
  void ensureUiIpcSocket().then((socket) => {
    if (!socket) return;
    socket.emit(
      UI_IPC_RPC_EVENT,
      encodeMessagePack(
        {
          jsonrpc: '2.0',
          method: active ? UI_IPC_IME_FOCUS : UI_IPC_IME_BLUR,
          params: {
            source: 'terminal_app',
            surface: 'terminal',
            trigger,
          },
        },
        { ignoreUndefined: true },
      ),
    );
  });
}

function ensureXtermCSS(): void {
  const href = '/static/vendor/xterm/xterm.css';
  const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((node) => {
    const link = node as HTMLLinkElement;
    return typeof link.href === 'string' && link.href.includes('/static/vendor/xterm/xterm.css');
  });
  if (exists) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

async function ensureXterm(): Promise<XtermTerminalConstructor> {
  const existing = getXtermGlobal();
  if (existing) return existing;
  ensureXtermCSS();
  await loadScript('/static/vendor/xterm/xterm.js');
  const loaded = getXtermGlobal();
  if (!loaded) throw new Error('Failed to load xterm');
  return loaded;
}

async function ensureFitAddon(): Promise<XtermFitAddonConstructor> {
  const existing = getFitAddonGlobal();
  if (existing) return existing;
  await loadScript('/static/vendor/xterm/addon-fit.js');
  const loaded = getFitAddonGlobal();
  if (!loaded) throw new Error('Failed to load xterm fit addon');
  return loaded;
}

async function ensureWebFontsAddon(): Promise<XtermWebFontsAddonConstructor> {
  const existing = getWebFontsAddonGlobal();
  if (existing) return existing;
  await loadScript('/static/vendor/xterm/addon-web-fonts.js');
  const loaded = getWebFontsAddonGlobal();
  if (!loaded) throw new Error('Failed to load xterm web-fonts addon');
  return loaded;
}

function getRequired<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required node: ${selector}`);
  }
  return node;
}

function shortId(id: string | null | undefined): string {
  return String(id || '').slice(-8);
}

function isObjectRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function isServerCheckpointFrame(raw: unknown): raw is ServerCheckpointFrame {
  if (!isObjectRecord(raw)) return false;
  return raw.type === 'checkpoint'
    && typeof raw.request_id === 'string'
    && typeof raw.shell_id === 'string'
    && typeof raw.sequence === 'number'
    && typeof raw.cols === 'number'
    && typeof raw.rows === 'number'
    && typeof raw.scrollback === 'number'
    && raw.state instanceof Uint8Array;
}

function isServerOutputFrame(raw: unknown): raw is ServerOutputFrame {
  if (!isObjectRecord(raw)) return false;
  return raw.type === 'output'
    && typeof raw.sequence === 'number'
    && raw.data instanceof Uint8Array;
}

function isServerExitFrame(raw: unknown): raw is ServerExitFrame {
  if (!isObjectRecord(raw)) return false;
  return raw.type === 'exit'
    && typeof raw.sequence === 'number'
    && (raw.exit_code === undefined || raw.exit_code === null || typeof raw.exit_code === 'number')
    && (raw.reason === undefined || typeof raw.reason === 'string');
}

function isServerErrorFrame(raw: unknown): raw is ServerErrorFrame {
  if (!isObjectRecord(raw)) return false;
  return raw.type === 'error'
    && (raw.code === undefined || typeof raw.code === 'string')
    && (raw.message === undefined || typeof raw.message === 'string')
    && (raw.fatal === undefined || typeof raw.fatal === 'boolean');
}

function isServerPongFrame(raw: unknown): raw is ServerPongFrame {
  if (!isObjectRecord(raw)) return false;
  return raw.type === 'pong'
    && (raw.request_id === undefined || typeof raw.request_id === 'string');
}

async function parseServerFrame(raw: unknown): Promise<ServerFrame | null> {
  try {
    let bytes: Uint8Array;
    if (raw instanceof Blob) {
      bytes = new Uint8Array(await raw.arrayBuffer());
    } else if (raw instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw);
    } else if (ArrayBuffer.isView(raw)) {
      bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else {
      return null;
    }
    const parsed: unknown = decodeMessagePack(bytes);
    if (isServerCheckpointFrame(parsed)) return parsed;
    if (isServerOutputFrame(parsed)) return parsed;
    if (isServerExitFrame(parsed)) return parsed;
    if (isServerErrorFrame(parsed)) return parsed;
    if (isServerPongFrame(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: string | null | undefined): string {
  return (value || '').trim();
}

function parseSidebarStateContext(): SidebarStateContext {
  const params = new URLSearchParams(window.location.search);
  const hostId = nonEmptyString(params.get('te2_host_id'));
  return {
    enabled: Boolean(hostId),
    hostId,
    tokenId: nonEmptyString(params.get('te2_token_id')) || 'terminal',
    consoleWorkerId: nonEmptyString(
      params.get('te2_console_worker_id')
        || params.get('console_worker_id'),
    ),
    initialShellId: nonEmptyString(params.get('shell_id')),
    initialCwd: nonEmptyString(params.get('cwd')),
  };
}

function isShellAlive(record: ShellRecord | null | undefined): boolean {
  return Boolean(record?.stats?.alive || record?.status === 'running');
}

export default function initTerminalApp(root: HTMLElement, api: AppApi, host: HostBridge): void {
  const sidebarState = parseSidebarStateContext();
  const consoleBridgeReady = ensureTerminalConsoleBridge(sidebarState.consoleWorkerId);
  const mobileSpecialKeysAvailable = isMobileUserAgent(window.navigator);

  const ui: UiRefs = {
    list: getRequired(root, '#ta-shell-list'),
    listContainer: getRequired(root, '#ta-list-container'),
    showExited: getRequired(root, '#ta-show-exited'),
    terminalContainer: getRequired(root, '#ta-terminal-container'),
    keys: getRequired(root, '#ta-keys'),
    drawerOverlay: getRequired(root, '#ta-drawer-overlay'),
    btnMenu: getRequired(root, '#ta-btn-menu'),
    btnNew: getRequired(root, '#ta-btn-new'),
    btnRefresh: getRequired(root, '#ta-btn-refresh'),
    btnStop: getRequired(root, '#ta-btn-stop'),
    btnKill: getRequired(root, '#ta-btn-kill'),
    btnRemove: getRequired(root, '#ta-btn-remove'),
    zoomOut: getRequired(root, '#ta-zoom-out'),
    zoomIn: getRequired(root, '#ta-zoom-in'),
    keyToggle: getRequired(root, '#ta-key-toggle'),
    title: getRequired(root, '#ta-shell-title'),
    status: getRequired(root, '#ta-shell-status'),
    termContainer: getRequired(root, '#ta-term'),
    keyEsc: getRequired(root, '#k-esc'),
    keyMinibar: getRequired(root, '#k-minibar'),
    keyDash: getRequired(root, '#k-dash'),
    keyHome: getRequired(root, '#k-home'),
    keyUp: getRequired(root, '#k-up'),
    keyEnd: getRequired(root, '#k-end'),
    keyPageUp: getRequired(root, '#k-page-up'),
    keyTab: getRequired(root, '#k-tab'),
    keyCtrl: getRequired(root, '#k-ctrl'),
    keyAlt: getRequired(root, '#k-alt'),
    keyLeft: getRequired(root, '#k-left'),
    keyDown: getRequired(root, '#k-down'),
    keyRight: getRequired(root, '#k-right'),
    keyPageDown: getRequired(root, '#k-page-down'),
  };

  const state: AppState = {
    shells: [],
    shellGeneration: '',
    shellRevision: 0,
    shellsReady: false,
    activeId: null,
    ws: null,
    wsDesiredId: null,
    attachRequestId: null,
    checkpointReady: false,
    lastSeqApplied: 0,
    term: null,
    fitAddon: null,
    doFit: null,
    fitRaf: null,
    fitFramesRemaining: 0,
    lastResizeSent: null,
    resizeObserver: null,
    touchSelection: null,
    mode: 'list',
    showExited: false,
    specialKeysVisible: true,
    modifiers: new TerminalModifierState(),
    ctrlFocusCleanup: null,
    inputBuffer: '',
    inputBatchMode: null,
    inputBufferStartedAt: null,
    inputFlushTimer: null,
    inputLastChunk: null,
    inputLastChunkAt: null,
    encoder: new TextEncoder(),
  };
  let initialSidebarStateApplied = false;
  let lifecycleClient: TerminalLifecycleClient | null = null;
  let syncingVendoredCtrl = false;
  let minibarInteractionGuardUntil = 0;

  function requireLifecycleClient(): TerminalLifecycleClient {
    if (!lifecycleClient) {
      throw new Error('Terminal lifecycle socket is not ready');
    }
    return lifecycleClient;
  }

  function applyShellSnapshot(snapshot: TerminalShellSnapshot): void {
    if (
      state.shellGeneration === snapshot.generation
      && snapshot.revision < state.shellRevision
    ) return;
    state.shellGeneration = snapshot.generation;
    state.shellRevision = snapshot.revision;
    state.shellsReady = snapshot.ready;
    state.shells = snapshot.shells;

    const activeId = state.activeId;
    if (activeId && !state.shells.some((item) => item.id === activeId)) {
      disposeSession();
      state.activeId = null;
      ui.title.textContent = 'No shell selected';
      setStatus('removed');
      setMode('list');
      if (sidebarState.enabled) resetSidebarShellState(activeId);
    }
    renderShellList();
    void applyInitialSidebarShellState();
  }

  async function startLifecycleClient(): Promise<void> {
    await ensureSocketIoClient();
    const io = getSocketIoFactory();
    if (!io) throw new Error('Socket.IO client is unavailable');
    const socket = io(TERMINAL_LIFECYCLE_NAMESPACE, {
      path: TERMINAL_LIFECYCLE_PATH,
      transports: ['websocket'],
      autoConnect: false,
      auth: { rpcCodec: TERMINAL_LIFECYCLE_CODEC },
    }) as unknown as TerminalLifecycleSocket;
    lifecycleClient = new TerminalLifecycleClient(
      socket,
      applyShellSnapshot,
      (connected) => {
        if (state.mode !== 'list') return;
        setStatus(connected ? '' : 'lifecycle disconnected');
      },
      (error) => console.warn('[terminal] lifecycle socket error', error),
    );
    lifecycleClient.start();
  }

  async function concreteConsoleWorkerId(): Promise<string> {
    try {
      await consoleBridgeReady;
    } catch {
      // State publication is still useful without console bridge status.
    }
    const status = getConsoleBridgeStatus();
    return nonEmptyString(status.workerId) || sidebarState.consoleWorkerId;
  }

  async function resolveNewShellCwd(): Promise<string> {
    if (!sidebarState.enabled) return '~';
    try {
      const payload = await requireLifecycleClient().request<SidebarCwdPayload>('sidebar.cwd.get');
      return nonEmptyString(payload.cwd) || sidebarState.initialCwd || '~';
    } catch (error) {
      console.warn('[terminal] sidebar cwd lookup failed; using local default', error);
      return sidebarState.initialCwd || '~';
    }
  }

  async function publishSidebarShellState(shellId: string | null, options: { cwd?: string; reset?: boolean; requestedShellId?: string } = {}): Promise<void> {
    if (!sidebarState.enabled) return;
    const liveShellId = nonEmptyString(shellId || '');
    const cwd = nonEmptyString(options.cwd);
    const queryState: Record<string, string> = {};
    if (liveShellId) {
      queryState.shell_id = liveShellId;
      if (cwd) queryState.cwd = cwd;
    }
    try {
      const consoleWorkerId = await concreteConsoleWorkerId();
      await requireLifecycleClient().request<SidebarWindowStatePayload>('sidebar.state.publish', {
        host_id: sidebarState.hostId,
        hostId: sidebarState.hostId,
        token_id: sidebarState.tokenId,
        tokenId: sidebarState.tokenId,
        console_worker_id: consoleWorkerId,
        consoleWorkerId,
        shell_id: liveShellId || nonEmptyString(options.requestedShellId),
        shellId: liveShellId || nonEmptyString(options.requestedShellId),
        cwd,
        reset: Boolean(options.reset || !liveShellId),
        query_state: queryState,
        queryState,
      });
    } catch (error) {
      console.warn('[terminal] sidebar shell state publish failed', error);
    }
  }

  function resetSidebarShellState(requestedShellId?: string): void {
    void publishSidebarShellState(null, {
      reset: true,
      requestedShellId,
    });
  }

  async function createShell(): Promise<void> {
    try {
      const cwd = await resolveNewShellCwd();
      const data = await requireLifecycleClient().request<LifecycleShellMutationResult>(
        'shell.create',
        { cwd },
      );
      applyShellSnapshot(data.snapshot);
      await selectShell(data.shell_id);
      host.toast?.('New shell started');
    } catch (error) {
      console.error(error);
      await window.teUI.dialog.alert(
        `Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function requestFit(frames = 8): void {
    if (!state.term || !state.fitAddon || !state.doFit) return;
    state.fitFramesRemaining = Math.max(state.fitFramesRemaining, Math.max(1, Number(frames) || 1));
    if (state.fitRaf !== null) return;

    const step = (): void => {
      state.fitRaf = null;
      if (!state.term || !state.fitAddon || !state.doFit) return;
      try {
        state.doFit();
      } catch {
        return;
      }
      state.fitFramesRemaining = Math.max(0, state.fitFramesRemaining - 1);
      if (state.fitFramesRemaining > 0) {
        state.fitRaf = requestAnimationFrame(step);
      }
    };

    state.fitRaf = requestAnimationFrame(step);
  }

  async function ensureFontLoaded(fontFamily: string, timeoutMs = 900): Promise<void> {
    const fam = String(fontFamily || '').trim();
    if (!fam) return;
    if (!document.fonts || typeof document.fonts.load !== 'function') return;

    try {
      await Promise.race([
        document.fonts.load(`12px "${fam}"`),
        new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0))),
      ]);
    } catch {
      return;
    }
  }

  async function prepareTerminalWebFonts(): Promise<XtermWebFontsAddonLike | null> {
    try {
      const WebFontsAddonCtor = await ensureWebFontsAddon();
      const webFontsAddon = new WebFontsAddonCtor(true);
      await webFontsAddon.loadFonts([TERMINAL_WEB_FONT_FAMILY]);
      return webFontsAddon;
    } catch (error) {
      console.warn('[terminal] JetBrains Mono webfont preload failed; falling back to browser font handling', error);
      await ensureFontLoaded(TERMINAL_WEB_FONT_FAMILY, 1200);
      return null;
    }
  }

  function getStoredFontSize(): number {
    try {
      const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      return 12;
    }
    return 12;
  }

  function getCurrentFontSize(): number {
    const size = state.term?.options?.fontSize;
    return typeof size === 'number' && Number.isFinite(size) ? size : getStoredFontSize();
  }

  function applyFontSize(size: number): void {
    if (!state.term) return;
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
    try {
      state.term.options.fontSize = clamped;
    } catch {
      try {
        state.term.setOption?.('fontSize', clamped);
      } catch {
        return;
      }
    }
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clamped));
    } catch {
      // ignore
    }
    ui.zoomOut.title = `Zoom out (${clamped}px)`;
    ui.zoomIn.title = `Zoom in (${clamped}px)`;
    requestFit(6);
  }

  function syncSpecialKeysUi(): void {
    const visible = mobileSpecialKeysAvailable && state.specialKeysVisible;
    ui.keys.hidden = !visible;
    ui.keyToggle.hidden = !mobileSpecialKeysAvailable;
    ui.keyToggle.classList.toggle('toggle', visible);
    ui.keyToggle.setAttribute('aria-pressed', String(visible));
    ui.keyToggle.title = visible ? 'Hide special keys' : 'Show special keys';
    requestFit(8);
  }

  function toggleSpecialKeys(): void {
    if (!mobileSpecialKeysAvailable) return;
    state.specialKeysVisible = !state.specialKeysVisible;
    syncSpecialKeysUi();
  }

  function setMode(mode: 'list' | 'terminal'): void {
    state.mode = mode;
    root.classList.remove('mode-list', 'mode-terminal', 'drawer-open');
    root.classList.add(mode === 'terminal' ? 'mode-terminal' : 'mode-list');
  }

  function openDrawer(): void {
    root.classList.add('drawer-open');
  }

  function openDrawerFromSoftKey(event: Event): void {
    if (
      event instanceof PointerEvent
      && event.currentTarget instanceof Element
    ) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The capture guard below remains authoritative if capture is unavailable.
      }
    }
    minibarInteractionGuardUntil = performance.now() + MINIBAR_INTERACTION_GUARD_MS;
    openDrawer();
  }

  function suppressPrematureMinibarInteraction(event: Event): void {
    if (!shouldSuppressMinibarInteraction(
      minibarInteractionGuardUntil,
      performance.now(),
    )) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function closeDrawer(): void {
    root.classList.remove('drawer-open');
  }

  function refocusTerm(): void {
    try {
      state.term?.focus();
    } catch {
      return;
    }
  }

  function syncModifierUi(): void {
    const ctrlActive = state.modifiers.ctrl;
    ui.keyCtrl.classList.toggle('toggle', ctrlActive);
    ui.keyCtrl.classList.toggle('locked', state.modifiers.ctrlMode === 'locked');
    ui.keyCtrl.setAttribute('aria-pressed', String(ctrlActive));
    ui.keyCtrl.title = state.modifiers.ctrlMode === 'locked'
      ? 'Control locked'
      : 'Control';
    ui.keyAlt.classList.toggle('toggle', state.modifiers.alt);
    ui.keyAlt.setAttribute('aria-pressed', String(state.modifiers.alt));
  }

  async function setVendoredCtrlEnabled(active: boolean): Promise<void> {
    const runtimeWindow = getRuntimeWindow();
    if (typeof runtimeWindow.__androidTerminalSetCtrl === 'function') {
      runtimeWindow.__androidTerminalSetCtrl(active);
      return;
    }
    await loadHelperScript(helperUrl(active ? 'enable_ctrl_key.js' : 'disable_ctrl_key.js', true));
  }

  function setCtrlMode(mode: CtrlMode, publish = true): void {
    state.modifiers.setCtrlMode(mode);
    const runtimeWindow = getRuntimeWindow();
    const active = mode !== 'off';
    runtimeWindow.__te2MobileCtrlLocked = mode === 'locked';
    runtimeWindow.__androidTerminalCtrlDesired = active;
    syncModifierUi();
    if (!publish) return;
    syncingVendoredCtrl = true;
    void setVendoredCtrlEnabled(active)
      .catch((error) => {
        console.warn('[terminal] failed to set vendored ctrl helper', error);
      })
      .finally(() => {
        syncingVendoredCtrl = false;
      });
  }

  function consumeOneShotModifiers(): void {
    const ctrlWasArmed = state.modifiers.ctrlMode === 'armed';
    state.modifiers.consumeOneShot();
    if (ctrlWasArmed) {
      setCtrlMode('off');
      return;
    }
    syncModifierUi();
  }

  function clearCtrlMode(): void {
    const runtimeWindow = getRuntimeWindow();
    state.modifiers.reset();
    runtimeWindow.__te2MobileCtrlLocked = false;
    runtimeWindow.__androidTerminalCtrlDesired = false;
    runtimeWindow.ctrl = false;
    runtimeWindow.term = null;
    clearVendoredCtrlFocusBinding();
    syncModifierUi();
  }

  function getTermTextarea(term: XtermTerminalLike | null): HTMLTextAreaElement | null {
    const textarea = (term as VendoredCtrlTerminal | null)?.textarea;
    return textarea instanceof HTMLTextAreaElement ? textarea : null;
  }

  function clearVendoredCtrlFocusBinding(): void {
    if (!state.ctrlFocusCleanup) return;
    try {
      state.ctrlFocusCleanup();
    } catch {
      // ignore
    }
    state.ctrlFocusCleanup = null;
  }

  async function bindVendoredCtrlHandler(currentTerm: XtermTerminalLike | null): Promise<void> {
    if (!currentTerm) return;
    const runtimeWindow = getRuntimeWindow();
    const vendoredTerm = currentTerm as VendoredCtrlTerminal;
    vendoredTerm.input = (data: string) => queueInput(data);
    runtimeWindow.term = vendoredTerm;
    await loadHelperScript(helperUrl('ctrl_key_handler.js', true));
  }

  function installVendoredCtrlFocusBinding(currentTerm: XtermTerminalLike | null): void {
    clearVendoredCtrlFocusBinding();
    const textarea = getTermTextarea(currentTerm);
    if (!textarea || !currentTerm) return;
    const handleFocus = () => {
      emitTerminalImeIntent(true, 'textarea_focus');
      void bindVendoredCtrlHandler(currentTerm).catch((error) => {
        console.warn('[terminal] failed to rebind vendored ctrl helper', error);
      });
    };
    const handleBlur = () => {
      emitTerminalImeIntent(false, 'textarea_blur');
    };
    textarea.addEventListener('focus', handleFocus, true);
    textarea.addEventListener('blur', handleBlur, true);
    state.ctrlFocusCleanup = () => {
      textarea.removeEventListener('focus', handleFocus, true);
      textarea.removeEventListener('blur', handleBlur, true);
    };
  }

  function toggleCtrl(): void {
    const mode = state.modifiers.tapCtrl();
    setCtrlMode(mode);
  }

  function toggleAlt(): void {
    state.modifiers.toggleAlt();
    syncModifierUi();
  }

  function syncVendoredCtrlFromEvent(event: Event): void {
    if (syncingVendoredCtrl) return;
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    const active = Boolean(detail?.active);
    if (!active && state.modifiers.ctrlMode === 'locked') {
      setCtrlMode('locked');
      return;
    }
    state.modifiers.setCtrlMode(active ? 'armed' : 'off');
    syncModifierUi();
  }

  function installVendoredCtrlStateListener(): void {
    window.addEventListener(CTRL_STATE_EVENT, syncVendoredCtrlFromEvent as EventListener);
    const runtimeWindow = getRuntimeWindow();
    state.modifiers.setCtrlMode(
      runtimeWindow.ctrl
        ? (runtimeWindow.__te2MobileCtrlLocked ? 'locked' : 'armed')
        : 'off',
    );
    syncModifierUi();
  }

  function clearVendoredCtrlRuntime(): void {
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.term = null;
    runtimeWindow.__androidTerminalCtrlDesired = false;
    runtimeWindow.__te2MobileCtrlLocked = false;
    runtimeWindow.ctrl = false;
  }

  function bindVendoredCtrlOnPointerDown(): void {
    void bindVendoredCtrlHandler(state.term).catch((error) => {
      console.warn('[terminal] failed to rebind vendored ctrl helper', error);
    });
  }

  function softKey(handler: (event: Event) => void): (ev: Event) => void {
    return (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      handler(ev);
      refocusTerm();
    };
  }

  function resolveTerminalKeyTarget(): {
    term: XtermTerminalLike;
    textarea: HTMLTextAreaElement;
  } | null {
    const term = state.term;
    if (!term) return null;
    const textarea = getTermTextarea(term);
    return textarea ? { term, textarea } : null;
  }

  function dispatchTerminalKeyToTarget(
    target: { term: XtermTerminalLike; textarea: HTMLTextAreaElement },
    key: SyntheticTerminalKey,
    modifiers: TerminalKeyModifiers,
  ): boolean {
    try { target.term.focus(); } catch (_) {}
    if (
      key === TERMINAL_KEYS.dash
      && !modifiers.ctrl
      && !modifiers.alt
    ) {
      dispatchSyntheticTerminalText(target.textarea, '-');
      return true;
    }
    dispatchSyntheticTerminalKey(target.textarea, key, modifiers);
    return true;
  }

  function dispatchTerminalKey(key: SyntheticTerminalKey): void {
    const target = resolveTerminalKeyTarget();
    if (!target) return;
    const handled = dispatchTerminalKeyToTarget(target, key, {
      ctrl: state.modifiers.ctrl,
      alt: state.modifiers.alt,
    });
    if (handled) consumeOneShotModifiers();
  }

  function bindRepeatingTerminalKey(
    button: HTMLButtonElement,
    key: SyntheticTerminalKey,
  ): () => void {
    let target: ReturnType<typeof resolveTerminalKeyTarget> = null;
    let modifiers: TerminalKeyModifiers | null = null;
    let handled = false;
    const dispatch = (): void => {
      if (!target || !modifiers) return;
      handled = dispatchTerminalKeyToTarget(target, key, modifiers) || handled;
    };
    return bindPointerHoldRepeat(button, {
      start() {
        target = resolveTerminalKeyTarget();
        modifiers = {
          ctrl: state.modifiers.ctrl,
          alt: state.modifiers.alt,
        };
        handled = false;
        dispatch();
      },
      repeat: dispatch,
      finish() {
        if (handled) consumeOneShotModifiers();
        target = null;
        modifiers = null;
        handled = false;
      },
    }, { window });
  }

  function wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/app/terminal/terminal?codec=${encodeURIComponent(TERMINAL_STREAM_CODEC)}`;
  }

  function getTerminalCols(term: XtermTerminalLike | null): number {
    return Math.max(1, Number(term?.cols) || 0);
  }

  function getTerminalRows(term: XtermTerminalLike | null): number {
    return Math.max(1, Number(term?.rows) || 0);
  }

  function clearInputBuffer(): void {
    state.inputBuffer = '';
    state.inputBatchMode = null;
    state.inputBufferStartedAt = null;
    if (state.inputFlushTimer !== null) {
      clearTimeout(state.inputFlushTimer);
      state.inputFlushTimer = null;
    }
  }

  function sendMessage(payload: ClientMessage): void {
    const ws = state.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeMessagePack(payload, { ignoreUndefined: true }));
  }

  function shouldFlushImmediately(data: string): boolean {
    return data.includes('\r') || data.includes('\n') || data === '\u0003' || data === '\u0004' || data === '\u001b';
  }

  function isAnsiControlSequence(data: string): boolean {
    return data.startsWith('\u001b') && data.length > 1;
  }

  function isLikelyBulkInput(data: string): boolean {
    return data.length > 1 && !isAnsiControlSequence(data);
  }

  function mergeBatchMode(current: InputBatchMode | null, next: InputBatchMode): InputBatchMode {
    if (current === 'repeat' || next === 'repeat') return 'repeat';
    if (current === 'fast' || next === 'fast') return 'fast';
    return 'normal';
  }

  function classifyBatchMode(data: string, now: number): InputBatchMode {
    const gapMs = state.inputLastChunkAt === null ? Number.POSITIVE_INFINITY : now - state.inputLastChunkAt;
    if (gapMs <= INPUT_REPEAT_GAP_MS) {
      if (state.inputLastChunk === data) return 'repeat';
      return 'fast';
    }
    return 'normal';
  }

  function batchPolicy(mode: InputBatchMode): { delayMs: number; maxHoldMs: number } {
    if (mode === 'repeat') {
      return { delayMs: INPUT_REPEAT_DELAY_MS, maxHoldMs: INPUT_REPEAT_MAX_HOLD_MS };
    }
    if (mode === 'fast') {
      return { delayMs: INPUT_FAST_DELAY_MS, maxHoldMs: INPUT_FAST_MAX_HOLD_MS };
    }
    return { delayMs: INPUT_NORMAL_DELAY_MS, maxHoldMs: INPUT_NORMAL_MAX_HOLD_MS };
  }

  function flushInput(): void {
    if (!state.inputBuffer) return;
    const data = state.inputBuffer;
    clearInputBuffer();
    const bytes = state.encoder.encode(data);
    sendMessage({ type: 'input', data: bytes });
  }

  function queueInput(data: string): void {
    const now = performance.now();
    const nextMode = classifyBatchMode(data, now);
    state.inputLastChunk = data;
    state.inputLastChunkAt = now;
    state.inputBuffer += data;
    if (state.inputBufferStartedAt === null) {
      state.inputBufferStartedAt = now;
    }
    const bytes = state.encoder.encode(state.inputBuffer);
    if (shouldFlushImmediately(data) || isLikelyBulkInput(data) || bytes.byteLength >= INPUT_FLUSH_THRESHOLD) {
      flushInput();
      return;
    }

    state.inputBatchMode = mergeBatchMode(state.inputBatchMode, nextMode);
    const mode = state.inputBatchMode || 'normal';
    const { delayMs, maxHoldMs } = batchPolicy(mode);
    const heldForMs = now - state.inputBufferStartedAt;
    if (heldForMs >= maxHoldMs) {
      flushInput();
      return;
    }

    if (state.inputFlushTimer !== null) {
      clearTimeout(state.inputFlushTimer);
    }
    const nextDelayMs = Math.max(0, Math.min(delayMs, maxHoldMs - heldForMs));
    state.inputFlushTimer = window.setTimeout(flushInput, nextDelayMs);
  }

  function clearSocket(): void {
    clearInputBuffer();
    if (state.ws) {
      try {
        state.ws.close(1000, 'dispose');
      } catch {
        // ignore
      }
    }
    state.ws = null;
  }

  function setStatus(message: string): void {
    const status = message.trim();
    ui.status.textContent = status
      ? status.startsWith('connected')
        ? '👍'
        : '👎'
      : '';
    ui.status.title = status;
    ui.status.setAttribute('aria-label', status ? `Terminal status: ${status}` : '');
  }

  function handleServerFrame(frame: ServerFrame): void {
    if (frame.type === 'checkpoint') {
      if (!state.term || frame.request_id !== state.attachRequestId) return;
      if (frame.shell_id !== state.wsDesiredId) return;
      state.checkpointReady = false;
      state.lastSeqApplied = frame.sequence;
      state.term.reset();
      if (state.term.cols !== frame.cols || state.term.rows !== frame.rows) {
        state.term.resize(frame.cols, frame.rows);
      }
      state.term.write(frame.state, () => {
        if (frame.request_id !== state.attachRequestId || !state.term) return;
        state.term.scrollToBottom();
        requestFit(6);
      });
      state.checkpointReady = true;
      setStatus('connected');
      return;
    }

    if (frame.type === 'output') {
      if (!state.term || !state.checkpointReady) return;
      if (frame.sequence <= state.lastSeqApplied) return;
      state.lastSeqApplied = frame.sequence;
      state.term.write(frame.data);
      return;
    }

    if (frame.type === 'exit') {
      state.lastSeqApplied = Math.max(state.lastSeqApplied, frame.sequence);
      setStatus(frame.reason || 'exited');
      if (sidebarState.enabled) {
        resetSidebarShellState(state.activeId || undefined);
      }
      return;
    }

    if (frame.type === 'error') {
      const message = frame.message || 'Terminal socket error';
      setStatus(message);
      host.toast?.(message);
    }
  }

  function makeRequestId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function connectWs(shellId: string): void {
    state.wsDesiredId = shellId;
    clearSocket();

    const ws = new ReconnectingWebSocket(wsUrl(), [], {
      minReconnectionDelay: 400,
      maxReconnectionDelay: 4000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 4000,
      maxEnqueuedMessages: 0,
      minUptime: 1000,
    });
    ws.binaryType = 'arraybuffer';
    state.ws = ws;

    ws.addEventListener('open', () => {
      const cols = getTerminalCols(state.term);
      const rows = getTerminalRows(state.term);
      const requestId = makeRequestId();
      state.attachRequestId = requestId;
      state.checkpointReady = false;
      const message: ClientAttachMessage = {
        type: 'attach',
        request_id: requestId,
        shell_id: shellId,
        cols,
        rows,
      };
      setStatus('connecting…');
      sendMessage(message);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      void parseServerFrame(event.data).then((frame) => {
        if (frame) handleServerFrame(frame);
      });
    });

    ws.addEventListener('close', () => {
      clearInputBuffer();
      setStatus('disconnected');
    });

    ws.addEventListener('error', () => {
      setStatus('socket error');
    });
  }

  function disposeSession(): void {
    emitTerminalImeIntent(false, 'dispose_session');
    state.wsDesiredId = null;
    state.attachRequestId = null;
    state.checkpointReady = false;
    state.lastSeqApplied = 0;
    clearSocket();
    state.lastResizeSent = null;
    if (state.fitRaf !== null) {
      cancelAnimationFrame(state.fitRaf);
      state.fitRaf = null;
    }
    state.fitFramesRemaining = 0;
    try {
      state.resizeObserver?.disconnect();
    } catch {
      // ignore
    }
    state.resizeObserver = null;
    try {
      state.touchSelection?.dispose();
    } catch {
      // ignore
    }
    state.touchSelection = null;
    try {
      state.term?.dispose();
    } catch {
      // ignore
    }
    state.term = null;
    state.fitAddon = null;
    state.doFit = null;
    ui.termContainer.innerHTML = '';
    clearCtrlMode();
    clearVendoredCtrlRuntime();
  }

  async function applyInitialSidebarShellState(): Promise<void> {
    if (!sidebarState.enabled || initialSidebarStateApplied || !state.shellsReady) return;
    initialSidebarStateApplied = true;
    const requestedShellId = sidebarState.initialShellId;
    if (!requestedShellId) return;
    const rec = state.shells.find((item) => item.id === requestedShellId) || null;
    if (rec && isShellAlive(rec)) {
      await selectShell(rec.id);
      return;
    }
    setMode('list');
    resetSidebarShellState(requestedShellId);
  }

  async function listShells(resync = false): Promise<void> {
    const data = await requireLifecycleClient().request<LifecycleSnapshotResult>(
      resync ? 'shells.resync' : 'shells.get',
    );
    applyShellSnapshot(data.snapshot);
  }

  function formatUptime(seconds?: number): string {
    if (!seconds || seconds < 1) return 'new';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  function renderShellList(): void {
    ui.list.innerHTML = '';
    if (!state.shellsReady) {
      ui.list.innerHTML = '<div style="color:var(--muted-foreground);">Loading terminals…</div>';
      return;
    }
    const visibleShells = state.showExited
      ? state.shells
      : state.shells.filter((record) => isShellAlive(record));
    if (!visibleShells.length) {
      ui.list.innerHTML = state.shells.length
        ? '<div style="color:var(--muted-foreground);">No running shells.</div>'
        : '<div style="color:var(--muted-foreground);">No shells yet.</div>';
      return;
    }

    visibleShells.forEach((rec) => {
      const alive = Boolean(rec.stats?.alive);
      const uptime = formatUptime(rec.stats?.uptime);
      const el = document.createElement('div');
      const active = state.activeId === rec.id;
      el.className = `ta-shell-item${active ? ' active' : ''}`;
      if (active) el.setAttribute('aria-current', 'true');
      const removeMarkup = alive ? '' : '<button class="app-btn ta-shell-remove" type="button">Close</button>';
      el.innerHTML = `
        <div class="ta-status-dot ${alive ? 'ta-dot-alive' : 'ta-dot-dead'}"></div>
        <div class="ta-shell-main">
          <div class="ta-shell-title">${rec.label || 'terminal-stream'} · <span style="color:var(--muted-foreground);">${shortId(rec.id)}</span></div>
          <div class="ta-shell-meta">
            <span class="ta-badge">${rec.status || (alive ? 'running' : 'exited')}</span>
            ${rec.cwd ? `<span>${rec.cwd}</span>` : ''}
            ${uptime ? `<span>uptime ${uptime}</span>` : ''}
          </div>
        </div>
        <div class="ta-shell-actions">${removeMarkup}</div>
      `;
      const removeButton = el.querySelector<HTMLButtonElement>('.ta-shell-remove');
      if (removeButton) {
        removeButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void removeShellById(rec.id);
        });
      }
      el.addEventListener('click', () => {
        void selectShell(rec.id);
      });
      ui.list.appendChild(el);
    });
  }

  function installGlobalViewportHandlers(): void {
    if ((installGlobalViewportHandlers as (() => void) & { installed?: boolean }).installed) {
      return;
    }
    (installGlobalViewportHandlers as (() => void) & { installed?: boolean }).installed = true;

    window.addEventListener('resize', () => requestFit(8), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => requestFit(10), { passive: true });
      window.visualViewport.addEventListener('scroll', () => requestFit(4), { passive: true });
    }
  }

  function scheduleResizeSync(shellId: string, cols: number, rows: number, force = false): void {
    const nextCols = Math.max(1, Number(cols) || 0);
    const nextRows = Math.max(1, Number(rows) || 0);
    if (!nextCols || !nextRows) return;
    const key = `${shellId}:${nextCols}x${nextRows}`;
    if (!force && state.lastResizeSent === key) return;
    state.lastResizeSent = key;
    sendMessage({ type: 'resize', cols: nextCols, rows: nextRows });
  }

  async function selectShell(id: string): Promise<void> {
    const rec = state.shells.find((item) => item.id === id) || null;
    if (!rec || !isShellAlive(rec)) {
      disposeSession();
      state.activeId = null;
      ui.title.textContent = 'No shell selected';
      setStatus(rec ? 'closed' : 'missing shell');
      setMode('list');
      renderShellList();
      resetSidebarShellState(id);
      return;
    }
    state.activeId = id;
    renderShellList();
    ui.title.textContent = shortId(id);
    setStatus('');
    setMode('terminal');
    closeDrawer();
    disposeSession();
    installGlobalViewportHandlers();

    const TerminalCtor = await ensureXterm();
    const webFontsAddon = await prepareTerminalWebFonts();
    const term = new TerminalCtor({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: getStoredFontSize(),
      theme: {
        background: '#0b1020',
        cursor: '#9cc3ff',
      },
    });
    if (webFontsAddon) {
      term.loadAddon(webFontsAddon);
    }
    term.open(ui.termContainer);
    term.focus();
    emitTerminalImeIntent(true, 'select_shell');
    state.term = term;

    await ensureTouchToMouseHelper();
    state.touchSelection = attachTouchSelection(term);
    await bindVendoredCtrlHandler(term);
    installVendoredCtrlFocusBinding(term);
    term.onData((data) => {
      queueInput(data);
    });
    term.onResize(({ cols, rows }) => {
      scheduleResizeSync(id, cols, rows);
    });

    try {
      const FitAddonCtor = await ensureFitAddon();
      const fitAddon = new FitAddonCtor();
      term.loadAddon(fitAddon);
      state.fitAddon = fitAddon;
      state.doFit = () => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      };
      requestFit(18);
      if (typeof ResizeObserver !== 'undefined') {
        state.resizeObserver = new ResizeObserver(() => requestFit(8));
        state.resizeObserver.observe(ui.termContainer);
      }
    } catch (error) {
      console.warn('[terminal] fit addon unavailable', error);
      state.fitAddon = null;
      state.doFit = null;
    }

    applyFontSize(getCurrentFontSize());
    connectWs(id);

    try {
      const cols = getTerminalCols(term);
      const rows = getTerminalRows(term);
      if (cols && rows) {
        scheduleResizeSync(id, cols, rows, true);
      }
    } catch {
      // ignore
    }
    void publishSidebarShellState(id, { cwd: rec?.cwd });
  }

  async function doAction(action: string): Promise<void> {
    if (!state.activeId) return;
    try {
      const result = await requireLifecycleClient().request<LifecycleShellMutationResult>(
        'shell.action',
        { shell_id: state.activeId, action },
      );
      applyShellSnapshot(result.snapshot);
    } catch (error) {
      console.error(error);
      await window.teUI.dialog.alert(
        `Action failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function removeShellById(shellId: string | null): Promise<void> {
    if (!shellId) return;
    if (!(await window.teUI.dialog.confirm('Remove this shell? It will be killed if running.'))) return;
    try {
      const result = await requireLifecycleClient().request<LifecycleShellMutationResult>(
        'shell.remove',
        { shell_id: shellId },
      );
      if (state.activeId === shellId) {
        disposeSession();
        state.activeId = null;
        ui.title.textContent = 'No shell selected';
        setStatus('');
        if (sidebarState.enabled) {
          resetSidebarShellState(shellId);
        }
      }
      applyShellSnapshot(result.snapshot);
    } catch (error) {
      console.error(error);
      await window.teUI.dialog.alert(
        `Remove failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  installVendoredCtrlStateListener();
  ui.termContainer.addEventListener('pointerdown', () => {
    emitTerminalImeIntent(true, 'pointerdown');
    bindVendoredCtrlOnPointerDown();
    refocusTerm();
  }, { passive: true });

  ui.btnNew.addEventListener('click', () => void createShell());
  ui.btnRefresh.addEventListener('click', () => void listShells(true));
  ui.btnStop.addEventListener('click', () => void doAction('stop'));
  ui.btnKill.addEventListener('click', () => void doAction('kill'));
  ui.btnRemove.addEventListener('click', () => void removeShellById(state.activeId));
  ui.btnMenu.addEventListener('click', openDrawer);
  ui.drawerOverlay.addEventListener('click', closeDrawer);
  for (const eventType of ['pointerdown', 'pointerup', 'click']) {
    ui.listContainer.addEventListener(
      eventType,
      suppressPrematureMinibarInteraction,
      true,
    );
  }
  ui.showExited.addEventListener('change', () => {
    state.showExited = ui.showExited.checked;
    renderShellList();
  });
  ui.zoomOut.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() - FONT_SIZE_STEP)), { passive: false });
  ui.zoomIn.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() + FONT_SIZE_STEP)), { passive: false });
  ui.keyToggle.addEventListener('pointerdown', softKey(toggleSpecialKeys), { passive: false });
  ui.keyEsc.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.escape)), { passive: false });
  ui.keyMinibar.addEventListener('pointerdown', softKey(openDrawerFromSoftKey), { passive: false });
  ui.keyDash.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.dash)), { passive: false });
  ui.keyHome.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.home)), { passive: false });
  ui.keyEnd.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.end)), { passive: false });
  ui.keyPageUp.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.pageUp)), { passive: false });
  ui.keyTab.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.tab)), { passive: false });
  ui.keyCtrl.addEventListener('pointerdown', softKey(toggleCtrl), { passive: false });
  ui.keyAlt.addEventListener('pointerdown', softKey(toggleAlt), { passive: false });
  ui.keyPageDown.addEventListener('pointerdown', softKey(() => dispatchTerminalKey(TERMINAL_KEYS.pageDown)), { passive: false });
  const disposeRepeatingKeys = [
    bindRepeatingTerminalKey(ui.keyUp, TERMINAL_KEYS.up),
    bindRepeatingTerminalKey(ui.keyLeft, TERMINAL_KEYS.left),
    bindRepeatingTerminalKey(ui.keyDown, TERMINAL_KEYS.down),
    bindRepeatingTerminalKey(ui.keyRight, TERMINAL_KEYS.right),
  ];
  window.addEventListener('pagehide', () => {
    disposeRepeatingKeys.forEach((dispose) => dispose());
  }, { once: true });

  syncSpecialKeysUi();
  setMode('list');
  void startLifecycleClient().catch((error) => {
    console.error('[terminal] lifecycle startup failed', error);
    setStatus('lifecycle unavailable');
  });
}
