import { bootInlineEditorHost } from '../../monaco_editor/inline_host.ts';
import {
  UI_IPC_RPC_METHODS,
  UI_IPC_RPC_NOTIFICATIONS,
  type UiIpcRpcNotificationMethod,
} from '../../src/ui_ipc/rpc_contract.ts';
import type { JsonObject } from '../../src/rpc/transport.ts';
import { basename, HOME_DIR, parentDir, toAbsolute } from './core/utils.ts';
import { createUiIpcRpcConnection } from './connections/ui-ipc-rpc.ts';
import { ensureSocketIoLoaded } from './connections/vendor-loaders.ts';
import {
  mobileSecondaryModeTransition,
  secondaryEditorActivePath,
  type SecondaryEditorHostState,
  type SecondaryEditorMode,
} from './secondary-editor-state.ts';
import { renderDiagnosticIssuePills } from './ui/diagnostic-issue-pills.ts';

type SecondaryMode = SecondaryEditorMode;

interface SecondaryPresentation {
  mode: SecondaryMode;
  dockSize: number;
  detachedBounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
}

type SecondaryCommand =
  | { type: 'open'; projectPath: string; path: string; requestId?: string }
  | { type: 'state'; projectPath: string; presentation: SecondaryPresentation };

interface SecondaryElectronBridge {
  secondEditorReady(): Promise<{ ok: true }>;
  setSecondEditorMode(
    mode: SecondaryMode,
  ): Promise<{ ok: true; presentation: SecondaryPresentation }>;
  onSecondEditorCommand(
    listener: (command: SecondaryCommand) => void,
  ): () => void;
}

interface SecondaryPresentationBridge {
  kind: 'electron' | 'mobile';
  ready(): Promise<void>;
  setMode(mode: SecondaryMode): Promise<SecondaryPresentation>;
  publishForeground(path: string): void;
  publishOpenResult(requestId: string, ok: boolean, path: string, error?: string): void;
  onCommand(listener: (command: SecondaryCommand) => void): () => void;
}

interface SecondaryRuntimeWindow extends Window {
  te2Electron?: SecondaryElectronBridge;
}

interface SecondaryHost {
  toast(message: string, kind?: unknown): void;
}

type HostState = SecondaryEditorHostState;

const STYLE = `
.te2-secondary-editor {
  --secondary-border: #30363d;
  --secondary-bg: #0d1117;
  --secondary-header: #161b22;
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #e6edf3;
  background: var(--secondary-bg);
  border-left: 1px solid var(--secondary-border);
  box-sizing: border-box;
}
.te2-secondary-editor-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px 5px;
  border-bottom: 1px solid var(--secondary-border);
  background: var(--secondary-header);
  user-select: none;
}
.te2-secondary-editor[data-mode='detached'] .te2-secondary-editor-header {
  -webkit-app-region: drag;
}
.te2-secondary-editor[data-presentation='mobile'] {
  border-left: 0;
}
.te2-secondary-editor[data-presentation='mobile'] .te2-secondary-editor-expand,
.te2-secondary-editor[data-presentation='mobile'] .te2-secondary-editor-detach {
  display: none !important;
}
.te2-secondary-editor button,
.te2-secondary-editor-menu {
  -webkit-app-region: no-drag;
}
.te2-secondary-editor button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  min-width: 30px;
  height: 30px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 3px;
  color: inherit;
  background: transparent;
  font: inherit;
}
.te2-secondary-editor button:hover,
.te2-secondary-editor button:focus-visible {
  border-color: #3d444d;
  background: #21262d;
  outline: none;
}
.te2-secondary-editor-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #c9d1d9;
  font: 500 12px/1.2 'JetBrains Mono Nerd', 'JetBrains Mono', monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.te2-secondary-editor-issues {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  min-width: 0 !important;
  padding: 0 2px !important;
  border: 0 !important;
  background: transparent !important;
  cursor: pointer;
}
.te2-secondary-editor-issues:disabled { cursor: default; }
.te2-secondary-editor-issues .fe-issues-dot {
  display: inline-flex;
  min-width: 16px;
  padding: 2px 6px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 999px;
  background: rgba(255, 255, 255, .06);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
}
.te2-secondary-editor-issues .fe-issues-dot.error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, .45);
}
.te2-secondary-editor-issues .fe-issues-dot.warning {
  color: #eab308;
  border-color: rgba(234, 179, 8, .40);
}
.te2-secondary-editor-menu {
  position: absolute;
  top: 35px;
  left: 5px;
  z-index: 500;
  display: grid;
  min-width: 170px;
  padding: 4px;
  border: 1px solid #3d444d;
  border-radius: 4px;
  background: #161b22;
  box-shadow: 0 10px 28px rgba(0, 0, 0, .45);
}
.te2-secondary-editor-menu[hidden] { display: none; }
.te2-secondary-editor-menu button {
  justify-content: start;
  width: 100%;
  text-align: left;
}
.te2-secondary-editor-body {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.te2-secondary-editor #editor-frame {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.te2-secondary-editor-status {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 450;
  max-width: calc(100% - 16px);
  padding: 4px 7px;
  border: 1px solid #30363d;
  border-radius: 3px;
  color: #8c959f;
  background: rgba(22, 27, 34, .92);
  font-size: 11px;
}
.te2-secondary-editor-status:empty { display: none; }
.te2-secondary-editor-expand { display: none !important; }
.te2-secondary-editor[data-mode='collapsed'] {
  grid-template-rows: 1fr;
}
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-header {
  flex-direction: column;
  justify-content: flex-start;
  padding-top: 7px;
  border-bottom: 0;
}
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-body,
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-menu-button,
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-title,
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-issues,
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-collapse,
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-detach {
  display: none;
}
.te2-secondary-editor[data-mode='collapsed'] .te2-secondary-editor-expand {
  display: inline-grid !important;
}
`;

function runtimeWindow(): SecondaryRuntimeWindow {
  return window as SecondaryRuntimeWindow;
}

function createPresentationBridge(): SecondaryPresentationBridge {
  const electron = runtimeWindow().te2Electron;
  if (electron) {
    return {
      kind: 'electron',
      async ready() {
        await electron.secondEditorReady();
      },
      async setMode(mode) {
        return (await electron.setSecondEditorMode(mode)).presentation;
      },
      publishForeground() {},
      publishOpenResult() {},
      onCommand(listener) {
        return electron.onSecondEditorCommand(listener);
      },
    };
  }
  if (window.parent === window) {
    throw new Error('Second editor requires a presentation host');
  }
  const origin = window.location.origin;
  return {
    kind: 'mobile',
    async ready() {
      window.parent.postMessage({
        channel: 'te2.secondaryEditor.presentation',
        type: 'ready',
      }, origin);
    },
    async setMode(mode) {
      const transition = mobileSecondaryModeTransition(mode);
      window.parent.postMessage({
        channel: 'te2.secondaryEditor.presentation',
        type: 'mode',
        mode: transition.hostMode,
      }, origin);
      return {
        mode: transition.rendererMode,
        dockSize: 0,
        detachedBounds: { x: 0, y: 0, width: 0, height: 0 },
        maximized: false,
      };
    },
    publishForeground(path) {
      window.parent.postMessage({
        channel: 'te2.secondaryEditor.presentation',
        type: 'foreground',
        path,
      }, origin);
    },
    publishOpenResult(requestId, ok, path, error) {
      window.parent.postMessage({
        channel: 'te2.secondaryEditor.presentation',
        type: 'openResult',
        requestId,
        ok,
        path,
        error: error || '',
      }, origin);
    },
    onCommand(listener) {
      const onMessage = (event: MessageEvent): void => {
        if (event.source !== window.parent || event.origin !== origin) return;
        const data = asRecord(event.data);
        if (data.channel !== 'te2.secondaryEditor.command') return;
        const command = data.command;
        if (!command || typeof command !== 'object' || Array.isArray(command)) return;
        listener(command as SecondaryCommand);
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  return asRecord(asRecord(value)[key]);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostStateFromReply(reply: unknown): HostState {
  return nestedRecord(nestedRecord(reply, 'snapshot'), 'host_state') as HostState;
}

function installStyle(): void {
  const style = document.createElement('style');
  style.id = 'te2-secondary-editor-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function clearPrimaryTemplateSurfaces(rootEl: HTMLElement): void {
  for (const node of Array.from(rootEl.childNodes)) {
    if (
      node instanceof HTMLElement
      && ['LINK', 'META', 'STYLE', 'TITLE'].includes(node.tagName)
    ) {
      continue;
    }
    node.remove();
  }
}

export async function bootSecondaryEditorRuntime(
  rootEl: HTMLElement,
  host: SecondaryHost,
): Promise<void> {
  const presentationBridge = createPresentationBridge();

  installStyle();
  // The framework injects the app template's stylesheet links and inline CSS
  // into this same container. Remove the primary visual surfaces without
  // detaching those assets: the reduced Monaco host still depends on their
  // breadcrumb, font, Codicon, and flex sizing rules.
  clearPrimaryTemplateSurfaces(rootEl);
  const root = document.createElement('section');
  root.className = 'te2-secondary-editor';
  root.dataset.mode = 'docked';
  root.dataset.presentation = presentationBridge.kind;
  root.innerHTML = `
    <header class="te2-secondary-editor-header">
      <button class="te2-secondary-editor-menu-button" type="button" title="File actions" aria-label="File actions">☰</button>
      <span class="te2-secondary-editor-title" title="No file open">No file open</span>
      <button class="te2-secondary-editor-issues" type="button" title="Next issue" aria-label="Next issue" disabled></button>
      <button class="te2-secondary-editor-expand" type="button" title="Expand second window" aria-label="Expand second window">◧</button>
      <button class="te2-secondary-editor-collapse" type="button" title="Collapse second window" aria-label="Collapse second window">▯</button>
      <button class="te2-secondary-editor-detach" type="button" title="Detach second window" aria-label="Detach second window">↗</button>
      <button class="te2-secondary-editor-close" type="button" title="Close second window" aria-label="Close second window">×</button>
      <div class="te2-secondary-editor-menu" hidden>
        <button type="button" data-action="save">Save</button>
        <button type="button" data-action="save-as">Save As…</button>
        <button type="button" data-action="discard">Discard Draft…</button>
      </div>
    </header>
    <div class="te2-secondary-editor-body">
      <div id="editor-frame"></div>
      <div class="te2-secondary-editor-status" aria-live="polite"></div>
    </div>
  `;
  rootEl.appendChild(root);

  const editorFrame = root.querySelector<HTMLElement>('#editor-frame');
  const title = root.querySelector<HTMLElement>('.te2-secondary-editor-title');
  const status = root.querySelector<HTMLElement>('.te2-secondary-editor-status');
  const menu = root.querySelector<HTMLElement>('.te2-secondary-editor-menu');
  const menuButton = root.querySelector<HTMLButtonElement>('.te2-secondary-editor-menu-button');
  const issuesButton = root.querySelector<HTMLButtonElement>('.te2-secondary-editor-issues');
  if (!editorFrame || !title || !status || !menu || !menuButton || !issuesButton) {
    throw new Error('Second editor shell did not initialize');
  }
  const titleEl = title;
  const statusEl = status;
  const issuesButtonEl = issuesButton;

  let projectPath = '';
  let currentPath = '';
  let currentMode: SecondaryMode = 'docked';
  let editorReady = false;
  let nativeReadySent = false;
  let busy = false;

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function setCurrentPath(path: string): void {
    if (currentPath !== path) {
      renderDiagnosticIssuePills(issuesButtonEl, {});
      issuesButtonEl.disabled = true;
    }
    currentPath = path;
    const label = path ? basename(path) : 'No file open';
    titleEl.textContent = label;
    titleEl.title = path || label;
    presentationBridge.publishForeground(path);
  }

  function applyHostState(state: HostState): void {
    projectPath = stringValue(state.activeProject);
    setCurrentPath(secondaryEditorActivePath(state));
  }

  async function requestHostState(): Promise<HostState> {
    const reply = await connection.request(
      UI_IPC_RPC_METHODS.hostBootSnapshotGet,
      { scope: 'hostState' },
      8_000,
    );
    const state = hostStateFromReply(reply);
    applyHostState(state);
    return state;
  }

  async function publishPresentationReady(): Promise<void> {
    if (!editorReady || nativeReadySent) return;
    nativeReadySent = true;
    try {
      await presentationBridge.ready();
    } catch (error) {
      nativeReadySent = false;
      console.warn('[second_editor] presentation readiness failed', error);
    }
  }

  async function save(targetPath = ''): Promise<void> {
    if (busy || !currentPath) return;
    busy = true;
    setStatus('Saving…');
    try {
      const params: JsonObject = targetPath
        ? { target_path: targetPath, force: true }
        : { path: currentPath, expected_path: currentPath };
      const reply = asRecord(await connection.request(
        UI_IPC_RPC_METHODS.hostFileSave,
        params,
        12_000,
      ));
      if (reply.ok === false) throw new Error(stringValue(reply.error) || 'Save failed');
      if (targetPath) {
        await connection.request(
          UI_IPC_RPC_METHODS.hostFileOpen,
          { path: targetPath, source: 'secondary_editor_save_as' },
          8_000,
        );
      }
      setStatus('Saved');
      window.setTimeout(() => {
        if (!busy) setStatus('');
      }, 1_200);
    } catch (error) {
      setStatus('');
      host.toast(`Save failed: ${errorMessage(error)}`);
    } finally {
      busy = false;
    }
  }

  async function saveAs(): Promise<void> {
    if (!currentPath || busy) return;
    const choice = await window.teFilePicker?.saveFile({
      title: 'Save As',
      startPath: toAbsolute(parentDir(currentPath), null, HOME_DIR),
      filename: basename(currentPath),
      selectLabel: 'Save',
    });
    if (!choice?.path) return;
    if (choice.existed && !(await window.teUI.dialog.confirm('File exists. Overwrite?'))) {
      return;
    }
    await save(toAbsolute(choice.path, null, HOME_DIR));
  }

  async function discardDraft(): Promise<void> {
    if (!currentPath || busy) return;
    if (!(await window.teUI.dialog.confirm(`Discard the draft for ${basename(currentPath)}?`))) {
      return;
    }
    busy = true;
    setStatus('Discarding draft…');
    try {
      await connection.request(
        UI_IPC_RPC_METHODS.hostDraftDiscard,
        { path: currentPath, source: 'secondary_editor' },
        8_000,
      );
      setStatus('Draft discarded');
    } catch (error) {
      host.toast(`Discard failed: ${errorMessage(error)}`);
      setStatus('');
    } finally {
      busy = false;
    }
  }

  async function setMode(mode: SecondaryMode): Promise<void> {
    const result = await presentationBridge.setMode(mode);
    currentMode = result.mode;
    root.dataset.mode = currentMode;
  }

  async function closeSecondaryEditor(): Promise<void> {
    if (presentationBridge.kind === 'electron') {
      await setMode('closed');
      return;
    }
    if (busy) return;
    busy = true;
    setStatus('Closing…');
    try {
      await connection.request(
        UI_IPC_RPC_METHODS.hostClientForegroundClear,
        {},
        8_000,
      );
      setCurrentPath('');
      await setMode('closed');
    } catch (error) {
      setStatus('');
      host.toast(`Close failed: ${errorMessage(error)}`);
    } finally {
      busy = false;
    }
  }

  async function handleNativeCommand(command: SecondaryCommand): Promise<void> {
    if (command.type === 'state') {
      projectPath = command.projectPath;
      currentMode = command.presentation.mode;
      root.dataset.mode = currentMode;
      const detach = root.querySelector<HTMLButtonElement>('.te2-secondary-editor-detach');
      if (detach) {
        detach.textContent = currentMode === 'detached' ? '↙' : '↗';
        detach.title = currentMode === 'detached' ? 'Attach second window' : 'Detach second window';
      }
      return;
    }
    if (command.projectPath !== projectPath) {
      await requestHostState();
    }
    if (command.projectPath !== projectPath) {
      throw new Error('Second editor project changed before the file could open');
    }
    await connection.request(
      UI_IPC_RPC_METHODS.hostFileOpen,
      { path: command.path, source: 'secondary_editor' },
      8_000,
    );
    await requestHostState();
  }

  function handleNotification(
    method: UiIpcRpcNotificationMethod,
    params: JsonObject,
  ): void {
    if (method === UI_IPC_RPC_NOTIFICATIONS.editorReady) {
      editorReady = true;
      void publishPresentationReady();
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorSave) {
      void save();
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.hostActiveFileChanged) {
      const nextPath = secondaryEditorActivePath({
        clientForeground: asRecord(params.clientForeground),
        currentPath: stringValue(params.path),
      });
      const shouldClosePresentation = !!currentPath && !nextPath;
      setCurrentPath(nextPath);
      if (shouldClosePresentation) void setMode('closed');
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitching) {
      setStatus('Switching project…');
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitched) {
      void requestHostState().then(() => setStatus('')).catch((error) => {
        console.warn('[second_editor] project state refresh failed', error);
      });
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorNotify) {
      const message = stringValue(params.message) || stringValue(params.text);
      if (message) host.toast(message);
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorDiagnosticsCounts) {
      const counts = renderDiagnosticIssuePills(issuesButtonEl, params);
      issuesButtonEl.disabled = counts.total === 0;
    }
  }

  const connection = createUiIpcRpcConnection({
    ensureSocketIoLoaded,
    onConnect: () => {
      if (editorReady) void requestHostState();
    },
    onDisconnect: (reason) => setStatus(`Reconnecting${reason ? `: ${reason}` : '…'}`),
    onConnectError: (error) => {
      setStatus('Connection unavailable');
      console.warn('[second_editor] UI IPC connection failed', error);
    },
    onNotification: handleNotification,
  });

  const unsubscribePresentation = presentationBridge.onCommand((command) => {
    void handleNativeCommand(command).then(() => {
      if (command.type === 'open' && command.requestId) {
        presentationBridge.publishOpenResult(command.requestId, true, currentPath);
      }
    }).catch((error) => {
      const message = errorMessage(error);
      if (command.type === 'open' && command.requestId) {
        presentationBridge.publishOpenResult(command.requestId, false, currentPath, message);
      }
      host.toast(message);
    });
  });
  window.addEventListener('pagehide', unsubscribePresentation, { once: true });

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  issuesButtonEl.addEventListener('click', () => {
    if (issuesButtonEl.disabled) return;
    void connection.request(
      UI_IPC_RPC_METHODS.hostEditorIssuesCommand,
      { action: 'next' },
      8_000,
    ).catch((error) => {
      console.warn('[second_editor] issue navigation failed', error);
    });
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target)) {
      menu.hidden = true;
    }
  });
  menu.addEventListener('click', (event) => {
    const action = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-action]')?.dataset.action
      : '';
    if (!action) return;
    menu.hidden = true;
    if (action === 'save') void save();
    else if (action === 'save-as') void saveAs();
    else if (action === 'discard') void discardDraft();
  });
  root.querySelector('.te2-secondary-editor-close')?.addEventListener('click', () => {
    void closeSecondaryEditor();
  });
  root.querySelector('.te2-secondary-editor-collapse')?.addEventListener('click', () => {
    void setMode('collapsed');
  });
  root.querySelector('.te2-secondary-editor-expand')?.addEventListener('click', () => {
    void setMode('docked');
  });
  root.querySelector('.te2-secondary-editor-detach')?.addEventListener('click', () => {
    void setMode(currentMode === 'detached' ? 'docked' : 'detached');
  });

  await connection.connect();
  const fullSnapshotReply = await connection.request(
    UI_IPC_RPC_METHODS.hostBootSnapshotGet,
    {},
    20_000,
  );
  const fullSnapshot = nestedRecord(fullSnapshotReply, 'snapshot');
  applyHostState(asRecord(fullSnapshot.host_state) as HostState);
  await bootInlineEditorHost(editorFrame, {
    ensureSocketIoLoaded,
    bootSnapshot: fullSnapshot,
  });
}
