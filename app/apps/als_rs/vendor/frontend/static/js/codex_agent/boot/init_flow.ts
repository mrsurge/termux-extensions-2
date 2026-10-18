type InputLikeElement = HTMLElement & {
  value: string;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
};

type ConversationSettingsState = {
  agent?: string | null;
};

type ConversationMetaState = {
  conversation_id?: string | null;
  settings?: ConversationSettingsState | null;
};

type BootInitState = {
  messageCount?: number;
  tokenCount?: number;
  activeView?: string;
  clientConversationId?: string | null;
  clientActiveView?: string | null;
  conversationSettings?: ConversationSettingsState | null;
  conversationMeta?: ConversationMetaState | null;
  homePrefix?: string | null;
  pendingNewConversation?: boolean;
  pendingRollout?: unknown;
  rolloutPickerProvider?: unknown;
  pickerPath?: string | null;
  pickerMode?: string | null;
  splashTab?: string;
  hostUi?: unknown;
  appConfig?: unknown;
  openDropdownEl?: HTMLElement | null;
};

type BootElements = {
  statusEl?: HTMLElement | null;
  counterMessagesEl?: HTMLElement | null;
  counterTokensEl?: HTMLElement | null;
  settingsApprovalEl?: HTMLElement | null;
  settingsApprovalToggle?: HTMLElement | null;
  settingsApprovalOptions?: HTMLElement | null;
  settingsSandboxEl?: HTMLElement | null;
  settingsSandboxToggle?: HTMLElement | null;
  settingsSandboxOptions?: HTMLElement | null;
  settingsModelEl?: InputLikeElement | null;
  settingsModelToggle?: HTMLElement | null;
  settingsModelOptions?: HTMLElement | null;
  settingsEffortEl?: HTMLElement | null;
  settingsEffortToggle?: HTMLElement | null;
  settingsEffortOptions?: HTMLElement | null;
  settingsSummaryEl?: HTMLElement | null;
  settingsSummaryToggle?: HTMLElement | null;
  settingsSummaryOptions?: HTMLElement | null;
  settingsAgentEl?: HTMLElement | null;
  settingsAgentToggle?: HTMLElement | null;
  settingsAgentOptions?: HTMLElement | null;
  startBtn?: HTMLElement | null;
  stopBtn?: HTMLElement | null;
};

type CodexAgentApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

type CodexAgentWindow = Window & {
  CodexAgent?: CodexAgentApi;
  CodexAgentModules?: Array<(api: CodexAgentApi | undefined) => void>;
};

interface BootInitFlowContext {
  getState: () => BootInitState;
  setState: (patch: Partial<BootInitState>) => void;
  elements: BootElements;
  setPill: (el: HTMLElement | null, text: string, cls?: string) => void;
  setCounter: (el: HTMLElement | null, count: number) => void;
  updateScrollButton: () => void;
  resetWsReady: () => void;
  connectWS: (handleEvent?: (event: unknown) => void) => void;
  waitForWs: (timeoutMs: number) => Promise<boolean>;
  recheckSidebarConnection?: () => Promise<unknown> | unknown;
  fetchHostUi: () => Promise<unknown>;
  fetchHomePrefix?: () => Promise<unknown> | unknown;
  fetchAppConfig: () => Promise<unknown>;
  bindPickerFilter: () => void;
  setDrawerOpen: (open: boolean) => void;
  isWidescreenLayout?: () => boolean;
  fetchConversation: (conversationId?: string | null) => Promise<unknown>;
  fetchConversations: () => Promise<unknown>;
  resetTimeline: () => void;
  replayTranscript: () => Promise<unknown>;
  refreshPlanSurface?: () => Promise<unknown> | unknown;
  restorePendingApprovals: () => void;
  publishSidebarWindowState?: () => Promise<unknown> | unknown;
  isStatefulSidebarWindow?: () => boolean;
  maybeAutoScroll: (force?: boolean) => void;
  ensureActivityRow: () => void;
  fetchStatus: () => Promise<unknown>;
  setupDropdown: (
    inputEl: HTMLElement | null | undefined,
    toggleEl: HTMLElement | null | undefined,
    optionsEl: HTMLElement | null | undefined,
    items: string[],
  ) => void;
  loadAgentOptions: () => void;
  loadModelOptions: () => void;
  loadRuntimeOptions: (agentId: string | null, conversationId?: string | null) => void;
  updateEffortOptionsForModel: (model: string) => void;
  helperFns: Record<string, unknown>;
  closeDropdownMenu: (dropdownEl: HTMLElement) => void;
  sioCall: (event: string, payload?: Record<string, unknown>) => Promise<unknown>;
  documentRef: Document;
  windowRef: CodexAgentWindow;
}

export function bindBootInitFlow(ctx: BootInitFlowContext) {
  const {
    getState,
    setState,
    elements,
    setPill,
    setCounter,
    updateScrollButton,
    resetWsReady,
    connectWS,
    waitForWs,
    recheckSidebarConnection,
    fetchHostUi,
    fetchHomePrefix,
    fetchAppConfig,
    bindPickerFilter,
    setDrawerOpen,
    isWidescreenLayout,
    fetchConversation,
    fetchConversations,
    resetTimeline,
    replayTranscript,
    refreshPlanSurface,
    restorePendingApprovals,
    publishSidebarWindowState,
    isStatefulSidebarWindow,
    maybeAutoScroll,
    ensureActivityRow,
    fetchStatus,
    setupDropdown,
    loadAgentOptions,
    loadModelOptions,
    loadRuntimeOptions,
    updateEffortOptionsForModel,
    helperFns,
    closeDropdownMenu,
    sioCall,
    documentRef,
    windowRef,
  } = ctx;

  const {
    statusEl,
    counterMessagesEl,
    counterTokensEl,
    settingsApprovalEl,
    settingsApprovalToggle,
    settingsApprovalOptions,
    settingsSandboxEl,
    settingsSandboxToggle,
    settingsSandboxOptions,
    settingsModelEl,
    settingsModelToggle,
    settingsModelOptions,
    settingsEffortEl,
    settingsEffortToggle,
    settingsEffortOptions,
    settingsSummaryEl,
    settingsSummaryToggle,
    settingsSummaryOptions,
    settingsAgentEl,
    settingsAgentToggle,
    settingsAgentOptions,
    startBtn,
    stopBtn,
  } = elements;

  function initializeBoot(handleEvent?: (event: unknown) => void) {
    const state = getState();
    setPill(statusEl ?? null, 'idle', 'warn');
    setCounter(counterMessagesEl ?? null, state.messageCount ?? 0);
    setCounter(counterTokensEl ?? null, state.tokenCount ?? 0);
    updateScrollButton();
    resetWsReady();
    connectWS(handleEvent);
    bindPickerFilter();
    setDrawerOpen(state.activeView === 'conversation');
    void (async () => {
      const ready = await waitForWs(10000);
      if (!ready) {
        console.warn('Socket.IO not ready during initial boot hydration');
        ensureActivityRow();
        return;
      }
      await recheckSidebarConnection?.();
      await fetchHostUi();
      await fetchHomePrefix?.();
      await fetchAppConfig();
      const prefetchState = getState();
      const scopedConversationId = typeof prefetchState.clientConversationId === 'string' && prefetchState.clientConversationId.trim()
        ? prefetchState.clientConversationId.trim()
        : null;
      if (isStatefulSidebarWindow?.() === true && !scopedConversationId) {
        setState({
          activeView: 'splash',
          clientActiveView: 'splash',
        });
        await fetchConversations();
        ensureActivityRow();
        return;
      }
      await fetchConversation(scopedConversationId);
      await fetchConversations();
      const hydratedState = getState();
      const hasConversationId = typeof hydratedState.conversationMeta?.conversation_id === 'string'
        && hydratedState.conversationMeta.conversation_id.trim();
      const activeConversationView = hydratedState.activeView === 'conversation';
      const shouldHydrateTranscript = activeConversationView
        || (Boolean(hasConversationId) && isWidescreenLayout?.() === true);
      if (shouldHydrateTranscript) {
        resetTimeline();
        await replayTranscript();
        await refreshPlanSurface?.();
        restorePendingApprovals();
        await publishSidebarWindowState?.();
        setTimeout(() => {
          maybeAutoScroll(true);
        }, 50);
      } else {
        ensureActivityRow();
      }
    })();
  }

  function setupSettingsBoot() {
    setupDropdown(settingsApprovalEl, settingsApprovalToggle, settingsApprovalOptions, []);
    setupDropdown(settingsSandboxEl, settingsSandboxToggle, settingsSandboxOptions, []);
    setupDropdown(settingsEffortEl, settingsEffortToggle, settingsEffortOptions, [
      'low',
      'medium',
      'high',
    ]);
    setupDropdown(settingsSummaryEl, settingsSummaryToggle, settingsSummaryOptions, [
      'concise',
      'detailed',
      'auto',
    ]);
    setupDropdown(settingsModelEl, settingsModelToggle, settingsModelOptions, []);
    setupDropdown(settingsAgentEl, settingsAgentToggle, settingsAgentOptions, []);
    loadAgentOptions();
    loadModelOptions();
    const state = getState();
    const scopedConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
      ? state.clientConversationId.trim()
      : (typeof state.conversationMeta?.conversation_id === 'string' && state.conversationMeta.conversation_id.trim()
        ? state.conversationMeta.conversation_id.trim()
        : null);
    loadRuntimeOptions(
      state.conversationSettings?.agent || state.conversationMeta?.settings?.agent || null,
      scopedConversationId,
    );
    if (settingsModelEl) {
      settingsModelEl.addEventListener('input', () => {
        updateEffortOptionsForModel(settingsModelEl.value);
      });
      settingsModelEl.addEventListener('change', () => {
        updateEffortOptionsForModel(settingsModelEl.value);
      });
    }
  }

  function installCodexAgentGlobal() {
    const api = {
      helpers: {
        ...helperFns,
        setPendingNewConversation: (val: unknown) => { setState({ pendingNewConversation: Boolean(val) }); },
        setPendingRollout: (val: unknown) => { setState({ pendingRollout: val }); },
        setRolloutPickerProvider: (provider: unknown) => { setState({ rolloutPickerProvider: provider || null }); },
        getRolloutPickerProvider: () => getState().rolloutPickerProvider || null,
        getPickerPath: () => getState().pickerPath,
        setPickerPath: (val: string | null | undefined) => { setState({ pickerPath: val ?? null }); },
        getPickerMode: () => getState().pickerMode,
        setPickerMode: (val: string | null | undefined) => { setState({ pickerMode: val || 'cwd' }); },
      },
      state: {
        get pendingNewConversation() { return getState().pendingNewConversation; },
        set pendingNewConversation(val) { setState({ pendingNewConversation: Boolean(val) }); },
        get pendingRollout() { return getState().pendingRollout; },
        get rolloutPickerProvider() { return getState().rolloutPickerProvider || null; },
        get conversationMeta() { return getState().conversationMeta; },
        get conversationSettings() { return getState().conversationSettings; },
        get splashTab() { return getState().splashTab; },
        get hostUi() { return getState().hostUi; },
        get homePrefix() { return getState().homePrefix; },
        get appConfig() { return getState().appConfig; },
      },
    };
    windowRef.CodexAgent = api;
    return api;
  }

  function bindStartStopButtons() {
    // Legacy builtin app-server controls removed from the codex-agent UI.
  }

  function initExternalModules() {
    (windowRef.CodexAgentModules || []).forEach((fn: (api: CodexAgentApi | undefined) => void) => {
      try {
        fn(windowRef.CodexAgent);
      } catch (err) {
        console.warn('module init failed', err);
      }
    });
  }

  function bindDropdownClose() {
    documentRef.addEventListener('click', (evt: MouseEvent) => {
      const openDropdownEl = getState().openDropdownEl;
      if (!openDropdownEl) return;
      const target = evt.target;
      if (!(target instanceof HTMLElement)) return;
      if (openDropdownEl.contains(target)) return;
      if (target.classList.contains('dropdown-toggle')) return;
      closeDropdownMenu(openDropdownEl);
    });
  }

  return {
    initializeBoot,
    setupSettingsBoot,
    installCodexAgentGlobal,
    bindStartStopButtons,
    initExternalModules,
    bindDropdownClose,
  };
}
