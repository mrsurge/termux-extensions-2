import ReconnectingWebSocket from 'reconnecting-websocket';
import { initConsoleBridge } from 'te2-console-bridge';

interface AppApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

interface HostBridge {
  toast?: (message: string) => void;
}

interface ShellStats {
  alive?: boolean;
  uptime?: number;
}

interface ShellLogs {
  stdout_tail?: string[];
}

interface ShellRecord {
  id: string;
  label?: string;
  status?: string;
  cwd?: string;
  stats?: ShellStats;
  logs?: ShellLogs;
}

interface TerminalConnectParams {
  session_id?: string;
  shell_id?: string;
  cols?: number;
  rows?: number;
  resume_after_seq?: number;
  create_if_missing?: boolean;
  cwd?: string;
  shell?: string | string[];
}

interface TerminalInputParams {
  data_b64: string;
  flush?: 'auto' | 'immediate';
}

interface TerminalResizeParams {
  cols: number;
  rows: number;
}

interface TerminalDestroyParams {}

interface TerminalPingParams {
  nonce?: string;
}

interface ClientNotificationMap {
  'terminal.connect': TerminalConnectParams;
  'terminal.input': TerminalInputParams;
  'terminal.resize': TerminalResizeParams;
  'terminal.destroy': TerminalDestroyParams;
  'terminal.ping': TerminalPingParams;
}

type ClientMethod = keyof ClientNotificationMap;

interface JsonRpcNotification<M extends ClientMethod> {
  jsonrpc: '2.0';
  method: M;
  params: ClientNotificationMap[M];
}

interface ServerHelloFrame {
  type: 'hello';
  session_id: string;
  shell_id: string;
  next_seq?: number;
  resume_mode?: string;
}

interface ServerDataFrame {
  type: 'data';
  seq: number;
  data_b64: string;
}

interface ServerClosedFrame {
  type: 'closed';
  seq?: number;
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
  nonce?: string;
}

interface ServerReadyFrame {
  type: 'ready';
}

type ServerFrame = ServerHelloFrame | ServerDataFrame | ServerClosedFrame | ServerErrorFrame | ServerPongFrame | ServerReadyFrame;

interface UiRefs {
  list: HTMLElement;
  listContainer: HTMLElement;
  terminalContainer: HTMLElement;
  drawerOverlay: HTMLElement;
  btnMenu: HTMLButtonElement;
  btnNew: HTMLButtonElement;
  btnRefresh: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  btnKill: HTMLButtonElement;
  btnRemove: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  title: HTMLElement;
  status: HTMLElement;
  termContainer: HTMLElement;
  keyCtrl: HTMLButtonElement;
  keyTab: HTMLButtonElement;
  keyEsc: HTMLButtonElement;
  keyLeft: HTMLButtonElement;
  keyUp: HTMLButtonElement;
  keyDown: HTMLButtonElement;
  keyRight: HTMLButtonElement;
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

interface XtermFitAddonLike {
  fit(): void;
}

interface XtermFitAddonConstructor {
  new (): XtermFitAddonLike;
}

interface XtermTerminalLike {
  cols: number;
  rows: number;
  options: { fontSize?: number };
  open(container: HTMLElement): void;
  focus(): void;
  dispose(): void;
  write(data: string): void;
  loadAddon(addon: XtermFitAddonLike): void;
  onData(handler: (data: string) => void): XtermDisposable;
  onResize(handler: (event: { cols: number; rows: number }) => void): XtermDisposable;
  attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void;
  setOption?(key: string, value: unknown): void;
}

interface XtermTerminalConstructor {
  new (options?: XtermOptions): XtermTerminalLike;
}

interface XtermRuntimeBridge extends XtermTerminalLike {
  input(data: string): void;
}

interface AppState {
  shells: ShellRecord[];
  activeId: string | null;
  ws: ReconnectingWebSocket | null;
  wsDesiredId: string | null;
  sessionId: string | null;
  lastSeqApplied: number;
  term: XtermTerminalLike | null;
  fitAddon: XtermFitAddonLike | null;
  doFit: (() => void) | null;
  fitRaf: number | null;
  fitFramesRemaining: number;
  lastResizeSent: string | null;
  resizeObserver: ResizeObserver | null;
  mode: 'list' | 'terminal';
  ctrlActive: boolean;
  inputBuffer: string;
  inputBatchMode: InputBatchMode | null;
  inputBufferStartedAt: number | null;
  inputFlushTimer: number | null;
  inputLastChunk: string | null;
  inputLastChunkAt: number | null;
  decoder: TextDecoder;
  encoder: TextEncoder;
}

type InputBatchMode = 'normal' | 'fast' | 'repeat';

const INITIAL_TAIL = 2000;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 1;
const FONT_SIZE_STORAGE_KEY = 'te2_terminal_testing_font_size';
const INPUT_NORMAL_DELAY_MS = 16;
const INPUT_NORMAL_MAX_HOLD_MS = 48;
const INPUT_FAST_DELAY_MS = 24;
const INPUT_FAST_MAX_HOLD_MS = 72;
const INPUT_REPEAT_DELAY_MS = 64;
const INPUT_REPEAT_MAX_HOLD_MS = 176;
const INPUT_REPEAT_GAP_MS = 42;
const INPUT_FLUSH_THRESHOLD = 1024;
const HELPER_BASE_URL = '/apps/terminal_testing/vendor/android-terminalapp-assets-js';
let terminalConsoleBridgeInitialized = false;

function getSocketIoGlobal(): unknown {
  return (window as Window & { io?: unknown }).io;
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

function getRuntimeWindow(): Window & {
  io?: unknown;
  Terminal?: XtermTerminalConstructor;
  FitAddon?: XtermFitAddonConstructor | { FitAddon?: XtermFitAddonConstructor };
  term?: XtermRuntimeBridge;
  ctrl?: boolean;
  __terminalTestingTouchToMouseLoaded?: boolean;
} {
  return window as Window & {
    io?: unknown;
    Terminal?: XtermTerminalConstructor;
    FitAddon?: XtermFitAddonConstructor | { FitAddon?: XtermFitAddonConstructor };
    term?: XtermRuntimeBridge;
    ctrl?: boolean;
    __terminalTestingTouchToMouseLoaded?: boolean;
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

async function bindVendoredCtrlHandler(term: XtermTerminalLike, input: (data: string) => void): Promise<void> {
  const runtimeWindow = getRuntimeWindow();
  const bridge = term as XtermRuntimeBridge;
  bridge.input = input;
  runtimeWindow.term = bridge;
  runtimeWindow.ctrl = false;
  await loadHelperScript(helperUrl('ctrl_key_handler.js', true));
}

async function setVendoredCtrlState(enabled: boolean): Promise<void> {
  const runtimeWindow = getRuntimeWindow();
  runtimeWindow.ctrl = enabled;
  await loadHelperScript(helperUrl(enabled ? 'enable_ctrl_key.js' : 'disable_ctrl_key.js', true));
}

async function ensureSocketIoClient(): Promise<void> {
  if (getSocketIoGlobal()) return;
  await loadScript('/static/vendor/socket.io.min.js');
  if (!getSocketIoGlobal()) {
    throw new Error('Failed to load Socket.IO client');
  }
}

async function ensureTerminalConsoleBridge(): Promise<void> {
  if (terminalConsoleBridgeInitialized) return;
  try {
    await ensureSocketIoClient();
    const bridge = initConsoleBridge({
      workerLabel: 'terminal_testing',
      uniquePerWindow: true,
    });
    if (bridge) {
      terminalConsoleBridgeInitialized = true;
      console.info('[terminal_testing] console bridge ready', bridge.workerId);
    }
  } catch (error) {
    console.warn('[terminal_testing] failed to init console bridge', error);
  }
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(raw: string): Uint8Array {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const parsed = JSON.parse(raw) as ServerFrame;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function frameHasSeq(frame: ServerFrame): frame is ServerDataFrame | ServerClosedFrame {
  return typeof (frame as { seq?: unknown }).seq === 'number';
}

export default function initTerminalApp(root: HTMLElement, api: AppApi, host: HostBridge): void {
  void ensureTerminalConsoleBridge();

  const ui: UiRefs = {
    list: getRequired(root, '#ta-shell-list'),
    listContainer: getRequired(root, '#ta-list-container'),
    terminalContainer: getRequired(root, '#ta-terminal-container'),
    drawerOverlay: getRequired(root, '#ta-drawer-overlay'),
    btnMenu: getRequired(root, '#ta-btn-menu'),
    btnNew: getRequired(root, '#ta-btn-new'),
    btnRefresh: getRequired(root, '#ta-btn-refresh'),
    btnStop: getRequired(root, '#ta-btn-stop'),
    btnKill: getRequired(root, '#ta-btn-kill'),
    btnRemove: getRequired(root, '#ta-btn-remove'),
    zoomOut: getRequired(root, '#ta-zoom-out'),
    zoomIn: getRequired(root, '#ta-zoom-in'),
    title: getRequired(root, '#ta-shell-title'),
    status: getRequired(root, '#ta-shell-status'),
    termContainer: getRequired(root, '#ta-term'),
    keyCtrl: getRequired(root, '#k-ctrl'),
    keyTab: getRequired(root, '#k-tab'),
    keyEsc: getRequired(root, '#k-esc'),
    keyLeft: getRequired(root, '#k-left'),
    keyUp: getRequired(root, '#k-up'),
    keyDown: getRequired(root, '#k-down'),
    keyRight: getRequired(root, '#k-right'),
  };

  const state: AppState = {
    shells: [],
    activeId: null,
    ws: null,
    wsDesiredId: null,
    sessionId: null,
    lastSeqApplied: 0,
    term: null,
    fitAddon: null,
    doFit: null,
    fitRaf: null,
    fitFramesRemaining: 0,
    lastResizeSent: null,
    resizeObserver: null,
    mode: 'list',
    ctrlActive: false,
    inputBuffer: '',
    inputBatchMode: null,
    inputBufferStartedAt: null,
    inputFlushTimer: null,
    inputLastChunk: null,
    inputLastChunkAt: null,
    decoder: new TextDecoder(),
    encoder: new TextEncoder(),
  };

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

  function setMode(mode: 'list' | 'terminal'): void {
    state.mode = mode;
    root.classList.remove('mode-list', 'mode-terminal', 'drawer-open');
    root.classList.add(mode === 'terminal' ? 'mode-terminal' : 'mode-list');
  }

  function openDrawer(): void {
    root.classList.add('drawer-open');
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

  function clearCtrlMode(): void {
    state.ctrlActive = false;
    ui.keyCtrl.classList.remove('toggle');
    void setVendoredCtrlState(false).catch((error) => {
      console.warn('[terminal_testing] failed to disable vendored ctrl helper', error);
    });
  }

  function softKey(handler: () => void): (ev: Event) => void {
    return (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      handler();
      refocusTerm();
    };
  }

  function toggleCtrl(): void {
    state.ctrlActive = !state.ctrlActive;
    ui.keyCtrl.classList.toggle('toggle', state.ctrlActive);
    void setVendoredCtrlState(state.ctrlActive).catch((error) => {
      console.warn('[terminal_testing] failed to toggle vendored ctrl helper', error);
    });
  }

  function wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/app/terminal_testing/terminal`;
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

  function sendNotification<M extends ClientMethod>(method: M, params: ClientNotificationMap[M]): void {
    const ws = state.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: JsonRpcNotification<M> = { jsonrpc: '2.0', method, params };
    ws.send(JSON.stringify(payload));
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

  function flushInput(flush: 'auto' | 'immediate' = 'auto'): void {
    if (!state.inputBuffer) return;
    const data = state.inputBuffer;
    clearInputBuffer();
    const bytes = state.encoder.encode(data);
    sendNotification('terminal.input', {
      data_b64: toBase64(bytes),
      flush,
    });
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
      flushInput('immediate');
      return;
    }

    state.inputBatchMode = mergeBatchMode(state.inputBatchMode, nextMode);
    const mode = state.inputBatchMode || 'normal';
    const { delayMs, maxHoldMs } = batchPolicy(mode);
    const heldForMs = now - state.inputBufferStartedAt;
    if (heldForMs >= maxHoldMs) {
      flushInput('auto');
      return;
    }

    if (state.inputFlushTimer !== null) {
      clearTimeout(state.inputFlushTimer);
    }
    const nextDelayMs = Math.max(0, Math.min(delayMs, maxHoldMs - heldForMs));
    state.inputFlushTimer = window.setTimeout(() => flushInput('auto'), nextDelayMs);
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
    ui.status.textContent = message;
  }

  function handleServerFrame(frame: ServerFrame): void {
    if (frame.type === 'hello') {
      state.sessionId = frame.session_id;
      if (typeof frame.next_seq === 'number' && frame.next_seq > 0) {
        state.lastSeqApplied = Math.max(state.lastSeqApplied, frame.next_seq - 1);
      }
      setStatus(frame.resume_mode ? `connected (${frame.resume_mode})` : 'connected');
      requestFit(6);
      try {
        const cols = getTerminalCols(state.term);
        const rows = getTerminalRows(state.term);
        if (cols && rows) {
          sendNotification('terminal.resize', { cols, rows });
        }
      } catch {
        // ignore
      }
      return;
    }

    if (frame.type === 'data') {
      if (!state.term) return;
      if (frame.seq <= state.lastSeqApplied) return;
      state.lastSeqApplied = frame.seq;
      const text = state.decoder.decode(fromBase64(frame.data_b64), { stream: true });
      if (text) {
        state.term.write(text);
      }
      return;
    }

    if (frame.type === 'closed') {
      if (frameHasSeq(frame) && typeof frame.seq === 'number') {
        state.lastSeqApplied = Math.max(state.lastSeqApplied, frame.seq);
      }
      setStatus(frame.reason || 'closed');
      void listShells();
      return;
    }

    if (frame.type === 'error') {
      const message = frame.message || 'Terminal socket error';
      setStatus(message);
      host.toast?.(message);
    }
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
    state.ws = ws;

    ws.addEventListener('open', () => {
      const cols = getTerminalCols(state.term);
      const rows = getTerminalRows(state.term);
      const params: TerminalConnectParams = {
        shell_id: shellId,
        session_id: state.sessionId || undefined,
        resume_after_seq: state.lastSeqApplied,
        cols: cols || undefined,
        rows: rows || undefined,
      };
      setStatus('connecting…');
      sendNotification('terminal.connect', params);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const frame = parseServerFrame(event.data);
      if (!frame) return;
      handleServerFrame(frame);
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
    state.wsDesiredId = null;
    state.sessionId = null;
    state.lastSeqApplied = 0;
    state.decoder = new TextDecoder();
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
      state.term?.dispose();
    } catch {
      // ignore
    }
    state.term = null;
    state.fitAddon = null;
    state.doFit = null;
    ui.termContainer.innerHTML = '';
    getRuntimeWindow().term = undefined;
    clearCtrlMode();
  }

  async function listShells(): Promise<void> {
    const data = await api.get<ShellRecord[]>('shells');
    state.shells = data;
    renderShellList();
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
    if (!state.shells.length) {
      ui.list.innerHTML = '<div style="color:var(--muted-foreground);">No broker shells yet.</div>';
      return;
    }

    state.shells.forEach((rec) => {
      const alive = Boolean(rec.stats?.alive);
      const uptime = formatUptime(rec.stats?.uptime);
      const el = document.createElement('div');
      el.className = `ta-shell-item${state.activeId === rec.id ? ' active' : ''}`;
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
      `;
      el.addEventListener('click', () => {
        void selectShell(rec.id);
        Array.from(ui.list.children).forEach((child) => child.classList.remove('active'));
        el.classList.add('active');
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

  async function primeFromLogTail(shellId: string): Promise<void> {
    const detail = await api.get<ShellRecord>(`shells/${shellId}?logs=true&tail=${INITIAL_TAIL}`);
    const lines = detail.logs?.stdout_tail;
    if (!Array.isArray(lines) || !state.term) {
      return;
    }

    for (const rawLine of lines) {
      const frame = parseServerFrame(rawLine);
      if (!frame || frame.type !== 'data') {
        continue;
      }
      if (frame.seq <= state.lastSeqApplied) {
        continue;
      }
      state.lastSeqApplied = frame.seq;
      const text = state.decoder.decode(fromBase64(frame.data_b64), { stream: true });
      if (text) {
        state.term.write(text);
      }
    }
  }

  function scheduleResizeSync(shellId: string, cols: number, rows: number, force = false): void {
    const nextCols = Math.max(1, Number(cols) || 0);
    const nextRows = Math.max(1, Number(rows) || 0);
    if (!nextCols || !nextRows) return;
    const key = `${shellId}:${nextCols}x${nextRows}`;
    if (!force && state.lastResizeSent === key) return;
    state.lastResizeSent = key;
    sendNotification('terminal.resize', { cols: nextCols, rows: nextRows });
  }

  async function selectShell(id: string): Promise<void> {
    state.activeId = id;
    const rec = state.shells.find((item) => item.id === id) || null;
    ui.title.textContent = `${rec?.label || 'terminal-stream'} · ${shortId(id)}`;
    setStatus('');
    setMode('terminal');
    closeDrawer();
    disposeSession();
    installGlobalViewportHandlers();

    await ensureFontLoaded('JetBrains Mono', 900);

    const TerminalCtor = await ensureXterm();
    const term = new TerminalCtor({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: getStoredFontSize(),
      theme: {
        background: '#0b1020',
        cursor: '#9cc3ff',
      },
    });
    term.open(ui.termContainer);
    term.focus();
    state.term = term;

    const handleInput = (data: string): void => {
      queueInput(data);
    };

    await ensureTouchToMouseHelper();
    await bindVendoredCtrlHandler(term, handleInput);
    term.onData(handleInput);
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
      console.warn('[terminal_testing] fit addon unavailable', error);
      state.fitAddon = null;
      state.doFit = null;
    }

    applyFontSize(getCurrentFontSize());
    await primeFromLogTail(id);
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
  }

  async function doAction(action: string): Promise<void> {
    if (!state.activeId) return;
    try {
      await api.post(`shells/${state.activeId}/action`, { action });
      await listShells();
    } catch (error) {
      console.error(error);
      alert(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function removeShell(): Promise<void> {
    if (!state.activeId) return;
    if (!confirm('Remove this shell? It will be killed if running.')) return;
    try {
      await api.delete(`shells/${state.activeId}`);
      disposeSession();
      state.activeId = null;
      ui.title.textContent = 'No shell selected';
      setStatus('');
      await listShells();
    } catch (error) {
      console.error(error);
      alert(`Remove failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ui.termContainer.addEventListener('pointerdown', () => refocusTerm(), { passive: true });

  ui.btnNew.addEventListener('click', () => {
    void (async () => {
      try {
        const data = await api.post<ShellRecord>('shells', { cwd: '~' });
        await listShells();
        await selectShell(data.id);
        host.toast?.('New broker shell started');
      } catch (error) {
        console.error(error);
        alert(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  });
  ui.btnRefresh.addEventListener('click', () => void listShells());
  ui.btnStop.addEventListener('click', () => void doAction('stop'));
  ui.btnKill.addEventListener('click', () => void doAction('kill'));
  ui.btnRemove.addEventListener('click', () => void removeShell());
  ui.btnMenu.addEventListener('click', openDrawer);
  ui.drawerOverlay.addEventListener('click', closeDrawer);
  ui.zoomOut.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() - FONT_SIZE_STEP)), { passive: false });
  ui.zoomIn.addEventListener('pointerdown', softKey(() => applyFontSize(getCurrentFontSize() + FONT_SIZE_STEP)), { passive: false });
  ui.keyCtrl.addEventListener('pointerdown', softKey(toggleCtrl), { passive: false });
  ui.keyTab.addEventListener('pointerdown', softKey(() => queueInput('\t')), { passive: false });
  ui.keyEsc.addEventListener('pointerdown', softKey(() => queueInput('\u001b')), { passive: false });
  ui.keyLeft.addEventListener('pointerdown', softKey(() => queueInput('\u001b[D')), { passive: false });
  ui.keyRight.addEventListener('pointerdown', softKey(() => queueInput('\u001b[C')), { passive: false });
  ui.keyUp.addEventListener('pointerdown', softKey(() => queueInput('\u001b[A')), { passive: false });
  ui.keyDown.addEventListener('pointerdown', softKey(() => queueInput('\u001b[B')), { passive: false });

  setMode('list');
  void listShells();
}
