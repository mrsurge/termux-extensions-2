import { isMobileUserAgent, TERMINAL_KEYS, TerminalModifierState, dispatchSyntheticTerminalKey, dispatchSyntheticTerminalText, MINIBAR_INTERACTION_GUARD_MS, shouldSuppressMinibarInteraction } from './mobile-special-keys';
import { bindPointerHoldRepeat } from './pointer-hold-repeat';
import { packObject, unpackObject } from './wire_codec';

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
interface Tab { id: string; shellId: string | null; directoryLocked?: boolean }
interface DirectoryStatus { state: string; path: string }
interface Reply { tab?: Tab; token?: string; shellId?: string; ansi?: string; pendingBytes?: Uint8Array; outputOffset?: number; directoryTracking?: DirectoryStatus }
interface Tabs { readonly tab: Tab | null; terminal(method: string, params?: object): Promise<Reply> }
interface Delta { tabId: string; shellId: string; startOffset: number; endOffset: number; data: Uint8Array }
const TERMINAL_WEB_FONT_FAMILY = 'JetBrains Mono Nerd';
const TERMINAL_FONT_FAMILY = `"${TERMINAL_WEB_FONT_FAMILY}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
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
  constructor(private send: (data: string) => void, private report: (error: unknown) => void) {}
  reset() {} // No retained input or reconnect replay.
  enqueue(data: string) {
    const encoder = new TextEncoder();
    if (encoder.encode(data).length > 65536) {
      this.report(new Error('Terminal input is too large; input was not sent')); return;
    }
    let chunk = '', bytes = 0;
    try {
      for (const character of data) {
        const length = encoder.encode(character).length;
        if (bytes + length > 4096) { this.send(chunk); chunk = ''; bytes = 0; }
        chunk += character; bytes += length;
      }
      if (chunk) this.send(chunk);
    } catch (error) { this.report(error); }
  }
}
interface Socket {
  connected: boolean;
  on(event: string, callback: (value: never) => void): void;
  off(event: string, callback: (value: never) => void): void;
}

export function bindTerminalDrawerResize(root: HTMLElement, drawer: HTMLElement) {
  const handle = drawer.querySelector<HTMLElement>('.fx-terminal-resize-handle');
  let pointer: number | undefined, startY = 0, startHeight = 0, maximum = 0;
  const bounds = () => {
    const content = root.querySelector<HTMLElement>('.fx-content');
    // Toolbar, breadcrumbs and mobile footer are outside this available region.
    return Math.max(0, drawer.getBoundingClientRect().height + (content?.getBoundingClientRect().height || 0) - 48);
  };
  const apply = (height: number) => {
    const minimum = Math.min(160, maximum);
    const value = Math.max(minimum, Math.min(maximum, height));
    drawer.style.setProperty('--fx-terminal-height', `${value}px`);
    drawer.style.setProperty('--fx-terminal-max-height', `${maximum}px`);
    handle?.setAttribute('aria-valuemin', String(minimum));
    handle?.setAttribute('aria-valuemax', String(maximum));
    handle?.setAttribute('aria-valuenow', String(Math.round(value)));
  };
  const cancel = () => {
    if (pointer === undefined) return;
    const previous = pointer;
    pointer = undefined;
    handle?.classList.remove('dragging');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', cancel);
    if (previous !== undefined && handle?.hasPointerCapture(previous)) handle.releasePointerCapture(previous);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    apply(startHeight + startY - event.clientY);
    event.preventDefault();
  };
  const end = (event: PointerEvent) => { if (event.pointerId === pointer) cancel(); };
  const start = (event: PointerEvent) => {
    if (pointer !== undefined || event.button !== 0 || drawer.hidden || drawer.classList.contains('is-minimized')) return;
    maximum = bounds();
    startHeight = drawer.getBoundingClientRect().height;
    startY = event.clientY;
    drawer.classList.remove('is-maximized');
    apply(startHeight);
    pointer = event.pointerId;
    handle?.classList.add('dragging');
    try { handle?.setPointerCapture(pointer); } catch { /* Document listeners retain fallback ownership. */ }
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    window.addEventListener('blur', cancel);
    event.preventDefault(); event.stopPropagation();
  };
  const key = (event: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || drawer.hidden || drawer.classList.contains('is-minimized')) return;
    maximum = bounds();
    const height = drawer.getBoundingClientRect().height;
    drawer.classList.remove('is-maximized');
    apply(event.key === 'Home' ? 0 : event.key === 'End' ? maximum : height + (event.key === 'ArrowUp' ? 16 : -16));
    event.preventDefault(); event.stopPropagation();
  };
  handle?.addEventListener('pointerdown', start);
  handle?.addEventListener('lostpointercapture', cancel);
  handle?.addEventListener('keydown', key);
  return { cancel, dispose() {
    cancel();
    handle?.removeEventListener('pointerdown', start);
    handle?.removeEventListener('lostpointercapture', cancel);
    handle?.removeEventListener('keydown', key);
  } };
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
  const drawerResize = bindTerminalDrawerResize(root, drawer);
  const viewport = drawer.querySelector<HTMLElement>('.fx-terminal-viewport')!;
  const keys = drawer.querySelector<HTMLElement>('.fx-terminal-keys')!;
  const status = drawer.querySelector<HTMLElement>('[data-terminal-status]')!;
  const directoryLock = drawer.querySelector<HTMLInputElement>('[data-terminal="directory-lock"]');
  const directoryStatus = drawer.querySelector<HTMLElement>('[data-directory-status]');
  let lockPending = false;
  let displayedLock = true;
  function showDirectoryStatus(value?: DirectoryStatus) {
    if (!directoryStatus) return;
    directoryStatus.textContent = value?.state === 'pending' ? 'Waiting for terminal directory change'
      : value?.state === 'error' ? 'Terminal directory change failed'
      : value?.state === 'unavailable' ? 'Directory tracking needs a newly started terminal'
      : value?.state === 'starting' ? 'Waiting for terminal directory tracking'
      : '';
  }
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
  let stream: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastColumns = 0, lastRows = 0, resizing = false, resizeAgain = false;
  const error = (value: unknown) => { status.textContent = value instanceof Error ? value.message : 'Terminal unavailable'; report(value); };
  const inputs = new TerminalInputBatcher(data => {
    if (!ready || !socket.connected || !stream || stream.readyState !== WebSocket.OPEN) return;
    if (stream.bufferedAmount > 65536) throw new Error('Terminal input transport is full; input was not sent');
    stream.send(packObject({ type: 'input', data: new TextEncoder().encode(data) }));
  }, error);
  function clear() {
    drawerResize.cancel();
    generation++; ready = false; recovering = false; recoverAgain = false; mounting = undefined;
    lastColumns = 0; lastRows = 0; resizing = false; resizeAgain = false;
    clearTimeout(retryTimer);
    const old = stream; stream = undefined; old?.close();
    buffered = []; bufferedBytes = 0; clearTimeout(resizeTimer);
    inputs.reset();
    for (const binding of bindings) binding.dispose(); bindings = [];
    terminal?.dispose(); terminal = undefined; fit = undefined;
    viewport.replaceChildren(); modifiers.reset(); updateModifiers(); showDirectoryStatus(); identity = ''; shell = '';
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
      if (current !== generation || terminal !== view) return;
      lastColumns = dimensions.columns; lastRows = dimensions.rows;
      const grant = await tabs.terminal('terminal.stream');
      if (current !== generation || terminal !== view) return;
      if (!grant.token || grant.shellId !== shell) throw new Error('Invalid terminal stream authorization');
      const old = stream; stream = undefined; old?.close();
      const url = new URL('/ws/app/file_explorer/terminal?codec=msgpack-v1', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const next = new WebSocket(url); stream = next; next.binaryType = 'arraybuffer';
      const checkpoint = await new Promise<Reply>((resolve, reject) => {
        let attached = false;
        const timer = setTimeout(() => { reject(new Error('Terminal attach timed out')); next.close(); }, 10000);
        next.onopen = () => {
          if (stream !== next || current !== generation) { next.close(); return; }
          next.send(packObject({ type: 'attach', token: grant.token, ...dimensions }));
        };
        next.onmessage = event => {
          if (stream !== next || current !== generation) return;
          try {
            const frame = unpackObject(event.data);
            if (frame.tabId !== identity || frame.shellId !== shell) throw new Error('Terminal stream identity changed');
            if (!attached) {
              if (frame.type !== 'checkpoint' || typeof frame.ansi !== 'string' || !Number.isSafeInteger(frame.outputOffset)) throw new Error('Expected terminal checkpoint');
              attached = true; clearTimeout(timer); resolve(frame as Reply);
            } else {
              if (frame.type !== 'output' || !(frame.data instanceof Uint8Array)
                || !Number.isSafeInteger(frame.startOffset) || !Number.isSafeInteger(frame.endOffset)) throw new Error('Invalid terminal output');
              output(frame as unknown as Delta);
            }
          } catch (value) { clearTimeout(timer); reject(value); next.close(); }
        };
        next.onerror = () => { clearTimeout(timer); reject(new Error('Terminal output connection failed')); };
        next.onclose = () => {
          clearTimeout(timer); reject(new Error('Terminal output disconnected'));
          if (stream !== next || current !== generation || disposed) return;
          stream = undefined; ready = false; inputs.reset();
          if (!minimized && socket.connected) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => void recover(), 500);
          }
        };
      });
      if (current !== generation || terminal !== view || checkpoint.shellId !== shell) return;
      if (typeof checkpoint.ansi !== 'string' || !Number.isSafeInteger(checkpoint.outputOffset)) throw new Error('Invalid terminal checkpoint');
      view.reset();
      await new Promise<void>(resolve => view.write(checkpoint.ansi!, resolve));
      if (current !== generation || terminal !== view || stream !== next) return;
      if (checkpoint.pendingBytes?.length) view.write(new Uint8Array(checkpoint.pendingBytes));
      cursor.offset = checkpoint.outputOffset!; ready = true; status.textContent = 'Terminal';
      showDirectoryStatus(checkpoint.directoryTracking);
      const pending = buffered; buffered = []; bufferedBytes = 0;
      for (const delta of pending) { if (!ready) break; paint(delta); }
    } catch (value) { if (current === generation) error(value); }
    finally {
      if (current === generation) {
        recovering = false;
        if (recoverAgain) void recover();
        else if (resizeAgain && ready) { resizeAgain = false; void fitAndResize(); }
      }
    }
  }
  async function fitAndResize() {
    if (disposed || !terminal || !socket.connected || minimized) return;
    if (recovering || resizing) { resizeAgain = true; return; }
    if (!ready) { void recover(); return; }
    const current = generation, view = terminal;
    fit?.fit();
    const columns = view.cols, rows = view.rows;
    if (columns === lastColumns && rows === lastRows) return;
    resizing = true; resizeAgain = false;
    try {
      await tabs.terminal('terminal.resize', { columns, rows });
      if (current === generation && view === terminal) { lastColumns = columns; lastRows = rows; }
    } catch (value) { if (current === generation) error(value); }
    finally {
      if (current === generation) {
        resizing = false;
        if (resizeAgain) { resizeAgain = false; void fitAndResize(); }
      }
    }
  }
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void fitAndResize(), 150);
  }
  function input(data: string) {
    if (!ready || !socket.connected) return;
    inputs.enqueue(data);
  }
  function sync(tab: Tab | null) {
    const locked = tab?.directoryLocked !== false;
    if (locked !== displayedLock) showDirectoryStatus();
    displayedLock = locked;
    if (directoryLock) { directoryLock.checked = tab?.directoryLocked !== false; directoryLock.disabled = lockPending; }
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
        fontFamily: TERMINAL_FONT_FAMILY, fontSize: 13,
        theme: { background: '#0b1020', foreground: '#e6edf3', cursor: '#9cc3ff' } });
      const fonts = new api.WebFontsAddon.WebFontsAddon(true);
      await fonts.loadFonts([TERMINAL_WEB_FONT_FAMILY]);
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
      drawer.classList.remove('is-minimized'); await mounting;
      if (!ready) await recover(); else scheduleResize();
      terminal?.focus();
    } catch (value) { error(value); }
  };
  root.querySelector('[data-action="terminal"]')!.addEventListener('click', () => void show());
  drawer.querySelector('[data-terminal="minimize"]')!.addEventListener('click', () => {
    drawerResize.cancel();
    minimized = !minimized; drawer.classList.toggle('is-minimized', minimized);
    if (!minimized) scheduleResize();
  });
  drawer.querySelector('[data-terminal="maximize"]')!.addEventListener('click', () => {
    drawerResize.cancel();
    drawer.classList.toggle('is-maximized'); scheduleResize();
  });
  drawer.querySelector('[data-terminal="close"]')!.addEventListener('click', async () => {
    const ui = window as unknown as { teUI: { dialog: { confirm(message: string): Promise<boolean> } } };
    if (!await ui.teUI.dialog.confirm('Close this terminal? Its running processes will be stopped in every attached window.')) return;
    try { await tabs.terminal('terminal.close'); sync(tabs.tab); } catch (value) { error(value); }
  });
  directoryLock?.addEventListener('change', () => {
    if (lockPending) return;
    const current = generation;
    const locked = directoryLock.checked;
    lockPending = true; directoryLock.disabled = true;
    void tabs.terminal('terminal.directoryLock', { locked }).then(reply => {
      if (current === generation) showDirectoryStatus(reply.directoryTracking);
    }).catch(value => { if (current === generation) error(value); }).finally(() => {
      lockPending = false;
      directoryLock.checked = tabs.tab?.directoryLocked !== false;
      directoryLock.disabled = false;
    });
  });
  const resize = new ResizeObserver(scheduleResize); resize.observe(viewport);
  // Clearing the renderer also fences a still-loading runtime/font promise.
  // Reconnect's authoritative tab snapshot mounts a new view even if IDs match.
  const disconnected = () => { clear(); status.textContent = 'Disconnected'; };
  const reset = (payload: { shellId: string }) => { if (payload.shellId === shell) { ready = false; recoverAgain = true; void recover(); } };
  const directoryChanged = (raw: unknown) => {
    try {
      const payload = unpackObject(raw);
      if (payload.tabId === identity && payload.shellId === shell) showDirectoryStatus(payload.directoryTracking as DirectoryStatus);
    } catch (value) { error(value); }
  };
  const wireReset = (raw: unknown) => {
    try { const payload = unpackObject(raw); if (typeof payload.shellId === 'string') reset({ shellId: payload.shellId }); }
    catch (value) { error(value); }
  };
  socket.on('terminal_directory', directoryChanged);
  socket.on('terminal_reset', wireReset); socket.on('disconnect', disconnected);
  return { sync, show, dispose() {
    drawerResize.dispose();
    disposeRepeatingKeys.forEach(dispose => dispose());
    for (const type of ['pointerdown', 'pointerup', 'click']) tabsPanel?.removeEventListener(type, guardMinibar, true);
    disposed = true; clear(); resize.disconnect();
    socket.off('terminal_reset', wireReset); socket.off('disconnect', disconnected);
    socket.off('terminal_directory', directoryChanged);
  } };
}
