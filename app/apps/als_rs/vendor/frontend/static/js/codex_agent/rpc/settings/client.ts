import { getRpcRegistry } from '../registry.ts';
import {
  callRpcNamespace,
  JsonRpcCallError,
  readRpcTransportEnabledPreference,
  subscribeRpcNamespaceNotifications,
  type JsonRpcNotificationEnvelope,
  type RpcWindowRef,
} from '../transport.ts';
import {
  SETTINGS_RPC_ANCHOR_MODULES,
  SETTINGS_RPC_IMPLEMENTATION_STATUS,
  SETTINGS_RPC_METHODS,
  SETTINGS_RPC_NAMESPACE,
  SETTINGS_RPC_NOTIFICATION_METHODS,
  type JsonObject,
} from './contract.ts';

export interface SettingsRpcClientDescriptor {
  status: typeof SETTINGS_RPC_IMPLEMENTATION_STATUS;
  namespace: typeof SETTINGS_RPC_NAMESPACE;
  methods: typeof SETTINGS_RPC_METHODS;
  anchorModules: readonly string[];
  notificationCount: number;
}

interface SettingsRpcClientDeps {
  sioCall: (event: string, payload?: JsonObject, options?: JsonObject) => Promise<unknown>;
  windowRef?: RpcWindowRef;
}

type TransportTag = 'rpc' | 'legacy';

export function createSettingsRpcClientDescriptor(): SettingsRpcClientDescriptor {
  const registry = getRpcRegistry();
  return {
    status: SETTINGS_RPC_IMPLEMENTATION_STATUS,
    namespace: SETTINGS_RPC_NAMESPACE,
    methods: SETTINGS_RPC_METHODS,
    anchorModules: [...SETTINGS_RPC_ANCHOR_MODULES],
    notificationCount: registry.namespaces.settings.notifications.length,
  };
}

export const createSettingsRpcClientPlaceholder = createSettingsRpcClientDescriptor;
export type SettingsRpcClientPlaceholder = SettingsRpcClientDescriptor;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function normalizeTransport<T extends JsonObject>(result: T, transport: TransportTag): T & { transport: TransportTag } {
  return {
    ...result,
    transport,
  };
}

function listFromKey(result: unknown, key: string): JsonObject[] {
  const payload = asObject(result);
  const items = payload?.[key];
  if (!Array.isArray(items)) return [];
  return items.map((item) => asObject(item)).filter((item): item is JsonObject => Boolean(item));
}

function normalizeLegacyResult(result: unknown): JsonObject {
  const payload = asObject(result) ?? {};
  const legacyError = typeof payload.__error === 'string' ? payload.__error.trim() : '';
  if (legacyError) {
    throw new Error(legacyError);
  }
  return payload;
}

function getWindowRef(windowRef?: RpcWindowRef): RpcWindowRef {
  return windowRef ?? (typeof window !== 'undefined' ? window : null);
}

function normalizeNotificationMethod(method: unknown): typeof SETTINGS_RPC_NOTIFICATION_METHODS[number] | null {
  if (typeof method !== 'string') return null;
  return SETTINGS_RPC_NOTIFICATION_METHODS.find((candidate) => candidate === method) ?? null;
}

export function createSettingsRpcClient(deps: SettingsRpcClientDeps) {
  function rpcEnabled(): boolean {
    return readRpcTransportEnabledPreference(getWindowRef(deps.windowRef));
  }

  async function callLegacy(event: string, payload: JsonObject = {}): Promise<JsonObject> {
    return normalizeLegacyResult(await deps.sioCall(event, payload));
  }

  async function getConfig(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_config', {}), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.configGet,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function updateConfig(patch: JsonObject): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('update_config', patch), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.configUpdate,
      params: patch,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getStatus(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_status', {}), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.statusGet,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function listExtensions(): Promise<{ extensions: JsonObject[]; transport: TransportTag } & JsonObject> {
    if (!rpcEnabled()) {
      const legacy = await callLegacy('get_extensions', {});
      return normalizeTransport(
        {
          ...legacy,
          extensions: listFromKey(legacy, 'extensions'),
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionsList,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(
      {
        ...(asObject(result) ?? {}),
        extensions: listFromKey(result, 'extensions'),
      },
      'rpc',
    );
  }

  async function reloadExtensions(payload: JsonObject = {}): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('extensions_reload', payload), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionsReload,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function setExtensionEnabled(options: {
    extensionId: string;
    enabled: boolean;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = {
      extension_id: options.extensionId,
      enabled: options.enabled === true,
    };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('extension_set_enabled', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionEnabledSet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function installExtension(options: {
    extensionId: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = { extension_id: options.extensionId };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('extension_install', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionInstall,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionSplashSchema(options: {
    extensionId: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = { extension_id: options.extensionId };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_extension_splash_schema', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSplashSchemaGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function runExtensionSplashAction(options: {
    extensionId: string;
    actionId: string;
    payload?: JsonObject;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = {
      extension_id: options.extensionId,
      action_id: options.actionId,
      payload: options.payload ?? {},
    };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('run_extension_splash_action', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSplashActionRun,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionSettingsSchema(extensionId: string): Promise<JsonObject & { transport: TransportTag }> {
    const params = { extension_id: extensionId };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_extension_settings_schema', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSettingsSchemaGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionSettingsSchemaFragment(options: {
    extensionId: string;
    target: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      throw new Error('Schema fragments require settings RPC transport');
    }
    const params = {
      extension_id: options.extensionId,
      target: options.target,
    };
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSettingsSchemaFragmentGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getRuntimeOptions(options: {
    conversationId?: string | null;
    agent?: string | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params: JsonObject = {
      conversation_id: options.conversationId ?? null,
      agent: options.agent ?? null,
    };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_runtime_options', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionRuntimeOptionsGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionProviderInfo(options: {
    extensionId: string;
    conversationId?: string | null;
    providerSessionId?: string | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params: JsonObject = {
      extension_id: options.extensionId,
    };
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      params.conversation_id = options.conversationId.trim();
    }
    if (typeof options.providerSessionId === 'string' && options.providerSessionId.trim()) {
      params.provider_session_id = options.providerSessionId.trim();
      params.thread_id = options.providerSessionId.trim();
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionProviderInfoGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
      timeoutMs: 45000,
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function runSchemaInteraction(options: {
    extensionId: string;
    interactionId: string;
    action?: string | null;
    inputs?: JsonObject | null;
    values?: JsonObject | null;
    params?: JsonObject | null;
    conversationId?: string | null;
    settings?: JsonObject | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      throw new Error('Schema interactions require settings RPC transport');
    }
    const params: JsonObject = {
      extension_id: options.extensionId,
      interaction_id: options.interactionId,
      inputs: options.inputs ?? {},
      values: options.values ?? {},
      params: options.params ?? {},
    };
    if (typeof options.action === 'string' && options.action.trim()) {
      params.action = options.action.trim();
    }
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      params.conversation_id = options.conversationId.trim();
    }
    if (options.settings && typeof options.settings === 'object') {
      params.settings = options.settings;
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSchemaInteractionRun,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionRequestCards(options: {
    extensionId: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = { extension_id: options.extensionId };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_extension_request_cards', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionRequestCardsGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionUiFeatures(options: {
    extensionId: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params = { extension_id: options.extensionId };
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_extension_ui_features', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionUiFeaturesGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionPlan(options: {
    extensionId: string;
    conversationId?: string | null;
    force?: boolean;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params: JsonObject = {
      extension_id: options.extensionId,
    };
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      params.conversation_id = options.conversationId.trim();
    }
    if (options.force === true) {
      params.force = true;
    }
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_extension_plan', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionPlanGet,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function listExtensionModels(options: {
    extensionId: string;
    extraParams?: JsonObject | null;
  }): Promise<{ models: JsonObject[]; transport: TransportTag } & JsonObject> {
    const params: JsonObject = { extension_id: options.extensionId };
    const extraParams = asObject(options.extraParams);
    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined) {
          params[key] = value;
        }
      });
    }
    if (!rpcEnabled()) {
      const rawLegacy = await deps.sioCall('get_extension_models', params);
      const legacy = Array.isArray(rawLegacy) ? null : normalizeLegacyResult(rawLegacy);
      const models = Array.isArray(rawLegacy)
        ? rawLegacy.map((item) => asObject(item)).filter((item): item is JsonObject => Boolean(item))
        : Array.isArray(legacy?.models)
          ? legacy.models.map((item) => asObject(item)).filter((item): item is JsonObject => Boolean(item))
          : [];
      return normalizeTransport(
        {
          ...(legacy ?? {}),
          models,
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionModelsList,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(
      {
        ...(asObject(result) ?? {}),
        models: listFromKey(result, 'models'),
      },
      'rpc',
    );
  }

  async function listExtensionSessions(options: {
    extensionId: string;
    cwd?: string | null;
    extraParams?: JsonObject | null;
  }): Promise<{ sessions: JsonObject[]; transport: TransportTag } & JsonObject> {
    const params: JsonObject = {
      extension_id: options.extensionId,
    };
    if (typeof options.cwd === 'string' && options.cwd.trim()) {
      params.cwd = options.cwd.trim();
    }
    const extraParams = asObject(options.extraParams);
    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined) {
          params[key] = value;
        }
      });
    }
    if (!rpcEnabled()) {
      const rawLegacy = await deps.sioCall('get_sessions', params);
      const legacy = Array.isArray(rawLegacy) ? null : normalizeLegacyResult(rawLegacy);
      const sessions = Array.isArray(rawLegacy)
        ? rawLegacy.map((item) => asObject(item)).filter((item): item is JsonObject => Boolean(item))
        : listFromKey(legacy, 'sessions');
      return normalizeTransport(
        {
          ...(legacy ?? {}),
          sessions,
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSessionsList,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(
      {
        ...(asObject(result) ?? {}),
        sessions: listFromKey(result, 'sessions'),
      },
      'rpc',
    );
  }

  async function bindExtensionSession(options: {
    extensionId: string;
    sessionId: string;
    conversationId?: string | null;
    cwd?: string | null;
    model?: string | null;
    settings?: JsonObject | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const params: JsonObject = {
      extension_id: options.extensionId,
      session_id: options.sessionId,
    };
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      params.conversation_id = options.conversationId.trim();
    }
    if (typeof options.cwd === 'string' && options.cwd.trim()) params.cwd = options.cwd.trim();
    if (typeof options.model === 'string' && options.model.trim()) params.model = options.model.trim();
    if (options.settings && typeof options.settings === 'object') params.settings = options.settings;
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('session_resume', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSessionBind,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getExtensionSessionState(options: {
    extensionId?: string;
    conversationId: string;
    providerSessionId?: string | null;
    timeoutMs?: number;
  }): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport({
        ok: true,
        supported: false,
        state: 'unsupported',
        loaded: false,
        unload_supported: false,
      }, 'legacy');
    }
    const params: JsonObject = {
      conversation_id: options.conversationId,
    };
    if (options.extensionId) params.extension_id = options.extensionId;
    if (typeof options.providerSessionId === 'string' && options.providerSessionId.trim()) {
      params.provider_session_id = options.providerSessionId.trim();
      params.thread_id = options.providerSessionId.trim();
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSessionStateGet,
      params,
      timeoutMs: options.timeoutMs,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function unloadExtensionSession(options: {
    extensionId: string;
    conversationId: string;
    providerSessionId?: string | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport({
        ok: false,
        supported: false,
        state: 'unsupported',
        loaded: false,
        unload_supported: false,
        error: 'Live session unload requires settings RPC transport',
      }, 'legacy');
    }
    const params: JsonObject = {
      extension_id: options.extensionId,
      conversation_id: options.conversationId,
    };
    if (typeof options.providerSessionId === 'string' && options.providerSessionId.trim()) {
      params.provider_session_id = options.providerSessionId.trim();
      params.thread_id = options.providerSessionId.trim();
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: SETTINGS_RPC_NAMESPACE,
      method: SETTINGS_RPC_METHODS.extensionSessionUnload,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  function subscribeLiveNotifications(options: {
    onNotification: (
      method: typeof SETTINGS_RPC_NOTIFICATION_METHODS[number],
      params: JsonObject,
      notification: JsonRpcNotificationEnvelope<unknown>,
    ) => void;
    onError?: (error: unknown) => void;
    onConnectionChange?: (connected: boolean) => void;
  }): () => void {
    return subscribeRpcNamespaceNotifications({
      namespace: SETTINGS_RPC_NAMESPACE,
      windowRef: getWindowRef(deps.windowRef),
      onConnectionChange: (connected) => {
        options.onConnectionChange?.(connected);
      },
      onNotification: (notification) => {
        try {
          const method = normalizeNotificationMethod(notification.method);
          if (!method) return;
          options.onNotification(method, asObject(notification.params) ?? {}, notification);
        } catch (error) {
          options.onError?.(error);
        }
      },
    });
  }

  return {
    rpcEnabled,
    getConfig,
    updateConfig,
    getStatus,
    listExtensions,
    reloadExtensions,
    setExtensionEnabled,
    installExtension,
    getExtensionSplashSchema,
    runExtensionSplashAction,
    getExtensionSettingsSchema,
    getExtensionSettingsSchemaFragment,
    getRuntimeOptions,
    getExtensionProviderInfo,
    runSchemaInteraction,
    getExtensionRequestCards,
    getExtensionUiFeatures,
    getExtensionPlan,
    listExtensionModels,
    listExtensionSessions,
    bindExtensionSession,
    getExtensionSessionState,
    unloadExtensionSession,
    subscribeLiveNotifications,
    JsonRpcCallError,
  };
}
