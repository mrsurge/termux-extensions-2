import { createSettingsRpcClient } from '../rpc/settings/client.ts';
import { createUiRpcClient } from '../rpc/ui/client.ts';

type CodexAgentHelpers = {
  getSchemaFieldInput?: (fieldId: string) => unknown;
  onAgentChange?: (agentId: string) => unknown;
  refreshProviderInfo?: (extensionId?: string) => unknown;
};

type CodexAgentWindow = Window & typeof globalThis & {
  CodexAgent?: {
    helpers?: CodexAgentHelpers;
  };
};

type TextValueInput = HTMLInputElement | HTMLTextAreaElement;
type PickerMode = 'cwd' | 'mention';
type DropdownOption = { value: string; label: string };
type DropdownOptionInput = string | { value?: string; label?: string; [key: string]: unknown };

type RuntimeOptionInput = {
  settingKey?: string;
  options?: DropdownOptionInput[];
  current?: string;
  default?: string;
  [key: string]: unknown;
};

type RuntimeOptionDescriptor = {
  settingKey: string;
  options: DropdownOption[];
  current: string;
  default: string;
};

type RuntimeOptionsState = {
  approval?: RuntimeOptionInput;
  sandbox?: RuntimeOptionInput;
  agent?: string;
  [key: string]: unknown;
};

const DEFAULT_COMMAND_OUTPUT_LINES = '500';

type ConversationSettings = {
  cwd?: string;
  agent?: string;
  approvalPolicy?: string;
  sandboxPolicy?: string;
  model?: string;
  effort?: string;
  reasoning_effort?: string;
  summary?: string;
  developer_instructions?: string;
  label?: string;
  alias?: string;
  commandOutputLines?: string;
  viewWrap?: boolean;
  markdown?: boolean;
  diffSyntax?: boolean;
  semanticShellRibbon?: boolean;
  te2_mcp_integration?: boolean;
  rolloutId?: string;
  [key: string]: unknown;
};

type ConversationMeta = {
  conversation_id?: string;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

type HostUiState = {
  ideMode?: boolean;
  projectRoot?: string;
  [key: string]: unknown;
};

type PickerItem = {
  name?: string;
  path?: string;
  type?: string;
  [key: string]: unknown;
};

const MENTION_DOUBLE_ACTIVATION_MS = 400;

export function mentionPickerItemPath(item: PickerItem | null | undefined): string {
  const value = item?.path || item?.name || '';
  return typeof value === 'string' ? value.trim() : '';
}

type RolloutItem = {
  id?: string;
  short_id?: string;
  preview?: string;
  cwd?: string;
  [key: string]: unknown;
};

type PendingRolloutState = {
  id?: string;
  items?: RolloutItem[];
  token_total?: number | null;
};

type ExtensionCatalogEntry = {
  id?: string;
  name?: string;
  active?: boolean;
  [key: string]: unknown;
};

type ModelEffortInput = string | { reasoningEffort?: string; reasoning_effort?: string; value?: string; [key: string]: unknown };
type ModelSupportsInput = {
  reasoningEffort?: ModelEffortInput[] | boolean;
  reasoning_effort?: ModelEffortInput[] | boolean;
  [key: string]: unknown;
};
type ModelCapabilitiesInput = {
  supports?: ModelSupportsInput;
  [key: string]: unknown;
};

type ExtensionModel = {
  id?: string;
  supportedReasoningEfforts?: ModelEffortInput[];
  supported_reasoning_efforts?: ModelEffortInput[];
  defaultReasoningEffort?: string;
  default_reasoning_effort?: string;
  capabilities?: ModelCapabilitiesInput;
  [key: string]: unknown;
};

type SettingsUiState = {
  clientConversationId?: string | null;
  conversationMeta?: ConversationMeta | null;
  conversationSettings?: ConversationSettings | null;
  pendingNewConversation?: boolean;
  pendingRollout?: PendingRolloutState | null;
  hostUi?: HostUiState | null;
  splashTab?: string;
  pickerPath?: string | null;
  pickerMode?: string | null;
  pickerItems?: PickerItem[];
  filterTimer?: ReturnType<typeof setTimeout> | null;
  openDropdownEl?: HTMLElement | null;
  modelList?: ExtensionModel[];
  runtimeOptions?: RuntimeOptionsState;
  extensionCatalog?: ExtensionCatalogEntry[];
  rolloutPickerProvider?: RolloutPickerProvider | null;
};

function scopedConversationId(state: SettingsUiState): string | null {
  const clientConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
    ? state.clientConversationId.trim()
    : null;
  const metaConversationId = typeof state.conversationMeta?.conversation_id === 'string' && state.conversationMeta.conversation_id.trim()
    ? state.conversationMeta.conversation_id.trim()
    : null;
  return clientConversationId || metaConversationId;
}

type RolloutProviderArgs = {
  cwd: string;
  state: SettingsUiState;
  setState: (patch: Partial<SettingsUiState>) => void;
  setActivity: (message: string, isError: boolean) => unknown;
  sioCall: (event: string, payload?: Record<string, unknown>) => Promise<unknown>;
};

type RolloutPreviewArgs = RolloutProviderArgs & {
  rolloutId: string;
};

type RolloutProviderResult = {
  items?: RolloutItem[];
  token_total?: number | null;
};

type RolloutPickerProvider = {
  list?: (args: RolloutProviderArgs) => Promise<RolloutProviderResult | null | undefined>;
  preview?: (args: RolloutPreviewArgs) => Promise<RolloutProviderResult | null | undefined>;
};

type SettingsUiElements = {
  settingsCwdEl?: TextValueInput | null;
  settingsApprovalEl?: TextValueInput | null;
  settingsSandboxEl?: TextValueInput | null;
  settingsModelEl?: TextValueInput | null;
  settingsEffortEl?: TextValueInput | null;
  settingsSummaryEl?: TextValueInput | null;
  settingsDeveloperInstructionsEl?: TextValueInput | null;
  settingsLabelEl?: TextValueInput | null;
  settingsAliasEl?: TextValueInput | null;
  settingsCommandLinesEl?: TextValueInput | null;
  settingsViewWrapEl?: HTMLInputElement | null;
  settingsMarkdownEl?: HTMLInputElement | null;
  settingsDiffSyntaxEl?: HTMLInputElement | null;
  settingsSemanticShellRibbonEl?: HTMLInputElement | null;
  settingsTe2McpIntegrationEl?: HTMLInputElement | null;
  settingsAgentEl?: TextValueInput | null;
  settingsAgentOptions?: HTMLElement | null;
  settingsAgentRowEl?: HTMLElement | null;
  settingsRolloutEl?: TextValueInput | null;
  settingsRolloutRowEl?: HTMLElement | null;
  settingsApprovalOptions?: HTMLElement | null;
  settingsSandboxOptions?: HTMLElement | null;
  settingsModelOptions?: HTMLElement | null;
  settingsEffortOptions?: HTMLElement | null;
  settingsSummaryOptions?: HTMLElement | null;
  pickerOverlayEl?: HTMLElement | null;
  pickerPathEl?: HTMLElement | null;
  pickerListEl?: HTMLElement | null;
  pickerTitleEl?: HTMLElement | null;
  pickerFilterEl?: HTMLInputElement | null;
  rolloutOverlayEl?: HTMLElement | null;
  rolloutListEl?: HTMLElement | null;
  pickerCloseBtn?: HTMLElement | null;
  pickerUpBtn?: HTMLElement | null;
  pickerSelectBtn?: HTMLElement | null;
};

type SettingsUiContext = {
  getState: () => SettingsUiState;
  setState: (patch: Partial<SettingsUiState>) => void;
  elements: SettingsUiElements;
  sioCall: (event: string, payload?: Record<string, unknown>) => Promise<unknown>;
  setActivity: (message: string, isError: boolean) => unknown;
  getRelativePath: (absolutePath: string | null | undefined, cwd: string | null | undefined) => string | null | undefined;
  insertMention: (text: string) => unknown;
  getWindow?: () => CodexAgentWindow;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isValueInput(candidate: unknown): candidate is TextValueInput {
  return !!candidate && typeof (candidate as TextValueInput).value === 'string';
}

function isExtensionCatalogEntry(value: unknown): value is ExtensionCatalogEntry {
  return isRecord(value);
}

function isExtensionModel(value: unknown): value is ExtensionModel {
  return isRecord(value) && typeof value.id === 'string' && value.id.trim().length > 0;
}

function isPickerItem(value: unknown): value is PickerItem {
  return isRecord(value);
}

function isRolloutItem(value: unknown): value is RolloutItem {
  return isRecord(value);
}

export function bindSettingsUiFlow(ctx: SettingsUiContext) {
  const {
    getState,
    setState,
    elements,
    sioCall,
    setActivity,
    getRelativePath,
    insertMention,
    getWindow,
  } = ctx;

  const {
    settingsCwdEl,
    settingsApprovalEl,
    settingsSandboxEl,
    settingsModelEl,
    settingsEffortEl,
    settingsSummaryEl,
    settingsDeveloperInstructionsEl,
    settingsLabelEl,
    settingsAliasEl,
    settingsCommandLinesEl,
    settingsViewWrapEl,
    settingsMarkdownEl,
    settingsDiffSyntaxEl,
    settingsSemanticShellRibbonEl,
    settingsTe2McpIntegrationEl,
    settingsAgentEl,
    settingsAgentOptions,
    settingsAgentRowEl,
    settingsRolloutEl,
    settingsRolloutRowEl,
    settingsApprovalOptions,
    settingsSandboxOptions,
    settingsModelOptions,
    settingsEffortOptions,
    settingsSummaryOptions,
    pickerOverlayEl,
    pickerPathEl,
    pickerListEl,
    pickerTitleEl,
    pickerFilterEl,
    rolloutOverlayEl,
    rolloutListEl,
  } = elements;
  const windowRef = (getWindow ? getWindow() : window) as CodexAgentWindow;
  const settingsRpcClient = createSettingsRpcClient({
    sioCall,
    windowRef,
  });
  const uiRpcClient = createUiRpcClient({
    sioCall,
    windowRef,
  });
  const pickerCloseBtn = elements.pickerCloseBtn || windowRef?.document?.getElementById('picker-close');
  const pickerUpBtn = elements.pickerUpBtn || windowRef?.document?.getElementById('picker-up');
  const pickerSelectBtn = elements.pickerSelectBtn || windowRef?.document?.getElementById('picker-select');
  let pickerTargetInput: TextValueInput | null = null;
  let selectedMentionItem: PickerItem | null = null;
  let lastMentionClickPath = '';
  let lastMentionClickAt = 0;

  function getSchemaFieldInput(fieldId: string): TextValueInput | null {
    const getter = windowRef?.CodexAgent?.helpers?.getSchemaFieldInput;
    if (typeof getter !== 'function') return null;
    const input = getter(fieldId);
    return isValueInput(input) ? input : null;
  }

  function getActiveCwdInput(): TextValueInput | null {
    const schemaInput = getSchemaFieldInput('cwd');
    if (isValueInput(schemaInput)) return schemaInput;
    if (isValueInput(settingsCwdEl)) return settingsCwdEl;
    return null;
  }

  function getActiveCwdValue({ fallbackToSaved = true }: { fallbackToSaved?: boolean } = {}): string {
    const input = getActiveCwdInput();
    const currentValue = isValueInput(input) ? input.value.trim() : '';
    if (currentValue) return currentValue;
    if (!fallbackToSaved) return '';
    const saved = getState().conversationSettings?.cwd;
    return typeof saved === 'string' ? saved.trim() : '';
  }

  function setPickerChrome(mode: PickerMode): void {
    if (pickerTitleEl) {
      pickerTitleEl.textContent = mode === 'mention' ? 'Mentioning' : 'Pick CWD';
    }
    const isMention = mode === 'mention';
    if (pickerListEl instanceof HTMLElement) {
      if (isMention) {
        pickerListEl.setAttribute('role', 'listbox');
        pickerListEl.setAttribute('aria-label', 'Mention target');
      } else {
        pickerListEl.removeAttribute('role');
        pickerListEl.removeAttribute('aria-label');
      }
    }
    if (pickerSelectBtn instanceof HTMLButtonElement) {
      pickerSelectBtn.style.display = '';
      pickerSelectBtn.textContent = isMention ? 'Mention' : 'Select Current';
      pickerSelectBtn.disabled = isMention && !mentionPickerItemPath(selectedMentionItem);
      pickerSelectBtn.setAttribute('aria-disabled', String(pickerSelectBtn.disabled));
    }
    if (pickerUpBtn instanceof HTMLElement) pickerUpBtn.style.display = '';
  }

  function clearMentionPickerSelection(): void {
    selectedMentionItem = null;
    lastMentionClickPath = '';
    lastMentionClickAt = 0;
    pickerListEl?.querySelectorAll<HTMLElement>('.picker-item.selected').forEach((row) => {
      row.classList.remove('selected');
      row.setAttribute('aria-selected', 'false');
    });
    if (getState().pickerMode === 'mention') setPickerChrome('mention');
  }

  function selectMentionPickerItem(item: PickerItem, row: HTMLElement): void {
    pickerListEl?.querySelectorAll<HTMLElement>('.picker-item.selected').forEach((candidate) => {
      candidate.classList.remove('selected');
      candidate.setAttribute('aria-selected', 'false');
    });
    selectedMentionItem = item;
    row.classList.add('selected');
    row.setAttribute('aria-selected', 'true');
    setPickerChrome('mention');
  }

  function activateMentionPickerItem(item: PickerItem): void {
    const path = mentionPickerItemPath(item);
    if (!path) return;
    if (item.type === 'directory') {
      clearMentionPickerSelection();
      void fetchPicker(path);
      return;
    }
    insertMention(path);
    closePicker();
  }

  function applyPickedCwd(path: unknown): void {
    const nextPath = typeof path === 'string' ? path.trim() : '';
    if (!nextPath) return;
    const targetInput = isValueInput(pickerTargetInput) ? pickerTargetInput : getActiveCwdInput();
    if (isValueInput(targetInput)) {
      targetInput.value = nextPath;
    }
    if (isValueInput(settingsCwdEl) && targetInput !== settingsCwdEl) {
      settingsCwdEl.value = nextPath;
    }
  }

  function parentPickerPath(path: unknown): string {
    const raw = typeof path === 'string' ? path.trim() : '';
    if (!raw || raw === '~' || raw === '/') return raw || '~';
    if (raw.startsWith('~/')) {
      const rest = raw.slice(2).replace(/\/+$/, '');
      if (!rest) return '~';
      const slash = rest.lastIndexOf('/');
      return slash === -1 ? '~' : `~/${rest.slice(0, slash)}`;
    }
    const trimmed = raw.replace(/\/+$/, '');
    const slash = trimmed.lastIndexOf('/');
    return slash <= 0 ? '/' : trimmed.slice(0, slash);
  }

  function normalizeRuntimeOption(option: unknown): RuntimeOptionDescriptor | null {
    if (!isRecord(option)) return null;
    const settingKey = typeof option.settingKey === 'string' ? option.settingKey.trim() : '';
    const options = Array.isArray(option.options)
      ? option.options
          .map((item): DropdownOption | null => {
            if (typeof item === 'string') {
              const text = item.trim();
              return text ? { value: text, label: text } : null;
            }
            if (!isRecord(item)) return null;
            const value = typeof item.value === 'string' ? item.value.trim() : '';
            if (!value) return null;
            const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : value;
            return { value, label };
          })
          .filter((item): item is DropdownOption => Boolean(item))
      : [];
    return {
      settingKey,
      options,
      current: typeof option.current === 'string' ? option.current : '',
      default: typeof option.default === 'string' ? option.default : '',
    };
  }

  function getSettingValueByKey(settings: ConversationSettings | null | undefined, key: string): string {
    if (!settings || !key) return '';
    const value = settings[key];
    return typeof value === 'string' ? value : '';
  }

  function getActiveAgentOptions(state: SettingsUiState = getState()): DropdownOption[] {
    const extensions = Array.isArray(state.extensionCatalog) ? state.extensionCatalog : [];
    return extensions
      .filter((ext) => ext?.active === true && ext?.id && ext.id !== 'codex')
      .map((ext) => ({
        value: ext.id || '',
        label: ext.name || ext.id || '',
      }))
      .filter((ext) => Boolean(ext.value));
  }

  function getDefaultAgentId(state: SettingsUiState = getState()): string {
    const runtimeAgent = typeof state.runtimeOptions?.agent === 'string' ? state.runtimeOptions.agent.trim() : '';
    if (runtimeAgent && runtimeAgent !== 'codex') return runtimeAgent;
    return getActiveAgentOptions(state)[0]?.value || '';
  }

  function resolveAgentId(candidate: unknown, state: SettingsUiState = getState()): string {
    const agent = typeof candidate === 'string' ? candidate.trim() : '';
    if (agent && agent !== 'codex') return agent;
    const savedAgent = typeof state.conversationSettings?.agent === 'string' ? state.conversationSettings.agent.trim() : '';
    if (savedAgent && savedAgent !== 'codex') return savedAgent;
    return getDefaultAgentId(state);
  }

  function applyRuntimeOptions(runtimeOptions: RuntimeOptionsState | null | undefined): void {
    const state = getState();
    const approval = normalizeRuntimeOption(runtimeOptions?.approval);
    const sandbox = normalizeRuntimeOption(runtimeOptions?.sandbox);
    if (approval) {
      updateDropdownOptions(settingsApprovalOptions, approval.options, settingsApprovalEl);
      if (settingsApprovalEl) {
        settingsApprovalEl.placeholder = approval.default || 'Use runtime default';
        settingsApprovalEl.value = getSettingValueByKey(state.conversationSettings, approval.settingKey)
          || approval.current
          || settingsApprovalEl.value
          || '';
      }
    } else {
      updateDropdownOptions(settingsApprovalOptions, [], settingsApprovalEl);
      if (settingsApprovalEl) settingsApprovalEl.value = '';
    }
    if (sandbox) {
      updateDropdownOptions(settingsSandboxOptions, sandbox.options, settingsSandboxEl);
      if (settingsSandboxEl) {
        settingsSandboxEl.placeholder = sandbox.default || 'Use runtime default';
        settingsSandboxEl.value = getSettingValueByKey(state.conversationSettings, sandbox.settingKey)
          || sandbox.current
          || settingsSandboxEl.value
          || '';
      }
    } else {
      updateDropdownOptions(settingsSandboxOptions, [], settingsSandboxEl);
      if (settingsSandboxEl) settingsSandboxEl.value = '';
    }
  }

  async function loadRuntimeOptions(agentId: unknown, conversationId: unknown): Promise<RuntimeOptionsState> {
    const agent = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : '';
    const conversation_id = typeof conversationId === 'string' && conversationId.trim() ? conversationId.trim() : '';
    try {
      const data = await settingsRpcClient.getRuntimeOptions({
        conversationId: conversation_id || null,
        agent: agent || null,
      });
      const next = isRecord(data) ? data as RuntimeOptionsState : {};
      setState({ runtimeOptions: next });
      applyRuntimeOptions(next);
      return next;
    } catch {
      const next: RuntimeOptionsState = {};
      setState({ runtimeOptions: next });
      applyRuntimeOptions(next);
      return next;
    }
  }

  async function openSettingsModal(): Promise<void> {
    const state = getState();
    if (state.pendingNewConversation) {
      if (settingsCwdEl) {
        const projectPrefill = (state.hostUi?.ideMode && state.splashTab === 'project' && typeof state.hostUi?.projectRoot === 'string' && state.hostUi.projectRoot)
          ? state.hostUi.projectRoot
          : '';
        settingsCwdEl.value = projectPrefill;
      }
      if (settingsApprovalEl) settingsApprovalEl.value = '';
      if (settingsSandboxEl) settingsSandboxEl.value = '';
      if (settingsModelEl) settingsModelEl.value = '';
      if (settingsEffortEl) settingsEffortEl.value = '';
      if (settingsSummaryEl) settingsSummaryEl.value = '';
      if (settingsDeveloperInstructionsEl) settingsDeveloperInstructionsEl.value = '';
      if (settingsLabelEl) settingsLabelEl.value = '';
      if (settingsAliasEl) settingsAliasEl.value = '';
      if (settingsCommandLinesEl) settingsCommandLinesEl.value = DEFAULT_COMMAND_OUTPUT_LINES;
      if (settingsViewWrapEl) settingsViewWrapEl.checked = false;
      if (settingsMarkdownEl) settingsMarkdownEl.checked = true;
      if (settingsRolloutEl) settingsRolloutEl.value = state.pendingRollout?.id || '';
      if (settingsSemanticShellRibbonEl) settingsSemanticShellRibbonEl.checked = false;
      if (settingsTe2McpIntegrationEl) settingsTe2McpIntegrationEl.checked = false;
      if (settingsAgentEl) settingsAgentEl.value = resolveAgentId('', state);
    } else {
      if (settingsCwdEl) settingsCwdEl.value = state.conversationSettings?.cwd || '';
      if (settingsApprovalEl) settingsApprovalEl.value = getSettingValueByKey(state.conversationSettings, state.runtimeOptions?.approval?.settingKey || '');
      if (settingsSandboxEl) settingsSandboxEl.value = getSettingValueByKey(state.conversationSettings, state.runtimeOptions?.sandbox?.settingKey || '');
      if (settingsModelEl) settingsModelEl.value = state.conversationSettings?.model || '';
      updateEffortOptionsForModel(state.conversationSettings?.model);
      if (settingsEffortEl) settingsEffortEl.value = state.conversationSettings?.reasoning_effort || state.conversationSettings?.effort || '';
      if (settingsSummaryEl) settingsSummaryEl.value = state.conversationSettings?.summary || '';
      if (settingsDeveloperInstructionsEl) settingsDeveloperInstructionsEl.value = state.conversationSettings?.developer_instructions || '';
      if (settingsLabelEl) settingsLabelEl.value = state.conversationSettings?.label || '';
      if (settingsAliasEl) settingsAliasEl.value = state.conversationSettings?.alias || '';
      if (settingsCommandLinesEl) settingsCommandLinesEl.value = String(state.conversationSettings?.commandOutputLines || DEFAULT_COMMAND_OUTPUT_LINES);
      if (settingsViewWrapEl) settingsViewWrapEl.checked = state.conversationSettings?.viewWrap === true;
      if (settingsMarkdownEl) settingsMarkdownEl.checked = state.conversationSettings?.markdown !== false;
      if (settingsDiffSyntaxEl) settingsDiffSyntaxEl.checked = state.conversationSettings?.diffSyntax === true;
      if (settingsSemanticShellRibbonEl) settingsSemanticShellRibbonEl.checked = state.conversationSettings?.semanticShellRibbon === true;
      if (settingsTe2McpIntegrationEl) settingsTe2McpIntegrationEl.checked = state.conversationSettings?.te2_mcp_integration === true;
      if (settingsRolloutEl) settingsRolloutEl.value = state.pendingRollout?.id || state.conversationSettings?.rolloutId || '';
      if (settingsAgentEl) settingsAgentEl.value = resolveAgentId(state.conversationSettings?.agent, state);
    }
    if (settingsAgentRowEl) {
      const hasSavedSettings = !state.pendingNewConversation && !!state.conversationMeta?.settings && Object.values(state.conversationMeta.settings).some((value) => Boolean(value));
      settingsAgentRowEl.style.display = hasSavedSettings ? 'none' : 'block';
    }
    if (settingsRolloutRowEl) {
      const hasSavedSettings = !state.pendingNewConversation && !!state.conversationMeta?.settings && Object.values(state.conversationMeta.settings).some((value) => Boolean(value));
      settingsRolloutRowEl.style.display = hasSavedSettings ? 'none' : 'block';
    }
    const currentAgent = resolveAgentId(settingsAgentEl?.value, state);
    if (settingsAgentEl) settingsAgentEl.value = currentAgent;
    if (currentAgent) {
      await onAgentSelectionChange(currentAgent);
    }
  }

  function closeSettingsModal(): boolean {
    const state = getState();
    const agentType = resolveAgentId(settingsAgentEl?.value, state);
    if (!agentType) {
      setActivity('Agent required', true);
      return false;
    }
    const cwdOk = Boolean(getActiveCwdValue({ fallbackToSaved: true }));
    if (!cwdOk) {
      setActivity('CWD required', true);
      return false;
    }
    setState({ pendingNewConversation: false });
    return true;
  }

  function openPicker(startPath: unknown, mode: PickerMode = 'cwd', options: { input?: unknown } = {}): void {
    if (!pickerOverlayEl) return;
    const nextMode = mode || 'cwd';
    pickerTargetInput = nextMode === 'cwd' && isValueInput(options?.input)
      ? options.input
      : (nextMode === 'cwd' ? getActiveCwdInput() : null);
    const nextPath = (typeof startPath === 'string' && startPath.trim())
      || (nextMode === 'cwd' ? getActiveCwdValue({ fallbackToSaved: true }) : '')
      || getState().pickerPath
      || '~';
    selectedMentionItem = null;
    lastMentionClickPath = '';
    lastMentionClickAt = 0;
    setState({ pickerMode: nextMode, pickerPath: nextPath });
    setPickerChrome(nextMode);
    pickerOverlayEl.classList.remove('hidden');
    void fetchPicker(nextPath);
    if (pickerFilterEl) {
      pickerFilterEl.value = '';
      setTimeout(() => pickerFilterEl.focus(), 0);
    }
  }

  function closePicker(): void {
    if (!pickerOverlayEl) return;
    pickerOverlayEl.classList.add('hidden');
    pickerTargetInput = null;
    selectedMentionItem = null;
    lastMentionClickPath = '';
    lastMentionClickAt = 0;
    setPickerChrome('cwd');
    setState({ pickerMode: 'cwd' });
  }

  function bindPickerFilter(): void {
    if (!pickerFilterEl) return;
    pickerFilterEl.addEventListener('input', () => {
      const state = getState();
      if (state.pickerMode === 'mention') clearMentionPickerSelection();
      if (state.filterTimer) clearTimeout(state.filterTimer);
      const timer = setTimeout(() => {
        applyPickerFilter();
      }, 150);
      setState({ filterTimer: timer });
    });
  }

  function openRolloutPicker(): void {
    if (!rolloutOverlayEl) return;
    const cwdOk = Boolean(getActiveCwdValue({ fallbackToSaved: false }));
    if (!cwdOk) {
      setActivity('select CWD first', true);
      return;
    }
    rolloutOverlayEl.classList.remove('hidden');
    void fetchRollouts();
  }

  function closeRolloutPicker(): void {
    if (!rolloutOverlayEl) return;
    rolloutOverlayEl.classList.add('hidden');
  }

  function getRolloutPickerProvider(): RolloutPickerProvider | null {
    const provider = getState().rolloutPickerProvider;
    if (provider && typeof provider === 'object') return provider;
    return null;
  }

  function renderRolloutList(items: RolloutItem[], emptyText = 'No rollouts found'): void {
    if (!rolloutListEl) return;
    rolloutListEl.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-item';
      empty.textContent = emptyText;
      rolloutListEl.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'picker-item rollout-item';
      row.dataset.rolloutId = item.id || '';
      const idSpan = document.createElement('span');
      idSpan.className = 'rollout-id';
      idSpan.textContent = item.short_id || item.id || '';
      const previewSpan = document.createElement('span');
      previewSpan.className = 'rollout-preview';
      previewSpan.textContent = item.preview || '';
      row.append(idSpan, previewSpan);
      rolloutListEl.appendChild(row);
    });
  }

  async function fetchRollouts(): Promise<void> {
    const provider = getRolloutPickerProvider();
    if (!provider || typeof provider.list !== 'function') {
      renderRolloutList([], 'No rollout provider');
      setActivity('rollout picker unavailable', true);
      return;
    }
    try {
      const cwd = getActiveCwdValue({ fallbackToSaved: false });
      const data = await provider.list({ cwd, state: getState(), setState, setActivity, sioCall });
      let items = Array.isArray(data?.items) ? data.items.filter(isRolloutItem) : [];
      if (cwd) {
        items = items.filter((item) => item && item.cwd && String(item.cwd) === cwd);
      }
      renderRolloutList(items);
    } catch (err) {
      console.warn('rollout list failed', err);
      renderRolloutList([], 'Rollout list unavailable');
    }
  }

  async function loadRolloutPreview(rolloutId: unknown): Promise<void> {
    const resolvedRolloutId = typeof rolloutId === 'string' ? rolloutId.trim() : '';
    if (!resolvedRolloutId) return;
    const provider = getRolloutPickerProvider();
    if (!provider || typeof provider.preview !== 'function') {
      setActivity('rollout preview unavailable', true);
      return;
    }
    try {
      const cwd = getActiveCwdValue({ fallbackToSaved: false });
      const data = await provider.preview({
        rolloutId: resolvedRolloutId,
        cwd,
        state: getState(),
        setState,
        setActivity,
        sioCall,
      });
      const items = Array.isArray(data?.items) ? data.items.filter(isRolloutItem) : [];
      setState({
        pendingRollout: {
          id: resolvedRolloutId,
          items,
          token_total: typeof data?.token_total === 'number' ? data.token_total : null,
        },
      });
      if (settingsRolloutEl) settingsRolloutEl.value = resolvedRolloutId;
      closeRolloutPicker();
    } catch (err) {
      console.warn('rollout preview failed', err);
      setActivity('rollout failed', true);
    }
  }

  function normalizeDropdownOption(option: DropdownOptionInput | null | undefined): DropdownOption | null {
    if (typeof option === 'string') {
      const text = option.trim();
      return text ? { value: text, label: text } : null;
    }
    if (!option || typeof option !== 'object') return null;
    const value = typeof option.value === 'string' ? option.value.trim() : '';
    if (!value) return null;
    const label = typeof option.label === 'string' && option.label.trim() ? option.label.trim() : value;
    return { value, label };
  }

  function buildDropdown(
    listEl: HTMLElement | null | undefined,
    options: DropdownOptionInput[] | null | undefined,
    inputEl: TextValueInput | null | undefined,
    onChange: ((value: string) => unknown) | null = null,
  ): void {
    if (!listEl) return;
    listEl.innerHTML = '';
    (options || [])
      .map(normalizeDropdownOption)
      .filter((opt): opt is DropdownOption => Boolean(opt))
      .forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          if (inputEl) inputEl.value = opt.value;
          closeDropdownMenu(listEl);
          if (typeof onChange === 'function') onChange(opt.value);
        });
        listEl.appendChild(btn);
      });
  }

  function updateDropdownOptions(
    listEl: HTMLElement | null | undefined,
    options: DropdownOptionInput[] | null | undefined,
    inputEl: TextValueInput | null | undefined,
    onChange: ((value: string) => unknown) | null = null,
  ): void {
    if (!listEl) return;
    const seen = new Set<string>();
    const values: DropdownOption[] = [];
    (options || []).forEach((option) => {
      const normalized = normalizeDropdownOption(option);
      if (!normalized || seen.has(normalized.value)) return;
      seen.add(normalized.value);
      values.push(normalized);
    });
    buildDropdown(listEl, values, inputEl, onChange);
  }

  async function loadModelOptions(agentId = ''): Promise<void> {
    try {
      const resolvedAgent = resolveAgentId(agentId, getState());
      if (!resolvedAgent) {
        setState({ modelList: [] });
        updateDropdownOptions(settingsModelOptions, [], settingsModelEl, updateEffortOptionsForModel);
        updateEffortOptionsForModel(settingsModelEl?.value);
        return;
      }
      const data = await settingsRpcClient.listExtensionModels({ extensionId: resolvedAgent });
      const items = firstArray(data.models).filter(isExtensionModel);
      setState({ modelList: items });
      const names = items.map((model) => model.id || '').filter(Boolean);
      if (names.length) {
        updateDropdownOptions(settingsModelOptions, names, settingsModelEl, updateEffortOptionsForModel);
      }
      updateEffortOptionsForModel(settingsModelEl?.value);
    } catch {
      // ignore
    }
  }

  async function loadAgentOptions(): Promise<void> {
    try {
      const data = await settingsRpcClient.listExtensions();
      const extensions = firstArray(data.extensions).filter(isExtensionCatalogEntry);
      const nextState: SettingsUiState = { ...getState(), extensionCatalog: extensions };
      setState({ extensionCatalog: nextState.extensionCatalog });
      const agents = getActiveAgentOptions(nextState);
      updateDropdownOptions(settingsAgentOptions, agents, settingsAgentEl, onAgentSelectionChange);
      const resolvedAgent = resolveAgentId(settingsAgentEl?.value, nextState);
      if (settingsAgentEl) settingsAgentEl.value = resolvedAgent;
    } catch {
      // ignore
    }
  }

  const eventsWindow = (getWindow ? getWindow() : window) as CodexAgentWindow;
  settingsRpcClient.subscribeLiveNotifications({
    onNotification: (method, params) => {
      if (method === 'extensions.updated') {
        void loadAgentOptions();
        return;
      }
      if (method === 'extension.providerInfo.updated') {
        const extensionId = typeof params.extension_id === 'string' ? params.extension_id.trim() : '';
        const refreshProviderInfo = eventsWindow.CodexAgent?.helpers?.refreshProviderInfo;
        if (typeof refreshProviderInfo === 'function') {
          void Promise.resolve(refreshProviderInfo(extensionId)).catch((error: unknown) => {
            console.warn('Provider info refresh failed:', error);
          });
        }
      }
    },
  });

  async function onAgentSelectionChange(agentId: string | null | undefined): Promise<void> {
    const resolvedAgent = resolveAgentId(agentId, getState());
    if (settingsAgentEl) settingsAgentEl.value = resolvedAgent;
    const win = (getWindow ? getWindow() : window) as CodexAgentWindow;
    const onAgentChange = win.CodexAgent?.helpers?.onAgentChange;
    if (typeof onAgentChange === 'function') {
      await onAgentChange(resolvedAgent);
    }
    await loadModelOptions(resolvedAgent);
    await loadRuntimeOptions(resolvedAgent, scopedConversationId(getState()));
  }

  function normalizeModelEfforts(model: ExtensionModel | null | undefined): string[] {
    const candidates: (ModelEffortInput[] | boolean | undefined)[] = [
      model?.supportedReasoningEfforts,
      model?.supported_reasoning_efforts,
      model?.capabilities?.supports?.reasoning_effort,
      model?.capabilities?.supports?.reasoningEffort,
    ];
    const efforts: string[] = [];
    candidates.forEach((raw) => {
      if (!Array.isArray(raw)) return;
      raw.forEach((item) => {
        const value = typeof item === 'string'
          ? item
          : (item && typeof item === 'object'
            ? (item.reasoningEffort || item.reasoning_effort || item.value || '')
            : '');
        if (!value || efforts.includes(value)) return;
        efforts.push(value);
      });
    });
    return efforts;
  }

  function updateEffortOptionsForModel(modelId: string | null | undefined): void {
    const state = getState();
    if (!modelId || !state.modelList?.length) {
      updateDropdownOptions(settingsEffortOptions, [], settingsEffortEl);
      if (settingsEffortEl) {
        settingsEffortEl.value = '';
        settingsEffortEl.placeholder = 'Select model first';
      }
      return;
    }
    const model = state.modelList.find((item) => item.id === modelId);
    if (!model) {
      updateDropdownOptions(settingsEffortOptions, [], settingsEffortEl);
      if (settingsEffortEl) {
        settingsEffortEl.value = '';
        settingsEffortEl.placeholder = 'Model capabilities unavailable';
      }
      return;
    }
    const efforts = normalizeModelEfforts(model);
    if (!efforts.length) {
      updateDropdownOptions(settingsEffortOptions, [], settingsEffortEl);
      if (settingsEffortEl) {
        settingsEffortEl.value = '';
        settingsEffortEl.placeholder = 'Not supported by selected model';
      }
      return;
    }
    updateDropdownOptions(settingsEffortOptions, efforts, settingsEffortEl);
    if (settingsEffortEl) {
      settingsEffortEl.placeholder = 'Select reasoning effort';
    }
    const currentEffort = settingsEffortEl?.value;
    const defaultEffort = model.defaultReasoningEffort || model.default_reasoning_effort || efforts[0] || '';
    if (settingsEffortEl && !currentEffort) {
      settingsEffortEl.value = defaultEffort;
    }
  }

  function openDropdownMenu(listEl: HTMLElement | null | undefined): void {
    if (!listEl) return;
    const state = getState();
    if (state.openDropdownEl && state.openDropdownEl !== listEl) {
      closeDropdownMenu(state.openDropdownEl);
    }
    listEl.classList.add('open');
    setState({ openDropdownEl: listEl });
  }

  function closeDropdownMenu(listEl: HTMLElement | null | undefined): void {
    if (!listEl) return;
    listEl.classList.remove('open');
    if (getState().openDropdownEl === listEl) {
      setState({ openDropdownEl: null });
    }
  }

  function toggleDropdownMenu(listEl: HTMLElement | null | undefined): void {
    if (!listEl) return;
    if (listEl.classList.contains('open')) {
      closeDropdownMenu(listEl);
    } else {
      openDropdownMenu(listEl);
    }
  }

  function setupDropdown(
    inputEl: TextValueInput | null | undefined,
    toggleEl: HTMLElement | null | undefined,
    listEl: HTMLElement | null | undefined,
    options: DropdownOptionInput[] | null | undefined,
  ): void {
    if (!listEl || !inputEl) return;
    buildDropdown(listEl, options, inputEl);
    toggleEl?.addEventListener('click', (evt: MouseEvent) => {
      evt.preventDefault();
      toggleDropdownMenu(listEl);
    });
  }

  async function fetchPicker(path: unknown): Promise<void> {
    if (getState().pickerMode === 'mention') clearMentionPickerSelection();
    try {
      const targetPath = typeof path === 'string' && path.trim() ? path : '~';
      const data = await uiRpcClient.listFilesystem(targetPath);
      const record = isRecord(data) ? data : null;
      if (!record || record.ok === false) return;
      const nextPath = typeof record.path === 'string' ? record.path : targetPath;
      const items = firstArray(record.items).filter(isPickerItem);
      setState({
        pickerPath: nextPath,
        pickerItems: items,
      });
      if (pickerPathEl) pickerPathEl.textContent = nextPath;
      applyPickerFilter();
    } catch {
      // ignore
    }
  }

  async function fetchPickerSearch(query: unknown): Promise<PickerItem[]> {
    try {
      const state = getState();
      const root = state.pickerPath || state.conversationSettings?.cwd || settingsCwdEl?.value || '~';
      const data = await uiRpcClient.searchFilesystem({
        query: typeof query === 'string' ? query : '',
        root,
      });
      const record = isRecord(data) ? data : null;
      if (!record || record.ok === false) return [];
      return firstArray(record.items).filter(isPickerItem);
    } catch {
      return [];
    }
  }

  function applyPickerFilter(): void {
    const state = getState();
    if (!pickerFilterEl) {
      renderPickerList(state.pickerItems || []);
      return;
    }
    const raw = pickerFilterEl.value || '';
    if (!raw.trim()) {
      renderPickerList(state.pickerItems || []);
      return;
    }
    if (state.pickerMode === 'mention') {
      void fetchPickerSearch(raw).then(renderPickerList);
      return;
    }
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(raw, 'i');
    } catch {
      renderPickerList([]);
      return;
    }
    const items = (state.pickerItems || []).filter((item) => {
      const target = `${item?.name || ''} ${item?.path || ''}`;
      return regex?.test(target) === true;
    });
    renderPickerList(items);
  }

  function renderPickerList(items: PickerItem[]): void {
    if (!pickerListEl) return;
    if (getState().pickerMode === 'mention') clearMentionPickerSelection();
    pickerListEl.innerHTML = '';
    const state = getState();
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'picker-item';
      const icon = document.createElement('span');
      icon.textContent = item.type === 'directory' ? '📁' : '📄';
      const name = document.createElement('span');
      name.textContent = item.name || item.path || '';
      if (state.pickerMode === 'mention') {
        row.tabIndex = 0;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        const textWrap = document.createElement('span');
        textWrap.className = 'picker-item-text';
        name.className = 'picker-item-name';
        const path = document.createElement('span');
        path.className = 'picker-item-path';
        const cwd = state.conversationSettings?.cwd || '';
        const itemPath = item.path || item.name || '';
        const relPath = getRelativePath(itemPath, cwd) || itemPath;
        path.textContent = relPath || '';
        textWrap.append(name, path);
        row.append(icon, textWrap);
      } else {
        row.append(icon, name);
      }
      row.addEventListener('click', () => {
        if (getState().pickerMode === 'mention') {
          const path = mentionPickerItemPath(item);
          if (!path) return;
          const now = windowRef.performance?.now?.() ?? Date.now();
          const isDoubleActivation = path === lastMentionClickPath
            && now - lastMentionClickAt <= MENTION_DOUBLE_ACTIVATION_MS;
          selectMentionPickerItem(item, row);
          lastMentionClickPath = path;
          lastMentionClickAt = now;
          if (isDoubleActivation) {
            lastMentionClickPath = '';
            lastMentionClickAt = 0;
            activateMentionPickerItem(item);
          }
          return;
        }
        if (item.type === 'directory') {
          void fetchPicker(item.path || item.name || '');
          return;
        }
      });
      pickerListEl.appendChild(row);
    });
  }

  pickerCloseBtn?.addEventListener('click', closePicker);
  pickerUpBtn?.addEventListener('click', () => {
    const currentPath = getState().pickerPath || getActiveCwdValue({ fallbackToSaved: true }) || '~';
    void fetchPicker(parentPickerPath(currentPath));
  });
  pickerSelectBtn?.addEventListener('click', () => {
    if (getState().pickerMode === 'mention') {
      const selectedPath = mentionPickerItemPath(selectedMentionItem);
      if (!selectedPath) return;
      insertMention(selectedPath);
      closePicker();
      return;
    }
    const currentPath = getState().pickerPath || pickerPathEl?.textContent || '';
    applyPickedCwd(currentPath);
    closePicker();
  });

  return {
    openSettingsModal,
    closeSettingsModal,
    openPicker,
    closePicker,
    bindPickerFilter,
    openRolloutPicker,
    closeRolloutPicker,
    fetchRollouts,
    loadRolloutPreview,
    buildDropdown,
    updateDropdownOptions,
    loadModelOptions,
    loadRuntimeOptions,
    loadAgentOptions,
    onAgentSelectionChange,
    updateEffortOptionsForModel,
    openDropdownMenu,
    closeDropdownMenu,
    toggleDropdownMenu,
    setupDropdown,
    fetchPicker,
    fetchPickerSearch,
    applyPickerFilter,
  };
}
