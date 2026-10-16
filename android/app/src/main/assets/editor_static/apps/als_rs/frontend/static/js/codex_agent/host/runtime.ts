import { createSettingsRpcClient } from '../rpc/settings/client.ts';
import { createUiRpcClient } from '../rpc/ui/client.ts';
import type { UnknownRecord } from '../shared_types.ts';

interface HostUiState {
  showClose?: boolean;
  ideMode?: boolean;
  parentOrigin?: string | null;
  projectRoot?: string | null;
}

interface ConversationMetaState {
  conversation_id?: string | null;
}

interface ConversationSettingsState {
  cwd?: string;
  alias?: string;
  model?: string;
  label?: string;
}

interface AppConfigState {
  user_name?: string;
  show_console_worker_id?: boolean;
}

interface ConsoleWorkerInfo {
  workerId?: string;
  workerLabel?: string;
}

interface ConsoleWorkerWindow extends Window {
  __TE2_CONSOLE_WORKER?: ConsoleWorkerInfo | null;
}

interface HostUiPayload {
  show_close?: unknown;
  parent_origin?: unknown;
  ide_mode?: unknown;
  project_root?: unknown;
}

interface HostRuntimeState {
  hostUi?: HostUiState;
  conversationMeta?: ConversationMetaState;
  conversationSettings?: ConversationSettingsState;
  homePrefix?: string | null;
  activeView?: string | null;
  appConfig?: AppConfigState;
}

interface HostRuntimeContext {
  getState(): HostRuntimeState;
  setState(patch: Partial<HostRuntimeState>): void;
  sioCall(event: string, data?: Record<string, unknown>): Promise<unknown>;
  refreshMessageCardHeaders(): void;
  hostCloseTopEl: HTMLElement | null;
  hostCloseDrawerEl: HTMLElement | null;
  activeConversationEl: HTMLElement | null;
  conversationTitleEl: HTMLElement | null;
  splashSettingsModalEl: HTMLElement | null;
  splashSettingsUserNameEl: HTMLInputElement | null;
  splashSettingsShowConsoleWorkerIdEl: HTMLInputElement | null;
  splashConsoleWorkerIdEl: HTMLElement | null;
  documentRef: Document;
  windowRef: Window;
  onHostUiChanged?(): void;
}

export function bindHostRuntime(ctx: HostRuntimeContext) {
  const {
    getState,
    setState,
    sioCall,
    refreshMessageCardHeaders,
    hostCloseTopEl,
    hostCloseDrawerEl,
    activeConversationEl,
    conversationTitleEl,
    splashSettingsModalEl,
    splashSettingsUserNameEl,
    splashSettingsShowConsoleWorkerIdEl,
    splashConsoleWorkerIdEl,
    documentRef,
    windowRef,
    onHostUiChanged,
  } = ctx;
  const settingsRpcClient = createSettingsRpcClient({
    sioCall,
    windowRef,
  });
  let consoleWorkerId: string | null = readConsoleWorkerId();
  windowRef.addEventListener('te2-console-worker-ready', (event) => {
    consoleWorkerId = readConsoleWorkerIdFromEvent(event) ?? readConsoleWorkerId();
    renderConsoleWorkerId();
  });
  const uiRpcClient = createUiRpcClient({
    sioCall,
    windowRef,
  });
  uiRpcClient.subscribeLiveNotifications({
    onNotification: (method, params) => {
      if (method !== 'hostUi.updated') return;
      const ui = (params?.host_ui && typeof params.host_ui === 'object' ? params.host_ui : params) as HostUiPayload;
      setState({
        hostUi: {
          showClose: Boolean(ui.show_close),
          parentOrigin: typeof ui.parent_origin === 'string' && ui.parent_origin ? ui.parent_origin : null,
          ideMode: Boolean(ui.ide_mode),
          projectRoot: typeof ui.project_root === 'string' && ui.project_root ? ui.project_root : null,
        },
      });
      applyHostUi();
    },
  });

  function applyHostUi() {
    const { hostUi, activeView } = getState();
    const show = Boolean(hostUi?.showClose) && !Boolean(hostUi?.ideMode);
    if (hostCloseTopEl) {
      hostCloseTopEl.style.display = show && activeView !== 'conversation' ? 'inline-flex' : 'none';
    }
    if (hostCloseDrawerEl) {
      hostCloseDrawerEl.style.display = show && activeView === 'conversation' ? 'inline-flex' : 'none';
    }
    const tabsEl = documentRef.getElementById('splash-tabs');
    if (tabsEl instanceof HTMLElement) {
      tabsEl.style.display = Boolean(hostUi?.ideMode) ? 'flex' : 'none';
    }
    onHostUiChanged?.();
  }

  function sendHostCloseMessage() {
    if (!windowRef.parent || windowRef.parent === windowRef) return;
    const { conversationMeta, activeView, hostUi } = getState();
    const payload = {
      type: 'codex_agent_close',
      conversation_id: conversationMeta?.conversation_id || null,
      active_view: activeView || null,
    };
    const origin = hostUi?.parentOrigin || '*';
    try {
      windowRef.parent.postMessage(payload, origin);
    } catch {
      // ignore
    }
  }

  async function fetchHostUi() {
    try {
      const data = await uiRpcClient.getHostUi();
      if (!data || data.ok === false) return;
      const ui = (data?.host_ui && typeof data.host_ui === 'object' ? data.host_ui : {}) as HostUiPayload;
      setState({
        hostUi: {
          showClose: Boolean(ui.show_close),
          parentOrigin: typeof ui.parent_origin === 'string' && ui.parent_origin ? ui.parent_origin : null,
          ideMode: Boolean(ui.ide_mode),
          projectRoot: typeof ui.project_root === 'string' && ui.project_root ? ui.project_root : null,
        },
      });
      applyHostUi();
    } catch {
      // ignore
    }
  }

  async function fetchHomePrefix() {
    try {
      const data = await uiRpcClient.getFilesystemHome();
      const homePrefix = typeof data?.home === 'string' && data.home.trim() ? data.home.trim() : null;
      setState({ homePrefix });
      return homePrefix;
    } catch {
      return null;
    }
  }

  async function recheckSidebarConnection() {
    try {
      await uiRpcClient.recheckHostUi();
    } catch {
      // Best-effort only; host UI fetch still runs after this.
    }
  }

  async function postTe2OpenRequest({ path, line, column }: { path?: unknown; line?: unknown; column?: unknown }) {
    const { conversationSettings } = getState();
    const payload: UnknownRecord = {};
    if (typeof path === 'string' && path) {
      let nextPath = path;
      if (!nextPath.startsWith('/') && /^(?:data|home|tmp|usr|var|etc|storage)\//.test(nextPath)) {
        nextPath = `/${nextPath}`;
      }
      if (nextPath.startsWith('/')) {
        payload.path = nextPath;
      } else {
        const cwd = (conversationSettings?.cwd || '').replace(/\/+$/, '');
        payload.path = cwd ? `${cwd}/${nextPath}` : `/${nextPath}`;
      }
    }
    if (Number.isFinite(line)) payload.line = Number(line);
    if (Number.isFinite(column)) payload.column = Number(column);
    try {
      await uiRpcClient.openFile(payload);
    } catch {}
  }

  async function postExternalUrlOpenRequest(url: unknown) {
    const target = typeof url === 'string' ? url.trim() : '';
    if (!target) return;
    try {
      const { conversationMeta } = getState();
      const result = await uiRpcClient.openUrl({
        url: target,
        source: 'codex-agent',
        conversation_id: conversationMeta?.conversation_id || null,
      });
      if (result?.ok === false) {
        console.warn('[OPEN_EXTERNAL_URL] failed:', JSON.stringify(result));
      }
    } catch (err) {
      console.warn('[OPEN_EXTERNAL_URL] error:', err);
    }
  }

  function updateActiveConversationLabel() {
    if (!activeConversationEl) return;
    activeConversationEl.textContent = '';
  }

  function getUserDisplayName() {
    const appConfig = getState().appConfig;
    const userName = typeof appConfig?.user_name === 'string' ? appConfig.user_name.trim() : '';
    return userName || 'user';
  }

  function getAssistantDisplayName() {
    const conversationSettings = getState().conversationSettings;
    const alias = typeof conversationSettings?.alias === 'string' ? conversationSettings.alias.trim() : '';
    const model = typeof conversationSettings?.model === 'string' ? conversationSettings.model.trim() : '';
    return alias || model || 'assistant';
  }

  function getConversationHeaderTitle() {
    const conversationSettings = getState().conversationSettings;
    const alias = typeof conversationSettings?.alias === 'string' ? conversationSettings.alias.trim() : '';
    return alias || 'Conversation';
  }

  function updateConversationHeaderLabel() {
    if (conversationTitleEl) {
      conversationTitleEl.textContent = getConversationHeaderTitle();
    }
    const labelEl = documentRef.getElementById('conversation-label');
    if (labelEl instanceof HTMLElement) {
      labelEl.textContent = getState().conversationSettings?.label || '—';
    }
    refreshMessageCardHeaders();
  }

  function applyAppConfig(cfg: unknown) {
    const appConfig = cfg && typeof cfg === 'object' ? cfg as AppConfigState : {};
    setState({ appConfig });
    if (splashSettingsUserNameEl) {
      splashSettingsUserNameEl.value = typeof appConfig.user_name === 'string' ? appConfig.user_name : '';
    }
    if (splashSettingsShowConsoleWorkerIdEl) {
      splashSettingsShowConsoleWorkerIdEl.checked = appConfig.show_console_worker_id === true;
    }
    renderConsoleWorkerId();
    refreshMessageCardHeaders();
  }

  async function fetchAppConfig() {
    try {
      const data = await settingsRpcClient.getConfig();
      if (!data || data.ok === false) return null;
      applyAppConfig(data);
      return data;
    } catch {
      return null;
    }
  }

  function openSplashSettingsModal() {
    if (!splashSettingsModalEl) return;
    const { appConfig } = getState();
    if (splashSettingsUserNameEl) {
      splashSettingsUserNameEl.value = typeof appConfig?.user_name === 'string' ? appConfig.user_name : '';
    }
    if (splashSettingsShowConsoleWorkerIdEl) {
      splashSettingsShowConsoleWorkerIdEl.checked = appConfig?.show_console_worker_id === true;
    }
    splashSettingsModalEl.classList.remove('hidden');
  }

  function closeSplashSettingsModal() {
    if (!splashSettingsModalEl) return;
    splashSettingsModalEl.classList.add('hidden');
  }

  async function saveSplashSettings() {
    try {
      const data = await settingsRpcClient.updateConfig({
        user_name: splashSettingsUserNameEl?.value?.trim() || null,
        show_console_worker_id: splashSettingsShowConsoleWorkerIdEl?.checked === true,
      });
      if (!data || data.ok === false) return;
      applyAppConfig(data);
      closeSplashSettingsModal();
    } catch {
      // ignore
    }
  }

  function readConsoleWorkerId(): string | null {
    const source = (windowRef as ConsoleWorkerWindow).__TE2_CONSOLE_WORKER;
    const workerId = source && typeof source.workerId === 'string' ? source.workerId.trim() : '';
    return workerId || null;
  }

  function readConsoleWorkerIdFromEvent(event: Event): string | null {
    if (!(event instanceof CustomEvent)) return null;
    const detail = event.detail;
    if (!detail || typeof detail !== 'object') return null;
    const workerId = (detail as ConsoleWorkerInfo).workerId;
    return typeof workerId === 'string' && workerId.trim() ? workerId.trim() : null;
  }

  function renderConsoleWorkerId() {
    if (!splashConsoleWorkerIdEl) return;
    const { appConfig } = getState();
    const show = appConfig?.show_console_worker_id === true && Boolean(consoleWorkerId);
    splashConsoleWorkerIdEl.hidden = !show;
    if (!show) {
      splashConsoleWorkerIdEl.textContent = '';
      return;
    }
    splashConsoleWorkerIdEl.textContent = `console: ${consoleWorkerId}`;
  }

  return {
    applyHostUi,
    sendHostCloseMessage,
    fetchHostUi,
    fetchHomePrefix,
    recheckSidebarConnection,
    postTe2OpenRequest,
    postExternalUrlOpenRequest,
    updateActiveConversationLabel,
    getUserDisplayName,
    getAssistantDisplayName,
    updateConversationHeaderLabel,
    applyAppConfig,
    fetchAppConfig,
    openSplashSettingsModal,
    closeSplashSettingsModal,
    saveSplashSettings,
  };
}
