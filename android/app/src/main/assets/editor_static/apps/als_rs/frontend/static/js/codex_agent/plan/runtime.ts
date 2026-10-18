import { bindPlanOverlay } from '../plan_overlay.ts';
import { bindPlanModal } from '../plan_modal.ts';
import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import type { JsonObject } from '../rpc/conversations/contract.ts';
import { createSettingsRpcClient } from '../rpc/settings/client.ts';

type PlanRuntimeRecord = JsonObject;

interface PlanStep {
  step: string;
  status: string;
}

interface PlanDocumentState extends PlanRuntimeRecord {
  has_plan?: boolean;
  plan_exists?: boolean;
  plan_content?: string;
  plan_path?: string | null;
  plan_source?: string | null;
}

interface TodoState extends PlanRuntimeRecord {
  has_todo?: boolean;
  plan_steps?: PlanStep[];
  steps?: unknown[];
  step?: string;
  status?: string;
}

interface PlanFetchResult extends PlanRuntimeRecord {
  ok?: boolean;
  error?: string;
}

interface PlanRuntimeState {
  clientConversationId?: string | null;
  conversationMeta?: PlanRuntimeRecord;
  conversationSettings?: PlanRuntimeRecord;
  runtimeOptions?: PlanRuntimeRecord;
  planOverlayEl?: HTMLDivElement | null;
  planListEl?: HTMLDivElement | null;
  planCollapsed?: boolean;
  planDocState?: PlanDocumentState;
  todoState?: TodoState;
  planDocDirty?: boolean;
  planFetchSerial?: number;
  topSpacerEl?: HTMLElement | null;
}

interface PlanRuntimeContext {
  getState(): PlanRuntimeState;
  setState(patch: Partial<PlanRuntimeState>): void;
  timelineEl: HTMLElement | null;
  planItems: Map<string, HTMLDivElement>;
  sioCall(event: string, data?: Record<string, unknown>): Promise<unknown>;
  currentExtensionId(): string;
  planModalEl: HTMLElement | null;
  planCloseBtn: HTMLElement | null;
  planDismissBtn: HTMLElement | null;
  planBodyEl: HTMLElement | null;
  renderMarkdownInto: (container: HTMLElement | null | undefined, text: unknown) => void;
  highlightCode: (container: HTMLElement | null | undefined) => void;
}

function asObject(value: unknown): PlanRuntimeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as PlanRuntimeRecord;
}

function scopedConversationId(state: PlanRuntimeState): string | null {
  const clientConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
    ? state.clientConversationId.trim()
    : null;
  const metaConversationId = typeof state.conversationMeta?.conversation_id === 'string' && state.conversationMeta.conversation_id.trim()
    ? state.conversationMeta.conversation_id.trim()
    : null;
  return clientConversationId || metaConversationId;
}

function isPlanStep(value: PlanStep | null): value is PlanStep {
  return Boolean(value);
}

export function bindPlanRuntime(ctx: PlanRuntimeContext) {
  const {
    getState,
    setState,
    timelineEl,
    planItems,
    sioCall,
    currentExtensionId,
    planModalEl,
    planCloseBtn,
    planDismissBtn,
    planBodyEl,
    renderMarkdownInto,
    highlightCode,
  } = ctx;
  const conversationsRpcClient = createConversationsRpcClient({
    windowRef: typeof window !== 'undefined' ? window : null,
  });
  const settingsRpcClient = createSettingsRpcClient({
    sioCall,
    windowRef: typeof window !== 'undefined' ? window : null,
  });

  function createEmptyPlanDocumentState(hasPlan = Boolean(getState().runtimeOptions?.has_plan)) {
    return {
      has_plan: Boolean(hasPlan),
      plan_exists: false,
      plan_content: '',
      plan_path: null,
      plan_source: null,
    };
  }

  function createEmptyTodoState(hasTodo = Boolean(getState().runtimeOptions?.has_todo)) {
    return {
      has_todo: Boolean(hasTodo),
      plan_steps: [],
    };
  }

  function createEmptyPlanState(
    hasPlan = Boolean(getState().runtimeOptions?.has_plan),
    hasTodo = Boolean(getState().runtimeOptions?.has_todo),
  ) {
    return {
      ...createEmptyPlanDocumentState(hasPlan),
      ...createEmptyTodoState(hasTodo),
    };
  }

  function currentPlanState() {
    const { planDocState = {}, todoState = {}, runtimeOptions = {} } = getState();
    return {
      has_plan: Boolean(planDocState?.has_plan ?? runtimeOptions?.has_plan),
      has_todo: Boolean(todoState?.has_todo ?? runtimeOptions?.has_todo),
      plan_exists: Boolean(planDocState?.plan_exists),
      plan_content: typeof planDocState?.plan_content === 'string' ? planDocState.plan_content : '',
      plan_steps: Array.isArray(todoState?.plan_steps) ? todoState.plan_steps : [],
      plan_path: typeof planDocState?.plan_path === 'string' ? planDocState.plan_path : null,
      plan_source: typeof planDocState?.plan_source === 'string' ? planDocState.plan_source : null,
    };
  }

  function normalizePlanDocumentState(nextState: PlanDocumentState = {}) {
    const { planDocState = {}, runtimeOptions = {} } = getState();
    const hasPlan = nextState.has_plan ?? planDocState.has_plan ?? Boolean(runtimeOptions?.has_plan);
    const planContent = typeof nextState.plan_content === 'string'
      ? nextState.plan_content
      : (nextState.plan_exists === false ? '' : (planDocState.plan_content || ''));
    const planExists = nextState.plan_exists ?? (Boolean(hasPlan) && Boolean(planContent.trim()));
    return {
      ...planDocState,
      has_plan: Boolean(hasPlan),
      plan_exists: Boolean(planExists),
      plan_content: Boolean(planExists) ? planContent : '',
      plan_path: Boolean(planExists)
        ? (typeof nextState.plan_path === 'string' ? nextState.plan_path : (planDocState.plan_path || null))
        : null,
      plan_source: typeof nextState.plan_source === 'string' ? nextState.plan_source : (planDocState.plan_source || null),
    };
  }

  function normalizeTodoState(nextState: TodoState = {}) {
    const { todoState = {}, runtimeOptions = {} } = getState();
    const hasTodo = nextState.has_todo ?? todoState.has_todo ?? Boolean(runtimeOptions?.has_todo);
    const rawSteps = Array.isArray(nextState.plan_steps)
      ? nextState.plan_steps
      : (Array.isArray(nextState.steps) ? nextState.steps : (todoState.plan_steps || []));
    const steps = rawSteps
      .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const stepRecord = item as { step?: unknown; status?: unknown };
          const step = typeof stepRecord.step === 'string' ? stepRecord.step : '';
          if (!step) return null;
          return {
            step,
            status: typeof stepRecord.status === 'string' ? stepRecord.status : 'pending',
          };
        })
        .filter(isPlanStep);
    return {
      has_todo: Boolean(hasTodo),
      plan_steps: steps,
    };
  }

  const planModal = bindPlanModal({
    elements: {
      planModalEl,
      planCloseBtn,
      planDismissBtn,
      planBodyEl,
    },
    getState: () => ({ planState: currentPlanState() }),
    renderMarkdownInto,
    highlightCode,
  });

  async function persistPlanCollapsedState(collapsed: boolean) {
    const state = getState();
    const { conversationMeta = {}, conversationSettings = {} } = state;
    const nextPlanCollapsed = Boolean(collapsed);
    const nextConversationSettings = {
      ...(conversationSettings || {}),
      planOverlayCollapsed: nextPlanCollapsed,
    };
    const nextConversationMeta = conversationMeta && typeof conversationMeta === 'object'
      ? {
          ...conversationMeta,
          settings: nextConversationSettings,
        }
      : conversationMeta;
    setState({
      planCollapsed: nextPlanCollapsed,
      conversationSettings: nextConversationSettings,
      conversationMeta: nextConversationMeta,
    });
    const convoId = scopedConversationId(state);
    if (!convoId) return;
    try {
      await conversationsRpcClient.updateConversation({
        conversationId: convoId,
        settings: {
          planOverlayCollapsed: nextPlanCollapsed,
        },
      });
    } catch (err) {
      console.warn('failed to persist plan overlay collapse state', err);
    }
  }

  async function openPlanModal() {
    if (getState().planDocDirty) {
      try {
        await refreshPlanSurface(true);
      } catch (err) {
        console.warn('failed to refresh stale plan state before opening modal', err);
      }
    }
    return planModal.openPlanModal();
  }

  function closePlanModal() {
    return planModal.closePlanModal();
  }

  function renderPlanModal() {
    return planModal.renderPlanModal();
  }

  const planOverlay = bindPlanOverlay({
    timelineEl,
    getState: () => ({
      planOverlayEl: getState().planOverlayEl ?? null,
      planListEl: getState().planListEl ?? null,
      planCollapsed: Boolean(getState().planCollapsed),
      planItems,
      planState: currentPlanState(),
      topSpacerEl: getState().topSpacerEl ?? null,
    }),
    setState: (patch) => {
      const nextPatch: Partial<PlanRuntimeState> = {};
      if (patch.planOverlayEl !== undefined) nextPatch.planOverlayEl = patch.planOverlayEl;
      if (patch.planListEl !== undefined) nextPatch.planListEl = patch.planListEl;
      if (patch.planCollapsed !== undefined) nextPatch.planCollapsed = patch.planCollapsed;
      setState(nextPatch);
    },
    persistCollapsedState: (collapsed) => persistPlanCollapsedState(collapsed),
    openPlanModal: () => openPlanModal(),
  });

  function ensurePlanOverlay() {
    return planOverlay.ensurePlanOverlay();
  }

  function updatePlanItem(step: string, status: string) {
    return planOverlay.updatePlanItem(step, status);
  }

  function clearPlanOverlay() {
    return planOverlay.clearPlanOverlay();
  }

  function finalizePlanToTranscript() {
    return planOverlay.finalizePlanToTranscript();
  }

  function syncPlanOverlayUi() {
    return planOverlay.syncPlanOverlayUi();
  }

  function restorePlanOverlay(snapshot: PlanRuntimeRecord) {
    return planOverlay.restorePlanOverlay(snapshot);
  }

  function syncPlanSurface({ renderModal = false } = {}) {
    const mergedState = currentPlanState();
    if (mergedState.plan_exists || (mergedState.has_todo && mergedState.plan_steps.length > 0)) {
      ensurePlanOverlay();
    }
    if (mergedState.has_todo && mergedState.plan_steps.length > 0) {
      restorePlanOverlay({ steps: mergedState.plan_steps });
    } else {
      clearPlanOverlay();
    }
    syncPlanOverlayUi();
    if (renderModal && planModal.isPlanModalOpen()) {
      renderPlanModal();
    }
    return mergedState;
  }

  function applyAuthoritativePlanState(nextState: PlanDocumentState & TodoState) {
    setState({
      planDocState: normalizePlanDocumentState(nextState),
      todoState: normalizeTodoState(nextState),
      planDocDirty: false,
    });
    return syncPlanSurface({ renderModal: true });
  }

  function applyTodoState(nextState: TodoState) {
    setState({ todoState: normalizeTodoState(nextState) });
    return syncPlanSurface();
  }

  function updateTodoStateStep(step: string, status: string | undefined) {
    const normalizedStep = typeof step === 'string' ? step : '';
    if (!normalizedStep) return currentPlanState();
    const normalizedStatus = typeof status === 'string' && status ? status : 'pending';
    const { todoState = {} } = getState();
    const steps = Array.isArray(todoState.plan_steps) ? [...todoState.plan_steps] : [];
    const existingIndex = steps.findIndex((item) => item && item.step === normalizedStep);
    const nextItem = { step: normalizedStep, status: normalizedStatus };
    if (existingIndex >= 0) {
      steps[existingIndex] = nextItem;
    } else {
      steps.push(nextItem);
    }
    setState({
      todoState: {
        has_todo: true,
        plan_steps: steps,
      },
    });
    return syncPlanSurface();
  }

  function handleLiveTodoUpdate(nextState: TodoState = {}) {
    if (Array.isArray(nextState.plan_steps) || Array.isArray(nextState.steps)) {
      return applyTodoState(nextState);
    }
    if (typeof nextState.step === 'string' && nextState.step) {
      return updateTodoStateStep(nextState.step, nextState.status);
    }
    return currentPlanState();
  }

  function handleLivePlanState(nextState: PlanDocumentState & TodoState = {}) {
    handleLiveTodoUpdate(nextState);
    const operation = typeof nextState.plan_operation === 'string' ? nextState.plan_operation.trim().toLowerCase() : '';
    const modalOpen = planModal.isPlanModalOpen();
    const { planDocState = {}, runtimeOptions = {} } = getState();
    const hasPlanCapability = Boolean(nextState.has_plan ?? planDocState.has_plan ?? runtimeOptions?.has_plan);
    if (operation === 'update' && !modalOpen && hasPlanCapability) {
      setState({ planDocDirty: true });
      return currentPlanState();
    }
    if (operation === 'create' || operation === 'delete' || (operation === 'update' && modalOpen)) {
      const refreshPromise = refreshPlanSurface(true);
      if (refreshPromise && typeof (refreshPromise as Promise<unknown>).catch === 'function') {
        (refreshPromise as Promise<unknown>).catch((err) => console.warn('failed to refresh authoritative plan state', err));
      }
      return refreshPromise;
    }
    return currentPlanState();
  }

  async function fetchPlanState(force = false) {
    const state = getState();
    const { runtimeOptions = {} } = state;
    const convoId = scopedConversationId(state);
    const extensionId = currentExtensionId();
    const hasPlanCapability = Boolean(runtimeOptions?.has_plan);
    const hasTodoCapability = Boolean(runtimeOptions?.has_todo);
    const hasStateCapability = hasPlanCapability || hasTodoCapability;
    if (!convoId || !extensionId || !hasStateCapability) {
      return applyAuthoritativePlanState(createEmptyPlanState(hasPlanCapability, hasTodoCapability));
    }

    const requestSerial = Number(getState().planFetchSerial || 0) + 1;
    setState({ planFetchSerial: requestSerial });

    try {
      const data = asObject(await settingsRpcClient.getExtensionPlan({
        extensionId,
        conversationId: convoId,
        force,
      }));
      if (requestSerial !== getState().planFetchSerial) return currentPlanState();
      const planData = data as (PlanFetchResult & PlanDocumentState & TodoState) | null;
      if (!planData || planData.ok === false) {
        console.warn('failed to fetch plan state', planData?.error || 'unknown error');
        return currentPlanState();
      }
      return applyAuthoritativePlanState(planData);
    } catch (err) {
      if (requestSerial !== getState().planFetchSerial) return currentPlanState();
      console.warn('failed to refresh plan state', err);
      return currentPlanState();
    }
  }

  async function refreshPlanSurface(force = false) {
    return fetchPlanState(force);
  }

  return {
    ensurePlanOverlay,
    updatePlanItem,
    clearPlanOverlay,
    finalizePlanToTranscript,
    syncPlanOverlayUi,
    restorePlanOverlay,
    createEmptyPlanDocumentState,
    createEmptyTodoState,
    createEmptyPlanState,
    currentPlanState,
    applyAuthoritativePlanState,
    applyTodoState,
    updateTodoStateStep,
    handleLiveTodoUpdate,
    handleLivePlanState,
    fetchPlanState,
    refreshPlanSurface,
    openPlanModal,
    closePlanModal,
    renderPlanModal,
    persistPlanCollapsedState,
  };
}
