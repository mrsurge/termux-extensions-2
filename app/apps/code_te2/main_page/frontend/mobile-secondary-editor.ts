import { recordValue } from '../../src/rpc/value-types.ts';
import type { SecondaryEditorRuntimeHandle,
  SecondaryPresentationBridge, SecondaryCommand as RuntimeSecondaryCommand } from './secondary-editor-runtime.ts';
import { resolveCodeTe2ClientIdentity } from './client-identity.ts';
import {
  mobileSecondaryShortcutVisible,
  mobileSecondaryTabVisible,
  parseSecondaryContentPresentation,
  mobileSecondaryModeTransition,
} from './secondary-editor-state.ts';
import {
  MOBILE_EDITOR_MODIFIER_STATE_EVENT,
  MOBILE_EDITOR_OWNER_EVENT,
  MOBILE_EDITOR_PANEL_STATE_EVENT,
  MOBILE_EDITOR_SPECIAL_KEY_REQUEST_EVENT,
  currentMobileEditorModifiers,
  currentMobileEditorOwner,
  currentMobileEditorPanelState,
  markMobileEditorSpecialKeyHandled,
  publishMobileEditorModifiersConsumed,
  requestMobileEditorPanelToggle,
  setMobileEditorOwner,
  type MobileEditorModifierState,
  type MobileEditorRole,
  type MobileEditorSpecialKeyRequestDetail,
} from '../../src/mobile-input/editor-special-key-bridge.ts';
import type {
  SyntheticEditorKey,
  SyntheticKeyModifiers,
} from '../../src/mobile-input/terminal-special-key-bridge.ts';

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

type SecondaryInputCommand =
  | {
    type: 'inputState';
    owner: MobileEditorRole;
    modifiers: MobileEditorModifierState;
    panelOpen: boolean;
  }
  | {
    type: 'specialKey';
    key: SyntheticEditorKey;
    modifiers: SyntheticKeyModifiers;
  };

type SecondaryCommand = SecondaryOpenCommand | SecondaryInputCommand
  | { type: 'history'; projectPath: string; ticket: string; requestId: string };

export interface MobileSecondaryEditorController {
  readonly supported: boolean;
  attachDrawer(drawer: MobileSecondaryEditorDrawer): void;
  show(): void;
  hide(): void;
  open(projectPath: string, path: string, historyTicket?: string): Promise<void>;
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
  target.searchParams.set('te2_secondary_isolated', '1');
  target.searchParams.delete('te2_desktop_editor');
  return target.href;
}

export function createMobileSecondaryEditorController(
  options: MobileSecondaryEditorOptions,
): MobileSecondaryEditorController {
  const supported = supportsMobileSecondEditor();
  let frame: HTMLIFrameElement | null = null;
  let directRoot: HTMLElement | null = null;
  let directRuntime: SecondaryEditorRuntimeHandle | null = null;
  let directController: AbortController | null = null;
  let directCommand: ((command: RuntimeSecondaryCommand) => void) | null = null;
  let isolated = false;
  let destroyed = false;
  let ready = false;
  let readyPromise: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  let readyTimeout = 0;
  let drawer: MobileSecondaryEditorDrawer | null = null;
  let populated = false;
  let dismissed = false;
  let openSequence = 0;
  const shortcut = document.createElement('button');
  shortcut.type = 'button';
  shortcut.className = [
    'te2-mobile-special-key',
    'te2-mobile-special-key-overlay-trigger',
    'te2-mobile-second-window-trigger',
  ].join(' ');
  shortcut.textContent = 'Ⅱ';
  shortcut.title = 'Open Second Window';
  shortcut.setAttribute('aria-label', 'Open Second Window');
  shortcut.hidden = true;
  const editorContainer = options.root.querySelector<HTMLElement>('.fe-editor-container');
  const placeShortcut = (): void => {
    const target = options.root.querySelector<HTMLElement>(
      '.te2-mobile-editor-overlay-left',
    ) ?? editorContainer;
    if (target && shortcut.parentElement !== target) target.appendChild(shortcut);
  };
  placeShortcut();
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
    placeShortcut();
    const available = mobileSecondaryTabVisible({
      supported,
      mobileLayout: isMobileLayout(),
      populated,
      dismissed,
    });
    if (options.tab) {
      options.tab.hidden = !available;
    }
    shortcut.hidden = !mobileSecondaryShortcutVisible({
      supported,
      mobileLayout: isMobileLayout(),
      populated,
    });
    const selected = available && options.tab?.classList.contains('active') === true;
    const visible = available && selected;
    options.container.hidden = !visible;
    if (frame) frame.hidden = !visible;
    if (!visible && currentMobileEditorOwner(window) === 'secondary') {
      setMobileEditorOwner(window, 'primary');
    }
  }

  function selectFallbackTab(): void {
    if (!options.tab?.classList.contains('active')) return;
    options.tab.classList.remove('active');
    options.tab.parentElement
      ?.querySelector<HTMLElement>('.drawer-tab[data-tab="terminal"]')
      ?.classList.add('active');
  }

  function closeDrawer(): void {
    void Promise.resolve(drawer?.close()).catch((error: unknown) => {
      console.warn('[second_editor] mobile drawer close failed', error);
    });
  }

  function destroyFrame(reason: string, preserveWaiters = false): void {
    const wasReady = ready;
    if (!preserveWaiters) {
      if (readyTimeout) window.clearTimeout(readyTimeout);
      readyTimeout = 0;
      rejectReady?.(new Error(reason));
      for (const pending of pendingOpens.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error(reason));
      }
      pendingOpens.clear();
      readyPromise = null;
      resolveReady = null;
      rejectReady = null;
      isolated = false;
    }
    if (preserveWaiters && wasReady) {
      readyPromise = null;
      resolveReady = null;
      rejectReady = null;
    }
    directController?.abort();
    directController = null;
    directRuntime?.dispose();
    directRuntime = null;
    directCommand = null;
    directRoot?.remove();
    directRoot = null;
    frame?.remove();
    frame = null;
    ready = false;
    if (!preserveWaiters) populated = false;
    options.container.replaceChildren();
  }

  function applyPopulation(hasContent: boolean): void {
    const wasSelected = options.tab?.classList.contains('active') === true;
    populated = hasContent;
    if (!populated) {
      dismissed = false;
      selectFallbackTab();
      hide();
      if (wasSelected) closeDrawer();
    }
    updateVisibility();
  }

  function applyForeground(path: string): void {
    applyPopulation(!!path);
  }

  function ensureFrame(): Promise<void> {
    if (destroyed) return Promise.reject(new Error('Second Window presentation destroyed'));
    if (ready && (frame?.contentWindow || directRuntime)) return Promise.resolve();
    if (readyPromise && (frame || directRoot)) return readyPromise;
    if (!readyPromise) readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
      readyTimeout = window.setTimeout(() => {
        readyTimeout = 0;
        readyPromise = null;
        rejectReady = null;
        resolveReady = null;
        reject(new Error('Second Window editor did not become ready'));
      }, 20_000);
    });
    if (!isolated) {
      const mount = document.createElement('div');
      mount.className = 'te2-mobile-secondary-editor-frame';
      mount.style.cssText = 'width:100%;height:100%;position:relative;min-height:0;';
      directRoot = mount;
      options.container.replaceChildren(mount);
      const controller = new AbortController();
      directController = controller;
      const publish = (data: Record<string, unknown>): void => {
        if (!controller.signal.aborted) applyPresentation(data);
      };
      const bridge: SecondaryPresentationBridge = {
        kind: 'mobile',
        async ready() { publish({ type: 'ready' }); },
        async setMode(mode) {
          controller.signal.throwIfAborted();
          const transition = mobileSecondaryModeTransition(mode);
          // Closing can synchronously dispose the runtime; its caller must not
          // need to touch the presentation again after this notification.
          publish({ type: 'mode', mode: transition.hostMode });
          return { mode: transition.rendererMode, dockSize: 0,
            detachedBounds: { x: 0, y: 0, width: 0, height: 0 }, maximized: false };
        },
        publishForeground: path => publish({ type: 'foreground', path }),
        publishContent: content => publish({ type: 'content', content }),
        publishOpenResult: (requestId, ok, path, error) => publish({ type: 'openResult', requestId, ok, path, error }),
        publishInputFocus() {}, publishModifiersConsumed() {}, publishPanelToggle() {},
        onCommand(listener) { directCommand = listener; return () => { if (directCommand === listener) directCommand = null; }; },
      };
      void Promise.all([resolveCodeTe2ClientIdentity({ role: 'secondary' }),
        import('./secondary-editor-runtime.ts')]).then(([identity, { bootSecondaryEditorRuntime }]) => {
        controller.signal.throwIfAborted();
        return bootSecondaryEditorRuntime(mount, { toast: options.toast }, {
          rendererIdentity: { ...identity, clientRole: 'secondary' }, presentationBridge: bridge,
          signal: controller.signal, reloadPresentation: () => replacePresentation(true),
        });
      }).then(runtime => {
        if (controller.signal.aborted) runtime.dispose(); else directRuntime = runtime;
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) onPresentationError(error);
      });
      updateVisibility();
      return readyPromise;
    }
    frame = document.createElement('iframe');
    frame.className = 'te2-mobile-secondary-editor-frame';
    frame.title = 'Second Window editor';
    frame.src = secondaryFrameUrl();
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    const isolatedFrame = frame;
    frame.addEventListener('error', () => { if (frame === isolatedFrame) onFrameError(); }, { once: true });
    options.container.replaceChildren(frame);
    updateVisibility();
    return readyPromise;
  }

  function postCommand(command: SecondaryCommand): void {
    if (directRoot && directCommand) { directCommand(command); return; }
    const target = frame?.contentWindow;
    if (!target) throw new Error('Second Window editor is unavailable');
    target.postMessage({
      channel: 'te2.secondaryEditor.command',
      command,
    }, window.location.origin);
  }

  function syncInputState(): void {
    if (!ready || !frame?.contentWindow) return;
    postCommand({
      type: 'inputState',
      owner: currentMobileEditorOwner(window),
      modifiers: currentMobileEditorModifiers(window),
      panelOpen: currentMobileEditorPanelState(window),
    });
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

  function onMessage(event: MessageEvent<unknown>): void {
    const data = recordValue(event.data);
    if (
      event.origin !== window.location.origin
      || !frame?.contentWindow
      || event.source !== frame.contentWindow
      || !data
      || data.channel !== 'te2.secondaryEditor.presentation'
    ) return;
    applyPresentation(data);
  }

  function replacePresentation(nextIsolated: boolean): void {
    if (destroyed) return;
    if (isolated === nextIsolated && (frame || directRoot)) return;
    destroyFrame('Second Window content changed', true);
    isolated = nextIsolated;
    void ensureFrame().catch((error: unknown) => onPresentationError(error));
  }

  function applyPresentation(data: Record<string, unknown>): void {
    if (data.type === 'ready') {
      ready = true;
      if (readyTimeout) window.clearTimeout(readyTimeout);
      readyTimeout = 0;
      resolveReady?.();
      readyPromise = Promise.resolve();
      resolveReady = null;
      rejectReady = null;
      syncInputState();
    } else if (data.type === 'foreground') {
      applyForeground(typeof data.path === 'string' ? data.path : '');
    } else if (data.type === 'content') {
      const content = parseSecondaryContentPresentation(data.content);
      if (!content) return;
      if (isolated && content.kind !== 'historicalDiff') {
        replacePresentation(false);
        return;
      }
      applyPopulation(content.kind !== 'empty');
      if (options.tab) options.tab.title = content.kind === 'empty'
        ? 'Second Window'
        : content.kind === 'historicalDiff'
          ? `${content.label} @ ${content.commitId.slice(0, 8)} (read-only)` : content.label;
    } else if (data.type === 'openResult') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const pending = pendingOpens.get(requestId);
      if (!pending) return;
      pendingOpens.delete(requestId);
      window.clearTimeout(pending.timeout);
      if (data.ok === true) {
        const path = typeof data.path === 'string' ? data.path : '';
        pending.resolve(path);
      } else {
        pending.reject(new Error(
          typeof data.error === 'string' && data.error
            ? data.error
            : 'Second Window file open failed',
        ));
      }
    } else if (data.type === 'mode' && data.mode === 'collapsed') {
      setMobileEditorOwner(window, 'primary');
      closeDrawer();
    } else if (data.type === 'mode' && data.mode === 'closed') {
      setMobileEditorOwner(window, 'primary');
      dismissed = true;
      selectFallbackTab();
      hide();
      destroyFrame('Second Window editor was closed');
      updateVisibility();
      closeDrawer();
    } else if (data.type === 'inputFocus') {
      if (options.container.hidden || frame?.hidden || !populated) return;
      setMobileEditorOwner(window, 'secondary');
    } else if (data.type === 'modifiersConsumed') {
      publishMobileEditorModifiersConsumed(window, 'secondary');
    } else if (data.type === 'panelToggle') {
      requestMobileEditorPanelToggle(window, 'secondary');
    }
  }

  function onFrameError(): void {
    onPresentationError(new Error('Second Window editor failed to load'));
  }

  function onPresentationError(cause: unknown): void {
    if (destroyed) return;
    ready = false;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    rejectReady?.(error);
    readyPromise = null;
    resolveReady = null;
    rejectReady = null;
    destroyFrame(error.message);
    options.toast(error.message);
  }

  function show(): void {
    updateVisibility();
  }

  function hide(): void {
    options.container.hidden = true;
    if (frame) frame.hidden = true;
    if (currentMobileEditorOwner(window) === 'secondary') {
      setMobileEditorOwner(window, 'primary');
    }
  }

  function reconcileLayout(): void {
    if (destroyed) return;
    updateVisibility();
    if (supported && isMobileLayout() && !frame && !directRoot && !dismissed) {
      void ensureFrame().catch((error: unknown) => {
        if (!destroyed) options.toast(error instanceof Error ? error.message : String(error));
      });
    }
  }

  const layoutObserver = new MutationObserver(reconcileLayout);
  layoutObserver.observe(options.root, {
    attributes: true,
    attributeFilter: ['class'],
  });
  window.addEventListener('message', onMessage);
  const onInputStateChanged = (): void => syncInputState();
  const onSpecialKeyRequest = (event: Event): void => {
    const detail = (
      event as CustomEvent<MobileEditorSpecialKeyRequestDetail>
    ).detail;
    if (detail?.role !== 'secondary' || !ready || !frame?.contentWindow) return;
    postCommand({
      type: 'specialKey',
      key: detail.key,
      modifiers: detail.modifiers,
    });
    markMobileEditorSpecialKeyHandled(event);
  };
  window.addEventListener(MOBILE_EDITOR_OWNER_EVENT, onInputStateChanged);
  window.addEventListener(MOBILE_EDITOR_MODIFIER_STATE_EVENT, onInputStateChanged);
  window.addEventListener(MOBILE_EDITOR_PANEL_STATE_EVENT, onInputStateChanged);
  window.addEventListener(
    MOBILE_EDITOR_SPECIAL_KEY_REQUEST_EVENT,
    onSpecialKeyRequest,
  );
  shortcut.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  shortcut.addEventListener('click', () => {
    dismissed = false;
    updateVisibility();
    void Promise.resolve(drawer?.open()).then(() => {
      options.tab?.click();
      show();
    }).catch((error: unknown) => {
      options.toast(error instanceof Error ? error.message : String(error));
    });
  });
  reconcileLayout();

  return {
    supported,
    attachDrawer(nextDrawer) {
      drawer = nextDrawer;
    },
    show,
    hide,
    async open(projectPath, path, historyTicket) {
      if (!supported) throw new Error('Second Window is unavailable in this client');
      if (!isMobileLayout()) {
        throw new Error('Second Window is available in the mobile layout');
      }
      dismissed = false;
      await ensureFrame();
      const requestId = `mobile_secondary_${Date.now().toString(36)}_${(++openSequence).toString(36)}`;
      const resultPromise = waitForOpenResult(requestId);
      postCommand(historyTicket ? { type: 'history', projectPath, ticket: historyTicket, requestId }
        : { type: 'open', projectPath, path, requestId });
      const openedPath = await resultPromise;
      if (!openedPath) throw new Error('Second Window did not retain the opened file');
      applyPopulation(true);
      dismissed = false;
      updateVisibility();
      await Promise.resolve(drawer?.open());
      options.tab?.click();
      show();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      layoutObserver.disconnect();
      window.removeEventListener('message', onMessage);
      window.removeEventListener(MOBILE_EDITOR_OWNER_EVENT, onInputStateChanged);
      window.removeEventListener(
        MOBILE_EDITOR_MODIFIER_STATE_EVENT,
        onInputStateChanged,
      );
      window.removeEventListener(MOBILE_EDITOR_PANEL_STATE_EVENT, onInputStateChanged);
      window.removeEventListener(
        MOBILE_EDITOR_SPECIAL_KEY_REQUEST_EVENT,
        onSpecialKeyRequest,
      );
      setMobileEditorOwner(window, 'primary');
      destroyFrame('Second Window editor was destroyed');
      shortcut.remove();
      dismissed = false;
    },
  };
}
