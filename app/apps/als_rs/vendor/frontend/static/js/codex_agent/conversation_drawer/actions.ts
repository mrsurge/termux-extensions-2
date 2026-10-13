import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import type { JsonObject } from '../rpc/conversations/contract.ts';
import { createSettingsRpcClient } from '../rpc/settings/client.ts';
import { createUiRpcClient } from '../rpc/ui/client.ts';

type Awaitable = Promise<unknown> | unknown;

interface ConversationSettings extends Record<string, unknown> {
  agent?: string;
}

interface ConversationMeta extends Record<string, unknown> {
  conversation_id?: string | null;
  settings?: ConversationSettings;
  status?: string;
  integrity?: string;
  integrity_error?: string;
}

export interface DrawerState {
  clientConversationId?: string | null;
  conversationMeta?: ConversationMeta | null;
  miniConversationDrawerOpen?: boolean;
  activeView?: string | null;
  draftSaveTimer?: ReturnType<typeof setTimeout> | null;
  lastDraftHash?: string | null;
  clientActiveView?: string | null;
  conversationList?: ConversationMeta[];
  conversationListRevision?: number;
  extensionCatalog?: unknown[];
  pendingNewConversation?: boolean;
  conversationSettings?: ConversationSettings;
  splashTab?: string;
  rpcTransportEnabled?: boolean;
}

interface ConversationListResponse {
  items: ConversationMeta[];
  activeConversationId: string | null;
  activeView: string | null;
  revision: number;
}

type ConversationCreateResponse = Omit<ConversationMeta, 'conversation_id' | 'settings'> & {
  conversation_id: string | null;
  settings: ConversationSettings;
};

interface ConversationDrawerActionsContext {
  sioCall(event: string, payload?: JsonObject, options?: JsonObject): Promise<unknown>;
  getState(): DrawerState;
  setState(nextState: Partial<DrawerState>): void;
  resetTimeline(): void;
  fetchConversation(conversationId?: string | null): Awaitable;
  replayTranscript(): Awaitable;
  refreshPlanSurface?(): Awaitable;
  restorePendingApprovals(): void;
  publishSidebarWindowState?(): Awaitable;
  resetConversationUiState(): void;
  setDrawerOpen(open: boolean): void;
  applyHostUi(): void;
  openSettingsModal(): void;
  renderConversationList(list: ConversationMeta[], activeConversationId: string | null): void;
  renderMiniConversationList(list: ConversationMeta[], activeConversationId: string | null): void;
  renderSplashTabs(): void;
  updateActiveConversationLabel(): void;
  conversationTitleEl: HTMLElement | null;
  conversationCreateBtn: HTMLElement | null;
  conversationBackBtn: HTMLElement | null;
  conversationSettingsBtn: HTMLElement | null;
  conversationBodyEl: HTMLElement | null;
  conversationMiniDrawerEl: HTMLElement | null;
  conversationMiniCloseBtn: HTMLElement | null;
  documentRef?: Document;
  windowRef?: Window;
}

interface ConversationDrawerActionsBinding {
  fetchConversations(): Promise<void>;
  resyncConversationList(): Promise<void>;
  setActiveView(view: string): Promise<void>;
  selectConversation(conversationId: string): Promise<void>;
  selectConversationWithView(conversationId: string, view: string): Promise<void>;
  createConversation(): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  setConversationPins(pinnedConversationIds: string[]): Promise<void>;
  bindHeaderHandlers(): void;
  bindSplashTabHandlers(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeConversationListResponse(data: unknown): ConversationListResponse {
  const payload = isRecord(data) ? data : null;
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item): item is ConversationMeta => isRecord(item))
    : [];
  return {
    items,
    activeConversationId: typeof payload?.active_conversation_id === 'string' ? payload.active_conversation_id : null,
    activeView: typeof payload?.active_view === 'string' ? payload.active_view : null,
    revision: typeof payload?.revision === 'number' && Number.isFinite(payload.revision)
      ? payload.revision
      : 0,
  };
}

function normalizeConversationCreateResponse(data: unknown): ConversationCreateResponse {
  const payload = isRecord(data) ? data : {};
  const settings = isRecord(payload.settings) ? payload.settings as ConversationSettings : {};
  return {
    ...payload,
    conversation_id: typeof payload.conversation_id === 'string' ? payload.conversation_id : null,
    settings,
  };
}

export function createConversationDrawerActions(
  ctx: ConversationDrawerActionsContext,
): ConversationDrawerActionsBinding {
  const {
    sioCall,
    getState,
    setState,
    resetTimeline,
    fetchConversation,
    replayTranscript,
    refreshPlanSurface,
    restorePendingApprovals,
    publishSidebarWindowState,
    resetConversationUiState,
    setDrawerOpen,
    applyHostUi,
    openSettingsModal,
    renderConversationList,
    renderMiniConversationList,
    renderSplashTabs,
    updateActiveConversationLabel,
    conversationTitleEl,
    conversationCreateBtn,
    conversationBackBtn,
    conversationSettingsBtn,
    conversationBodyEl,
    conversationMiniDrawerEl,
    conversationMiniCloseBtn,
    documentRef,
    windowRef,
  } = ctx;
  const settingsRpcClient = createSettingsRpcClient({
    sioCall,
    windowRef,
  });
  const conversationsRpcClient = createConversationsRpcClient({
    sioCall,
    windowRef,
  });
  const uiRpcClient = createUiRpcClient({
    sioCall,
    windowRef,
  });
  let conversationListFetchSerial = 0;

  function getActiveConversationId(): string | null {
    const state = getState();
    return state.clientConversationId || state.conversationMeta?.conversation_id || null;
  }

  function syncMiniDrawerUi() {
    const state = getState();
    const isOpen = Boolean(state.miniConversationDrawerOpen) && state.activeView === 'conversation';
    if (conversationBodyEl) {
      conversationBodyEl.classList.toggle('mini-drawer-open', isOpen);
    }
    if (conversationMiniDrawerEl) {
      conversationMiniDrawerEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
    if (conversationTitleEl) {
      conversationTitleEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      conversationTitleEl.setAttribute('title', isOpen ? 'Hide conversation switcher' : 'Show conversation switcher');
    }
    renderMiniConversationList(getState().conversationList || [], getActiveConversationId());
  }

  function setMiniDrawerOpen(open: boolean): void {
    setState({ miniConversationDrawerOpen: Boolean(open) });
    syncMiniDrawerUi();
  }

  function toggleMiniDrawer() {
    const state = getState();
    if (state.activeView !== 'conversation') return;
    setMiniDrawerOpen(!state.miniConversationDrawerOpen);
  }

  async function loadConversationList({ resetRevision = false }: { resetRevision?: boolean } = {}): Promise<void> {
    const fetchSerial = ++conversationListFetchSerial;
    if (resetRevision) {
      setState({ conversationListRevision: 0 });
    }
    let extensionCatalog = getState().extensionCatalog;
    try {
      try {
        const extData = await settingsRpcClient.listExtensions();
        extensionCatalog = Array.isArray(extData.extensions) ? extData.extensions : [];
      } catch {
        // ignore
      }
      const data = normalizeConversationListResponse(await conversationsRpcClient.listConversations());
      if (fetchSerial !== conversationListFetchSerial) return;
      const state = getState();
      const currentRevision = typeof state.conversationListRevision === 'number'
        && Number.isFinite(state.conversationListRevision)
        ? state.conversationListRevision
        : 0;
      if (currentRevision > data.revision) {
        setState({ extensionCatalog });
        syncMiniDrawerUi();
        return;
      }
      const conversationList = data.items;
      const ssotActiveId = data.activeConversationId;
      const highlightId = state.clientConversationId || state.conversationMeta?.conversation_id || ssotActiveId;
      const patch: Partial<DrawerState> = { conversationList, conversationListRevision: data.revision, extensionCatalog };
      let appliedSsotActiveView: string | null = null;
      if (!state.clientActiveView && data.activeView) {
        patch.clientActiveView = data.activeView;
        patch.activeView = data.activeView;
        appliedSsotActiveView = data.activeView;
      }
      setState(patch);
      if (appliedSsotActiveView) {
        setDrawerOpen(appliedSsotActiveView === 'conversation');
        applyHostUi();
      }
      renderConversationList(conversationList, highlightId);
      renderSplashTabs();
      updateActiveConversationLabel();
      syncMiniDrawerUi();
    } catch (error) {
      if (fetchSerial !== conversationListFetchSerial) return;
      if (resetRevision) {
        const currentRevision = getState().conversationListRevision;
        if (typeof currentRevision === 'number' && Number.isFinite(currentRevision) && currentRevision > 0) {
          return;
        }
      }
      const message = error instanceof Error
        ? error.message
        : String(error || 'Unknown conversation list error');
      const diagnostic: ConversationMeta = {
        status: 'error',
        integrity: 'list_error',
        integrity_error: message,
      };
      setState({ conversationList: [diagnostic], extensionCatalog });
      renderConversationList([diagnostic], null);
      renderSplashTabs();
      updateActiveConversationLabel();
      syncMiniDrawerUi();
      console.error('Conversation list failed:', error);
    }
  }

  async function fetchConversations(): Promise<void> {
    await loadConversationList();
  }

  async function resyncConversationList(): Promise<void> {
    await loadConversationList({ resetRevision: true });
  }

  async function setActiveView(view: string): Promise<void> {
    try {
      await uiRpcClient.setView(view);
    } catch {
      // ignore - SSOT is best-effort for boot defaults
    }
    setState({
      clientActiveView: view,
      activeView: view,
      miniConversationDrawerOpen: view === 'conversation' ? getState().miniConversationDrawerOpen : false,
    });
    setDrawerOpen(view === 'conversation');
    applyHostUi();
    syncMiniDrawerUi();
  }

  async function selectConversation(conversationId: string): Promise<void> {
    return selectConversationWithView(conversationId, 'conversation');
  }

  async function selectConversationWithView(conversationId: string, view: string): Promise<void> {
    if (!conversationId) return;
    const state = getState();
    // Cancel any pending draft save to avoid race condition
    if (state.draftSaveTimer) {
      clearTimeout(state.draftSaveTimer);
      setState({ draftSaveTimer: null });
    }
    setState({ lastDraftHash: null, miniConversationDrawerOpen: false });
    resetConversationUiState();
    resetTimeline();
    setState({ clientConversationId: conversationId, clientActiveView: view });
    try {
      await conversationsRpcClient.selectConversation({ conversationId, view });
    } catch {
      // ignore - SSOT is best-effort for boot defaults
    }
    await fetchConversation(conversationId);
    await fetchConversations();
    await replayTranscript();
    await refreshPlanSurface?.();
    restorePendingApprovals();
    await publishSidebarWindowState?.();
    setDrawerOpen(view === 'conversation');
    setState({
      activeView: view,
      miniConversationDrawerOpen: false,
    });
    applyHostUi();
    syncMiniDrawerUi();
  }

  async function createConversation(): Promise<void> {
    const state = getState();
    // Cancel any pending draft save from previous conversation
    if (state.draftSaveTimer) {
      clearTimeout(state.draftSaveTimer);
      setState({ draftSaveTimer: null });
    }
    setState({ lastDraftHash: null });
    resetConversationUiState();
    const meta = normalizeConversationCreateResponse(await conversationsRpcClient.createConversation());
    if (meta.conversation_id) {
      setState({
        clientConversationId: meta.conversation_id,
        clientActiveView: 'conversation',
        conversationMeta: meta,
        conversationSettings: meta.settings,
      });
    }
    await fetchConversation(getState().clientConversationId);
    await fetchConversations();
    resetTimeline();
    await replayTranscript();
    await refreshPlanSurface?.();
    restorePendingApprovals();
    await publishSidebarWindowState?.();
    setDrawerOpen(true);
    setState({ activeView: 'conversation' });
    applyHostUi();
    openSettingsModal();
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    if (!conversationId) return;
    const performDelete = async (): Promise<void> => {
      await conversationsRpcClient.deleteConversation({ conversationId });
      const state = getState();
      if (state.clientConversationId && state.clientConversationId === conversationId) {
        resetConversationUiState();
        setState({
          clientConversationId: null,
          clientActiveView: 'splash',
          activeView: 'splash',
          miniConversationDrawerOpen: false,
        });
        setDrawerOpen(false);
      }
      await fetchConversations();
      await fetchConversation();
      if (!getState().conversationMeta?.conversation_id) {
        setDrawerOpen(false);
        await setActiveView('splash');
      }
      syncMiniDrawerUi();
    };

    const warningHelpers = (
      windowRef as (Window & typeof globalThis & {
        CodexAgent?: {
          helpers?: {
            openWarningModal?: (options: {
              title?: string;
              body?: string;
              confirmText?: string;
              onConfirm?: () => Promise<void> | void;
              onCancel?: () => void;
            }) => void;
          };
        };
      })
    )?.CodexAgent?.helpers;
    const openWarningModal = warningHelpers?.openWarningModal;
    if (typeof openWarningModal !== 'function') {
      await performDelete();
      return;
    }
    const conversation = getState().conversationList?.find((item) => item.conversation_id === conversationId);
    const label = conversation?.settings?.alias || conversation?.settings?.label || conversationId;
    await new Promise<void>((resolve) => {
      openWarningModal({
        title: 'Delete conversation?',
        body: `Delete ${label}? This removes the local harness conversation history only.`,
        confirmText: 'Delete',
        onConfirm: async () => {
          try {
            await performDelete();
          } finally {
            resolve();
          }
        },
        onCancel: () => {
          resolve();
        },
      });
    });
  }

  async function setConversationPins(pinnedConversationIds: string[]): Promise<void> {
    if (!Array.isArray(pinnedConversationIds)) return;
    await conversationsRpcClient.setConversationPins({ pinnedConversationIds });
    await fetchConversations();
  }

  function bindHeaderHandlers() {
    conversationCreateBtn?.addEventListener('click', async () => {
      setState({ pendingNewConversation: true });
      setMiniDrawerOpen(false);
      await setActiveView('splash');
      openSettingsModal();
    });

    conversationBackBtn?.addEventListener('click', async () => {
      setMiniDrawerOpen(false);
      await setActiveView('splash');
    });

    conversationSettingsBtn?.addEventListener('click', () => {
      setState({ pendingNewConversation: false });
      openSettingsModal();
    });

    conversationMiniCloseBtn?.addEventListener('click', () => {
      setMiniDrawerOpen(false);
    });

    conversationTitleEl?.addEventListener('click', () => {
      toggleMiniDrawer();
    });

    conversationTitleEl?.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      toggleMiniDrawer();
    });

    documentRef?.addEventListener('click', (evt) => {
      const state = getState();
      if (!state.miniConversationDrawerOpen) return;
      const target = evt.target;
      if (!(target instanceof Element)) return;
      if (conversationMiniDrawerEl?.contains(target)) return;
      if (conversationTitleEl?.contains(target)) return;
      setMiniDrawerOpen(false);
    });

    settingsRpcClient.subscribeLiveNotifications({
      onNotification: async (method) => {
        if (method !== 'extensions.updated') return;
        await fetchConversations();
        await fetchConversation();
        const state = getState();
        if (!state.conversationMeta?.conversation_id) {
          setDrawerOpen(false);
          await setActiveView('splash');
        }
      },
    });

    syncMiniDrawerUi();
  }

  function bindSplashTabHandlers() {
    const doc = documentRef || document;
    const splashTabAllBtn = doc.getElementById('splash-tab-all');
    const splashTabProjectBtn = doc.getElementById('splash-tab-project');
    const miniTabAllBtn = doc.getElementById('conversation-mini-tab-all');
    const miniTabProjectBtn = doc.getElementById('conversation-mini-tab-project');
    const splashGoConversationBtn = doc.getElementById('splash-go-conversation');
    const setConversationScope = (scope: 'all' | 'project') => {
      setState({ splashTab: scope });
      const state = getState();
      renderSplashTabs();
      const activeConversationId = getActiveConversationId();
      renderConversationList(state.conversationList || [], activeConversationId);
      renderMiniConversationList(state.conversationList || [], activeConversationId);
    };
    splashTabAllBtn?.addEventListener('click', () => setConversationScope('all'));
    splashTabProjectBtn?.addEventListener('click', () => setConversationScope('project'));
    miniTabAllBtn?.addEventListener('click', () => setConversationScope('all'));
    miniTabProjectBtn?.addEventListener('click', () => setConversationScope('project'));
    splashGoConversationBtn?.addEventListener('click', async () => {
      const activeConversationId = getActiveConversationId();
      if (!activeConversationId) return;
      await selectConversationWithView(activeConversationId, 'conversation');
    });
    renderSplashTabs();
  }

  return {
    fetchConversations,
    resyncConversationList,
    setActiveView,
    selectConversation,
    selectConversationWithView,
    createConversation,
    deleteConversation,
    setConversationPins,
    bindHeaderHandlers,
    bindSplashTabHandlers,
  };
}
