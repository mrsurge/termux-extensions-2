import { getRpcRegistry } from '../registry.ts';
import { showToast } from '../../toast.ts';
import {
  callRpcNamespace,
  readRpcTransportEnabledPreference,
  subscribeRpcNamespaceNotifications,
  type JsonRpcNotificationEnvelope,
  type RpcWindowRef,
} from '../transport.ts';
import {
  UI_RPC_ANCHOR_MODULES,
  UI_RPC_IMPLEMENTATION_STATUS,
  UI_RPC_METHODS,
  UI_RPC_NAMESPACE,
  UI_RPC_NOTIFICATION_METHODS,
  type JsonObject,
} from './contract.ts';

export interface UiRpcClientDescriptor {
  status: typeof UI_RPC_IMPLEMENTATION_STATUS;
  namespace: typeof UI_RPC_NAMESPACE;
  methods: typeof UI_RPC_METHODS;
  anchorModules: readonly string[];
  notificationCount: number;
}

interface UiRpcClientDeps {
  sioCall: (event: string, payload?: JsonObject, options?: JsonObject) => Promise<unknown>;
  windowRef?: RpcWindowRef;
}

type TransportTag = 'rpc' | 'legacy';

export function createUiRpcClientDescriptor(): UiRpcClientDescriptor {
  const registry = getRpcRegistry();
  return {
    status: UI_RPC_IMPLEMENTATION_STATUS,
    namespace: UI_RPC_NAMESPACE,
    methods: UI_RPC_METHODS,
    anchorModules: [...UI_RPC_ANCHOR_MODULES],
    notificationCount: registry.namespaces.ui.notifications.length,
  };
}

export const createUiRpcClientPlaceholder = createUiRpcClientDescriptor;
export type UiRpcClientPlaceholder = UiRpcClientDescriptor;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function normalizeLegacyResult(result: unknown): JsonObject {
  const payload = asObject(result) ?? {};
  const legacyError = typeof payload.__error === 'string' ? payload.__error.trim() : '';
  if (legacyError) {
    throw new Error(legacyError);
  }
  return payload;
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

function getWindowRef(windowRef?: RpcWindowRef): RpcWindowRef {
  return windowRef ?? (typeof window !== 'undefined' ? window : null);
}

function normalizeNotificationMethod(method: unknown): typeof UI_RPC_NOTIFICATION_METHODS[number] | null {
  if (typeof method !== 'string') return null;
  return UI_RPC_NOTIFICATION_METHODS.find((candidate) => candidate === method) ?? null;
}

export function createUiRpcClient(deps: UiRpcClientDeps) {
  function rpcEnabled(): boolean {
    return readRpcTransportEnabledPreference(getWindowRef(deps.windowRef));
  }

  async function callLegacy(event: string, payload: JsonObject = {}): Promise<JsonObject> {
    return normalizeLegacyResult(await deps.sioCall(event, payload));
  }

  async function getView(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      const config = await callLegacy('get_config', {});
      return normalizeTransport(
        {
          active_view: typeof config.active_view === 'string' ? config.active_view : null,
          conversation_id: typeof config.conversation_id === 'string' ? config.conversation_id : null,
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.viewGet,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function setView(view: string): Promise<JsonObject & { transport: TransportTag }> {
    const payload = { view };
    if (!rpcEnabled()) {
      const result = await callLegacy('set_view', payload);
      return normalizeTransport(
        {
          active_view: typeof result.active_view === 'string' ? result.active_view : view,
          conversation_id: typeof result.conversation_id === 'string' ? result.conversation_id : null,
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.viewSet,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getHostUi(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('get_host_ui', {}), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.hostUiGet,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function recheckHostUi(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      const recheck = await callLegacy('sidebar_recheck', {});
      const hostUi = await callLegacy('get_host_ui', {});
      return normalizeTransport({ recheck, ...hostUi }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.hostUiRecheck,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function listFilesystem(path?: string | null): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof path === 'string' && path.trim()) payload.path = path.trim();
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('fs_list', payload), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.filesystemList,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getFilesystemHome(): Promise<JsonObject & { transport: TransportTag }> {
    if (!rpcEnabled()) {
      const listed = await callLegacy('fs_list', { path: '~' });
      const path = typeof listed.path === 'string' && listed.path.trim() ? listed.path.trim() : null;
      return normalizeTransport(
        {
          ok: Boolean(path),
          home: path,
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.filesystemHome,
      params: {},
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function searchFilesystem(options: {
    query: string;
    root?: string | null;
    limit?: number;
  }): Promise<{ items: JsonObject[]; transport: TransportTag } & JsonObject> {
    const payload: JsonObject = {
      query: options.query,
    };
    if (typeof options.root === 'string' && options.root.trim()) payload.root = options.root.trim();
    if (Number.isFinite(options.limit)) payload.limit = Number(options.limit);
    if (!rpcEnabled()) {
      const legacy = await callLegacy('fs_search', payload);
      return normalizeTransport(
        {
          ...legacy,
          items: listFromKey(legacy, 'items'),
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.filesystemSearch,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(
      {
        ...(asObject(result) ?? {}),
        items: listFromKey(result, 'items'),
      },
      'rpc',
    );
  }

  async function getProjectIdentity(conversationId: string): Promise<JsonObject> {
    return callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectIdentityGet,
      params: { conversation_id: conversationId },
      windowRef: getWindowRef(deps.windowRef),
    });
  }

  async function getProjectSummary(options: {
    conversationId?: string | null;
    path?: string | null;
    maxDiffBytes?: number;
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      payload.conversation_id = options.conversationId.trim();
    }
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (Number.isFinite(options.maxDiffBytes)) payload.max_diff_bytes = Number(options.maxDiffBytes);
    if (!rpcEnabled()) {
      return normalizeTransport(
        {
          ok: false,
          error: 'Project summary requires /rpc/ui',
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectSummaryGet,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function acceptAgentDiff(options: {
    conversationId: string;
    diffId: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {
      conversation_id: options.conversationId,
      diff_id: options.diffId,
    };
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Agent diff accept requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectAgentDiffAccept,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function rejectAgentDiff(options: {
    conversationId: string;
    diffId: string;
    force?: boolean;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {
      conversation_id: options.conversationId,
      diff_id: options.diffId,
    };
    if (options.force === true) payload.force = true;
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Agent diff reject requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectAgentDiffReject,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function rejectAllAgentDiffs(options: {
    conversationId: string;
    path?: string | null;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {
      conversation_id: options.conversationId,
    };
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Agent diff reject all requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectAgentDiffRejectAll,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function stageProjectPaths(options: {
    path?: string | null;
    paths?: string[];
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (Array.isArray(options.paths)) payload.paths = options.paths;
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Project git stage requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectGitStage,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function restoreProjectPaths(options: {
    path?: string | null;
    paths?: string[];
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (Array.isArray(options.paths)) payload.paths = options.paths;
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Project git restore requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectGitRestore,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function unstageProjectPaths(options: {
    path?: string | null;
    paths?: string[];
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (Array.isArray(options.paths)) payload.paths = options.paths;
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Project git unstage requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectGitUnstage,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function commitProject(options: {
    path?: string | null;
    message: string;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {
      message: options.message,
    };
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'Project git commit requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectGitCommit,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function getTe2ProjectStatus(options: {
    path?: string | null;
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (!rpcEnabled()) {
      return normalizeTransport(
        {
          ok: false,
          connected: false,
          action: 'disabled',
          error: 'TE2 project status requires /rpc/ui',
        },
        'legacy',
      );
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectTe2StatusGet,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function openTe2Project(options: {
    path?: string | null;
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'TE2 project open requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectTe2Open,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function createTe2Project(options: {
    path?: string | null;
    adoptExisting?: boolean;
    open?: boolean;
  } = {}): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {};
    if (typeof options.path === 'string' && options.path.trim()) payload.path = options.path.trim();
    if (typeof options.adoptExisting === 'boolean') payload.adoptExisting = options.adoptExisting;
    if (typeof options.open === 'boolean') payload.open = options.open;
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'TE2 project create requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectTe2Create,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function publishAppWindowState(options: {
    hostId: string;
    tokenId?: string | null;
    consoleWorkerId?: string | null;
    conversationId: string;
    view?: string | null;
    title?: string | null;
    ready?: boolean;
  }): Promise<JsonObject & { transport: TransportTag }> {
    const payload: JsonObject = {
      host_id: options.hostId,
      conversation_id: options.conversationId,
    };
    if (typeof options.tokenId === 'string' && options.tokenId.trim()) {
      payload.token_id = options.tokenId.trim();
    }
    if (typeof options.consoleWorkerId === 'string' && options.consoleWorkerId.trim()) {
      payload.console_worker_id = options.consoleWorkerId.trim();
    }
    if (typeof options.view === 'string' && options.view.trim()) {
      payload.view = options.view.trim();
    }
    if (typeof options.title === 'string' && options.title.trim()) {
      payload.title = options.title.trim();
    }
    if (typeof options.ready === 'boolean') {
      payload.ready = options.ready;
    }
    if (!rpcEnabled()) {
      return normalizeTransport({ ok: false, error: 'App window state requires /rpc/ui' }, 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.appWindowStatePublish,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  async function openFile(payload: JsonObject): Promise<JsonObject & { transport: TransportTag }> {
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.fileOpen,
      params: payload,
      windowRef: getWindowRef(deps.windowRef),
    });
    const response = normalizeTransport(asObject(result) ?? {}, 'rpc');
    if (response.ok === true && response.sent === true && typeof payload.path === 'string') {
      showToast(`Opened ${payload.path}${typeof payload.line === 'number' ? `:${payload.line}` : ''}`);
    }
    return response;
  }

  async function remoteProject(options: { path: string; action: 'fetch' | 'pull' | 'push' }): Promise<JsonObject> {
    return callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.projectGitRemote,
      params: options,
      timeoutMs: 130000,
      windowRef: getWindowRef(deps.windowRef),
    });
  }

  async function openUrl(payload: { url: string; source?: string | null; conversation_id?: string | null }): Promise<JsonObject & { transport: TransportTag }> {
    const params: JsonObject = {
      url: payload.url,
    };
    if (typeof payload.source === 'string' && payload.source.trim()) params.source = payload.source.trim();
    if (typeof payload.conversation_id === 'string' && payload.conversation_id.trim()) {
      params.conversation_id = payload.conversation_id.trim();
    }
    if (!rpcEnabled()) {
      return normalizeTransport(await callLegacy('open_external_url', params), 'legacy');
    }
    const result = await callRpcNamespace<JsonObject>({
      namespace: UI_RPC_NAMESPACE,
      method: UI_RPC_METHODS.urlOpen,
      params,
      windowRef: getWindowRef(deps.windowRef),
    });
    return normalizeTransport(asObject(result) ?? {}, 'rpc');
  }

  function subscribeLiveNotifications(options: {
    onNotification: (
      method: typeof UI_RPC_NOTIFICATION_METHODS[number],
      params: JsonObject,
      notification: JsonRpcNotificationEnvelope<unknown>,
    ) => void;
    onError?: (error: unknown) => void;
    onConnectionChange?: (connected: boolean) => void;
  }): () => void {
    return subscribeRpcNamespaceNotifications({
      namespace: UI_RPC_NAMESPACE,
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
    getView,
    setView,
    getHostUi,
    recheckHostUi,
    getFilesystemHome,
    listFilesystem,
    searchFilesystem,
    getProjectSummary,
    getProjectIdentity,
    acceptAgentDiff,
    rejectAgentDiff,
    rejectAllAgentDiffs,
    stageProjectPaths,
    remoteProject,
    unstageProjectPaths,
    restoreProjectPaths,
    commitProject,
    getTe2ProjectStatus,
    openTe2Project,
    createTe2Project,
    publishAppWindowState,
    openFile,
    openUrl,
    subscribeLiveNotifications,
  };
}
