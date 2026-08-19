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

type SecondaryMode = 'closed' | 'docked' | 'collapsed' | 'detached';

interface SecondaryPresentation {
  mode: SecondaryMode;
  dockSize: number;
  detachedBounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
}

type SecondaryCommand =
  | { type: 'open'; projectPath: string; path: string }
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

interface SecondaryRuntimeWindow extends Window {
  te2Electron?: SecondaryElectronBridge;
}

interface SecondaryHost {
  toast(message: string, kind?: unknown): void;
}

type HostState = {
  activeProject?: string | null;
  currentPath?: string | null;
  clientForeground?: { path?: string | null } | null;
};

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

function activePathFromState(state: HostState): string {
  const foreground = asRecord(state.clientForeground);
  return stringValue(foreground.path) || stringValue(state.currentPath);
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
  const electron = runtimeWindow().te2Electron;
  if (!electron) throw new Error('Second editor requires the Electron app-view bridge');
  const electronBridge = electron;

  installStyle();
  // The framework injects the app template's stylesheet links and inline CSS
  // into this same container. Remove the primary visual surfaces without
  // detaching those assets: the reduced Monaco host still depends on their
  // breadcrumb, font, Codicon, and flex sizing rules.
  clearPrimaryTemplateSurfaces(rootEl);
  const root = document.createElement('section');
  root.className = 'te2-secondary-editor';
  root.dataset.mode = 'docked';
  root.innerHTML = `
    <header class="te2-secondary-editor-header">
      <button class="te2-secondary-editor-menu-button" type="button" title="File actions" aria-label="File actions">☰</button>
      <span class="te2-secondary-editor-title" title="No file open">No file open</span>
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
  if (!editorFrame || !title || !status || !menu || !menuButton) {
    throw new Error('Second editor shell did not initialize');
  }
  const titleEl = title;
  const statusEl = status;

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
    currentPath = path;
    const label = path ? basename(path) : 'No file open';
    titleEl.textContent = label;
    titleEl.title = path || label;
  }

  function applyHostState(state: HostState): void {
    projectPath = stringValue(state.activeProject);
    setCurrentPath(activePathFromState(state));
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

  async function publishNativeReady(): Promise<void> {
    if (!editorReady || nativeReadySent) return;
    nativeReadySent = true;
    try {
      await electronBridge.secondEditorReady();
    } catch (error) {
      nativeReadySent = false;
      console.warn('[second_editor] native readiness failed', error);
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
          { path: targetPath, source: 'electron_second_editor_save_as' },
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
        { path: currentPath, source: 'electron_second_editor' },
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
    const result = await electronBridge.setSecondEditorMode(mode);
    currentMode = result.presentation.mode;
    root.dataset.mode = currentMode;
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
      { path: command.path, source: 'electron_second_editor' },
      8_000,
    );
  }

  function handleNotification(
    method: UiIpcRpcNotificationMethod,
    params: JsonObject,
  ): void {
    if (method === UI_IPC_RPC_NOTIFICATIONS.editorReady) {
      editorReady = true;
      void publishNativeReady();
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorSave) {
      void save();
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.hostActiveFileChanged) {
      const foreground = asRecord(params.clientForeground);
      setCurrentPath(stringValue(foreground.path) || stringValue(params.path));
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitching) {
      setStatus('Switching project…');
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitched) {
      void requestHostState().then(() => setStatus('')).catch((error) => {
        console.warn('[second_editor] project state refresh failed', error);
      });
    } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorNotify) {
      const message = stringValue(params.message) || stringValue(params.text);
      if (message) host.toast(message);
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

  const unsubscribeNative = electronBridge.onSecondEditorCommand((command) => {
    void handleNativeCommand(command).catch((error) => {
      host.toast(errorMessage(error));
    });
  });
  window.addEventListener('pagehide', unsubscribeNative, { once: true });

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
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
    void setMode('closed');
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
