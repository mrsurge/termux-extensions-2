import { isMobileUserAgent, TERMINAL_KEYS, TerminalModifierState, dispatchSyntheticTerminalKey, dispatchSyntheticTerminalText, MINIBAR_INTERACTION_GUARD_MS, shouldSuppressMinibarInteraction } from '../terminal/src/mobile-special-keys';
import { bindPointerHoldRepeat } from '../terminal/src/pointer-hold-repeat';

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
export class TerminalInputBatcher {
  private chunks: string[] = [];
  private bytes = 0;
  private sending = false;
  private generation = 0;
  constructor(private send: (data: string) => Promise<unknown>, private report: (error: unknown) => void) {}
  reset() { this.generation++; this.chunks = []; this.bytes = 0; this.sending = false; }
  enqueue(data: string) {
    const encoder = new TextEncoder();
    const size = encoder.encode(data).length;
    if (this.bytes + size > 65536) { this.report(new Error('Terminal input queue is full; input was not sent')); return; }
    // Keep each JSON request well below the lane's 64 KiB envelope limit,
    // including escaped controls and multibyte/surrogate-pair input.
    let chunk = '', bytes = 0;
    for (const character of data) {
      const length = encoder.encode(character).length;
      if (bytes + length > 4096) { this.chunks.push(chunk); chunk = ''; bytes = 0; }
      chunk += character; bytes += length;
    }
    if (chunk) this.chunks.push(chunk);
    this.bytes += size;
    const current = this.generation;
    queueMicrotask(() => { if (current === this.generation) void this.flush(); });
  }
  private async flush() {
    if (this.sending || !this.chunks.length) return;
    this.sending = true;
    const current = this.generation, encoder = new TextEncoder();
    let data = this.chunks.shift()!;
    while (this.chunks.length && encoder.encode(data + this.chunks[0]).length <= 4096) data += this.chunks.shift();
    try {
      await this.send(data);
      if (current !== this.generation) return;
      this.bytes -= encoder.encode(data).length;
    } catch (error) {
      if (current === this.generation) { this.reset(); this.report(error); }
    } finally {
      if (current === this.generation) { this.sending = false; void this.flush(); }
    }
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
  let recoverAgain = false;
  let buffered: Delta[] = [], bufferedBytes = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let bindings: Disposable[] = [];
  let mounting: Promise<void> | undefined;
  const error = (value: unknown) => { status.textContent = value instanceof Error ? value.message : 'Terminal unavailable'; report(value); };
  const inputs = new TerminalInputBatcher(data => tabs.terminal('terminal.input', { data }), error);
  function clear() {
    generation++; ready = false; recovering = false; recoverAgain = false; mounting = undefined;
    buffered = []; bufferedBytes = 0; clearTimeout(resizeTimer);
    inputs.reset();
    for (const binding of bindings) binding.dispose(); bindings = [];
    terminal?.dispose(); terminal = undefined; fit = undefined;
    viewport.replaceChildren(); modifiers.reset(); updateModifiers(); identity = ''; shell = '';
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
    inputs.enqueue(data);
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
    const ctrl = keys.querySelector<HTMLButtonElement>('[data-modifier="ctrl"]');
    ctrl?.setAttribute('aria-pressed', String(modifiers.ctrl));
    ctrl?.classList.toggle('toggle', modifiers.ctrl);
    ctrl?.classList.toggle('locked', modifiers.ctrlMode === 'locked');
    if (ctrl) ctrl.title = modifiers.ctrlMode === 'locked' ? 'Control locked' : 'Control';
    const alt = keys.querySelector('[data-modifier="alt"]');
    alt?.setAttribute('aria-pressed', String(modifiers.alt));
    alt?.classList.toggle('toggle', modifiers.alt);
  }
  const mobileKeys = isMobileUserAgent(navigator);
  const keyToggle = drawer.querySelector<HTMLButtonElement>('[data-terminal="keys"]');
  keys.hidden = !mobileKeys;
  if (keyToggle) {
    keyToggle.hidden = !mobileKeys;
    keyToggle.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      keys.hidden = !keys.hidden;
      keyToggle.classList.toggle('toggle', !keys.hidden);
      keyToggle.setAttribute('aria-pressed', String(!keys.hidden));
      keyToggle.title = keys.hidden ? 'Show special keys' : 'Hide special keys';
      terminal?.focus();
    });
    keyToggle.classList.toggle('toggle', mobileKeys);
    keyToggle.title = 'Hide special keys';
  }
  const disposeRepeatingKeys: (() => void)[] = [];
  let minibarGuardUntil = 0;
  const tabsPanel = root.querySelector<HTMLElement>('[data-menu-panel="tabs"]');
  const guardMinibar = (event: Event) => {
    if (!shouldSuppressMinibarInteraction(minibarGuardUntil, performance.now())) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) tabsPanel?.addEventListener(type, guardMinibar, true);
  // Keep the exact Terminal app ordering: two rows of seven.
  for (const name of ['escape', 'minibar', 'dash', 'home', 'up', 'end', 'pageUp', 'tab', 'ctrl', 'alt', 'left', 'down', 'right', 'pageDown']) {
    const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1; button.className = 'kbtn';
    button.textContent = ({ escape: 'ESC', minibar: '≡', dash: '-', home: 'HOME', end: 'END', tab: 'TAB', ctrl: 'CTRL', alt: 'ALT', up: '↑', down: '↓', left: '←', right: '→', pageUp: 'PGUP', pageDown: 'PGDN' } as Record<string, string>)[name]!;
    if (name === 'ctrl' || name === 'alt') button.dataset.modifier = name;
    const dispatch = (target: Terminal, held: { ctrl: boolean; alt: boolean }) => {
      if (!target.textarea) return false;
      target.focus();
      if (name === 'dash' && !held.ctrl && !held.alt) dispatchSyntheticTerminalText(target.textarea, '-');
      else dispatchSyntheticTerminalKey(target.textarea, TERMINAL_KEYS[name as keyof typeof TERMINAL_KEYS], held);
      return true;
    };
    if (mobileKeys && ['up', 'left', 'down', 'right'].includes(name)) {
      let target: Terminal | undefined, held = { ctrl: false, alt: false }, handled = false, heldGeneration = 0;
      const repeat = () => { if (target && heldGeneration === generation) handled = dispatch(target, held) || handled; };
      disposeRepeatingKeys.push(bindPointerHoldRepeat(button, {
        start() { target = terminal; heldGeneration = generation; held = { ctrl: modifiers.ctrl, alt: modifiers.alt }; handled = false; repeat(); },
        repeat,
        finish() { if (handled && heldGeneration === generation) modifiers.consumeOneShot(); updateModifiers(); target = undefined; handled = false; },
      }, { window }));
    } else button.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      if (name === 'ctrl') modifiers.tapCtrl();
      else if (name === 'alt') modifiers.toggleAlt();
      else if (name === 'minibar') {
        try { button.setPointerCapture(event.pointerId); } catch { /* Reveal guard remains authoritative. */ }
        minibarGuardUntil = performance.now() + MINIBAR_INTERACTION_GUARD_MS;
        root.querySelector<HTMLButtonElement>('[data-menu-toggle="tabs"]')?.click();
      }
      else if (terminal && dispatch(terminal, modifiers)) modifiers.consumeOneShot();
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
    disposeRepeatingKeys.forEach(dispose => dispose());
    for (const type of ['pointerdown', 'pointerup', 'click']) tabsPanel?.removeEventListener(type, guardMinibar, true);
    disposed = true; clear(); resize.disconnect();
    socket.off('terminal_output', output); socket.off('terminal_reset', reset); socket.off('disconnect', disconnected);
  } };
}
