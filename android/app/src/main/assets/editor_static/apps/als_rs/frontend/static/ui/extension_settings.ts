type JsonRecord = Record<string, unknown>;

type SioCall = (event: string, payload?: JsonRecord) => Promise<unknown>;

type SettingsRpcClient = {
  listExtensions?: () => Promise<unknown>;
  getExtensionSplashSchema?: (options: { extensionId: string }) => Promise<unknown>;
  setExtensionEnabled?: (options: { extensionId: string; enabled: boolean }) => Promise<unknown>;
  installExtension?: (options: { extensionId: string }) => Promise<unknown>;
  runExtensionSplashAction?: (options: {
    extensionId: string;
    actionId: string;
    payload: JsonRecord;
  }) => Promise<unknown>;
};

type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

type ExtensionInfo = {
  id: string;
  name?: string;
  enabled?: boolean;
  dependency_status?: string;
  dependency_message?: string;
  has_dependency_install?: boolean;
};

type SplashField = {
  type?: string;
  tone?: string;
  label?: string;
  text?: string;
  detail?: string;
  action_id?: string;
  open_strategy?: string;
  opens_window?: boolean;
  button_label?: string;
  description?: string;
};

type SplashSchema = {
  fields?: SplashField[];
};

type SplashActionResult = {
  open_url?: string;
  opened_externally?: boolean;
  poll_interval_ms?: unknown;
  poll_attempts?: unknown;
  error?: string;
};

type RpcResult = {
  ok?: boolean;
  error?: string;
  extensions?: unknown;
  result?: unknown;
};

declare global {
  interface Window {
    CodexAgentModules?: Array<(agent: CodexAgentModuleApi | undefined) => void>;
    CodexAgent?: CodexAgentModuleApi;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object';
}

function asRpcResult(value: unknown): RpcResult {
  return isRecord(value) ? value : {};
}

function normalizeExtension(value: unknown): ExtensionInfo | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  return {
    id,
    name: typeof value.name === 'string' ? value.name : undefined,
    enabled: value.enabled === true,
    dependency_status: typeof value.dependency_status === 'string' ? value.dependency_status : undefined,
    dependency_message: typeof value.dependency_message === 'string' ? value.dependency_message : undefined,
    has_dependency_install: value.has_dependency_install === true,
  };
}

function normalizeExtensions(value: unknown): ExtensionInfo[] {
  return Array.isArray(value)
    ? value.map(normalizeExtension).filter((item): item is ExtensionInfo => Boolean(item))
    : [];
}

function normalizeSplashField(value: unknown): SplashField | null {
  if (!isRecord(value)) return null;
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    tone: typeof value.tone === 'string' ? value.tone : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    text: typeof value.text === 'string' ? value.text : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    action_id: typeof value.action_id === 'string' ? value.action_id : undefined,
    open_strategy: typeof value.open_strategy === 'string' ? value.open_strategy : undefined,
    opens_window: value.opens_window === true,
    button_label: typeof value.button_label === 'string' ? value.button_label : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
  };
}

function normalizeSplashSchema(value: unknown): SplashSchema | null {
  if (!isRecord(value)) return null;
  const fields = Array.isArray(value.fields)
    ? value.fields.map(normalizeSplashField).filter((item): item is SplashField => Boolean(item))
    : [];
  return { fields };
}

function normalizeSplashActionResult(value: unknown): SplashActionResult {
  if (!isRecord(value)) return {};
  return {
    open_url: typeof value.open_url === 'string' ? value.open_url : undefined,
    opened_externally: value.opened_externally === true,
    poll_interval_ms: value.poll_interval_ms,
    poll_attempts: value.poll_attempts,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

window.CodexAgentModules = window.CodexAgentModules || [];
window.CodexAgentModules.push((agent: CodexAgentModuleApi | undefined) => {
  const splashSettingsBtn = document.getElementById('splash-settings');
  const splashSettingsModal = document.getElementById('splash-settings-modal');
  const container = document.getElementById('splash-settings-extensions');
  let refreshTimer: number | null = null;

  if (!container) return;
  const settingsContainer = container;

  function getSioCall(): SioCall {
    const sioCall = agent?.helpers?.sioCall || window.CodexAgent?.helpers?.sioCall;
    if (typeof sioCall !== 'function') {
      throw new Error('Socket.IO helper unavailable');
    }
    return sioCall as SioCall;
  }

  function getSettingsRpc(): SettingsRpcClient | null {
    const settingsRpc = agent?.helpers?.settingsRpc || window.CodexAgent?.helpers?.settingsRpc;
    return isRecord(settingsRpc) ? settingsRpc as SettingsRpcClient : null;
  }

  async function fetchExtensions(): Promise<ExtensionInfo[]> {
    const settingsRpc = getSettingsRpc();
    if (settingsRpc && typeof settingsRpc.listExtensions === 'function') {
      const data = asRpcResult(await settingsRpc.listExtensions());
      return normalizeExtensions(data.extensions);
    }
    const data = asRpcResult(await getSioCall()('get_extensions', {}));
    return normalizeExtensions(data.extensions);
  }

  async function fetchSplashSchema(extensionId: string): Promise<SplashSchema | null> {
    const settingsRpc = getSettingsRpc();
    if (settingsRpc && typeof settingsRpc.getExtensionSplashSchema === 'function') {
      const result = await settingsRpc.getExtensionSplashSchema({ extensionId });
      const payload = asRpcResult(result);
      if (!payload || payload.ok === false) return null;
      return normalizeSplashSchema(payload);
    }
    const result = asRpcResult(await getSioCall()('get_extension_splash_schema', { extension_id: extensionId }));
    if (!result || result.ok === false) return null;
    return normalizeSplashSchema(result);
  }

  function statusText(ext: ExtensionInfo): string {
    if (!ext || typeof ext !== 'object') return 'Unknown';
    if (ext.enabled !== true) return 'Disabled';
    if (ext.dependency_status === 'met') return 'Ready';
    if (typeof ext.dependency_message === 'string' && ext.dependency_message.trim()) {
      return ext.dependency_message.trim();
    }
    if (ext.dependency_status === 'unmet') return 'Dependencies unmet';
    if (ext.dependency_status === 'error') return 'Dependency check failed';
    return 'Status unknown';
  }

  function emitUpdated(): void {
    window.dispatchEvent(new CustomEvent('codexagent:extensions-updated'));
  }

  function clearRefreshTimer(): void {
    if (!refreshTimer) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh(intervalMs: unknown, attempts: unknown = 1): void {
    clearRefreshTimer();
    const delay = Number(intervalMs);
    const remaining = Number(attempts);
    if (!Number.isFinite(delay) || delay <= 0 || !Number.isFinite(remaining) || remaining <= 0) return;
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = null;
      if (splashSettingsModal?.classList?.contains('hidden')) return;
      await refresh();
      emitUpdated();
      scheduleRefresh(delay, remaining - 1);
    }, delay);
  }

  function showError(message: unknown): void {
    const text = typeof message === 'string' && message.trim() ? message.trim() : 'Extension action failed';
    const errorEl = document.createElement('div');
    errorEl.className = 'muted extension-settings-status';
    errorEl.textContent = text;
    settingsContainer.prepend(errorEl);
  }

  async function setEnabled(extensionId: string, enabled: boolean): Promise<void> {
    const settingsRpc = getSettingsRpc();
    const result = asRpcResult(settingsRpc && typeof settingsRpc.setExtensionEnabled === 'function'
      ? await settingsRpc.setExtensionEnabled({ extensionId, enabled })
      : await getSioCall()('extension_set_enabled', { extension_id: extensionId, enabled }));
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'Failed to update extension state');
    }
    emitUpdated();
    await refresh();
  }

  async function install(extensionId: string): Promise<void> {
    const settingsRpc = getSettingsRpc();
    const result = asRpcResult(settingsRpc && typeof settingsRpc.installExtension === 'function'
      ? await settingsRpc.installExtension({ extensionId })
      : await getSioCall()('extension_install', { extension_id: extensionId }));
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'Install failed');
    }
    emitUpdated();
    await refresh();
  }

  function buildStatusField(field: SplashField): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'extension-settings-field extension-settings-field-status';
    if (typeof field?.tone === 'string' && field.tone.trim()) {
      wrapper.dataset.tone = field.tone.trim();
    }

    const label = document.createElement('div');
    label.className = 'extension-settings-field-label';
    label.textContent = typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : 'Status';

    const text = document.createElement('div');
    text.className = 'extension-settings-field-text';
    text.textContent = typeof field?.text === 'string' && field.text.trim() ? field.text.trim() : 'Unavailable';

    wrapper.append(label, text);

    if (typeof field?.detail === 'string' && field.detail.trim()) {
      const detail = document.createElement('div');
      detail.className = 'extension-settings-field-detail';
      detail.textContent = field.detail.trim();
      wrapper.appendChild(detail);
    }

    return wrapper;
  }

  async function runSplashAction(ext: ExtensionInfo, field: SplashField): Promise<void> {
    const actionId = typeof field?.action_id === 'string' ? field.action_id.trim() : '';
    if (!actionId) return;
    const hostOpen = field?.open_strategy === 'host';
    let popup: Window | null = null;
    if (field?.opens_window === true && !hostOpen) {
      try {
        popup = window.open('', '_blank');
      } catch {
        popup = null;
      }
    }
    try {
      const settingsRpc = getSettingsRpc();
      const response = asRpcResult(settingsRpc && typeof settingsRpc.runExtensionSplashAction === 'function'
        ? await settingsRpc.runExtensionSplashAction({
          extensionId: ext.id,
          actionId,
          payload: {},
        })
        : await getSioCall()('run_extension_splash_action', {
          extension_id: ext.id,
          action_id: actionId,
          payload: {},
        }));
      if (!response || response.ok === false) {
        const resultPayload = normalizeSplashActionResult(response.result);
        const errorText = resultPayload.error || response?.error || 'Extension action failed';
        throw new Error(errorText);
      }
      const result = normalizeSplashActionResult(response.result);
      const openUrl = typeof result.open_url === 'string' ? result.open_url.trim() : '';
      const openedExternally = result.opened_externally === true;
      if (openUrl && !openedExternally) {
        if (popup && !popup.closed) {
          popup.location.replace(openUrl);
        } else {
          window.open(openUrl, '_blank', 'noopener,noreferrer');
        }
      } else if (popup && !popup.closed) {
        popup.close();
      }
      emitUpdated();
      await refresh();
      scheduleRefresh(result.poll_interval_ms, result.poll_attempts);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      showError(getErrorMessage(error, 'Extension action failed'));
    }
  }

  function buildActionField(ext: ExtensionInfo, field: SplashField): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'extension-settings-field extension-settings-field-action';

    const label = document.createElement('div');
    label.className = 'extension-settings-field-label';
    label.textContent = typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : 'Action';
    wrapper.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'extension-settings-inline-actions';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tiny';
    button.textContent = typeof field?.button_label === 'string' && field.button_label.trim()
      ? field.button_label.trim()
      : (typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : 'Run');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await runSplashAction(ext, field);
      } finally {
        button.disabled = false;
      }
    });

    actions.appendChild(button);
    wrapper.appendChild(actions);

    if (typeof field?.description === 'string' && field.description.trim()) {
      const detail = document.createElement('div');
      detail.className = 'extension-settings-field-detail';
      detail.textContent = field.description.trim();
      wrapper.appendChild(detail);
    }

    return wrapper;
  }

  function buildSplashSchema(ext: ExtensionInfo, schema: SplashSchema | null): HTMLElement | null {
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    if (!fields.length) return null;
    const root = document.createElement('div');
    root.className = 'extension-settings-splash';
    fields.forEach((field) => {
      if (!field || typeof field !== 'object') return;
      if (field.type === 'status') {
        root.appendChild(buildStatusField(field));
        return;
      }
      if (field.type === 'action') {
        root.appendChild(buildActionField(ext, field));
      }
    });
    return root.childNodes.length ? root : null;
  }

  function buildRow(ext: ExtensionInfo, splashSchema: SplashSchema | null): HTMLElement {
    const row = document.createElement('div');
    row.className = 'extension-settings-row';
    row.dataset.extensionId = ext?.id || '';

    const meta = document.createElement('div');
    meta.className = 'extension-settings-meta';

    const title = document.createElement('div');
    title.className = 'extension-settings-title';
    title.textContent = typeof ext?.name === 'string' && ext.name.trim() ? ext.name.trim() : (ext?.id || 'extension');

    const status = document.createElement('div');
    status.className = 'extension-settings-status';
    status.textContent = statusText(ext);

    meta.append(title, status);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle-label';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = ext?.enabled === true;
      toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      try {
        await setEnabled(ext.id, toggle.checked);
      } catch (error) {
        toggle.checked = !toggle.checked;
        showError(getErrorMessage(error, 'Failed to update extension state'));
      } finally {
        toggle.disabled = false;
      }
    });
    toggleLabel.append(toggle, document.createTextNode(' Enabled'));

    const actions = document.createElement('div');
    actions.className = 'extension-settings-actions';

    if (ext?.has_dependency_install === true && ext?.dependency_status !== 'met') {
      const installBtn = document.createElement('button');
      installBtn.className = 'btn tiny';
      installBtn.textContent = 'Install';
      installBtn.disabled = ext?.enabled !== true;
      installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        try {
          await install(ext.id);
        } catch (error) {
          showError(getErrorMessage(error, 'Install failed'));
        } finally {
          installBtn.disabled = false;
        }
      });
      actions.appendChild(installBtn);
    }

    row.append(meta, toggleLabel, actions);

    const splash = buildSplashSchema(ext, splashSchema);
    if (splash) {
      splash.style.gridColumn = '1 / -1';
      row.appendChild(splash);
    }

    return row;
  }

  async function refresh(): Promise<void> {
    settingsContainer.textContent = 'Loading extensions…';
    try {
      const extensions = await fetchExtensions();
      const splashSchemas = new Map(
        await Promise.all(
          extensions.map(async (ext): Promise<[string, SplashSchema | null]> => {
            try {
              return [ext.id, await fetchSplashSchema(ext.id)];
            } catch {
              return [ext.id, null];
            }
          }),
        ),
      );
      settingsContainer.innerHTML = '';
      if (!extensions.length) {
        settingsContainer.textContent = 'No extensions discovered.';
        return;
      }
      extensions.forEach((ext) => {
        settingsContainer.appendChild(buildRow(ext, splashSchemas.get(ext.id) || null));
      });
    } catch (error) {
      settingsContainer.textContent = getErrorMessage(error, 'Failed to load extensions');
    }
  }

  splashSettingsBtn?.addEventListener('click', () => {
    clearRefreshTimer();
    setTimeout(() => { void refresh(); }, 0);
  });

  window.addEventListener('codexagent:extensions-updated', () => {
    void refresh();
  });
});

export {};
