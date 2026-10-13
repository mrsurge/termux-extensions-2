import { createSettingsRpcClient } from '../rpc/settings/client.ts';

type JsonObject = Record<string, unknown>;

interface RequestCardMatchEntry {
  request_method: string;
  kind: string;
}

interface RequestCardDescriptor extends JsonObject {
  module_url?: unknown;
  export?: unknown;
  matches?: unknown;
}

interface RequestCardConfig {
  extension_id: string;
  cards: RequestCardDescriptor[];
  schemas: Record<string, unknown>;
}

interface RequestCardEvent extends JsonObject {
  request_method?: unknown;
  requestMethod?: unknown;
  kind?: unknown;
}

interface RequestCardRenderContext extends JsonObject {
  extensionId?: unknown;
}

interface RequestCardModuleInitContext {
  extensionId: string;
  cards: RequestCardDescriptor[];
  schemas: Record<string, unknown>;
}

type RequestCardRenderer = (ctx: RequestCardRenderContext & {
  extensionId: string;
  event: RequestCardEvent;
  card: RequestCardDescriptor;
  config: RequestCardConfig;
  schema: unknown;
}) => Promise<unknown> | unknown;

interface RequestCardModule {
  default?: RequestCardRenderer;
  initializeRequestCardModule?: (ctx: RequestCardModuleInitContext) => Promise<unknown> | unknown;
  initializeExtensionCardModule?: (ctx: RequestCardModuleInitContext) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

interface RequestCardRuntimeContext {
  sioCall(event: string, payload?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

interface RequestCardRuntimeBinding {
  preload(extensionId: string): Promise<RequestCardConfig>;
  render(evt: RequestCardEvent, renderCtx: RequestCardRenderContext): Promise<boolean>;
}

function normalizeRequestMethod(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeMatchEntries(card: RequestCardDescriptor | null | undefined): RequestCardMatchEntry[] {
  const matches = Array.isArray(card?.matches) ? card.matches : [];
  return matches
    .filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      request_method: normalizeRequestMethod(entry.request_method || entry.requestMethod),
      kind: typeof entry.kind === 'string' ? entry.kind.trim() : '',
    }));
}

function requestCardProxyBase(): string {
  if (typeof window === 'undefined') return '';
  const path = typeof window.location?.pathname === 'string' ? window.location.pathname : '';
  const match = path.match(/^(\/api\/app\/[^/]+\/proxy)(?:\/|$)/);
  return match && match[1] ? match[1] : '';
}

function resolveRequestCardUrl(rawUrl: unknown): string {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!url) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  const proxyBase = requestCardProxyBase();
  if (proxyBase && url.startsWith('/')) {
    return `${proxyBase}${url}`;
  }
  return url;
}

function normalizeConfigResponse(extensionId: string, data: unknown): RequestCardConfig {
  if (!data || typeof data !== 'object') {
    return { extension_id: extensionId, cards: [], schemas: {} };
  }
  const payload = data as JsonObject;
  if (payload.ok === false) {
    return { extension_id: extensionId, cards: [], schemas: {} };
  }
  return {
    extension_id: typeof payload.extension_id === 'string' ? payload.extension_id : extensionId,
    cards: Array.isArray(payload.cards) ? payload.cards.filter((card): card is RequestCardDescriptor => Boolean(card) && typeof card === 'object') : [],
    schemas: payload.schemas && typeof payload.schemas === 'object' ? (payload.schemas as Record<string, unknown>) : {},
  };
}

export function bindRequestCardRuntime(ctx: RequestCardRuntimeContext): RequestCardRuntimeBinding {
  const { sioCall } = ctx;
  const settingsRpcClient = createSettingsRpcClient({ sioCall });
  const configCache = new Map<string, Promise<RequestCardConfig>>();
  const moduleCache = new Map<string, Promise<RequestCardModule | null>>();

  async function fetchConfig(extensionId: string): Promise<RequestCardConfig> {
    const normalizedId = typeof extensionId === 'string' ? extensionId.trim() : '';
    if (!normalizedId) return { extension_id: '', cards: [], schemas: {} };
    const cachedConfig = configCache.get(normalizedId);
    if (cachedConfig) {
      return cachedConfig;
    }
    const promise = (async () => {
      try {
        const data = await settingsRpcClient.getExtensionRequestCards({
          extensionId: normalizedId,
        });
        return normalizeConfigResponse(normalizedId, data);
      } catch {
        return { extension_id: normalizedId, cards: [], schemas: {} };
      }
    })();
    configCache.set(normalizedId, promise);
    return promise;
  }

  async function loadCardModule(
    config: RequestCardConfig,
    card: RequestCardDescriptor | null | undefined,
  ): Promise<RequestCardModule | null> {
    const moduleUrl = resolveRequestCardUrl(card?.module_url);
    if (!moduleUrl) return null;
    const exportName = typeof card?.export === 'string' && card.export.trim() ? card.export.trim() : 'renderRequestCard';
    const cacheKey = `${moduleUrl}#${exportName}`;
    const cachedModule = moduleCache.get(cacheKey);
    if (cachedModule) {
      return cachedModule;
    }
    const promise = (async () => {
      const mod = (await import(moduleUrl)) as RequestCardModule;
      const init = mod?.initializeRequestCardModule || mod?.initializeExtensionCardModule;
      if (typeof init === 'function') {
        await init({
          extensionId: config.extension_id,
          cards: Array.isArray(config.cards) ? config.cards : [],
          schemas: config.schemas && typeof config.schemas === 'object' ? config.schemas : {},
        });
      }
      return mod;
    })();
    moduleCache.set(cacheKey, promise);
    return promise;
  }

  function findMatchingCard(
    config: RequestCardConfig | null | undefined,
    evt: RequestCardEvent | null | undefined,
  ): RequestCardDescriptor | null {
    const cards = Array.isArray(config?.cards) ? config.cards : [];
    const requestMethod = normalizeRequestMethod(evt?.request_method || evt?.requestMethod);
    const kind = typeof evt?.kind === 'string' ? evt.kind.trim() : '';
    return cards.find((card) => {
      const matches = normalizeMatchEntries(card);
      if (!matches.length) return false;
      return matches.some((match) => {
        if (match.request_method && match.request_method !== requestMethod) return false;
        if (match.kind && match.kind !== kind) return false;
        return true;
      });
    }) || null;
  }

  async function preload(extensionId: string): Promise<RequestCardConfig> {
    const config = await fetchConfig(extensionId);
    const cards = Array.isArray(config.cards) ? config.cards : [];
    await Promise.all(cards.map((card) => loadCardModule(config, card).catch(() => null)));
    return config;
  }

  async function render(
    evt: RequestCardEvent,
    renderCtx: RequestCardRenderContext,
  ): Promise<boolean> {
    const extensionId = typeof renderCtx?.extensionId === 'string' && renderCtx.extensionId.trim()
      ? renderCtx.extensionId.trim()
      : '';
    if (!extensionId) return false;
    const config = await fetchConfig(extensionId);
    const card = findMatchingCard(config, evt);
    if (!card) return false;
    let mod: RequestCardModule | null;
    try {
      mod = await loadCardModule(config, card);
    } catch (error) {
      console.error('[request-cards] failed to load card module', {
        extensionId,
        moduleUrl: card?.module_url || null,
        error,
      });
      return false;
    }
    if (!mod) return false;
    const exportName = typeof card.export === 'string' && card.export.trim() ? card.export.trim() : 'renderRequestCard';
    const renderFn = exportName === 'default'
      ? mod.default
      : mod[exportName];
    if (typeof renderFn !== 'function') return false;
    const requestMethod = normalizeRequestMethod(evt?.request_method || evt?.requestMethod);
    const schema = requestMethod ? (config.schemas?.[requestMethod] || null) : null;
    const handled = await renderFn({
      extensionId,
      event: evt,
      card,
      config,
      schema,
      ...renderCtx,
    });
    return handled === true;
  }

  return {
    preload,
    render,
  };
}
