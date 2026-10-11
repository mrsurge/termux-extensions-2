import { isMobileUserAgent, TERMINAL_KEYS, TerminalModifierState, dispatchSyntheticTerminalKey, dispatchSyntheticTerminalText } from '../terminal/src/mobile-special-keys';

interface Disposable { dispose(): void }
interface Terminal {
  cols: number; rows: number; textarea?: HTMLTextAreaElement;
  open(element: HTMLElement): void; loadAddon(addon: object): void;
  write(data: string | Uint8Array, done?: () => void): void;
  reset(): void; focus(): void; dispose(): void;
  onData(callback: (data: string) => void): Disposable;
  attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean): void;
}
interface Fit { fit(): void }
interface Runtime {
  Terminal: new (options: object) => Terminal;
  FitAddon: { FitAddon: new () => Fit };
  WebFontsAddon: { WebFontsAddon: new (initialRelayout: boolean) => { loadFonts(fonts: string[]): Promise<void> } };
  te2TerminalTouchSelection: { attach(terminal: Terminal): Disposable };
}
interface Tab { id: string; shellId: string | null }
interface Reply { tab?: Tab; shellId?: string; ansi?: string; pendingBytes?: Uint8Array; outputOffset?: number }
interface Tabs { readonly tab: Tab | null; terminal(method: string, params?: object): Promise<Reply> }
interface Delta { tabId: string; shellId: string; startOffset: number; endOffset: number; data: Uint8Array }
export class TerminalOutputCursor {
  offset = 0;
  accept(start: number, end: number, bytes: number): 'old' | 'next' | 'gap' {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end - start !== bytes) return 'gap';
    if (end <= this.offset) return 'old';
    if (start !== this.offset) return 'gap';
    this.offset = end;
    return 'next';
  }
}
interface Socket {
  connected: boolean;
  on(event: string, callback: (value: never) => void): void;
  off(event: string, callback: (value: never) => void): void;
}

let runtime: Promise<Runtime> | undefined;
function loadRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  runtime = (async () => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/vendor/xterm/xterm.css'; document.head.append(css);
    for (const src of ['/static/vendor/xterm/xterm.js', '/static/vendor/xterm/addon-fit.js', '/static/vendor/xterm/addon-web-fonts.js', '/apps/code_te2/vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js']) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script'); script.src = src;
        script.onload = () => resolve(); script.onerror = () => reject(new Error('Terminal runtime could not be loaded'));
        document.head.append(script);
      });
    }
    return window as unknown as Runtime;
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}

export function createTerminalDrawer(root: HTMLElement, tabs: Tabs, socket: Socket, report: (error: unknown) => void) {
  const drawer = root.querySelector<HTMLElement>('.fx-terminal-drawer')!;
  const viewport = drawer.querySelector<HTMLElement>('.fx-terminal-viewport')!;
  const keys = drawer.querySelector<HTMLElement>('.fx-terminal-keys')!;
  const status = drawer.querySelector<HTMLElement>('[data-terminal-status]')!;
  const modifiers = new TerminalModifierState();
  let terminal: Terminal | undefined, fit: Fit | undefined;
  let identity = '', shell = '', generation = 0;
  const cursor = new TerminalOutputCursor();
  let ready = false, recovering = false, disposed = false, minimized = false;
  let recoverAgain = false, queuedInputBytes = 0;
  let buffered: Delta[] = [], bufferedBytes = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let bindings: Disposable[] = [];
  let mounting: Promise<void> | undefined;
  const error = (value: unknown) => { status.textContent = value instanceof Error ? value.message : 'Terminal unavailable'; report(value); };
  function clear() {
    generation++; ready = false; recovering = false; recoverAgain = false; mounting = undefined;
    buffered = []; bufferedBytes = 0; clearTimeout(resizeTimer);
    for (const binding of bindings) binding.dispose(); bindings = [];
    terminal?.dispose(); terminal = undefined; fit = undefined;
    viewport.replaceChildren(); modifiers.reset(); identity = ''; shell = '';
  }
  function paint(delta: Delta) {
    const action = cursor.accept(delta.startOffset, delta.endOffset, delta.data.byteLength);
    if (action === 'old') return;
    if (action === 'gap') {
      ready = false; recoverAgain = true; void recover(); return;
    }
    terminal?.write(delta.data);
  }
  function output(delta: Delta) {
    if (delta.tabId !== identity || delta.shellId !== shell || disposed || !terminal) return;
    if (!(delta.data instanceof Uint8Array)) delta = { ...delta, data: new Uint8Array(delta.data) };
    if (!ready) {
      bufferedBytes += delta.data.byteLength;
      if (bufferedBytes > 1024 * 1024 || buffered.length >= 64) {
        // Bounded admission; a fresh checkpoint replaces the entire backlog.
        generation++; recovering = false; buffered = []; bufferedBytes = 0; void recover();
      } else buffered.push(delta);
      return;
    }
    paint(delta);
  }
  async function recover() {
    if (recovering || disposed || !terminal || !socket.connected || minimized) return;
    recovering = true; ready = false; recoverAgain = false;
    const current = generation, view = terminal;
    status.textContent = 'Connecting…';
    try {
      fit?.fit();
      const dimensions = { columns: view.cols, rows: view.rows };
      await tabs.terminal('terminal.resize', dimensions);
      const checkpoint = await tabs.terminal('terminal.checkpoint', dimensions);
      if (current !== generation || terminal !== view || checkpoint.shellId !== shell) return;
      if (typeof checkpoint.ansi !== 'string' || !Number.isSafeInteger(checkpoint.outputOffset)) throw new Error('Invalid terminal checkpoint');
      view.reset();
      await new Promise<void>(resolve => view.write(checkpoint.ansi!, resolve));
      if (current !== generation || terminal !== view) return;
      if (checkpoint.pendingBytes?.length) view.write(new Uint8Array(checkpoint.pendingBytes));
      cursor.offset = checkpoint.outputOffset!; ready = true; status.textContent = 'Terminal';
      const pending = buffered; buffered = []; bufferedBytes = 0;
      for (const delta of pending) { if (!ready) break; paint(delta); }
    } catch (value) { if (current === generation) error(value); }
    finally { if (current === generation) { recovering = false; if (recoverAgain) void recover(); } }
  }
  function input(data: string) {
    if (!ready || !socket.connected) return;
    const size = new TextEncoder().encode(data).length;
    if (queuedInputBytes + size > 65536) { error(new Error('Terminal input queue is full; input was not sent')); return; }
    queuedInputBytes += size;
    void tabs.terminal('terminal.input', { data }).catch(error).finally(() => { queuedInputBytes -= size; });
  }
  function sync(tab: Tab | null) {
    if (!tab?.shellId) { clear(); drawer.hidden = true; return; }
    if (tab.id === identity && tab.shellId === shell) {
      if (!ready) void recover();
      return;
    }
    clear(); identity = tab.id; shell = tab.shellId; minimized = false;
    drawer.hidden = false; drawer.classList.remove('is-minimized');
    const current = generation;
    mounting = (async () => {
      const api = await loadRuntime();
      if (current !== generation || disposed) return;
      const view = new api.Terminal({ convertEol: true, cursorBlink: true, scrollback: 5000,
        fontFamily: '"JetBrains Mono", monospace', fontSize: 13,
        theme: { background: '#0b1020', foreground: '#e6edf3', cursor: '#9cc3ff' } });
      const fonts = new api.WebFontsAddon.WebFontsAddon(true);
      await fonts.loadFonts(['JetBrains Mono']);
      if (current !== generation || disposed) { view.dispose(); return; }
      terminal = view; view.loadAddon(fonts); fit = new api.FitAddon.FitAddon(); view.loadAddon(fit); view.open(viewport);
      view.textarea?.setAttribute('autocapitalize', 'off'); view.textarea?.setAttribute('autocorrect', 'off');
      bindings.push(api.te2TerminalTouchSelection.attach(view));
      bindings.push(view.onData(data => {
        // Mobile IMEs can deliver text through input rather than keydown.
        if (data.length === 1 && (modifiers.ctrl || modifiers.alt)) {
          const code = data.toUpperCase().charCodeAt(0);
          const text = modifiers.ctrl && code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
          input((modifiers.alt ? '\x1b' : '') + text);
          modifiers.consumeOneShot(); updateModifiers();
        } else input(data);
      }));
      view.attachCustomKeyEventHandler(event => {
        if (!modifiers.ctrl && !modifiers.alt || event.ctrlKey || event.altKey || event.type !== 'keydown') return true;
        if (event.key.length === 1) {
          event.preventDefault();
          const code = event.key.toUpperCase().charCodeAt(0);
          const text = modifiers.ctrl && code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : event.key;
          input((modifiers.alt ? '\x1b' : '') + text);
          modifiers.consumeOneShot(); updateModifiers(); return false;
        }
        return true;
      });
      await recover();
    })().catch(value => { if (current === generation) error(value); });
  }
  function updateModifiers() {
    keys.querySelector('[data-modifier="ctrl"]')?.setAttribute('aria-pressed', String(modifiers.ctrl));
    keys.querySelector('[data-modifier="alt"]')?.setAttribute('aria-pressed', String(modifiers.alt));
  }
  keys.hidden = !isMobileUserAgent(navigator);
  for (const name of ['ctrl', 'alt', ...Object.keys(TERMINAL_KEYS)]) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = ({ up: '↑', down: '↓', left: '←', right: '→', pageUp: 'PgUp', pageDown: 'PgDn' } as Record<string, string>)[name] || name;
    if (name === 'ctrl' || name === 'alt') button.dataset.modifier = name;
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (name === 'ctrl') modifiers.tapCtrl();
      else if (name === 'alt') modifiers.toggleAlt();
      else if (terminal?.textarea) {
        if (name === 'dash' && !modifiers.ctrl && !modifiers.alt) dispatchSyntheticTerminalText(terminal.textarea, '-');
        else dispatchSyntheticTerminalKey(terminal.textarea, TERMINAL_KEYS[name as keyof typeof TERMINAL_KEYS], modifiers);
        modifiers.consumeOneShot();
      }
      updateModifiers(); terminal?.focus();
    }); keys.append(button);
  }
  const show = async () => {
    try {
      if (!tabs.tab) return;
      if (!tabs.tab.shellId) await tabs.terminal('terminal.start');
      sync(tabs.tab); drawer.hidden = false; minimized = false;
      drawer.classList.remove('is-minimized'); await mounting; await recover(); terminal?.focus();
    } catch (value) { error(value); }
  };
  root.querySelector('[data-action="terminal"]')!.addEventListener('click', () => void show());
  drawer.querySelector('[data-terminal="minimize"]')!.addEventListener('click', () => {
    minimized = !minimized; drawer.classList.toggle('is-minimized', minimized);
    if (!minimized) { ready = false; void recover(); }
  });
  drawer.querySelector('[data-terminal="maximize"]')!.addEventListener('click', () => {
    drawer.classList.toggle('is-maximized'); ready = false; recoverAgain = true; void recover();
  });
  drawer.querySelector('[data-terminal="close"]')!.addEventListener('click', async () => {
    const ui = window as unknown as { teUI: { dialog: { confirm(message: string): Promise<boolean> } } };
    if (!await ui.teUI.dialog.confirm('Close this terminal? Its running processes will be stopped in every attached window.')) return;
    try { await tabs.terminal('terminal.close'); sync(tabs.tab); } catch (value) { error(value); }
  });
  const resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!minimized && terminal) { ready = false; recoverAgain = true; void recover(); } }, 150);
  }); resize.observe(viewport);
  // Clearing the renderer also fences a still-loading runtime/font promise.
  // Reconnect's authoritative tab snapshot mounts a new view even if IDs match.
  const disconnected = () => { clear(); status.textContent = 'Disconnected'; };
  const reset = (payload: { shellId: string }) => { if (payload.shellId === shell) { ready = false; recoverAgain = true; void recover(); } };
  socket.on('terminal_output', output); socket.on('terminal_reset', reset); socket.on('disconnect', disconnected);
  return { sync, dispose() {
    disposed = true; clear(); resize.disconnect();
    socket.off('terminal_output', output); socket.off('terminal_reset', reset); socket.off('disconnect', disconnected);
  } };
}
