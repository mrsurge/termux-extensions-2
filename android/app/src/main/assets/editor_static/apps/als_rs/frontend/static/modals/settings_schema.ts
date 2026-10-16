/**
 * Settings Schema Module
 * 
 * Handles dynamic rendering of extension settings based on JSON schemas.
 * Each extension can define a settings_schema.json with field definitions.
 */
type JsonRecord = Record<string, unknown>;
type JsonValue = unknown;
type SchemaInput = HTMLInputElement | HTMLTextAreaElement;

type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

type SettingsRpcClient = {
  getExtensionSettingsSchema: (extensionId: string) => Promise<unknown>;
  getExtensionSettingsSchemaFragment?: (options: { extensionId: string; target: string }) => Promise<unknown>;
  listExtensionSessions: (options: { extensionId: string; cwd: string | null; extraParams?: JsonRecord | null }) => Promise<unknown>;
  listExtensionModels: (options: { extensionId: string; extraParams?: JsonRecord | null }) => Promise<unknown>;
  getRuntimeOptions: (options: { conversationId: string | null; agent: string | null }) => Promise<unknown>;
  getExtensionProviderInfo: (options: {
    extensionId: string;
    conversationId?: string | null;
    providerSessionId?: string | null;
  }) => Promise<unknown>;
  runSchemaInteraction?: (options: {
    extensionId: string;
    interactionId: string;
    action?: string | null;
    inputs?: JsonRecord | null;
    values?: JsonRecord | null;
    params?: JsonRecord | null;
    conversationId?: string | null;
    settings?: JsonRecord | null;
  }) => Promise<unknown>;
  getExtensionSessionState?: (options: {
    extensionId: string;
    conversationId: string;
    providerSessionId?: string | null;
  }) => Promise<unknown>;
  unloadExtensionSession?: (options: {
    extensionId: string;
    conversationId: string;
    providerSessionId?: string | null;
  }) => Promise<unknown>;
};

type UiRpcClient = {
  openUrl?: (payload: {
    url: string;
    source?: string | null;
    conversation_id?: string | null;
  }) => Promise<unknown>;
};

type ConversationsRpcClient = {
  forkConversation?: (options: {
    conversationId: string;
    title?: string | null;
    timeoutMs?: number;
  }) => Promise<unknown>;
};

type SchemaField = {
  id: string;
  type?: string;
  label?: string;
  description?: string;
  detail?: string;
  text?: string;
  tone?: string;
  placeholder?: string;
  default?: JsonValue;
  options?: unknown[];
  dynamic_source?: string;
  source_method?: string;
  source_params?: JsonRecord;
  dynamic_options_key?: string;
  dynamic_options_from?: JsonRecord;
  options_path?: unknown;
  option_value_path?: unknown;
  option_label_path?: unknown;
  current_path?: unknown;
  default_path?: unknown;
  refresh_on?: unknown[];
  depends_on?: unknown[];
  value_keys?: unknown[];
  model_gate?: JsonRecord;
  visible_if?: JsonRecord;
  enabled_if?: JsonRecord;
  clear_when_hidden?: boolean;
  schema_ref?: JsonRecord;
  fields?: SchemaField[];
  persist?: boolean;
  transient?: boolean;
  secret?: boolean;
  sensitive?: boolean;
  input?: JsonRecord;
  inputs?: unknown[];
  trigger?: JsonRecord;
  output?: JsonRecord;
  interaction?: JsonRecord;
  write_back?: JsonRecord;
  presentation?: string;
  default_open?: boolean;
  initial_open?: boolean;
  semantic?: JsonRecord;
  source?: string | JsonRecord;
  picker_sort?: JsonRecord;
  browse?: boolean;
  min?: number;
  max?: number;
  rows?: number;
  json_kind?: string;
  confirm?: string;
};

type SettingsSchema = {
  fields?: SchemaField[];
  cache?: string;
  useBuiltin?: boolean;
};

type SessionPickerTarget = {
  input: HTMLInputElement;
  field: SchemaField;
};

type SchemaValueEntry = {
  input: SchemaInput;
  type?: string;
  field: SchemaField;
};

type SelectOption = {
  value: string;
  label: string;
  detail?: string;
  raw?: unknown;
};

type ModelVersion = {
  family: string;
  major: number;
  minor: number;
};

type DynamicSelectOptions = {
  items: JsonRecord[];
  options: SelectOption[];
  current: string;
  defaultValue: string;
};

type SelectControl = {
  field: SchemaField;
  input: HTMLInputElement;
  listDiv: HTMLDivElement;
  toggleBtn: HTMLButtonElement;
  initialValue: string;
  initialValueApplied: boolean;
  dynamicItems: JsonRecord[];
  selectedOption?: unknown;
  options: SelectOption[];
  largePickerMode?: boolean;
};

type ProviderInfoBinding = {
  extensionId: string;
  runtimeKey: string;
  root: HTMLDivElement;
  text: HTMLDivElement;
  detail: HTMLDivElement;
};

type DynamicSourceOptions = {
  cwd?: string | null;
  conversationId?: string | null;
  agent?: string | null;
  extraParams?: JsonRecord | null;
  sourceMethod?: string | null;
  sourceAction?: string | null;
  interactionId?: string | null;
  values?: JsonRecord | null;
  settings?: JsonRecord | null;
};

type ConversationMeta = {
  conversation_id?: unknown;
  extension_id?: unknown;
  agent_type?: unknown;
  thread_id?: unknown;
  provider_session_id?: unknown;
  status?: unknown;
};

type HostUiState = {
  ideMode?: unknown;
  projectRoot?: unknown;
};

type CodexAgentState = {
  pendingNewConversation?: unknown;
  conversationMeta?: ConversationMeta | null;
  conversationSettings?: JsonRecord | null;
  hostUi?: HostUiState | null;
  homePrefix?: unknown;
  splashTab?: unknown;
};

declare global {
  interface Window {
    CodexAgentModules?: Array<(ctx: CodexAgentModuleApi | undefined) => void>;
    CodexAgent?: CodexAgentModuleApi;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asCodexAgentState(value: unknown): CodexAgentState {
  return isRecord(value) ? value as CodexAgentState : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trimString(value: unknown): string {
  return stringValue(value).trim();
}

function normalizeSelectOption(value: unknown): SelectOption | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? { value: normalized, label: normalized } : null;
  }
  const item = asRecord(value);
  const optionValue = trimString(item.value || item.id);
  if (!optionValue) return null;
  return {
    value: optionValue,
    label: trimString(item.label || item.name || optionValue) || optionValue,
  };
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function schemaFieldId(field: SchemaField): string {
  return trimString(field.id);
}

function normalizeSchemaField(value: unknown): SchemaField | null {
  if (!isRecord(value)) return null;
  const id = trimString(value.id);
  if (!id) return null;
  return {
    ...value,
    id,
    type: trimString(value.type) || undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    text: typeof value.text === 'string' ? value.text : undefined,
    tone: typeof value.tone === 'string' ? value.tone : undefined,
    placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined,
    dynamic_source: typeof value.dynamic_source === 'string' ? value.dynamic_source : undefined,
    source_method: typeof value.source_method === 'string' ? value.source_method : undefined,
    source_params: isRecord(value.source_params) ? value.source_params : undefined,
    dynamic_options_key: typeof value.dynamic_options_key === 'string' ? value.dynamic_options_key : undefined,
    dynamic_options_from: isRecord(value.dynamic_options_from) ? value.dynamic_options_from : undefined,
    options_path: value.options_path ?? value.items_path,
    option_value_path: value.option_value_path ?? value.value_path ?? value.id_path,
    option_label_path: value.option_label_path ?? value.label_path ?? value.name_path,
    current_path: value.current_path,
    default_path: value.default_path,
    refresh_on: Array.isArray(value.refresh_on) ? value.refresh_on : (Array.isArray(value.refreshOn) ? value.refreshOn : undefined),
    depends_on: Array.isArray(value.depends_on) ? value.depends_on : (Array.isArray(value.dependsOn) ? value.dependsOn : undefined),
    value_keys: Array.isArray(value.value_keys) ? value.value_keys : (Array.isArray(value.valueKeys) ? value.valueKeys : undefined),
    model_gate: isRecord(value.model_gate) ? value.model_gate : undefined,
    visible_if: isRecord(value.visible_if) ? value.visible_if : undefined,
    enabled_if: isRecord(value.enabled_if) ? value.enabled_if : undefined,
    clear_when_hidden: value.clear_when_hidden === true,
    schema_ref: isRecord(value.schema_ref) ? value.schema_ref : undefined,
    fields: normalizeSchemaFields(value.fields),
    persist: typeof value.persist === 'boolean' ? value.persist : undefined,
    transient: value.transient === true,
    secret: value.secret === true,
    sensitive: value.sensitive === true,
    input: isRecord(value.input) ? value.input : undefined,
    inputs: Array.isArray(value.inputs) ? value.inputs : undefined,
    trigger: isRecord(value.trigger) ? value.trigger : undefined,
    output: isRecord(value.output) ? value.output : undefined,
    interaction: isRecord(value.interaction) ? value.interaction : undefined,
    write_back: isRecord(value.write_back) ? value.write_back : undefined,
    presentation: typeof value.presentation === 'string' ? value.presentation : undefined,
    default_open: value.default_open === true,
    initial_open: value.initial_open === true,
    semantic: isRecord(value.semantic) ? value.semantic : undefined,
    source: typeof value.source === 'string' || isRecord(value.source) ? value.source : undefined,
    picker_sort: isRecord(value.picker_sort) ? value.picker_sort : undefined,
    browse: value.browse === true,
    min: typeof value.min === 'number' ? value.min : undefined,
    max: typeof value.max === 'number' ? value.max : undefined,
    rows: typeof value.rows === 'number' ? value.rows : undefined,
    json_kind: typeof value.json_kind === 'string' ? value.json_kind : undefined,
    confirm: typeof value.confirm === 'string' ? value.confirm : undefined,
  };
}

function normalizeSchemaFields(value: unknown): SchemaField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSchemaField)
    .filter((field): field is SchemaField => Boolean(field));
}

function normalizeSchema(value: unknown): SettingsSchema | null {
  if (!isRecord(value)) return null;
  const fields = normalizeSchemaFields(value.fields);
  return {
    ...value,
    fields,
    cache: typeof value.cache === 'string' ? value.cache : undefined,
    useBuiltin: value.useBuiltin === true,
  };
}

function getHelper(ctx: CodexAgentModuleApi | undefined, helperName: string): unknown {
  return ctx?.helpers?.[helperName];
}

function getCodexAgentState(): CodexAgentState {
  return asCodexAgentState(window.CodexAgent?.state);
}

function callCtxHelper(ctx: CodexAgentModuleApi | undefined, helperName: string, ...args: unknown[]): unknown {
  const helper = getHelper(ctx, helperName);
  if (typeof helper === 'function') {
    return helper(...args);
  }
  return undefined;
}

function formatJsonSetting(ctx: CodexAgentModuleApi | undefined, value: unknown): string {
  const result = callCtxHelper(ctx, 'formatJsonSetting', value);
  return typeof result === 'string' ? result : JSON.stringify(value, null, 2);
}

function parseJsonSetting(ctx: CodexAgentModuleApi | undefined, value: string, label: string): unknown {
  const helper = getHelper(ctx, 'parseJsonSetting');
  if (typeof helper === 'function') {
    return helper(value, label);
  }
  return JSON.parse(value || 'null');
}

function normalizeStaticOptions(options: unknown[] | undefined): SelectOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((item: unknown): SelectOption | null => {
    if (typeof item === 'string') return { value: item, label: item, raw: item };
    const itemMap = asRecord(item);
    const value = trimString(itemMap.value || itemMap.id);
    if (!value) return null;
    return {
      value,
      label: trimString(itemMap.label || itemMap.name || itemMap.value || itemMap.id) || value,
      detail: trimString(itemMap.detail || itemMap.description),
      raw: item,
    };
  }).filter((option): option is SelectOption => Boolean(option));
}

function schemaFieldSourceString(field: SchemaField | null | undefined): string {
  return typeof field?.source === 'string' ? field.source : '';
}

function schemaFieldPersists(field: SchemaField | null | undefined): boolean {
  if (!field) return true;
  if (field.persist === false) return false;
  if (field.transient === true || field.secret === true || field.sensitive === true) return false;
  if (field.type === 'secret') return false;
  return true;
}

window.CodexAgentModules = window.CodexAgentModules || [];
window.CodexAgentModules.push((ctx: CodexAgentModuleApi | undefined) => {
  if (!ctx) return;
  const settingsCodexFields = document.getElementById('settings-codex-fields');
  const settingsExtensionFields = document.getElementById('settings-extension-fields');
  const settingsAgentEl = document.getElementById('settings-agent') as HTMLInputElement | null;
   
  // Cache for loaded schemas
  const schemaCache: Record<string, SettingsSchema> = {};
   
  // Current schema field values (for save)
  let currentSchemaValues: Record<string, SchemaValueEntry> = {};
  let currentSchemaWriteBackValues: JsonRecord = {};
  let currentSchemaFields: Record<string, SchemaField> = {};
  let currentProviderInfoBindings: ProviderInfoBinding[] = [];
  let providerInfoRefreshPromise: Promise<void> | null = null;
   
  // Session picker overlay elements (reuse HTML already in template)
  const sessionPickerOverlay = document.getElementById('session-picker');
  const sessionPickerCloseBtn = document.getElementById('session-picker-close');
  const sessionPickerSortEl = document.getElementById('session-picker-sort');
  const sessionPickerListEl = document.getElementById('session-picker-list');
   
  // Track which input field the session picker is serving
  let _sessionPickerTarget: SessionPickerTarget | null = null;
  let _sessionPickerSortValue = '';
  let _sessionPickerFilterEnabled = false;
  let _sessionPickerItems: JsonRecord[] = [];
  let optionPickerOverlay: HTMLDivElement | null = null;
  let optionPickerListEl: HTMLDivElement | null = null;
  let optionPickerFilterEl: HTMLInputElement | null = null;
  let optionPickerTitleEl: HTMLHeadingElement | null = null;
  let optionPickerTarget: SelectControl | null = null;

  function requireSettingsRpc(): SettingsRpcClient {
    const client = getHelper(ctx, 'settingsRpc');
    if (!client || typeof client !== 'object') {
      throw new Error('Settings RPC helper unavailable');
    }
    return client as SettingsRpcClient;
  }

  function requireConversationsRpc(): ConversationsRpcClient {
    const client = getHelper(ctx, 'conversationsRpc');
    if (!client || typeof client !== 'object') {
      throw new Error('Conversations RPC helper unavailable');
    }
    return client as ConversationsRpcClient;
  }

  function requireUiRpc(): UiRpcClient {
    const client = getHelper(ctx, 'uiRpc');
    if (!client || typeof client !== 'object') {
      throw new Error('UI RPC helper unavailable');
    }
    return client as UiRpcClient;
  }

  function dynamicSourceErrorMessage(err: unknown): string {
    if (typeof err === 'string' && err) return err;
    if (isRecord(err)) {
      if (typeof err.message === 'string' && err.message) return err.message;
      if (typeof err.error === 'string' && err.error) return err.error;
      const nestedError = err.error;
      if (isRecord(nestedError) && typeof nestedError.message === 'string' && nestedError.message) {
        return nestedError.message;
      }
    }
    return 'Dynamic source request failed';
  }

  function unwrapDynamicSourceResult(result: unknown): unknown {
    if (!isRecord(result)) return result;
    if (result.ok === false) {
      throw new Error(dynamicSourceErrorMessage(result));
    }
    if (result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')) {
      return result.data;
    }
    return result;
  }

  function sourcePathname(sourceUrl: unknown): string {
    if (typeof sourceUrl !== 'string') return '';
    const raw = sourceUrl.trim();
    if (!raw) return '';
    try {
      return new URL(raw, window.location.origin).pathname || '';
    } catch {
      return raw.split(/[?#]/, 1)[0] || '';
    }
  }

  function isRuntimeOptionsSource(sourceUrl: unknown): boolean {
    const pathname = sourcePathname(sourceUrl).replace(/\/+$/, '');
    return /(?:^|\/)api\/appserver\/runtime_options$/.test(pathname);
  }

  function extensionIdFromApiPath(sourceUrl: unknown, suffix: string): string {
    const pathname = sourcePathname(sourceUrl).replace(/\/+$/, '');
    const escapedSuffix = String(suffix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = pathname
      ? pathname.match(new RegExp(`(?:^|/)api/extensions/([^/]+)/${escapedSuffix}$`))
      : null;
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  function sessionPickerSortConfig(field: SchemaField | null | undefined): JsonRecord {
    return asRecord(field?.picker_sort);
  }

  function sessionPickerSortOptions(field: SchemaField | null | undefined): SelectOption[] {
    const rawOptions = sessionPickerSortConfig(field).options;
    if (!Array.isArray(rawOptions)) return [];
    return rawOptions
      .map((item) => normalizeSelectOption(item))
      .filter((item): item is SelectOption => Boolean(item));
  }

  function sessionPickerSortDefault(field: SchemaField | null | undefined): string {
    const configured = trimString(sessionPickerSortConfig(field).default);
    if (configured) return configured;
    return sessionPickerSortOptions(field)[0]?.value || '';
  }

  function sessionPickerSortParam(field: SchemaField | null | undefined): string {
    return trimString(sessionPickerSortConfig(field).param) || 'sort';
  }

  function getSessionPickerActiveCwd(): string {
    const schemaCwd = currentSchemaValues.cwd?.input?.value;
    if (typeof schemaCwd === 'string' && schemaCwd.trim()) return schemaCwd.trim();
    const stateCwd = getCodexAgentState().conversationSettings?.cwd;
    return trimString(stateCwd);
  }

  function normalizePickerPath(value: string): string {
    const normalized = value.replace(/\/+/g, '/').replace(/\/+$/, '');
    return normalized || '/';
  }

  function sessionPickerHomePrefix(): string {
    return trimString(getCodexAgentState().homePrefix);
  }

  function sessionPickerRelativeHomePath(pathValue: unknown): string {
    const rawPath = trimString(pathValue);
    if (!rawPath) return '—';
    const homePrefix = sessionPickerHomePrefix();
    if (!homePrefix) return rawPath;
    const normalizedPath = normalizePickerPath(rawPath);
    const normalizedHome = normalizePickerPath(homePrefix);
    if (normalizedPath === normalizedHome) return '~';
    if (normalizedPath.startsWith(`${normalizedHome}/`)) {
      return `~/${normalizedPath.slice(normalizedHome.length + 1)}`;
    }
    return rawPath;
  }

  function sessionPickerMatchesCwdScope(pathValue: unknown, cwdValue: unknown): boolean {
    const sessionPath = trimString(pathValue);
    const selectedCwd = trimString(cwdValue);
    if (!selectedCwd) return true;
    if (!sessionPath) return false;
    const normalizedSession = normalizePickerPath(sessionPath);
    const normalizedCwd = normalizePickerPath(selectedCwd);
    return normalizedSession === normalizedCwd
      || normalizedSession.startsWith(`${normalizedCwd}/`)
      || normalizedCwd.startsWith(`${normalizedSession}/`);
  }

  function sessionPickerFormatTimestamp(value: unknown): string {
    const raw = trimString(value);
    if (!raw) return '—';
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(parsed);
    }
    return raw;
  }

  function sessionPickerShortId(value: unknown): string {
    const sid = trimString(value);
    if (!sid) return '—';
    return sid.length > 12 ? `${sid.slice(0, 8)}…` : sid;
  }

  function sessionPickerSummary(itemMap: JsonRecord, metadata: JsonRecord): string {
    return trimString(
      itemMap.summary
        || itemMap.preview
        || metadata.summary
        || metadata.preview
        || itemMap.label
        || metadata.label
        || itemMap.title
        || itemMap.name,
    );
  }

  function sessionPickerCwd(itemMap: JsonRecord, metadata: JsonRecord): string {
    const context = asRecord(itemMap.context);
    const metadataContext = asRecord(metadata.context);
    return trimString(
      itemMap.cwd
        || metadata.cwd
        || context.cwd
        || metadataContext.cwd,
    );
  }

  function sessionPickerUpdatedAt(itemMap: JsonRecord, metadata: JsonRecord): string {
    return trimString(
      itemMap.updated_at
        || itemMap.updatedAt
        || itemMap.modifiedTime
        || itemMap.modified_time
        || metadata.updated_at
        || metadata.updatedAt
        || metadata.modifiedTime
        || metadata.modified_time,
    );
  }

  function sessionPickerCreatedAt(itemMap: JsonRecord, metadata: JsonRecord): string {
    return trimString(
      itemMap.created_at
        || itemMap.createdAt
        || itemMap.start_time
        || itemMap.startTime
        || metadata.created_at
        || metadata.createdAt
        || metadata.start_time
        || metadata.startTime,
    );
  }

  function renderSessionPickerSort(field: SchemaField | null | undefined): void {
    if (!sessionPickerSortEl) return;
    sessionPickerSortEl.innerHTML = '';
    const options = sessionPickerSortOptions(field);
    const activeCwd = getSessionPickerActiveCwd();
    const sortGroup = document.createElement('div');
    sortGroup.className = 'picker-sort-group';
    if (options.length) {
      const label = document.createElement('span');
      label.className = 'picker-sort-label';
      label.textContent = 'Order';
      sortGroup.appendChild(label);

      options.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost picker-sort-btn';
        button.dataset.selected = option.value === _sessionPickerSortValue ? 'true' : 'false';
        button.textContent = option.label;
        button.addEventListener('click', () => {
          if (!_sessionPickerTarget || option.value === _sessionPickerSortValue) return;
          _sessionPickerSortValue = option.value;
          renderSessionPickerSort(_sessionPickerTarget.field);
          void fetchAndRenderSessions(schemaFieldSourceString(_sessionPickerTarget.field), _sessionPickerTarget.field);
        });
        sortGroup.appendChild(button);
      });
    }

    const filterGroup = document.createElement('div');
    filterGroup.className = 'picker-filter-group';
    if (activeCwd) {
      const filterButton = document.createElement('button');
      filterButton.type = 'button';
      filterButton.className = 'btn ghost picker-sort-btn picker-filter-btn';
      filterButton.dataset.selected = _sessionPickerFilterEnabled ? 'true' : 'false';
      filterButton.textContent = sessionPickerRelativeHomePath(activeCwd);
      filterButton.title = activeCwd;
      filterButton.addEventListener('click', () => {
        _sessionPickerFilterEnabled = !_sessionPickerFilterEnabled;
        renderSessionPickerSort(_sessionPickerTarget?.field);
        renderSessionList(_sessionPickerItems);
      });
      filterGroup.appendChild(filterButton);
    }

    sessionPickerSortEl.hidden = options.length === 0 && !activeCwd;
    if (sessionPickerSortEl.hidden) return;
    if (options.length) sessionPickerSortEl.appendChild(sortGroup);
    if (activeCwd) sessionPickerSortEl.appendChild(filterGroup);
  }

  async function fetchDynamicSource(sourceUrl: unknown, options: DynamicSourceOptions = {}): Promise<unknown> {
    const settingsRpc = requireSettingsRpc();
    const request = async (): Promise<unknown> => {
      const sourceMethod = trimString(options.sourceMethod);
      if (sourceMethod === 'extension.schemaInteraction.run') {
        if (typeof settingsRpc.runSchemaInteraction !== 'function') {
          throw new Error('Schema interaction RPC is unavailable');
        }
        const extensionId = trimString(options.agent);
        if (!extensionId) {
          throw new Error('Extension id is required for schema interaction source');
        }
        return unwrapDynamicSourceResult(await settingsRpc.runSchemaInteraction({
          extensionId,
          interactionId: trimString(options.interactionId) || trimString(options.sourceAction) || 'dynamic_source',
          action: trimString(options.sourceAction),
          inputs: {},
          values: options.values || {},
          params: options.extraParams || {},
          conversationId: options.conversationId || null,
          settings: options.settings || {},
        }));
      }
      const extensionIdForSessions = extensionIdFromApiPath(sourceUrl, 'sessions');
      if (extensionIdForSessions) {
        return unwrapDynamicSourceResult(await settingsRpc.listExtensionSessions({
          extensionId: extensionIdForSessions,
          cwd: options.cwd || null,
          extraParams: options.extraParams || null,
        }));
      }
      const extensionIdForModels = extensionIdFromApiPath(sourceUrl, 'models');
      if (extensionIdForModels || sourceMethod === 'extension.models.list') {
        const extensionId = extensionIdForModels || trimString(options.agent);
        if (!extensionId) {
          throw new Error('Extension id is required for model source');
        }
        return unwrapDynamicSourceResult(await settingsRpc.listExtensionModels({
          extensionId,
          extraParams: options.extraParams || null,
        }));
      }
      if (isRuntimeOptionsSource(sourceUrl)) {
        return unwrapDynamicSourceResult(await settingsRpc.getRuntimeOptions({
          conversationId: options.conversationId || null,
          agent: options.agent || null,
        }));
      }
      throw new Error(`Unsupported Socket.IO schema source: ${sourceUrl || '(empty)'}`);
    };

    return await request();
  }
  
  function openSessionPicker(field: SchemaField, input: HTMLInputElement): void {
    if (!sessionPickerOverlay) return;
    _sessionPickerTarget = { input, field };
    _sessionPickerSortValue = sessionPickerSortDefault(field);
    _sessionPickerFilterEnabled = Boolean(getSessionPickerActiveCwd());
    _sessionPickerItems = [];
    renderSessionPickerSort(field);
    sessionPickerOverlay.classList.remove('hidden');
    fetchAndRenderSessions(schemaFieldSourceString(field), field);
  }
  
  function closeSessionPicker(): void {
    if (!sessionPickerOverlay) return;
    sessionPickerOverlay.classList.add('hidden');
    _sessionPickerTarget = null;
    _sessionPickerSortValue = '';
    _sessionPickerFilterEnabled = false;
    _sessionPickerItems = [];
    if (sessionPickerSortEl) {
      sessionPickerSortEl.hidden = true;
      sessionPickerSortEl.innerHTML = '';
    }
  }
  
  async function fetchAndRenderSessions(sourceUrl: string, field: SchemaField | null = null): Promise<void> {
    if (!sessionPickerListEl) return;
    sessionPickerListEl.innerHTML = '<div class="picker-item">Loading…</div>';
    try {
      const extraParams: JsonRecord = {};
      const sortParam = sessionPickerSortParam(field);
      if (sortParam && _sessionPickerSortValue) {
        extraParams[sortParam] = _sessionPickerSortValue;
      }
      const data = await fetchDynamicSource(sourceUrl, {
        cwd: getSessionPickerActiveCwd() || null,
        extraParams: Object.keys(extraParams).length ? extraParams : null,
      });
      const dataMap = asRecord(data);
      const items = Array.isArray(dataMap.sessions) ? dataMap.sessions
        : Array.isArray(data) ? data : [];
      _sessionPickerItems = items.map((item) => asRecord(item)).filter((item) => Object.keys(item).length > 0);
      renderSessionPickerSort(field);
      renderSessionList(_sessionPickerItems);
    } catch (err) {
      console.warn('[schema] session list failed', err);
      _sessionPickerItems = [];
      renderSessionList([], dynamicSourceErrorMessage(err));
    }
  }
  
  function renderSessionList(items: unknown[], errorMessage = ''): void {
    if (!sessionPickerListEl) return;
    sessionPickerListEl.innerHTML = '';
    const selectedCwd = getSessionPickerActiveCwd();
    const renderedItems = items
      .map((item) => asRecord(item))
      .filter((item) => {
        if (!_sessionPickerFilterEnabled || !selectedCwd) return true;
        return sessionPickerMatchesCwdScope(sessionPickerCwd(item, asRecord(item.metadata)), selectedCwd);
      });
    if (!renderedItems.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-item';
      empty.textContent = errorMessage
        ? 'Session list unavailable'
        : (_sessionPickerFilterEnabled && selectedCwd ? 'No sessions match selected CWD' : 'No sessions found');
      if (errorMessage) empty.title = errorMessage;
      sessionPickerListEl.appendChild(empty);
      return;
    }
    renderedItems.forEach((item: unknown) => {
      const itemMap = asRecord(item);
      const metadata = asRecord(itemMap.metadata);
      const sid = trimString(itemMap.sessionId || itemMap.session_id || itemMap.id);
      const summary = sessionPickerSummary(itemMap, metadata);
      const modified = sessionPickerUpdatedAt(itemMap, metadata);
      const created = sessionPickerCreatedAt(itemMap, metadata);
      const cwd = sessionPickerCwd(itemMap, metadata);

      const row = document.createElement('div');
      row.className = 'picker-item session-item';
      row.dataset.sessionId = sid;
      row.style.cursor = 'pointer';
      if (_sessionPickerTarget) {
        const selectedId = trimString(_sessionPickerTarget.input.dataset.sessionId || _sessionPickerTarget.input.value);
        if (selectedId && selectedId === sid) {
          row.classList.add('selected');
        }
      }
      if (boolValue(itemMap.active) || boolValue(metadata.active)) {
        row.classList.add('active');
      }

      const header = document.createElement('div');
      header.className = 'session-header';

      const idSpan = document.createElement('span');
      idSpan.className = 'session-cell';
      idSpan.textContent = sessionPickerShortId(sid);

      const usedSpan = document.createElement('span');
      usedSpan.className = 'session-cell';
      usedSpan.textContent = sessionPickerFormatTimestamp(modified);

      const createdSpan = document.createElement('span');
      createdSpan.className = 'session-cell';
      createdSpan.textContent = sessionPickerFormatTimestamp(created);

      header.append(idSpan, usedSpan, createdSpan);
      row.appendChild(header);

      if (summary) {
        const previewSpan = document.createElement('div');
        previewSpan.className = 'session-summary';
        previewSpan.textContent = summary;
        row.appendChild(previewSpan);
      }

      const footer = document.createElement('div');
      footer.className = 'session-footer';
      const cwdSpan = document.createElement('span');
      cwdSpan.className = 'session-cell session-meta';
      cwdSpan.textContent = sessionPickerRelativeHomePath(cwd);
      cwdSpan.title = cwd || '';
      footer.appendChild(cwdSpan);
      row.appendChild(footer);

      row.addEventListener('click', () => {
        if (_sessionPickerTarget) {
          _sessionPickerTarget.input.value = sid;
          _sessionPickerTarget.input.dataset.sessionId = sid;
        }
        closeSessionPicker();
      });
      sessionPickerListEl.appendChild(row);
    });
  }
  
  // Wire close button
  if (sessionPickerCloseBtn) {
    sessionPickerCloseBtn.addEventListener('click', closeSessionPicker);
  }
  
  /**
   * Load settings schema for an extension
   */
  async function loadSettingsSchema(extensionId: string): Promise<SettingsSchema | null> {
    const cachedSchema = schemaCache[extensionId];
    if (cachedSchema && cachedSchema.cache !== 'none') {
      console.log(`[schema] cache hit for ${extensionId}`);
      return cachedSchema;
    }
    
    try {
      console.log(`[schema] loading schema for ${extensionId} sioCall=${typeof getHelper(ctx, 'sioCall') === 'function'}`);
      const schema = normalizeSchema(await requireSettingsRpc().getExtensionSettingsSchema(extensionId));
      console.log(`[schema] loaded schema for ${extensionId}`, schema ? Object.keys(schema) : null);
      if (schema && schema.cache !== 'none') {
        schemaCache[extensionId] = schema;
      } else {
        delete schemaCache[extensionId];
      }
      return schema;
    } catch {
      return null;
    }
  }

  function liveSessionBinding(schemaExtensionId = ''): {
    conversationId: string;
    extensionId: string;
    providerSessionId: string;
  } | null {
    const state = getCodexAgentState();
    const meta = state.conversationMeta;
    if (state.pendingNewConversation || !meta || typeof meta !== 'object') return null;
    const conversationId = trimString(meta.conversation_id);
    const threadId = trimString(meta.thread_id);
    const providerSessionId = trimString(meta.provider_session_id);
    const bindingId = threadId || providerSessionId;
    const boundExtensionId = trimString(meta.extension_id)
      || trimString(meta.agent_type)
      || trimString(state.conversationSettings?.agent);
    const requestedExtensionId = schemaExtensionId.trim();
    if (requestedExtensionId && boundExtensionId && requestedExtensionId !== boundExtensionId) return null;
    const extensionId = boundExtensionId || requestedExtensionId || settingsAgentEl?.value?.trim() || '';
    if (!conversationId || !extensionId || !bindingId) return null;
    return {
      conversationId,
      extensionId,
      providerSessionId: bindingId,
    };
  }

  function semanticRole(field: SchemaField): string {
    return trimString(asRecord(field.semantic).role);
  }

  function semanticRuntimeKey(field: SchemaField): string {
    return trimString(asRecord(field.semantic).runtime_key);
  }

  function isProviderInfoField(field: SchemaField): boolean {
    const role = semanticRole(field);
    return role === 'provider_status' || role === 'provider_usage';
  }

  function isConversationForkField(field: SchemaField): boolean {
    return semanticRole(field) === 'conversation_fork';
  }

  function providerInfoTarget(schemaExtensionId = ''): {
    extensionId: string;
    conversationId?: string;
    providerSessionId?: string;
  } | null {
    const state = getCodexAgentState();
    const meta = state.conversationMeta;
    const requestedExtensionId = schemaExtensionId.trim();
    const selectedExtensionId = settingsAgentEl?.value?.trim() || '';
    const boundExtensionId = meta && typeof meta === 'object'
      ? trimString(meta.extension_id)
        || trimString(meta.agent_type)
        || trimString(state.conversationSettings?.agent)
      : '';
    const extensionId = requestedExtensionId || selectedExtensionId || boundExtensionId;
    if (!extensionId) return null;

    const target: {
      extensionId: string;
      conversationId?: string;
      providerSessionId?: string;
    } = { extensionId };
    if (!state.pendingNewConversation && meta && typeof meta === 'object') {
      const conversationId = trimString(meta.conversation_id);
      const providerSessionId = trimString(meta.provider_session_id) || trimString(meta.thread_id);
      if (conversationId && (!boundExtensionId || boundExtensionId === extensionId)) {
        target.conversationId = conversationId;
        if (providerSessionId) target.providerSessionId = providerSessionId;
      }
    }
    return target;
  }

  function providerInfoUnavailable(message: string, detail = ''): JsonRecord {
    return {
      ok: false,
      supported: true,
      status: {
        supported: false,
        state: 'error',
        text: message,
        detail,
        tone: 'error',
      },
      usage: {
        supported: false,
        state: 'error',
        text: message,
        detail,
        tone: 'error',
      },
    };
  }

  function loadProviderInfo(schemaExtensionId = ''): Promise<JsonRecord> {
    const target = providerInfoTarget(schemaExtensionId);
    if (!target) {
      return Promise.resolve(providerInfoUnavailable('Provider unavailable.', 'No extension is selected.'));
    }
    return requireSettingsRpc().getExtensionProviderInfo({
      extensionId: target.extensionId,
      conversationId: target.conversationId ?? null,
      providerSessionId: target.providerSessionId ?? null,
    }).then(asRecord).catch((error: unknown) => providerInfoUnavailable(
      'Provider info unavailable.',
      dynamicSourceErrorMessage(error),
    ));
  }

  function applyProviderInfo(binding: ProviderInfoBinding, payload: JsonRecord): void {
    const part = asRecord(payload[binding.runtimeKey]);
    binding.root.dataset.tone = trimString(part.tone) || 'neutral';
    binding.text.textContent = trimString(part.text) || 'Provider info unavailable.';
    binding.detail.textContent = trimString(part.detail);
    binding.detail.hidden = !binding.detail.textContent;
    if (!binding.detail.isConnected) binding.root.appendChild(binding.detail);
  }

  function refreshProviderInfo(schemaExtensionId = ''): Promise<void> {
    if (providerInfoRefreshPromise) return providerInfoRefreshPromise;
    const target = providerInfoTarget(schemaExtensionId);
    if (!target) return Promise.resolve();
    const bindings = currentProviderInfoBindings.filter((binding) => (
      binding.root.isConnected && binding.extensionId === target.extensionId
    ));
    if (!bindings.length) return Promise.resolve();
    bindings.forEach((binding) => {
      binding.root.dataset.tone = 'neutral';
      binding.text.textContent = 'Checking...';
    });
    const refresh = loadProviderInfo(target.extensionId).then((payload) => {
      bindings.forEach((binding) => {
        if (binding.root.isConnected) applyProviderInfo(binding, payload);
      });
    });
    providerInfoRefreshPromise = refresh.finally(() => {
      providerInfoRefreshPromise = null;
    });
    return providerInfoRefreshPromise;
  }

  function renderProviderInfo(
    field: SchemaField,
    providerInfoPromise: Promise<JsonRecord> | null,
    schemaExtensionId: string,
  ): HTMLDivElement {
    const info = document.createElement('div');
    info.className = 'settings-schema-info';
    info.dataset.tone = 'neutral';

    const infoLabel = document.createElement('div');
    infoLabel.className = 'settings-schema-info-label';
    infoLabel.textContent = field.label || field.id || 'Provider Info';
    info.appendChild(infoLabel);

    const infoText = document.createElement('div');
    infoText.className = 'settings-schema-info-text';
    infoText.textContent = providerInfoPromise ? 'Checking...' : 'Provider info unavailable.';
    info.appendChild(infoText);

    const infoDetail = document.createElement('div');
    infoDetail.className = 'settings-schema-info-detail';
    infoDetail.textContent = field.detail || '';
    info.appendChild(infoDetail);

    const runtimeKey = semanticRuntimeKey(field);
    if (!runtimeKey) {
      info.dataset.tone = 'error';
      infoText.textContent = 'Provider info field is missing semantic.runtime_key.';
      return info;
    }
    if (!providerInfoPromise) return info;

    const binding: ProviderInfoBinding = {
      extensionId: schemaExtensionId,
      runtimeKey,
      root: info,
      text: infoText,
      detail: infoDetail,
    };
    currentProviderInfoBindings.push(binding);

    providerInfoPromise.then((payload) => {
      applyProviderInfo(binding, payload);
    }).catch((error: unknown) => {
      info.dataset.tone = 'error';
      infoText.textContent = 'Provider info unavailable.';
      infoDetail.textContent = dynamicSourceErrorMessage(error);
    });

    return info;
  }

  function boolFromPayload(payload: JsonRecord, key: string): boolean {
    return payload[key] === true;
  }

  function sessionStateText(payload: JsonRecord): string {
    const state = trimString(payload.state);
    if (state === 'loaded' || boolFromPayload(payload, 'loaded')) return 'Loaded in memory';
    if (state === 'cold') return 'Not loaded';
    if (state === 'busy') return 'Busy';
    if (state === 'unsupported') return 'Live state unsupported';
    if (state === 'unbound') return 'No provider binding';
    return 'Status unavailable';
  }

  function sessionStateTone(payload: JsonRecord): string {
    const state = trimString(payload.state);
    if (state === 'loaded' || boolFromPayload(payload, 'loaded')) return 'loaded';
    if (state === 'cold') return 'cold';
    if (state === 'busy') return 'busy';
    return 'unknown';
  }

  function renderLiveSessionInfo(field: SchemaField, schemaExtensionId = ''): HTMLDivElement {
    const binding = liveSessionBinding(schemaExtensionId);
    const info = document.createElement('div');
    info.className = 'settings-schema-info settings-live-session';
    info.dataset.state = 'unknown';

    const header = document.createElement('div');
    header.className = 'settings-live-session-header';

    const infoLabel = document.createElement('div');
    infoLabel.className = 'settings-schema-info-label';
    infoLabel.textContent = field.label || field.id || 'Provider Session';
    header.appendChild(infoLabel);

    const status = document.createElement('span');
    status.className = 'settings-live-session-status';
    status.textContent = binding ? 'Checking...' : 'Unavailable';
    header.appendChild(status);
    info.appendChild(header);

    const row = document.createElement('div');
    row.className = 'settings-live-session-row';

    const infoText = document.createElement('div');
    infoText.className = 'settings-schema-info-text settings-live-session-id';
    infoText.textContent = typeof field.text === 'string' && field.text.trim()
      ? field.text.trim()
      : 'Information unavailable.';
    row.appendChild(infoText);

    const unloadButton = document.createElement('button');
    unloadButton.type = 'button';
    unloadButton.className = 'settings-live-session-unload';
    unloadButton.textContent = '×';
    unloadButton.title = 'Unload provider session from memory';
    unloadButton.disabled = true;
    row.appendChild(unloadButton);
    info.appendChild(row);

    const detail = document.createElement('div');
    detail.className = 'settings-schema-info-detail';
    detail.textContent = field.detail || 'Bound provider session or thread identifier.';
    info.appendChild(detail);

    if (!binding) {
      status.textContent = 'Unavailable';
      unloadButton.style.display = 'none';
      return info;
    }

    const setPayload = (payload: JsonRecord): void => {
      const tone = sessionStateTone(payload);
      info.dataset.state = tone;
      status.textContent = sessionStateText(payload);
      const supported = payload.supported === true;
      const unloadSupported = payload.unload_supported === true || payload.unloadSupported === true;
      const busy = payload.busy === true || tone === 'busy';
      unloadButton.style.display = supported && unloadSupported ? '' : 'none';
      unloadButton.disabled = !supported || !unloadSupported || busy;
      const error = trimString(payload.error);
      detail.textContent = error || field.detail || 'Bound provider session or thread identifier.';
    };

    const setFailure = (error: unknown): void => {
      info.dataset.state = 'unknown';
      status.textContent = 'Status unavailable';
      unloadButton.disabled = true;
      detail.textContent = dynamicSourceErrorMessage(error);
    };

    const refresh = async (): Promise<void> => {
      const settingsRpc = requireSettingsRpc();
      if (typeof settingsRpc.getExtensionSessionState !== 'function') {
        setPayload({
          ok: true,
          supported: false,
          state: 'unsupported',
          loaded: false,
          unload_supported: false,
        });
        return;
      }
      const result = await settingsRpc.getExtensionSessionState({
        extensionId: binding.extensionId,
        conversationId: binding.conversationId,
        providerSessionId: binding.providerSessionId,
      });
      setPayload(asRecord(result));
    };

    unloadButton.addEventListener('click', () => {
      void (async () => {
        const settingsRpc = requireSettingsRpc();
        if (typeof settingsRpc.unloadExtensionSession !== 'function') return;
        unloadButton.disabled = true;
        status.textContent = 'Unloading...';
        try {
          const result = await settingsRpc.unloadExtensionSession({
            extensionId: binding.extensionId,
            conversationId: binding.conversationId,
            providerSessionId: binding.providerSessionId,
          });
          const payload = asRecord(result);
          setPayload(payload);
          if (payload.ok !== false) {
            await refresh();
          }
        } catch (error) {
          setFailure(error);
        }
      })();
    });

    void refresh().catch(setFailure);
    return info;
  }

  function renderConversationForkAction(field: SchemaField, schemaExtensionId = ''): HTMLDivElement {
    const binding = liveSessionBinding(schemaExtensionId);
    const row = document.createElement('div');
    row.className = 'settings-schema-action';

    const label = document.createElement('div');
    label.className = 'settings-schema-action-label';
    label.textContent = field.label || 'Branch Conversation';
    row.appendChild(label);

    const status = document.createElement('div');
    status.className = 'settings-schema-info-detail';
    status.textContent = binding ? '' : 'Provider session unavailable.';
    row.appendChild(status);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ghost';
    button.textContent = trimString(field.text) || 'Create Branch';
    button.disabled = !binding;
    row.appendChild(button);

    button.addEventListener('click', async () => {
      if (!binding) return;
      const confirmText = trimString(field.confirm);
      if (confirmText && !window.confirm(confirmText)) return;
      button.disabled = true;
      status.textContent = 'Branching...';
      try {
        const conversationsRpc = requireConversationsRpc();
        if (typeof conversationsRpc.forkConversation !== 'function') {
          throw new Error('conversation.fork is unavailable');
        }
        const result = asRecord(await conversationsRpc.forkConversation({
          conversationId: binding.conversationId,
          timeoutMs: 30000,
        }));
        if (result.ok === false) {
          throw new Error(dynamicSourceErrorMessage(result));
        }
        const nextConversationId = trimString(result.conversation_id);
        if (!nextConversationId) {
          throw new Error('Fork did not return a conversation id');
        }
        callCtxHelper(ctx, 'closeSettingsModal');
        const opened = callCtxHelper(ctx, 'openSplashConversation', nextConversationId, 'conversation');
        if (opened && typeof (opened as Promise<unknown>).then === 'function') {
          await opened;
        }
      } catch (error) {
        status.textContent = dynamicSourceErrorMessage(error);
        button.disabled = false;
      }
    });

    return row;
  }

  /**
   * Render schema fields into the extension fields container
   */
  function renderSchemaFields(schema: SettingsSchema | null, values: JsonRecord = {}, schemaExtensionId = ''): void {
    if (!settingsExtensionFields) return;
    settingsExtensionFields.innerHTML = '';
    currentSchemaValues = {};
    currentSchemaWriteBackValues = {};
    currentSchemaFields = {};
    currentProviderInfoBindings = [];
    
    if (!schema || !Array.isArray(schema.fields)) return;
    const getConversationInfoFields = (): SchemaField[] => {
      const state = getCodexAgentState();
      if (state?.pendingNewConversation) return [];

      const binding = liveSessionBinding(schemaExtensionId);
      if (!binding) return [];

      return [
        {
          id: '__conversation_info_section',
          type: 'section',
          label: 'Conversation Info',
          description: 'Current harness conversation binding for this active provider-backed conversation.',
        },
        {
          id: '__conversation_info_conversation_id',
          type: 'info',
          label: 'Conversation ID',
          text: binding.conversationId,
          detail: 'Harness conversation identifier.',
        },
        {
          id: '__conversation_info_provider_thread_id',
          type: 'live_session_info',
          label: 'Provider Session / Thread ID',
          text: binding.providerSessionId,
          detail: 'Bound provider session or thread identifier.',
        },
      ];
    };

    const moveFieldAfterIndex = (fields: SchemaField[], fieldIndex: number, afterIndex: number): SchemaField[] => {
      if (!Array.isArray(fields) || fieldIndex < 0 || afterIndex < 0 || fieldIndex === afterIndex + 1) {
        return fields;
      }

      const reordered = fields.slice();
      const [field] = reordered.splice(fieldIndex, 1);
      if (!field) return fields;

      const normalizedAfterIndex = fieldIndex < afterIndex ? afterIndex - 1 : afterIndex;
      reordered.splice(normalizedAfterIndex + 1, 0, field);
      return reordered;
    };

    const getRenderFields = (): SchemaField[] => {
      const fields = Array.isArray(schema.fields) ? schema.fields.slice() : [];
      const conversationInfoFields = getConversationInfoFields();
      if (!conversationInfoFields.length) return fields;

      const sessionPickerIndex = fields.findIndex((field) => field && field.type === 'session_picker');
      if (sessionPickerIndex >= 0) {
        let renderFields = [
          ...fields.slice(0, sessionPickerIndex + 1),
          ...conversationInfoFields,
          ...fields.slice(sessionPickerIndex + 1),
        ];

        const cwdIndex = fields.findIndex((field) => field && field.id === 'cwd');
        if (cwdIndex >= 0 && cwdIndex < sessionPickerIndex) {
          const renderedCwdIndex = renderFields.findIndex((field) => field && field.id === 'cwd');
          const conversationInfoEndIndex = sessionPickerIndex + conversationInfoFields.length;
          renderFields = moveFieldAfterIndex(renderFields, renderedCwdIndex, conversationInfoEndIndex);
        }

        return renderFields;
      }

      let insertAt = 0;
      while (insertAt < fields.length) {
        const type = typeof fields[insertAt]?.type === 'string' ? fields[insertAt].type : '';
        if (type === 'section' || type === 'info') {
          insertAt += 1;
          continue;
        }
        break;
      }

      return [
        ...fields.slice(0, insertAt),
        ...conversationInfoFields,
        ...fields.slice(insertAt),
      ];
    };

    const renderFields = getRenderFields();
    if (!renderFields.length) return;
    const selectControls: Record<string, SelectControl> = {};
    let modelItems: JsonRecord[] = [];
    const conditionalRows: Array<{
      field: SchemaField;
      element: HTMLElement;
      input?: SchemaInput | null;
    }> = [];
    let providerInfoPromise = renderFields.some(isProviderInfoField)
      ? loadProviderInfo(schemaExtensionId)
      : null;

    const fieldValueKeys = (field: SchemaField): string[] => {
      const extraKeys = Array.isArray(field?.value_keys)
        ? field.value_keys
            .map((key) => (typeof key === 'string' ? key.trim() : ''))
            .filter(Boolean)
        : [];
      return [field.id, ...extraKeys].filter((key, index, items): key is string => Boolean(key) && items.indexOf(key) === index);
    };

    const getFieldValue = (field: SchemaField, sourceValues: JsonRecord): JsonValue => {
      const resolvedValues = asRecord(sourceValues);
      for (const key of fieldValueKeys(field)) {
        if (Object.prototype.hasOwnProperty.call(resolvedValues, key)) {
          return resolvedValues[key];
        }
      }
      return field.default ?? '';
    };

    const getProviderInfoPromise = (): Promise<JsonRecord> => {
      if (!providerInfoPromise) {
        providerInfoPromise = loadProviderInfo(schemaExtensionId);
      }
      return providerInfoPromise;
    };

    const readPath = (source: unknown, path: unknown): unknown => {
      if (typeof path !== 'string' || !path.trim()) return undefined;
      return path
        .trim()
        .split('.')
        .filter(Boolean)
        .reduce<unknown>((current, part) => {
          if (!isRecord(current)) return undefined;
          return current[part];
        }, source);
    };

    const firstPathValue = (source: unknown, paths: unknown): unknown => {
      const candidates = Array.isArray(paths) ? paths : [paths];
      for (const path of candidates) {
        const value = readPath(source, path);
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return undefined;
    };

    const optionFromDynamicItem = (
      item: unknown,
      valuePath: unknown,
      labelPath: unknown,
    ): SelectOption | null => {
      if (typeof item === 'string') {
        return item ? { value: item, label: item, raw: item } : null;
      }
      const value = trimString(firstPathValue(item, valuePath) ?? (isRecord(item) ? item.value : ''));
      if (!value) return null;
      const label = trimString(firstPathValue(item, labelPath) ?? value) || value;
      const detail = trimString(firstPathValue(item, ['detail', 'description', 'raw.detail', 'raw.description']));
      return { value, label, detail, raw: item };
    };

    const selectedDependencyValue = (field: SchemaField): string => {
      const dynamicOptions = asRecord(field.dynamic_options_from);
      const sourceField = trimString(dynamicOptions.source_field);
      if (!sourceField) return '';
      return selectControls[sourceField]?.input?.value || '';
    };

    const findDependentSourceItem = (field: SchemaField): JsonRecord | null => {
      const dynamicOptions = asRecord(field.dynamic_options_from);
      const sourceValue = selectedDependencyValue(field);
      if (!sourceValue) return null;
      const matchPath = trimString(dynamicOptions.match_path) || 'id';
      const sourceControl = selectControls[trimString(dynamicOptions.source_field)];
      const ownControl = selectControls[field.id];
      const items = sourceControl?.dynamicItems?.length
        ? sourceControl.dynamicItems
        : (ownControl?.dynamicItems?.length ? ownControl.dynamicItems : modelItems);
      return items.find((item) => trimString(firstPathValue(item, matchPath)) === sourceValue) || null;
    };

    const optionsFromDependentSource = (field: SchemaField): DynamicSelectOptions => {
      const dynamicOptions = asRecord(field.dynamic_options_from);
      const sourceItem = findDependentSourceItem(field);
      if (!sourceItem) return { items: [], options: [], current: '', defaultValue: '' };
      const rawOptions = firstPathValue(sourceItem, dynamicOptions.options_path);
      const optionItems = Array.isArray(rawOptions) ? rawOptions : [];
      const valuePath = dynamicOptions.option_value_path || 'value';
      const labelPath = dynamicOptions.option_label_path || dynamicOptions.option_value_path || 'label';
      const options = optionItems
        .map((item) => optionFromDynamicItem(item, valuePath, labelPath))
        .filter((option): option is SelectOption => Boolean(option));
      return {
        items: optionItems.filter(isRecord),
        options,
        current: '',
        defaultValue: trimString(firstPathValue(sourceItem, dynamicOptions.default_path)),
      };
    };

    const parseModelVersion = (modelId: unknown): ModelVersion | null => {
      if (typeof modelId !== 'string') return null;
      const match = modelId.trim().toLowerCase().match(/^([a-z][a-z0-9]*)-(\d+)(?:\.(\d+))?(?:$|[-_])/);
      if (!match) return null;
      return {
        family: match[1],
        major: Number.parseInt(match[2], 10),
        minor: match[3] ? Number.parseInt(match[3], 10) : 0,
      };
    };

    const modelMatchesGate = (modelId: unknown, gate: unknown): boolean => {
      if (!isRecord(gate)) return true;
      const version = parseModelVersion(modelId);
      if (!version) return false;
      const family = typeof gate.family === 'string' ? gate.family.trim().toLowerCase() : '';
      if (family && version.family !== family) return false;
      const minMajor = Number.isFinite(gate.min_major) ? Number(gate.min_major) : gate.minMajor;
      const minMinor = Number.isFinite(gate.min_minor) ? Number(gate.min_minor) : gate.minMinor;
      const requiredMajor = Number.isFinite(minMajor) ? Number(minMajor) : 0;
      const requiredMinor = Number.isFinite(minMinor) ? Number(minMinor) : 0;
      if (version.major > requiredMajor) return true;
      if (version.major < requiredMajor) return false;
      return version.minor >= requiredMinor;
    };

    const normalizeDynamicSelectOptions = (field: SchemaField, data: unknown): DynamicSelectOptions => {
      if (!data) return { items: [], options: [], current: '', defaultValue: '' };
      const dataMap = asRecord(data);
      const source = schemaFieldSourceConfig(field);
      const mappedOptionsPath = field.options_path ?? source.options_path ?? source.items_path;
      if (mappedOptionsPath !== undefined && mappedOptionsPath !== null && mappedOptionsPath !== '') {
        const rawItems = firstPathValue(data, mappedOptionsPath);
        const items = Array.isArray(rawItems) ? rawItems : [];
        const valuePath = field.option_value_path ?? source.option_value_path ?? source.value_path ?? source.id_path ?? ['value', 'id'];
        const labelPath = field.option_label_path ?? source.option_label_path ?? source.label_path ?? source.name_path ?? ['label', 'name', 'value', 'id'];
        const options = items
          .map((item) => optionFromDynamicItem(item, valuePath, labelPath))
          .filter((option): option is SelectOption => Boolean(option));
        return {
          items: items.filter(isRecord),
          options,
          current: trimString(firstPathValue(data, field.current_path ?? source.current_path ?? 'current')),
          defaultValue: trimString(firstPathValue(data, field.default_path ?? source.default_path ?? 'default')),
        };
      }
      if (field.dynamic_options_key && isRecord(data)) {
        const descriptor = asRecord(dataMap[field.dynamic_options_key]);
        const items = Array.isArray(descriptor.options) ? descriptor.options : [];
        const options = items.map((item: unknown): SelectOption | null => {
          if (typeof item === 'string') return { value: item, label: item, raw: item };
          const itemMap = asRecord(item);
          const value = trimString(itemMap.value);
          if (!value) return null;
          return {
            value,
            label: trimString(itemMap.label) || value,
            raw: item,
          };
        }).filter((option): option is SelectOption => Boolean(option));
        return {
          items: items.filter(isRecord),
          options,
          current: trimString(descriptor.current),
          defaultValue: trimString(descriptor.default),
        };
      }
      const rawItems = Array.isArray(data) ? data : dataMap.models || dataMap.options || [];
      const items = Array.isArray(rawItems) ? rawItems : [];
      const options = items.map((item: unknown): SelectOption => {
        if (isRecord(item)) {
          const value = trimString(item.id || item.value);
          return { value, label: trimString(item.name || item.label || item.id || item.value) || value, raw: item };
        }
        const value = String(item ?? '');
        return { value, label: value, raw: item };
      }).filter((option) => option.value);
      return { items: items.filter(isRecord), options, current: '', defaultValue: '' };
    };

    const currentValueForFieldId = (fieldId: string): unknown => {
      const entry = currentSchemaValues[fieldId];
      if (entry?.input) {
        if (entry.type === 'checkbox') {
          return entry.input instanceof HTMLInputElement ? entry.input.checked : false;
        }
        return entry.input.value;
      }
      if (Object.prototype.hasOwnProperty.call(currentSchemaWriteBackValues, fieldId)) {
        return currentSchemaWriteBackValues[fieldId];
      }
      if (Object.prototype.hasOwnProperty.call(values, fieldId)) {
        return values[fieldId];
      }
      return undefined;
    };

    const conditionValueString = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return '';
    };

    const isEmptyConditionValue = (value: unknown): boolean => {
      if (value === undefined || value === null) return true;
      if (typeof value === 'string') return value.trim() === '';
      if (Array.isArray(value)) return value.length === 0;
      return false;
    };

    const compareConditionValue = (actual: unknown, expected: unknown): boolean => {
      if (typeof expected === 'boolean') return actual === expected;
      if (typeof expected === 'number') return Number(actual) === expected;
      return conditionValueString(actual) === conditionValueString(expected);
    };

    const conditionList = (value: unknown): unknown[] => {
      return Array.isArray(value) ? value : [value];
    };

    const fieldConditionMatches = (condition: JsonRecord): boolean => {
      const fieldId = trimString(condition.field || condition.source_field || condition.id);
      if (!fieldId) return true;
      const actual = currentValueForFieldId(fieldId);
      const op = trimString(condition.op || condition.operator) || 'truthy';
      switch (op) {
        case 'eq':
        case 'equals':
        case 'is':
          return compareConditionValue(actual, condition.value);
        case 'neq':
        case 'not_eq':
        case 'not_equals':
          return !compareConditionValue(actual, condition.value);
        case 'in':
          return conditionList(condition.values ?? condition.value).some((item) => compareConditionValue(actual, item));
        case 'not_in':
          return !conditionList(condition.values ?? condition.value).some((item) => compareConditionValue(actual, item));
        case 'empty':
          return isEmptyConditionValue(actual);
        case 'not_empty':
          return !isEmptyConditionValue(actual);
        case 'falsy':
          return actual === false || isEmptyConditionValue(actual);
        case 'matches': {
          const pattern = trimString(condition.value ?? condition.pattern);
          if (!pattern) return true;
          try {
            return new RegExp(pattern).test(conditionValueString(actual));
          } catch {
            return false;
          }
        }
        case 'truthy':
        default:
          return actual === true || !isEmptyConditionValue(actual);
      }
    };

    const conditionMatches = (condition: unknown): boolean => {
      if (!condition) return true;
      if (Array.isArray(condition)) return condition.every(conditionMatches);
      if (!isRecord(condition)) return true;
      if (Array.isArray(condition.all)) return condition.all.every(conditionMatches);
      if (Array.isArray(condition.any)) return condition.any.some(conditionMatches);
      if (Object.prototype.hasOwnProperty.call(condition, 'not')) return !conditionMatches(condition.not);
      return fieldConditionMatches(condition);
    };

    const isSchemaSubmenuField = (field: SchemaField): boolean => {
      return field.type === 'submenu' || field.type === 'group';
    };

    const schemaFragmentTarget = (field: SchemaField): string => {
      const ref = asRecord(field.schema_ref);
      return trimString(ref.target || ref.path || ref.file);
    };

    const schemaInteractionSource = (field: SchemaField): JsonRecord => {
      if (isRecord(field.interaction)) return field.interaction;
      if (isRecord(field.source)) return field.source;
      return {};
    };

    const schemaInteractionInputSpecs = (field: SchemaField): JsonRecord[] => {
      if (Array.isArray(field.inputs)) {
        return field.inputs.filter(isRecord);
      }
      if (isRecord(field.input)) return [field.input];
      return [{ id: 'query' }];
    };

    const resolveInteractionToken = (token: string, inputs: JsonRecord): unknown => {
      if (token.startsWith('$input.')) {
        return readPath(inputs, token.slice('$input.'.length));
      }
      if (token === '$input') return inputs;
      if (token.startsWith('$field.')) {
        return currentValueForFieldId(token.slice('$field.'.length));
      }
      if (token === '$values') return collectSchemaValues(false);
      if (token === '$context.cwd') {
        return currentValueForFieldId('cwd')
          || trimString(getCodexAgentState().conversationSettings?.cwd);
      }
      if (token === '$context.conversation_id') {
        return trimString(getCodexAgentState().conversationMeta?.conversation_id);
      }
      if (token === '$context.provider_session_id') {
        const meta = getCodexAgentState().conversationMeta;
        return trimString(meta?.provider_session_id) || trimString(meta?.thread_id);
      }
      return token;
    };

    const resolveInteractionValue = (value: unknown, inputs: JsonRecord): unknown => {
      if (typeof value === 'string' && value.startsWith('$')) {
        return resolveInteractionToken(value, inputs);
      }
      if (Array.isArray(value)) {
        return value.map((item) => resolveInteractionValue(item, inputs));
      }
      if (isRecord(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, resolveInteractionValue(item, inputs)]),
        );
      }
      return value;
    };

    const buildInteractionParams = (field: SchemaField, inputs: JsonRecord): JsonRecord => {
      const source = schemaInteractionSource(field);
      const rawParams = asRecord(source.params);
      return Object.fromEntries(
        Object.entries(rawParams).map(([key, value]) => [key, resolveInteractionValue(value, inputs)]),
      );
    };

    const schemaFieldSourceConfig = (field: SchemaField): JsonRecord => (
      isRecord(field.source) ? field.source : {}
    );

    const schemaFieldSourceMethod = (field: SchemaField): string => (
      trimString(field.source_method) || trimString(schemaFieldSourceConfig(field).method)
    );

    const schemaFieldSourceAction = (field: SchemaField): string => (
      trimString(schemaFieldSourceConfig(field).action)
    );

    const fieldIdList = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index);
    };

    const sourceParamsSpec = (field: SchemaField): JsonRecord => {
      if (isRecord(field.source_params)) return field.source_params;
      const source = schemaFieldSourceConfig(field);
      return isRecord(source.params) ? source.params : {};
    };

    const sourceParamFieldDependencies = (value: unknown): string[] => {
      if (typeof value === 'string') {
        return value.startsWith('$field.') ? [value.slice('$field.'.length).split('.')[0] || ''] : [];
      }
      if (Array.isArray(value)) {
        return value.flatMap(sourceParamFieldDependencies);
      }
      if (isRecord(value)) {
        return Object.values(value).flatMap(sourceParamFieldDependencies);
      }
      return [];
    };

    const sourceRefreshDependencies = (field: SchemaField): string[] => {
      const dynamicOptions = asRecord(field.dynamic_options_from);
      return [
        ...fieldIdList(field.depends_on),
        ...fieldIdList(field.refresh_on),
        ...sourceParamFieldDependencies(sourceParamsSpec(field)),
        trimString(dynamicOptions.source_field),
      ].filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index);
    };

    const requiredSourceDependencies = (field: SchemaField): string[] => {
      const dynamicOptions = asRecord(field.dynamic_options_from);
      return [
        ...fieldIdList(field.depends_on),
        trimString(dynamicOptions.source_field),
      ].filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index);
    };

    const hasMissingRequiredSourceDependency = (field: SchemaField): boolean => (
      requiredSourceDependencies(field).some((fieldId) => isEmptyConditionValue(currentValueForFieldId(fieldId)))
    );

    const buildSourceParams = (field: SchemaField): JsonRecord => {
      const rawParams = sourceParamsSpec(field);
      return Object.fromEntries(
        Object.entries(rawParams).map(([key, value]) => [key, resolveInteractionValue(value, {})]),
      );
    };

    const interactionInputId = (spec: JsonRecord, index: number): string => {
      const id = trimString(spec.id || spec.name || spec.key);
      if (id) return id;
      return index === 0 ? 'query' : `input_${index + 1}`;
    };

    const interactionInputType = (spec: JsonRecord): string => {
      const kind = trimString(spec.type || spec.input_type || spec.kind).toLowerCase();
      if (spec.secret === true || spec.sensitive === true || kind === 'secret') return 'password';
      if (['password', 'number', 'checkbox', 'textarea', 'text'].includes(kind)) return kind;
      return 'text';
    };

    const interactionInputValue = (input: SchemaInput, type: string, spec: JsonRecord): unknown => {
      if (type === 'checkbox') {
        return input instanceof HTMLInputElement ? input.checked : false;
      }
      const rawValue = input.value;
      if (type === 'number') {
        const trimmed = rawValue.trim();
        if (!trimmed) return '';
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? numeric : trimmed;
      }
      return spec.preserve_whitespace === true ? rawValue : rawValue.trim();
    };

    const setSchemaInputValue = (
      targetField: string,
      target: SchemaValueEntry | undefined,
      value: unknown,
    ): boolean => {
      currentSchemaWriteBackValues[targetField] = value == null ? null : value;
      if (!target?.input) return false;
      let changed = false;
      if (target.type === 'checkbox' && target.input instanceof HTMLInputElement) {
        const nextChecked = value === true || value === 'true';
        changed = target.input.checked !== nextChecked;
        target.input.checked = nextChecked;
      } else {
        const nextValue = value == null ? '' : String(value);
        changed = target.input.value !== nextValue;
        target.input.value = nextValue;
      }
      if (!changed) return false;
      target.input.dispatchEvent(new Event('input', { bubbles: true }));
      target.input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    const schemaFieldById = (fieldId: unknown): SchemaField | null => {
      const id = trimString(fieldId);
      if (!id) return null;
      return currentSchemaFields[id]
        || currentSchemaValues[id]?.field
        || selectControls[id]?.field
        || null;
    };

    const markSchemaDirty = (): void => {
      if (settingsExtensionFields) {
        settingsExtensionFields.dataset.dirty = 'true';
        settingsExtensionFields.dispatchEvent(new CustomEvent('settings-schema-dirty', { bubbles: true }));
      }
    };

    const applyWriteBackRules = (rules: unknown[], item: unknown): void => {
      rules.forEach((rawRule) => {
        const rule = asRecord(rawRule);
        const targetField = trimString(rule.field);
        if (!targetField) return;
        const sourcePath = rule.path || rule.value_path || rule.source_path || '$item';
        const fallbackPath = rule.fallback_path || rule.fallbackPath || rule.fallback_value_path;
        const sourcePaths = Array.isArray(sourcePath)
          ? sourcePath
          : [sourcePath, fallbackPath].filter((path) => path !== undefined && path !== null && path !== '');
        const value = sourcePath === '$item' ? item : firstPathValue(item, sourcePaths);
        const allowEmpty = rule.allow_empty === true
          || rule.allowEmpty === true
          || rule.allow_null === true
          || rule.allowNull === true
          || rule.clear === true;
        if (!allowEmpty && (value === undefined || value === null || value === '')) {
          return;
        }
        setSchemaInputValue(targetField, currentSchemaValues[targetField], value);
      });
      markSchemaDirty();
    };

    const applyFieldWriteBack = (field: SchemaField, item: unknown): void => {
      const writeBack = asRecord(field.write_back);
      const onSelect = Array.isArray(writeBack.on_select) ? writeBack.on_select : [];
      applyWriteBackRules(onSelect, item);
      syncConditionalState();
    };

    const renderInteractionOutput = (
      field: SchemaField,
      outputEl: HTMLElement,
      payload: unknown,
    ): void => {
      outputEl.innerHTML = '';
      const payloadMap = asRecord(payload);
      const output = asRecord(field.output);
      if (payloadMap.ok === false) {
        const error = document.createElement('div');
        error.className = 'settings-schema-info';
        error.dataset.tone = 'error';
        const text = document.createElement('div');
        text.className = 'settings-schema-info-text';
        text.textContent = dynamicSourceErrorMessage(payloadMap);
        error.appendChild(text);
        outputEl.appendChild(error);
        return;
      }

      const kind = trimString(output.kind) || 'list';
      if (kind === 'json') {
        const pre = document.createElement('pre');
        pre.className = 'settings-schema-interaction-json';
        pre.textContent = JSON.stringify(payload, null, 2);
        outputEl.appendChild(pre);
        return;
      }

      if (kind === 'info') {
        const info = document.createElement('div');
        info.className = 'settings-schema-info';
        const tone = trimString(firstPathValue(payload, output.tone_path));
        if (tone) info.dataset.tone = tone;
        const text = document.createElement('div');
        text.className = 'settings-schema-info-text';
        text.textContent = trimString(firstPathValue(payload, output.text_path || 'text'))
          || trimString(output.empty_text)
          || 'No result.';
        info.appendChild(text);
        const detail = trimString(firstPathValue(payload, output.detail_path || 'detail'));
        if (detail) {
          const detailEl = document.createElement('div');
          detailEl.className = 'settings-schema-info-detail';
          detailEl.textContent = detail;
          info.appendChild(detailEl);
        }
        outputEl.appendChild(info);
        return;
      }

      const rawItems = firstPathValue(payload, output.items_path || 'items');
      const items = Array.isArray(rawItems) ? rawItems : [];
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-schema-info';
        const text = document.createElement('div');
        text.className = 'settings-schema-info-text';
        text.textContent = trimString(output.empty_text) || 'No results.';
        empty.appendChild(text);
        outputEl.appendChild(empty);
        return;
      }
      const list = document.createElement('div');
      list.className = 'settings-schema-interaction-list';
      items.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-schema-interaction-result';
        const label = document.createElement('span');
        label.className = 'settings-schema-interaction-result-label';
        label.textContent = trimString(firstPathValue(item, output.label_path || output.name_path || 'label'))
          || trimString(firstPathValue(item, output.id_path || 'id'))
          || 'Result';
        row.appendChild(label);
        const detail = trimString(firstPathValue(item, output.detail_path || 'detail'));
        if (detail) {
          const detailEl = document.createElement('span');
          detailEl.className = 'settings-schema-interaction-result-detail';
          detailEl.textContent = detail;
          row.appendChild(detailEl);
        }
        row.addEventListener('click', () => {
          applyFieldWriteBack(field, item);
        });
        list.appendChild(row);
      });
      outputEl.appendChild(list);
    };

    const setFieldDisabledReason = (
      element: HTMLElement,
      input: SchemaInput | null | undefined,
      source: 'condition' | 'model',
      disabled: boolean,
      hint = '',
    ): void => {
      if (source === 'condition') {
        element.dataset.conditionDisabled = disabled ? 'true' : 'false';
        element.dataset.conditionHint = disabled ? hint : '';
      } else {
        element.dataset.modelGateDisabled = disabled ? 'true' : 'false';
        element.dataset.modelGateHint = disabled ? hint : '';
      }
      const disabledByCondition = element.dataset.conditionDisabled === 'true';
      const disabledByModel = element.dataset.modelGateDisabled === 'true';
      const disabledHint = disabledByCondition
        ? element.dataset.conditionHint || ''
        : (disabledByModel ? element.dataset.modelGateHint || '' : '');
      const isDisabled = disabledByCondition || disabledByModel;
      if (input) {
        input.disabled = isDisabled;
        if (disabledHint) {
          input.title = disabledHint;
        } else {
          input.removeAttribute('title');
        }
      }
      element.classList.toggle('is-disabled', isDisabled);
      if (disabledHint) {
        element.title = disabledHint;
      } else {
        element.removeAttribute('title');
      }
    };

    const syncConditionalState = (): void => {
      conditionalRows.forEach(({ field, element, input }) => {
        const visible = conditionMatches(field.visible_if);
        element.hidden = !visible;
        element.classList.toggle('is-hidden-by-condition', !visible);
        if (!visible && field.clear_when_hidden === true && input) {
          resetModelGatedInput(input, field.type);
        }
        if (isRecord(field.enabled_if)) {
          const enabled = visible && conditionMatches(field.enabled_if);
          const hint = enabled ? '' : 'Unavailable for the current settings selection.';
          setFieldDisabledReason(element, input, 'condition', !enabled, hint);
        } else if (element.dataset.conditionDisabled === 'true') {
          setFieldDisabledReason(element, input, 'condition', false);
        }
      });
    };

    const normalizeSelectControlOption = (option: SelectOption | string): SelectOption => {
      if (typeof option === 'string') {
        return { value: option, label: option, raw: option };
      }
      return {
        value: option.value,
        label: option.label || option.value,
        detail: option.detail,
        raw: option.raw ?? option,
      };
    };

    const selectOptionByValue = (
      control: SelectControl,
      value: string,
      options: SelectOption[] = control.options,
      applyWriteBack = true,
      sync = true,
    ): boolean => {
      const option = options.find((candidate) => candidate.value === value);
      if (!option) {
        control.selectedOption = undefined;
        return false;
      }
      control.input.value = option.value;
      control.selectedOption = option.raw ?? option;
      if (applyWriteBack) {
        applyFieldWriteBack(control.field, control.selectedOption);
      }
      if (sync) {
        syncDependentSelectOptions(control.field.id);
        refreshSourceDependentSelects(control.field.id);
        if (control.field?.id === 'model') syncModelDependentFields();
        syncConditionalState();
      }
      return true;
    };

    const selectOptionDetail = (option: SelectOption): string => (
      trimString(option.detail)
      || trimString(firstPathValue(option.raw, ['detail', 'description', 'raw.detail', 'raw.description']))
    );

    const closeOptionPicker = (): void => {
      optionPickerOverlay?.classList.add('hidden');
      optionPickerTarget = null;
      if (optionPickerFilterEl) optionPickerFilterEl.value = '';
    };

    const ensureOptionPicker = (): void => {
      if (optionPickerOverlay) return;
      const overlay = document.createElement('div');
      overlay.className = 'picker-overlay hidden schema-option-picker-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'picker-dialog schema-option-picker-dialog';
      const header = document.createElement('div');
      header.className = 'picker-header';
      optionPickerTitleEl = document.createElement('h3');
      optionPickerTitleEl.textContent = 'Select Option';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn ghost';
      closeBtn.textContent = 'x';
      closeBtn.addEventListener('click', closeOptionPicker);
      header.append(optionPickerTitleEl, closeBtn);
      const body = document.createElement('div');
      body.className = 'picker-body';
      optionPickerListEl = document.createElement('div');
      optionPickerListEl.className = 'picker-list schema-option-picker-list';
      body.appendChild(optionPickerListEl);
      const footer = document.createElement('div');
      footer.className = 'picker-footer';
      const footerLeft = document.createElement('div');
      footerLeft.className = 'picker-footer-left';
      optionPickerFilterEl = document.createElement('input');
      optionPickerFilterEl.type = 'text';
      optionPickerFilterEl.placeholder = 'filter (regex)...';
      optionPickerFilterEl.addEventListener('input', () => renderOptionPickerList());
      footerLeft.appendChild(optionPickerFilterEl);
      const footerRight = document.createElement('div');
      footerRight.className = 'picker-footer-right';
      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'btn ghost';
      dismissBtn.textContent = 'Close';
      dismissBtn.addEventListener('click', closeOptionPicker);
      footerRight.appendChild(dismissBtn);
      footer.append(footerLeft, footerRight);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeOptionPicker();
      });
      document.body.appendChild(overlay);
      optionPickerOverlay = overlay;
    };

    function renderOptionPickerList(): void {
      if (!optionPickerListEl || !optionPickerTarget) return;
      const listEl = optionPickerListEl;
      listEl.innerHTML = '';
      const rawFilter = optionPickerFilterEl?.value || '';
      let regex: RegExp | null = null;
      if (rawFilter.trim()) {
        try {
          regex = new RegExp(rawFilter, 'i');
        } catch {
          const invalid = document.createElement('div');
          invalid.className = 'picker-item';
          invalid.textContent = 'Invalid regex';
          listEl.appendChild(invalid);
          return;
        }
      }
      const items = optionPickerTarget.options.filter((option) => {
        if (!regex) return true;
        const target = `${option.label} ${option.value} ${selectOptionDetail(option)}`;
        return regex.test(target);
      });
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'picker-item';
        empty.textContent = 'No options matched';
        listEl.appendChild(empty);
        return;
      }
      items.forEach((option) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'picker-item schema-option-picker-item';
        if (option.value === optionPickerTarget?.input.value) {
          row.classList.add('selected');
        }
        const text = document.createElement('span');
        text.className = 'picker-item-text';
        const name = document.createElement('span');
        name.className = 'picker-item-name';
        name.textContent = option.label || option.value;
        const detail = document.createElement('span');
        detail.className = 'picker-item-path';
        detail.textContent = selectOptionDetail(option) || option.value;
        text.append(name, detail);
        row.appendChild(text);
        row.addEventListener('click', () => {
          if (!optionPickerTarget) return;
          selectOptionByValue(optionPickerTarget, option.value, optionPickerTarget.options, true);
          closeOptionPicker();
        });
        listEl.appendChild(row);
      });
    }

    const openOptionPicker = (control: SelectControl): void => {
      ensureOptionPicker();
      optionPickerTarget = control;
      if (optionPickerTitleEl) optionPickerTitleEl.textContent = control.field.label || control.field.id || 'Select Option';
      if (optionPickerFilterEl) optionPickerFilterEl.value = '';
      renderOptionPickerList();
      optionPickerOverlay?.classList.remove('hidden');
      setTimeout(() => optionPickerFilterEl?.focus(), 0);
    };

    const setSelectOptions = (control: SelectControl | undefined, options: SelectOption[] | string[] | undefined): void => {
      if (!control?.listDiv || !control?.input) return;
      control.options = (options || []).map(normalizeSelectControlOption).filter((option) => option.value);
      control.largePickerMode = control.options.length > 10;
      control.toggleBtn.textContent = control.largePickerMode ? 'Find' : '▾';
      control.toggleBtn.title = control.largePickerMode ? 'Search options' : '';
      control.listDiv.hidden = control.largePickerMode;
      if (control.largePickerMode) control.listDiv.classList.remove('open');
      control.listDiv.innerHTML = '';
      control.options.forEach((opt: SelectOption) => {
        const optValue = opt.value;
        const optLabel = opt.label || opt.value;
        if (!optValue) return;
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'dropdown-item';
        optBtn.textContent = optLabel;
        optBtn.addEventListener('click', () => {
          selectOptionByValue(control, optValue, control.options, true);
          const closeDropdownMenu = getHelper(ctx, 'closeDropdownMenu');
          if (typeof closeDropdownMenu === 'function') {
            closeDropdownMenu(control.listDiv);
          } else {
            control.listDiv.classList.remove('open');
          }
        });
        control.listDiv.appendChild(optBtn);
      });
    };

    const setSelectMessage = (control: SelectControl, message: string): void => {
      if (!control?.listDiv) return;
      control.largePickerMode = false;
      control.listDiv.hidden = false;
      control.toggleBtn.textContent = '▾';
      control.toggleBtn.title = '';
      control.listDiv.innerHTML = '';
      const messageRow = document.createElement('div');
      messageRow.className = 'picker-item';
      messageRow.textContent = message;
      control.listDiv.appendChild(messageRow);
    };

    const selectControlOptionFromItem = (item: unknown, action: JsonRecord = {}): SelectOption | null => {
      if (typeof item === 'string') {
        const value = item.trim();
        return value ? { value, label: value, raw: item } : null;
      }
      const valuePath = action.value_path || action.valuePath || action.id_path || action.idPath || ['value', 'id'];
      const labelPath = action.label_path || action.labelPath || action.name_path || action.namePath || ['label', 'name', 'value', 'id'];
      const value = trimString(firstPathValue(item, valuePath));
      if (!value) return null;
      const label = trimString(firstPathValue(item, labelPath)) || value;
      return { value, label, raw: item };
    };

    const upsertSelectOption = (control: SelectControl, item: unknown, action: JsonRecord = {}): SelectOption | null => {
      const option = selectControlOptionFromItem(item, action);
      if (!option) return null;
      const nextOptions = control.options.filter((candidate) => candidate.value !== option.value);
      nextOptions.push(option);
      setSelectOptions(control, nextOptions);
      if (isRecord(item)) {
        control.dynamicItems = control.dynamicItems.filter((candidate) => {
          const candidateValue = trimString(firstPathValue(candidate, ['value', 'id']));
          return candidateValue !== option.value;
        });
        control.dynamicItems.push(item);
      }
      return option;
    };

    const refreshSelectOptions = async (
      control: SelectControl,
      selectedValue = '',
      applyWriteBack = true,
    ): Promise<void> => {
      const field = control.field;
      if (field.dynamic_options_from) {
        syncDependentSelectOptions();
        if (selectedValue) {
          selectOptionByValue(control, selectedValue, control.options, applyWriteBack);
        }
        return;
      }
      const dynamicSource = typeof field.dynamic_source === 'string' ? field.dynamic_source : '';
      const sourceMethod = schemaFieldSourceMethod(field);
      if (!dynamicSource && !sourceMethod) return;
      if (hasMissingRequiredSourceDependency(field)) {
        setSelectOptions(control, []);
        control.input.value = '';
        control.selectedOption = undefined;
        control.input.placeholder = field.placeholder || 'Select dependency first';
        return;
      }
      const selectedAgent = schemaExtensionId || settingsAgentEl?.value?.trim() || '';
      const conversationId = stringValue(getCodexAgentState().conversationMeta?.conversation_id);
      const runtimeOptionsSource = isRuntimeOptionsSource(dynamicSource);
      const extensionModelsSource = Boolean(extensionIdFromApiPath(dynamicSource, 'models'));
      const extensionSessionsSource = Boolean(extensionIdFromApiPath(dynamicSource, 'sessions'));
      const schemaInteractionSource = sourceMethod === 'extension.schemaInteraction.run';
      if (!runtimeOptionsSource && !extensionModelsSource && !extensionSessionsSource && !schemaInteractionSource && sourceMethod !== 'extension.models.list') {
        const errorMessage = `Unsupported dynamic source: ${field.dynamic_source}`;
        control.input.title = errorMessage;
        setSelectMessage(control, 'Unable to load options');
        throw new Error(errorMessage);
      }
      const data = await fetchDynamicSource(dynamicSource, {
        conversationId,
        agent: selectedAgent,
        sourceMethod,
        sourceAction: schemaFieldSourceAction(field),
        interactionId: field.id,
        extraParams: buildSourceParams(field),
        values: collectSchemaValues(false),
        settings: asRecord(getCodexAgentState().conversationSettings),
      });
      const { items, options, current, defaultValue } = normalizeDynamicSelectOptions(field, data);
      control.dynamicItems = items;
      control.input.removeAttribute('title');
      setSelectOptions(control, options);
      const nextValue = selectedValue || control.input.value || current || defaultValue;
      if (nextValue) {
        selectOptionByValue(control, nextValue, control.options, applyWriteBack, false);
      }
      if (field.id === 'model') {
        modelItems = items;
        syncModelDependentFields();
      } else {
        syncDependentSelectOptions(field.id);
        syncConditionalState();
      }
    };

    function refreshSourceDependentSelects(changedFieldId = ''): void {
      if (!changedFieldId) return;
      Object.values(selectControls).forEach((control) => {
        if (control.field.dynamic_options_from) return;
        if (!sourceRefreshDependencies(control.field).includes(changedFieldId)) return;
        if (!control.field.dynamic_source && !schemaFieldSourceMethod(control.field)) return;
        control.input.value = '';
        control.selectedOption = undefined;
        if (!hasMissingRequiredSourceDependency(control.field)) {
          setSelectMessage(control, 'Loading...');
        }
        void refreshSelectOptions(control, '', true).catch((error) => {
          console.error('[schema] dependent dynamic source refresh failed', error);
          const message = dynamicSourceErrorMessage(error);
          control.input.title = message;
          control.input.placeholder = 'Unable to load options';
          setSelectMessage(control, 'Unable to load options');
        });
      });
    }

    const resetModelGatedInput = (input: SchemaInput, type: string | undefined): void => {
      if (type === 'checkbox') {
        if (input instanceof HTMLInputElement) input.checked = false;
        return;
      }
      input.value = '';
    };

    const syncDependentSelectOptions = (changedFieldId = ''): void => {
      Object.values(selectControls).forEach((control) => {
        const dynamicOptions = asRecord(control.field.dynamic_options_from);
        const sourceField = trimString(dynamicOptions.source_field);
        if (!sourceField) return;
        if (changedFieldId && sourceField !== changedFieldId) return;
        if (!selectedDependencyValue(control.field)) {
          setSelectOptions(control, []);
          if (!changedFieldId && control.input.value) {
            control.selectedOption = undefined;
            control.input.placeholder = trimString(dynamicOptions.missing_source_placeholder)
              || control.field.placeholder
              || 'Select source first';
            return;
          }
          control.input.value = '';
          control.selectedOption = undefined;
          control.input.placeholder = trimString(dynamicOptions.missing_source_placeholder)
            || control.field.placeholder
            || 'Select source first';
          return;
        }

        const { options, defaultValue } = optionsFromDependentSource(control.field);
        setSelectOptions(control, options);
        if (!options.length) {
          if (!changedFieldId && control.input.value) {
            control.selectedOption = undefined;
            control.input.placeholder = trimString(dynamicOptions.empty_placeholder)
              || control.field.placeholder
              || 'No options available';
            return;
          }
          control.input.value = '';
          control.selectedOption = undefined;
          control.input.placeholder = trimString(dynamicOptions.empty_placeholder)
            || control.field.placeholder
            || 'No options available';
          return;
        }

        control.input.placeholder = control.field.placeholder || '';
        const currentValue = control.input.value;
        if (currentValue && selectOptionByValue(control, currentValue, options, false, false)) {
          return;
        }
        if (currentValue) {
          control.selectedOption = undefined;
          return;
        }

        const nextValue = defaultValue && options.some((option) => option.value === defaultValue)
          ? defaultValue
          : '';
        if (nextValue) {
          selectOptionByValue(control, nextValue, options, true, false);
        } else {
          control.input.value = '';
          control.selectedOption = undefined;
        }
      });
    };

    const syncModelGatedFields = (): void => {
      const modelControl = selectControls.model;
      if (!modelControl?.input) return;
      const selectedModelId = modelControl.input.value || '';
      Object.values(currentSchemaValues).forEach((entry) => {
        const modelGate = entry?.field?.model_gate;
        if (!isRecord(modelGate) || !entry?.input) return;
        const input = entry.input;
        const fieldElement = input.closest('[data-schema-field-id]') as HTMLElement | null;
        const label = fieldElement || input.closest('label') as HTMLElement | null;
        const enabled = modelMatchesGate(selectedModelId, modelGate);
        const gateLabel = typeof modelGate.label === 'string' && modelGate.label.trim()
          ? modelGate.label.trim()
          : 'a supported model';
        const hint = enabled ? '' : `Available only when Model is ${gateLabel}`;
        if (!enabled) {
          resetModelGatedInput(input, entry.type);
        }
        if (label) {
          setFieldDisabledReason(label, input, 'model', !enabled, hint);
        }
      });
    };

    const syncModelDependentFields = (): void => {
      syncDependentSelectOptions();
      syncModelGatedFields();
      syncConditionalState();
    };

    const schemaActionFieldId = (action: JsonRecord): string => {
      return trimString(action.field || action.field_id || action.fieldId || action.target || action.target_field || action.targetField);
    };

    const actionItem = (action: JsonRecord, payload: unknown): unknown => {
      const itemPath = action.item_path || action.itemPath || action.path;
      return itemPath ? firstPathValue(payload, itemPath) : payload;
    };

    const actionValue = (action: JsonRecord, payload: unknown): unknown => {
      if (Object.prototype.hasOwnProperty.call(action, 'value')) return action.value;
      const valuePath = action.value_path || action.valuePath;
      if (valuePath) return firstPathValue(payload, valuePath);
      return undefined;
    };

    const schemaFieldElement = (fieldId: string): HTMLElement | null => {
      if (!settingsExtensionFields) return null;
      const nodes = settingsExtensionFields.querySelectorAll('[data-schema-field-id]');
      for (const node of Array.from(nodes)) {
        if (node instanceof HTMLElement && node.dataset.schemaFieldId === fieldId) {
          return node;
        }
      }
      return null;
    };

    const setSchemaFieldOpen = (fieldId: string, open: boolean): void => {
      const element = schemaFieldElement(fieldId);
      if (element instanceof HTMLDetailsElement) {
        element.open = open;
        return;
      }
      const details = element?.closest('details');
      if (details instanceof HTMLDetailsElement) {
        details.open = open;
      }
    };

    const openSchemaActionUrl = async (action: JsonRecord, payload: unknown): Promise<void> => {
      const directUrl = trimString(action.url || action.href);
      const urlPath = action.url_path || action.urlPath || action.href_path || action.hrefPath;
      const url = directUrl || trimString(urlPath ? firstPathValue(payload, urlPath) : firstPathValue(payload, ['open_url', 'openUrl', 'url']));
      if (!url) return;
      const uiRpc = requireUiRpc();
      if (typeof uiRpc.openUrl !== 'function') {
        throw new Error('URL open RPC is unavailable');
      }
      const result = await uiRpc.openUrl({
        url,
        source: trimString(action.source) || 'settings-schema',
        conversation_id: trimString(getCodexAgentState().conversationMeta?.conversation_id) || null,
      });
      if (isRecord(result) && result.ok === false) {
        throw new Error(dynamicSourceErrorMessage(result));
      }
    };

    const applySchemaInteractionAction = async (
      interactionField: SchemaField,
      rawAction: unknown,
      payload: unknown,
    ): Promise<void> => {
      const action = asRecord(rawAction);
      const actionType = trimString(action.type || action.action).toLowerCase();
      if (!actionType) return;
      const fieldId = schemaActionFieldId(action);
      if (actionType === 'refresh_options' || actionType === 'refresh-options') {
        const control = selectControls[fieldId];
        if (!control) throw new Error(`No select field found for ${fieldId || '(missing field)'}`);
        const selectedValue = trimString(actionValue(action, payload));
        await refreshSelectOptions(control, selectedValue, action.apply_write_back !== false && action.applyWriteBack !== false);
        return;
      }
      if (actionType === 'upsert_option' || actionType === 'upsert-option') {
        const control = selectControls[fieldId];
        if (!control) throw new Error(`No select field found for ${fieldId || '(missing field)'}`);
        const option = upsertSelectOption(control, actionItem(action, payload), action);
        if (!option) throw new Error(`Unable to build option for ${fieldId}`);
        syncConditionalState();
        return;
      }
      if (actionType === 'select_option' || actionType === 'select-option') {
        const control = selectControls[fieldId];
        if (!control) throw new Error(`No select field found for ${fieldId || '(missing field)'}`);
        let value = trimString(actionValue(action, payload));
        if (!value) {
          const option = selectControlOptionFromItem(actionItem(action, payload), action);
          value = option?.value || '';
          if (option && !control.options.some((candidate) => candidate.value === option.value)) {
            upsertSelectOption(control, actionItem(action, payload), action);
          }
        }
        if (!value || !selectOptionByValue(control, value, control.options, action.apply_write_back !== false && action.applyWriteBack !== false)) {
          throw new Error(`Unable to select option ${value || '(empty)'} for ${fieldId}`);
        }
        return;
      }
      if (actionType === 'write_back' || actionType === 'write-back' || actionType === 'apply_write_back' || actionType === 'apply-write-back') {
        const ownerField = fieldId ? schemaFieldById(fieldId) : interactionField;
        if (!ownerField) throw new Error(`No schema field found for ${fieldId || '(interaction)'}`);
        const item = actionItem(action, payload);
        const writeBack = asRecord(action.write_back || action.writeBack);
        const rules = Array.isArray(action.rules) ? action.rules
          : (Array.isArray(writeBack.on_select) ? writeBack.on_select : null);
        if (rules) {
          applyWriteBackRules(rules, item);
          syncConditionalState();
        } else {
          applyFieldWriteBack(ownerField, item);
        }
        return;
      }
      if (actionType === 'collapse' || actionType === 'close') {
        if (fieldId) setSchemaFieldOpen(fieldId, false);
        return;
      }
      if (actionType === 'open' || actionType === 'expand') {
        if (fieldId) setSchemaFieldOpen(fieldId, true);
        return;
      }
      if (actionType === 'mark_dirty' || actionType === 'mark-dirty') {
        markSchemaDirty();
        return;
      }
      if (actionType === 'open_url' || actionType === 'open-url' || actionType === 'url.open') {
        await openSchemaActionUrl(action, payload);
      }
    };

    const interactionResultActions = (payload: unknown): unknown[] => {
      const payloadMap = asRecord(payload);
      const actions = Array.isArray(payloadMap.actions) ? payloadMap.actions : [];
      const openUrl = payloadMap.open_url || payloadMap.openUrl;
      if (openUrl) {
        return [...actions, isRecord(openUrl) ? { type: 'open_url', ...openUrl } : { type: 'open_url', url: openUrl }];
      }
      return actions;
    };

    const applyInteractionResultActions = async (field: SchemaField, payload: unknown): Promise<void> => {
      const payloadMap = asRecord(payload);
      if (payloadMap.ok === false) return;
      for (const action of interactionResultActions(payload)) {
        await applySchemaInteractionAction(field, action, payload);
      }
    };

    const providerAuthAction = (field: SchemaField, name: string, fallback: string): string => {
      const source = schemaFieldSourceConfig(field);
      const actions = asRecord(source.actions);
      return trimString(actions[name])
        || trimString(source[`${name}_action`])
        || trimString(source[`${name}Action`])
        || fallback;
    };

    const providerAuthItems = (payload: unknown): JsonRecord[] => {
      const rawItems = firstPathValue(payload, ['items', 'providers', 'auth_providers', 'authProviders']);
      return Array.isArray(rawItems) ? rawItems.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
    };

    const providerAuthMethods = (provider: JsonRecord): JsonRecord[] => {
      const rawMethods = firstPathValue(provider, ['auth_methods', 'authMethods', 'methods']);
      return Array.isArray(rawMethods) ? rawMethods.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
    };

    const providerAuthPrompts = (method: JsonRecord): JsonRecord[] => {
      const rawPrompts = method.prompts || method.inputs || method.fields;
      const prompts = Array.isArray(rawPrompts) ? rawPrompts.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
      const methodType = trimString(method.type || method.kind).toLowerCase();
      if (!prompts.length && (methodType === 'api' || methodType === 'api_key' || methodType === 'api-key')) {
        return [{
          id: 'api_key',
          type: 'secret',
          label: 'API Key',
          required: true,
          persist: false,
        }];
      }
      return prompts;
    };

    const runProviderAuthAction = async (
      field: SchemaField,
      action: string,
      params: JsonRecord,
    ): Promise<JsonRecord> => {
      const settingsRpc = requireSettingsRpc();
      if (typeof settingsRpc.runSchemaInteraction !== 'function') {
        throw new Error('Schema interaction RPC is unavailable');
      }
      const result = await settingsRpc.runSchemaInteraction({
        extensionId: schemaExtensionId || settingsAgentEl?.value?.trim() || '',
        interactionId: field.id,
        action,
        inputs: {},
        values: collectSchemaValues(false),
        params,
        conversationId: trimString(getCodexAgentState().conversationMeta?.conversation_id) || null,
        settings: asRecord(getCodexAgentState().conversationSettings),
      });
      return asRecord(result);
    };

    const renderProviderAuthPrompt = (
      prompt: JsonRecord,
      values: JsonRecord,
    ): HTMLElement => {
      const promptId = trimString(prompt.id || prompt.name || prompt.key);
      const promptType = interactionInputType(prompt);
      const wrapper = document.createElement('label');
      wrapper.className = 'settings-schema-interaction-input';
      const labelText = document.createElement('span');
      labelText.className = 'settings-schema-interaction-input-label';
      labelText.textContent = trimString(prompt.label || prompt.title || promptId) || 'Input';
      wrapper.appendChild(labelText);
      let input: SchemaInput;
      if (promptType === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.rows = Number.isFinite(prompt.rows) ? Number(prompt.rows) : 3;
        input = textarea;
      } else {
        const inputEl = document.createElement('input');
        inputEl.type = promptType === 'checkbox' ? 'checkbox' : promptType;
        if (promptType === 'checkbox' && prompt.default === true) inputEl.checked = true;
        input = inputEl;
      }
      input.placeholder = trimString(prompt.placeholder);
      if (promptType !== 'checkbox') input.value = prompt.default == null ? '' : String(prompt.default);
      if (promptType === 'password') {
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
      }
      input.addEventListener('input', () => {
        if (promptId) values[promptId] = interactionInputValue(input, promptType, prompt);
      });
      input.addEventListener('change', () => {
        if (promptId) values[promptId] = interactionInputValue(input, promptType, prompt);
      });
      if (promptId) values[promptId] = interactionInputValue(input, promptType, prompt);
      wrapper.appendChild(input);
      return wrapper;
    };

    const openProviderAuthModal = (field: SchemaField, outputEl: HTMLElement): void => {
      const overlay = document.createElement('div');
      overlay.className = 'settings-overlay schema-provider-auth-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'settings-dialog schema-provider-auth-dialog';
      const header = document.createElement('div');
      header.className = 'settings-header';
      const title = document.createElement('h3');
      title.textContent = field.label || 'Connect Provider';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn ghost';
      closeBtn.textContent = 'x';
      header.append(title, closeBtn);
      const body = document.createElement('div');
      body.className = 'settings-body schema-provider-auth-body';
      const footer = document.createElement('div');
      footer.className = 'settings-footer';
      const status = document.createElement('div');
      status.className = 'settings-schema-info-detail';
      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'btn ghost';
      dismissBtn.textContent = 'Close';
      footer.append(status, dismissBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const close = (): void => overlay.remove();
      closeBtn.addEventListener('click', close);
      dismissBtn.addEventListener('click', close);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
      });

      const setStatus = (message: string, tone = ''): void => {
        status.textContent = message;
        status.dataset.tone = tone;
      };

      const renderResult = async (payload: JsonRecord): Promise<void> => {
        outputEl.innerHTML = '';
        renderInteractionOutput(field, outputEl, payload);
        await applyInteractionResultActions(field, payload);
        const flowId = trimString(payload.auth_flow_id || payload.authFlowId || payload.flow_id || payload.flowId);
        const callbackMode = trimString(payload.callback_mode || payload.callbackMode).toLowerCase();
        const sourceParams = buildSourceParams(field);
        const statusAction = providerAuthAction(field, 'status', 'provider.auth.status');
        const completeAction = providerAuthAction(field, 'complete', 'provider.auth.complete');
        if (!flowId) return;
        const followup = document.createElement('div');
        followup.className = 'settings-schema-interaction';
        if (callbackMode === 'code' || payload.requires_code === true || payload.requiresCode === true) {
          const codeValues: JsonRecord = {};
          const codePrompt = renderProviderAuthPrompt({
            id: 'code',
            type: 'text',
            label: 'Code',
            placeholder: 'Paste authorization code',
          }, codeValues);
          followup.appendChild(codePrompt);
          const completeBtn = document.createElement('button');
          completeBtn.type = 'button';
          completeBtn.className = 'btn primary';
          completeBtn.textContent = 'Complete';
          completeBtn.addEventListener('click', () => {
            void runProviderAuthAction(field, completeAction, {
              ...sourceParams,
              auth_flow_id: flowId,
              code: codeValues.code || '',
            }).then(renderResult).catch((error) => setStatus(dynamicSourceErrorMessage(error), 'error'));
          });
          followup.appendChild(completeBtn);
        }
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.className = 'btn ghost';
        statusBtn.textContent = 'Check Status';
        statusBtn.addEventListener('click', () => {
          void runProviderAuthAction(field, statusAction, {
            ...sourceParams,
            auth_flow_id: flowId,
          }).then(renderResult).catch((error) => setStatus(dynamicSourceErrorMessage(error), 'error'));
        });
        followup.appendChild(statusBtn);
        body.appendChild(followup);
      };

      const renderMethod = (provider: JsonRecord, method: JsonRecord): void => {
        body.innerHTML = '';
        const providerId = trimString(provider.id || provider.value || provider.provider);
        const methodId = trimString(method.id || method.value || method.name || method.type);
        const methodType = trimString(method.type || method.kind).toLowerCase();
        const heading = document.createElement('div');
        heading.className = 'settings-schema-info';
        const headingText = document.createElement('div');
        headingText.className = 'settings-schema-info-text';
        headingText.textContent = `${trimString(provider.label || provider.name || providerId) || providerId} / ${trimString(method.label || method.name || methodId) || methodId}`;
        heading.appendChild(headingText);
        body.appendChild(heading);
        const promptValues: JsonRecord = {};
        const promptsEl = document.createElement('div');
        promptsEl.className = 'settings-schema-interaction-inputs';
        providerAuthPrompts(method).forEach((prompt) => {
          promptsEl.appendChild(renderProviderAuthPrompt(prompt, promptValues));
        });
        body.appendChild(promptsEl);
        const row = document.createElement('div');
        row.className = 'settings-schema-interaction-row';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'btn ghost';
        backBtn.textContent = 'Back';
        backBtn.addEventListener('click', () => renderProviders([provider]));
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button';
        submitBtn.className = 'btn primary';
        submitBtn.textContent = methodType === 'oauth' ? 'Authorize' : 'Connect';
        submitBtn.addEventListener('click', () => {
          setStatus('Connecting...');
          const params = {
            ...buildSourceParams(field),
            provider_id: providerId,
            method_id: methodId,
            method_type: methodType,
            inputs: promptValues,
          };
          void runProviderAuthAction(field, providerAuthAction(field, 'start', 'provider.auth.start'), params)
            .then((payload) => {
              setStatus(payload.ok === false ? dynamicSourceErrorMessage(payload) : 'Provider response received.', payload.ok === false ? 'error' : '');
              return renderResult(payload);
            })
            .catch((error) => setStatus(dynamicSourceErrorMessage(error), 'error'));
        });
        row.append(backBtn, submitBtn);
        body.appendChild(row);
      };

      function renderProviders(items: JsonRecord[]): void {
        body.innerHTML = '';
        if (!items.length) {
          const empty = document.createElement('div');
          empty.className = 'settings-schema-info';
          const text = document.createElement('div');
          text.className = 'settings-schema-info-text';
          text.textContent = 'No provider auth methods available.';
          empty.appendChild(text);
          body.appendChild(empty);
          return;
        }
        items.forEach((provider) => {
          const providerId = trimString(provider.id || provider.value || provider.provider);
          const providerLabel = trimString(provider.label || provider.name || provider.displayName || providerId) || providerId;
          const methods = providerAuthMethods(provider);
          const providerBtn = document.createElement('button');
          providerBtn.type = 'button';
          providerBtn.className = 'settings-schema-interaction-result';
          const label = document.createElement('span');
          label.className = 'settings-schema-interaction-result-label';
          label.textContent = providerLabel;
          const detail = document.createElement('span');
          detail.className = 'settings-schema-interaction-result-detail';
          detail.textContent = trimString(provider.description || provider.detail)
            || `${methods.length || 1} auth method${methods.length === 1 ? '' : 's'}`;
          providerBtn.append(label, detail);
          providerBtn.addEventListener('click', () => {
            if (methods.length <= 1) {
              renderMethod(provider, methods[0] || { id: 'api_key', type: 'api_key', label: 'API Key' });
              return;
            }
            body.innerHTML = '';
            methods.forEach((method) => {
              const methodBtn = document.createElement('button');
              methodBtn.type = 'button';
              methodBtn.className = 'settings-schema-interaction-result';
              const methodLabel = document.createElement('span');
              methodLabel.className = 'settings-schema-interaction-result-label';
              methodLabel.textContent = trimString(method.label || method.name || method.id || method.type) || 'Auth Method';
              const methodDetail = document.createElement('span');
              methodDetail.className = 'settings-schema-interaction-result-detail';
              methodDetail.textContent = trimString(method.description || method.detail || method.type);
              methodBtn.append(methodLabel, methodDetail);
              methodBtn.addEventListener('click', () => renderMethod(provider, method));
              body.appendChild(methodBtn);
            });
          });
          body.appendChild(providerBtn);
        });
      }

      setStatus('Loading providers...');
      void runProviderAuthAction(field, providerAuthAction(field, 'list', schemaFieldSourceAction(field) || 'provider.auth.methods'), buildSourceParams(field))
        .then((payload) => {
          setStatus('');
          renderProviders(providerAuthItems(payload));
        })
        .catch((error) => {
          setStatus(dynamicSourceErrorMessage(error), 'error');
          renderProviders([]);
        });
    };
    
    const renderField = (field: SchemaField, container: HTMLElement): void => {
      currentSchemaFields[field.id] = field;

      if (field.type === 'provider_auth') {
        const authBlock = document.createElement('div');
        authBlock.className = 'settings-schema-action settings-schema-provider-auth';
        authBlock.dataset.schemaFieldId = field.id;
        const labelEl = document.createElement('div');
        labelEl.className = 'settings-schema-action-label';
        labelEl.textContent = field.label || 'Connect Provider';
        authBlock.appendChild(labelEl);
        if (field.description || field.detail) {
          const detail = document.createElement('div');
          detail.className = 'settings-schema-info-detail';
          detail.textContent = field.description || field.detail || '';
          authBlock.appendChild(detail);
        }
        const actionRow = document.createElement('div');
        actionRow.className = 'settings-schema-interaction-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost';
        const trigger = asRecord(field.trigger);
        button.textContent = trimString(trigger.label) || 'Connect';
        actionRow.appendChild(button);
        authBlock.appendChild(actionRow);
        const outputEl = document.createElement('div');
        outputEl.className = 'settings-schema-interaction-output';
        authBlock.appendChild(outputEl);
        button.addEventListener('click', () => openProviderAuthModal(field, outputEl));
        conditionalRows.push({ field, element: authBlock, input: null });
        container.appendChild(authBlock);
        return;
      }

      if (field.type === 'interaction') {
        const source = schemaInteractionSource(field);
        const inputSpecs = schemaInteractionInputSpecs(field);
        const trigger = asRecord(field.trigger);
        const interaction = document.createElement('div');
        interaction.className = 'settings-schema-interaction';
        interaction.dataset.schemaFieldId = field.id;

        const header = document.createElement('div');
        header.className = 'settings-schema-interaction-header';
        const title = document.createElement('div');
        title.className = 'settings-schema-action-label';
        title.textContent = field.label || field.id || 'Lookup';
        header.appendChild(title);
        if (field.description || field.detail) {
          const detail = document.createElement('div');
          detail.className = 'settings-schema-info-detail';
          detail.textContent = field.description || field.detail || '';
          header.appendChild(detail);
        }
        interaction.appendChild(header);

        const inputsEl = document.createElement('div');
        inputsEl.className = 'settings-schema-interaction-inputs';
        const interactionInputs: Array<{ id: string; input: SchemaInput; type: string; spec: JsonRecord }> = [];
        inputSpecs.forEach((inputSpec, index) => {
          const inputId = interactionInputId(inputSpec, index);
          const inputType = interactionInputType(inputSpec);
          const wrapper = document.createElement('label');
          wrapper.className = 'settings-schema-interaction-input';
          const inputLabel = trimString(inputSpec.label || inputSpec.title);
          if (inputLabel) {
            const labelText = document.createElement('span');
            labelText.className = 'settings-schema-interaction-input-label';
            labelText.textContent = inputLabel;
            wrapper.appendChild(labelText);
          }
          let input: SchemaInput;
          if (inputType === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.rows = Number.isFinite(inputSpec.rows) ? Number(inputSpec.rows) : 3;
            input = textarea;
          } else {
            const inputEl = document.createElement('input');
            inputEl.type = inputType === 'checkbox' ? 'checkbox' : inputType;
            if (inputType === 'checkbox' && inputSpec.default === true) {
              inputEl.checked = true;
            }
            input = inputEl;
          }
          input.placeholder = trimString(inputSpec.placeholder) || (index === 0 ? field.placeholder || '' : '');
          if (inputType !== 'checkbox') {
            input.value = inputSpec.default == null ? '' : String(inputSpec.default);
          }
          if (inputType === 'password') {
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('spellcheck', 'false');
          }
          input.id = `settings-ext-${field.id}-${inputId}`;
          wrapper.appendChild(input);
          inputsEl.appendChild(wrapper);
          interactionInputs.push({ id: inputId, input, type: inputType, spec: inputSpec });
        });
        interaction.appendChild(inputsEl);

        const row = document.createElement('div');
        row.className = 'settings-schema-interaction-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost';
        button.textContent = trimString(trigger.label) || 'Search';
        row.appendChild(button);
        interaction.appendChild(row);

        const outputEl = document.createElement('div');
        outputEl.className = 'settings-schema-interaction-output';
        interaction.appendChild(outputEl);

        let requestSeq = 0;
        const setInteractionMessage = (message: string, tone = ''): void => {
          outputEl.innerHTML = '';
          const info = document.createElement('div');
          info.className = 'settings-schema-info';
          if (tone) info.dataset.tone = tone;
          const text = document.createElement('div');
          text.className = 'settings-schema-info-text';
          text.textContent = message;
          info.appendChild(text);
          outputEl.appendChild(info);
        };

        const runInteraction = async (): Promise<void> => {
          const minLength = Number.isFinite(trigger.min_length)
            ? Number(trigger.min_length)
            : Number(trigger.minLength);
          const primaryInput = interactionInputs[0]?.input;
          const primaryInputLength = primaryInput ? primaryInput.value.trim().length : 0;
          if (Number.isFinite(minLength) && primaryInputLength < minLength) {
            setInteractionMessage(`Enter at least ${minLength} characters.`, 'warning');
            return;
          }
          const settingsRpc = requireSettingsRpc();
          if (typeof settingsRpc.runSchemaInteraction !== 'function') {
            setInteractionMessage('Schema interaction RPC is unavailable.', 'error');
            return;
          }
          const seq = requestSeq + 1;
          requestSeq = seq;
          button.disabled = true;
          interactionInputs.forEach((entry) => { entry.input.disabled = true; });
          setInteractionMessage('Loading...');
          const inputs: JsonRecord = Object.fromEntries(
            interactionInputs.map((entry) => [
              entry.id,
              interactionInputValue(entry.input, entry.type, entry.spec),
            ]),
          );
          const values = collectSchemaValues(false);
          const mappedParams = buildInteractionParams(field, inputs);
          const params = Object.keys(mappedParams).length ? mappedParams : { ...inputs };
          try {
            const result = await settingsRpc.runSchemaInteraction({
              extensionId: schemaExtensionId || settingsAgentEl?.value?.trim() || '',
              interactionId: field.id,
              action: trimString(source.action),
              inputs,
              values,
              params,
              conversationId: trimString(getCodexAgentState().conversationMeta?.conversation_id) || null,
              settings: asRecord(getCodexAgentState().conversationSettings),
            });
            if (seq !== requestSeq) return;
            renderInteractionOutput(field, outputEl, result);
            await applyInteractionResultActions(field, result);
          } catch (error) {
            if (seq !== requestSeq) return;
            setInteractionMessage(dynamicSourceErrorMessage(error), 'error');
          } finally {
            if (seq === requestSeq) {
              button.disabled = false;
              interactionInputs.forEach((entry) => { entry.input.disabled = false; });
            }
          }
        };

        button.addEventListener('click', () => {
          void runInteraction();
        });
        interactionInputs.forEach((entry) => {
          entry.input.addEventListener('keydown', (event) => {
            const keyEvent = event as KeyboardEvent;
            if (keyEvent.key === 'Enter' && entry.type !== 'textarea') {
              event.preventDefault();
              void runInteraction();
            }
            if (keyEvent.key === 'Enter' && keyEvent.ctrlKey && entry.type === 'textarea') {
              event.preventDefault();
              void runInteraction();
            }
          });
        });

        conditionalRows.push({ field, element: interaction, input: null });
        container.appendChild(interaction);
        return;
      }

      if (isSchemaSubmenuField(field)) {
        const details = document.createElement('details');
        details.className = 'settings-schema-submenu';
        details.dataset.schemaFieldId = field.id;
        if (field.default_open || field.initial_open) {
          details.open = true;
        }

        const summary = document.createElement('summary');
        summary.className = 'settings-schema-submenu-summary';

        const summaryText = document.createElement('span');
        summaryText.className = 'settings-schema-submenu-title';
        summaryText.textContent = field.label || field.id || 'Settings';
        summary.appendChild(summaryText);

        if (field.description || field.detail) {
          const summaryDetail = document.createElement('span');
          summaryDetail.className = 'settings-schema-submenu-detail';
          summaryDetail.textContent = field.description || field.detail || '';
          summary.appendChild(summaryDetail);
        }

        const body = document.createElement('div');
        body.className = 'settings-schema-submenu-body';

        const setSubmenuMessage = (message: string, tone = ''): void => {
          body.innerHTML = '';
          const info = document.createElement('div');
          info.className = 'settings-schema-info';
          if (tone) info.dataset.tone = tone;
          const text = document.createElement('div');
          text.className = 'settings-schema-info-text';
          text.textContent = message;
          info.appendChild(text);
          body.appendChild(info);
        };

        let fragmentLoaded = false;
        let fragmentLoading = false;
        const loadSchemaFragment = async (): Promise<void> => {
          if (fragmentLoaded || fragmentLoading) return;
          const target = schemaFragmentTarget(field);
          if (!target) return;
          fragmentLoading = true;
          setSubmenuMessage('Loading...');
          try {
            const settingsRpc = requireSettingsRpc();
            if (typeof settingsRpc.getExtensionSettingsSchemaFragment !== 'function') {
              throw new Error('Schema fragment RPC is unavailable');
            }
            const fragment = normalizeSchema(await settingsRpc.getExtensionSettingsSchemaFragment({
              extensionId: schemaExtensionId || settingsAgentEl?.value?.trim() || '',
              target,
            }));
            body.innerHTML = '';
            if (!fragment?.fields?.length) {
              setSubmenuMessage('No settings available.');
            } else {
              renderFieldList(fragment.fields, body);
            }
            fragmentLoaded = true;
            syncModelDependentFields();
          } catch (error) {
            setSubmenuMessage(dynamicSourceErrorMessage(error), 'error');
          } finally {
            fragmentLoading = false;
          }
        };

        if (field.fields?.length) {
          renderFieldList(field.fields, body);
          fragmentLoaded = true;
        } else if (schemaFragmentTarget(field)) {
          if (details.open) {
            void loadSchemaFragment();
          } else {
            setSubmenuMessage('Open to load settings.');
          }
          details.addEventListener('toggle', () => {
            if (details.open) void loadSchemaFragment();
          });
        } else {
          setSubmenuMessage('No settings available.');
        }

        details.append(summary, body);
        conditionalRows.push({ field, element: details, input: null });
        container.appendChild(details);
        return;
      }

      if (field.type === 'section') {
        const section = document.createElement('div');
        section.className = 'settings-schema-section';
        section.dataset.schemaFieldId = field.id;

        const title = document.createElement('div');
        title.className = 'settings-schema-section-title';
        title.textContent = field.label || field.id || 'Section';
        section.appendChild(title);

        if (typeof field.description === 'string' && field.description.trim()) {
          const description = document.createElement('div');
          description.className = 'settings-schema-section-description';
          description.textContent = field.description.trim();
          section.appendChild(description);
        }

        conditionalRows.push({ field, element: section, input: null });
        container.appendChild(section);
        return;
      }

      if (field.type === 'info') {
        if (isProviderInfoField(field)) {
          const info = renderProviderInfo(field, getProviderInfoPromise(), schemaExtensionId);
          info.dataset.schemaFieldId = field.id;
          conditionalRows.push({ field, element: info, input: null });
          container.appendChild(info);
          return;
        }

        const info = document.createElement('div');
        info.className = 'settings-schema-info';
        info.dataset.schemaFieldId = field.id;
        if (typeof field.tone === 'string' && field.tone.trim()) {
          info.dataset.tone = field.tone.trim();
        }

        const infoLabel = document.createElement('div');
        infoLabel.className = 'settings-schema-info-label';
        infoLabel.textContent = field.label || field.id || 'Information';
        info.appendChild(infoLabel);

        const infoText = document.createElement('div');
        infoText.className = 'settings-schema-info-text';
        infoText.textContent = typeof field.text === 'string' && field.text.trim()
          ? field.text.trim()
          : 'Information unavailable.';
        info.appendChild(infoText);

        if (typeof field.detail === 'string' && field.detail.trim()) {
          const infoDetail = document.createElement('div');
          infoDetail.className = 'settings-schema-info-detail';
          infoDetail.textContent = field.detail.trim();
          info.appendChild(infoDetail);
        }

        conditionalRows.push({ field, element: info, input: null });
        container.appendChild(info);
        return;
      }

      if (field.type === 'live_session_info') {
        const info = renderLiveSessionInfo(field, schemaExtensionId);
        info.dataset.schemaFieldId = field.id;
        conditionalRows.push({ field, element: info, input: null });
        container.appendChild(info);
        return;
      }

      if (field.type === 'action') {
        if (isConversationForkField(field)) {
          const action = renderConversationForkAction(field, schemaExtensionId);
          action.dataset.schemaFieldId = field.id;
          conditionalRows.push({ field, element: action, input: null });
          container.appendChild(action);
        }
        return;
      }

      const label = document.createElement('label');
      label.dataset.schemaFieldId = field.id;
      const span = document.createElement('span');
      span.textContent = field.label || field.id;
      label.appendChild(span);
      
      let input: SchemaInput | null = null;
      const value = getFieldValue(field, values);
      
      switch (field.type) {
        case 'path':
          // Path field with optional browse button
          const pathDiv = document.createElement('div');
          pathDiv.className = 'settings-row';
          
          input = document.createElement('input');
          const pathInput = input;
          pathInput.type = 'text';
          pathInput.id = `settings-ext-${field.id}`;
          pathInput.placeholder = field.placeholder || '';
          pathInput.value = String(value ?? '');
          pathDiv.appendChild(pathInput);
          
          if (field.browse) {
            const browseBtn = document.createElement('button');
            browseBtn.type = 'button';
            browseBtn.className = 'btn ghost';
            browseBtn.textContent = 'Browse';
            browseBtn.addEventListener('click', () => {
              // Use the existing picker if available
              const openPicker = getHelper(ctx, 'openPicker');
              if (typeof openPicker === 'function') {
                openPicker(pathInput.value || '~', 'cwd', { input: pathInput });
              }
            });
            pathDiv.appendChild(browseBtn);
          }
          
          label.appendChild(pathDiv);
          break;

        case 'session_picker':
          // Session picker: only shown for NEW conversations (no thread_id yet).
          // Once a conversation is bound to a session, this field disappears.
          const state = getCodexAgentState();
          const hasThread = !state.pendingNewConversation && Boolean(state.conversationMeta?.thread_id);
          if (hasThread) return; // Already bound — hide picker

          const sessionDiv = document.createElement('div');
          sessionDiv.className = 'settings-row';
          
          input = document.createElement('input');
          const sessionInput = input;
          sessionInput.type = 'text';
          sessionInput.id = `settings-ext-${field.id}`;
          sessionInput.placeholder = field.placeholder || '(new session)';
          sessionInput.value = String(value || '');
          sessionInput.dataset.sessionId = String(value || '');
          sessionInput.addEventListener('input', () => {
            sessionInput.dataset.sessionId = sessionInput.value || '';
          });
          sessionDiv.appendChild(sessionInput);
          
          const resumeBtn = document.createElement('button');
          resumeBtn.type = 'button';
          resumeBtn.className = 'btn ghost';
          resumeBtn.textContent = 'Browse';
          resumeBtn.addEventListener('click', () => {
            openSessionPicker(field, sessionInput);
          });
          sessionDiv.appendChild(resumeBtn);
          
          label.appendChild(sessionDiv);
          break;
          
        case 'select':
          // Dropdown field
          const selectDiv = document.createElement('div');
          selectDiv.className = 'dropdown-field';
          
          input = document.createElement('input');
          const selectInput = input;
          selectInput.type = 'text';
          selectInput.id = `settings-ext-${field.id}`;
          selectInput.placeholder = field.placeholder || '';
          selectInput.value = String(value ?? '');
          selectInput.readOnly = true;
          selectDiv.appendChild(selectInput);
          
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'btn ghost dropdown-toggle';
          toggleBtn.textContent = '▾';
          selectDiv.appendChild(toggleBtn);
          
          const listDiv = document.createElement('div');
          listDiv.className = 'dropdown-list';
          listDiv.id = `settings-ext-${field.id}-options`;
          const selectControl: SelectControl = {
            field,
            input: selectInput,
            listDiv,
            toggleBtn,
            initialValue: selectInput.value,
            initialValueApplied: false,
            dynamicItems: [],
            options: [],
          };
          selectControls[field.id] = selectControl;
          
          // Build options (static or dynamic)
          const buildOptions = (options: SelectOption[] | string[] | undefined): void => {
            setSelectOptions(selectControl, options);
          };
          
          if (field.dynamic_options_from) {
            buildOptions([]);
            const dynamicOptions = asRecord(field.dynamic_options_from);
            selectInput.placeholder = trimString(dynamicOptions.missing_source_placeholder)
              || field.placeholder
              || 'Select source first';
          } else {
            buildOptions(normalizeStaticOptions(field.options));
          }
          
          // Fetch dynamic options if configured
          const fieldSourceMethod = schemaFieldSourceMethod(field);
          if (field.dynamic_source || fieldSourceMethod) {
            const loadOpts = (data: unknown): void => {
              if (!data) return;
              const { items, options: opts, current, defaultValue } = normalizeDynamicSelectOptions(field, data);
              selectControl.dynamicItems = items;
              selectInput.removeAttribute('title');
              if (field.id === 'model') {
                modelItems = items;
                if (!selectInput.value) {
                  selectInput.placeholder = field.placeholder || 'Use server default';
                }
              } else if (field.dynamic_options_from) {
                const dependent = optionsFromDependentSource(field);
                buildOptions(dependent.options);
                if (!selectInput.value) {
                  selectInput.placeholder = dependent.defaultValue || field.placeholder || '';
                  if (dependent.defaultValue) {
                    selectOptionByValue(selectControl, dependent.defaultValue, selectControl.options, true, false);
                  }
                }
              } else if (!selectInput.value) {
                selectInput.placeholder = defaultValue || field.placeholder || '';
              }
              if (!field.dynamic_options_from && opts.length) buildOptions(opts);
              if (!field.dynamic_options_from) {
                const selectedValue = selectInput.value || current || defaultValue;
                if (selectedValue) {
                  selectOptionByValue(selectControl, selectedValue, selectControl.options, true, false);
                }
              }
              if (field.dynamic_options_from) {
                syncDependentSelectOptions();
              }
              if (field.id === 'model') syncModelDependentFields();
              syncConditionalState();
            };
            const selectedAgent = schemaExtensionId || settingsAgentEl?.value?.trim() || '';
            const conversationId = stringValue(getCodexAgentState().conversationMeta?.conversation_id);
            const dynamicSource = typeof field.dynamic_source === 'string' ? field.dynamic_source : '';
            const runtimeOptionsSource = isRuntimeOptionsSource(dynamicSource);
            const extensionModelsSource = Boolean(extensionIdFromApiPath(dynamicSource, 'models'));
            const schemaInteractionSource = fieldSourceMethod === 'extension.schemaInteraction.run';
            if (hasMissingRequiredSourceDependency(field)) {
              selectInput.placeholder = field.placeholder || 'Select dependency first';
              setSelectOptions(selectControl, []);
            } else if (runtimeOptionsSource || extensionModelsSource || schemaInteractionSource || fieldSourceMethod === 'extension.models.list') {
              fetchDynamicSource(dynamicSource, {
                conversationId,
                agent: selectedAgent,
                sourceMethod: fieldSourceMethod,
                sourceAction: schemaFieldSourceAction(field),
                interactionId: field.id,
                extraParams: buildSourceParams(field),
                values: collectSchemaValues(false),
                settings: asRecord(getCodexAgentState().conversationSettings),
              }).then(loadOpts).catch((e) => {
                console.error('[schema] dynamic Socket.IO load failed', e);
                const errorMessage = dynamicSourceErrorMessage(e);
                selectInput.title = errorMessage;
                if (!selectInput.value) {
                  selectInput.placeholder = 'Unable to load options';
                }
                setSelectMessage(selectControl, 'Unable to load options');
              });
            } else {
              const errorMessage = `Unsupported dynamic source: ${field.dynamic_source}`;
              input.title = errorMessage;
              if (!input.value) {
                input.placeholder = 'Unable to load options';
              }
              setSelectMessage(selectControl, 'Unable to load options');
              console.error(`[schema] ${errorMessage}`);
            }
          }
          
          toggleBtn.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            if (selectControl.largePickerMode) {
              openOptionPicker(selectControl);
              return;
            }
            const toggleDropdownMenu = getHelper(ctx, 'toggleDropdownMenu');
            if (typeof toggleDropdownMenu === 'function') {
              toggleDropdownMenu(listDiv);
            } else {
              listDiv.classList.toggle('open');
            }
          });
          
          selectDiv.appendChild(listDiv);
          label.appendChild(selectDiv);
          break;
          
        case 'checkbox':
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = `settings-ext-${field.id}`;
          input.checked = value === true || value === 'true';
          label.appendChild(input);
          label.className = 'settings-checkbox-row';
          break;
          
        case 'number':
          input = document.createElement('input');
          input.type = 'number';
          input.id = `settings-ext-${field.id}`;
          input.placeholder = field.placeholder || '';
          input.value = String(value ?? '');
          if (field.min !== undefined) input.min = String(field.min);
          if (field.max !== undefined) input.max = String(field.max);
          label.appendChild(input);
          break;

        case 'textarea':
          input = document.createElement('textarea');
          input.id = `settings-ext-${field.id}`;
          input.className = 'settings-textarea';
          input.placeholder = field.placeholder || '';
          input.rows = field.rows || 6;
          input.value = value == null ? '' : String(value);
          label.appendChild(input);
          break;

        case 'json':
          input = document.createElement('textarea');
          input.id = `settings-ext-${field.id}`;
          input.className = 'settings-textarea settings-json-input';
          input.placeholder = field.placeholder || '';
          input.rows = field.rows || 8;
          if (typeof getHelper(ctx, 'formatJsonSetting') === 'function') {
            input.value = formatJsonSetting(ctx, value);
          } else if (typeof value === 'string') {
            input.value = value;
          } else if (value == null || value === '') {
            input.value = '';
          } else {
            input.value = JSON.stringify(value, null, 2);
          }
          label.appendChild(input);
          break;
          
        case 'password':
        case 'secret':
          input = document.createElement('input');
          input.type = 'password';
          input.id = `settings-ext-${field.id}`;
          input.placeholder = field.placeholder || '';
          input.value = String(value ?? '');
          input.setAttribute('autocomplete', 'off');
          input.setAttribute('spellcheck', 'false');
          label.appendChild(input);
          break;

        case 'text':
        default:
          input = document.createElement('input');
          input.type = field.secret === true || field.sensitive === true ? 'password' : 'text';
          input.id = `settings-ext-${field.id}`;
          input.placeholder = field.placeholder || '';
          input.value = String(value ?? '');
          if (input.type === 'password') {
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('spellcheck', 'false');
          }
          label.appendChild(input);
          break;
      }
      
      // Track for save (only if input was created)
      if (input) {
        currentSchemaValues[field.id] = { input, type: field.type, field };
        input.addEventListener('input', syncConditionalState);
        input.addEventListener('change', () => {
          syncConditionalState();
          refreshSourceDependentSelects(field.id);
        });
      }
      
      conditionalRows.push({ field, element: label, input });
      container.appendChild(label);
    };

    const renderFieldList = (fields: SchemaField[], container: HTMLElement): void => {
      fields.forEach((field) => renderField(field, container));
    };

    renderFieldList(renderFields, settingsExtensionFields);

    syncModelDependentFields();
    syncConditionalState();
  }
  
  /**
   * Get current values from schema fields
   */
  function collectSchemaValues(parseStructured = false): JsonRecord {
    const values: JsonRecord = { ...currentSchemaWriteBackValues };
    Object.entries(currentSchemaValues).forEach(([id, { input, type, field }]) => {
      if (!input) return;
      if (!schemaFieldPersists(field)) {
        values[id] = null;
        return;
      }
      if (type === 'session_picker') {
        values[id] = input.value || input.dataset.sessionId || '';
        return;
      }
      if (type === 'checkbox') {
        values[id] = input instanceof HTMLInputElement ? input.checked : false;
      } else if (parseStructured && type === 'json') {
        const parsed = parseJsonSetting(ctx, input.value, field?.label || field?.id || id);
        if (field?.json_kind === 'object' && parsed != null && (Array.isArray(parsed) || typeof parsed !== 'object')) {
          throw new Error(`${field.label || field.id || id} must be a JSON object`);
        }
        values[id] = parsed;
      } else {
        values[id] = input.value;
      }
    });
    return values;
  }

  function getSchemaRawValues(): JsonRecord {
    return collectSchemaValues(false);
  }

  function getSchemaParsedValues(): JsonRecord {
    return collectSchemaValues(true);
  }

  function getSchemaValues(): JsonRecord {
    return getSchemaRawValues();
  }

  function getSchemaFieldInput(fieldId: string): SchemaInput | null {
    return currentSchemaValues[fieldId]?.input || null;
  }
  
  /**
   * Update settings modal based on selected agent
   */
  async function onAgentChange(agentId: string): Promise<void> {
    const isCodex = agentId === 'codex';
    
    // Show/hide Codex-specific fields
    if (settingsCodexFields) {
      settingsCodexFields.style.display = isCodex ? 'block' : 'none';
    }
    
    // Clear extension fields
    if (settingsExtensionFields) {
      settingsExtensionFields.innerHTML = '';
    }
    currentSchemaValues = {};
    currentSchemaWriteBackValues = {};
    currentSchemaFields = {};
    
    if (!isCodex) {
      // Load and render schema for this extension
      const schema = await loadSettingsSchema(agentId);
      if (schema && !schema.useBuiltin) {
        // For new conversations, use empty values; for existing, use saved settings
        const state = getCodexAgentState();
        const isPending = Boolean(state.pendingNewConversation);
        let settings: JsonRecord = isPending ? {} : asRecord(state.conversationSettings);
        // Prefill CWD from project root when starting from the project tab
        if (isPending) {
          const st = getCodexAgentState();
          const hu = st.hostUi;
          if (hu?.ideMode && st.splashTab === 'project' && typeof hu.projectRoot === 'string' && hu.projectRoot) {
            settings = { cwd: hu.projectRoot };
          }
        }
        renderSchemaFields(schema, settings, agentId);
      }
    }
  }
  
  // Export helpers - called after CodexAgent is created, so ctx === window.CodexAgent
  ctx.helpers = ctx.helpers || {};
  ctx.helpers.loadSettingsSchema = loadSettingsSchema;
  ctx.helpers.renderSchemaFields = renderSchemaFields;
  ctx.helpers.getSchemaRawValues = getSchemaRawValues;
  ctx.helpers.getSchemaParsedValues = getSchemaParsedValues;
  ctx.helpers.getSchemaValues = getSchemaValues;
  ctx.helpers.getSchemaFieldInput = getSchemaFieldInput;
  ctx.helpers.onAgentChange = onAgentChange;
  ctx.helpers.refreshProviderInfo = refreshProviderInfo;
});

export {};
