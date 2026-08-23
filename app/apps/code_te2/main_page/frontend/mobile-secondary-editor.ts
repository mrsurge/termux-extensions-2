import { mobileSecondaryTabVisible } from './secondary-editor-state.ts';

interface NavigatorWithUaData extends Navigator {
  userAgentData?: { mobile?: boolean };
}

interface ElectronMarkerWindow extends Window {
  te2Electron?: unknown;
}

interface MobileSecondaryEditorDrawer {
  open(): unknown;
  close(): unknown;
}

interface MobileSecondaryEditorOptions {
  root: HTMLElement;
  container: HTMLElement;
  tab: HTMLButtonElement | null;
  toast(message: string): void;
}

type SecondaryOpenCommand = {
  type: 'open';
  projectPath: string;
  path: string;
  requestId: string;
};

export interface MobileSecondaryEditorController {
  readonly supported: boolean;
  attachDrawer(drawer: MobileSecondaryEditorDrawer): void;
  show(): void;
  hide(): void;
  open(projectPath: string, path: string): Promise<void>;
  destroy(): void;
}

export function supportsMobileSecondEditor(
  navigatorValue: Navigator = navigator,
  windowValue: Window = window,
): boolean {
  if ((windowValue as ElectronMarkerWindow).te2Electron) return false;
  const params = new URLSearchParams(windowValue.location.search);
  if (params.get('gv_native') === '1') {
    const renderer = (params.get('te2_renderer') || 'gecko').trim().toLowerCase();
    return renderer === 'gecko' || renderer === 'cefrium';
  }
  const uaData = (navigatorValue as NavigatorWithUaData).userAgentData;
  if (typeof uaData?.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(
    navigatorValue.userAgent || '',
  );
}

function secondaryFrameUrl(): string {
  const target = new URL(window.location.href);
  target.hash = '';
  target.searchParams.set('te2_editor_role', 'secondary');
  target.searchParams.delete('te2_desktop_editor');
  return target.href;
}

export function createMobileSecondaryEditorController(
  options: MobileSecondaryEditorOptions,
): MobileSecondaryEditorController {
  const supported = supportsMobileSecondEditor();
  let frame: HTMLIFrameElement | null = null;
  let ready = false;
  let readyPromise: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  let readyTimeout = 0;
  let drawer: MobileSecondaryEditorDrawer | null = null;
  let populated = false;
  let dismissed = false;
  let openSequence = 0;
  const pendingOpens = new Map<string, {
    resolve(path: string): void;
    reject(error: Error): void;
    timeout: number;
  }>();

  options.container.hidden = true;

  function isMobileLayout(): boolean {
    return options.root.classList.contains('layout-mobile');
  }

  function updateVisibility(): void {
    const available = mobileSecondaryTabVisible({
      supported,
      mobileLayout: isMobileLayout(),
      populated,
      dismissed,
    });
    if (options.tab) {
      options.tab.hidden = !available;
    }
    const selected = available && options.tab?.classList.contains('active') === true;
    const visible = available && selected;
    options.container.hidden = !visible;
    if (frame) frame.hidden = !visible;
  }

  function selectFallbackTab(): void {
    if (!options.tab?.classList.contains('active')) return;
    options.tab.classList.remove('active');
    options.tab.parentElement
      ?.querySelector<HTMLElement>('.drawer-tab[data-tab="terminal"]')
      ?.classList.add('active');
  }

  function closeDrawer(): void {
    void Promise.resolve(drawer?.close()).catch((error) => {
      console.warn('[second_editor] mobile drawer close failed', error);
    });
  }

  function applyForeground(path: string): void {
    const wasSelected = options.tab?.classList.contains('active') === true;
    populated = !!path;
    if (!populated) {
      dismissed = false;
      selectFallbackTab();
      hide();
      if (wasSelected) closeDrawer();
    }
    updateVisibility();
  }

  function ensureFrame(): Promise<void> {
    if (ready && frame?.contentWindow) return Promise.resolve();
    if (readyPromise) return readyPromise;
    frame = document.createElement('iframe');
    frame.className = 'te2-mobile-secondary-editor-frame';
    frame.title = 'Second Window editor';
    frame.src = secondaryFrameUrl();
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.addEventListener('error', onFrameError, { once: true });
    options.container.replaceChildren(frame);
    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
      readyTimeout = window.setTimeout(() => {
        readyTimeout = 0;
        const error = new Error('Second Window editor did not become ready');
        readyPromise = null;
        rejectReady = null;
        resolveReady = null;
        reject(error);
      }, 20_000);
    });
    updateVisibility();
    return readyPromise;
  }

  function postCommand(command: SecondaryOpenCommand): void {
    const target = frame?.contentWindow;
    if (!target) throw new Error('Second Window editor is unavailable');
    target.postMessage({
      channel: 'te2.secondaryEditor.command',
      command,
    }, window.location.origin);
  }

  function waitForOpenResult(requestId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingOpens.delete(requestId);
        reject(new Error('Second Window file open timed out'));
      }, 12_000);
      pendingOpens.set(requestId, { resolve, reject, timeout });
    });
  }

  function onMessage(event: MessageEvent): void {
    if (
      event.origin !== window.location.origin
      || !frame?.contentWindow
      || event.source !== frame.contentWindow
      || !event.data
      || event.data.channel !== 'te2.secondaryEditor.presentation'
    ) return;
    if (event.data.type === 'ready') {
      ready = true;
      if (readyTimeout) window.clearTimeout(readyTimeout);
      readyTimeout = 0;
      resolveReady?.();
      readyPromise = Promise.resolve();
      resolveReady = null;
      rejectReady = null;
    } else if (event.data.type === 'foreground') {
      applyForeground(typeof event.data.path === 'string' ? event.data.path : '');
    } else if (event.data.type === 'openResult') {
      const requestId = typeof event.data.requestId === 'string' ? event.data.requestId : '';
      const pending = pendingOpens.get(requestId);
      if (!pending) return;
      pendingOpens.delete(requestId);
      window.clearTimeout(pending.timeout);
      if (event.data.ok === true) {
        const path = typeof event.data.path === 'string' ? event.data.path : '';
        pending.resolve(path);
      } else {
        pending.reject(new Error(
          typeof event.data.error === 'string' && event.data.error
            ? event.data.error
            : 'Second Window file open failed',
        ));
      }
    } else if (event.data.type === 'mode' && event.data.mode === 'collapsed') {
      closeDrawer();
    } else if (event.data.type === 'mode' && event.data.mode === 'closed') {
      dismissed = true;
      selectFallbackTab();
      hide();
      updateVisibility();
      closeDrawer();
    }
  }

  function onFrameError(): void {
    ready = false;
    const error = new Error('Second Window editor failed to load');
    rejectReady?.(error);
    readyPromise = null;
    resolveReady = null;
    rejectReady = null;
    options.toast(error.message);
  }

  function show(): void {
    updateVisibility();
  }

  function hide(): void {
    options.container.hidden = true;
    if (frame) frame.hidden = true;
  }

  function reconcileLayout(): void {
    updateVisibility();
    if (supported && isMobileLayout() && !frame) {
      void ensureFrame().catch((error) => {
        options.toast(error instanceof Error ? error.message : String(error));
      });
    }
  }

  const layoutObserver = new MutationObserver(reconcileLayout);
  layoutObserver.observe(options.root, {
    attributes: true,
    attributeFilter: ['class'],
  });
  window.addEventListener('message', onMessage);
  reconcileLayout();

  return {
    supported,
    attachDrawer(nextDrawer) {
      drawer = nextDrawer;
    },
    show,
    hide,
    async open(projectPath, path) {
      if (!supported) throw new Error('Second Window is unavailable in this client');
      if (!isMobileLayout()) {
        throw new Error('Second Window is available in the mobile layout');
      }
      await ensureFrame();
      const requestId = `mobile_secondary_${Date.now().toString(36)}_${(++openSequence).toString(36)}`;
      const resultPromise = waitForOpenResult(requestId);
      postCommand({ type: 'open', projectPath, path, requestId });
      const openedPath = await resultPromise;
      if (!openedPath) throw new Error('Second Window did not retain the opened file');
      applyForeground(openedPath);
      dismissed = false;
      updateVisibility();
      await Promise.resolve(drawer?.open());
      options.tab?.click();
      show();
    },
    destroy() {
      layoutObserver.disconnect();
      window.removeEventListener('message', onMessage);
      if (readyTimeout) window.clearTimeout(readyTimeout);
      readyTimeout = 0;
      rejectReady?.(new Error('Second Window editor was destroyed'));
      for (const pending of pendingOpens.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error('Second Window editor was destroyed'));
      }
      pendingOpens.clear();
      readyPromise = null;
      resolveReady = null;
      rejectReady = null;
      frame?.remove();
      frame = null;
      ready = false;
      populated = false;
      dismissed = false;
    },
  };
}
