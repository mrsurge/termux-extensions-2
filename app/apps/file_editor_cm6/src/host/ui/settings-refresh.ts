// @ts-nocheck

/**
 * @param {{
 *   getEditorViewState: () => any,
 *   themeSummaryEl: HTMLElement,
 *   extSummaryEl: HTMLElement,
 *   customSettingsInputEl: HTMLTextAreaElement,
 *   customSettingsSaveEl: HTMLButtonElement,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   toast: (msg: string, ms?: number) => void,
 *   reloadEditorIframe: () => void
 * }} deps
 */
export function createSettingsRefreshController(deps) {
  // ── Scope tab switching ──
  let activeScope = 'user';

  function installScopeTabs() {
    const tabs = document.querySelectorAll('#settings-scope-tabs .settings-scope-tab');
    const userPane = document.getElementById('settings-scope-user');
    const wsPane = document.getElementById('settings-scope-workspace');
    const modal = document.getElementById('editor-ext-manager-modal');
    if (!tabs.length || !userPane || !wsPane || !modal) return;

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const scope = /** @type {string} */ (tab.dataset.scope);
        if (scope === activeScope) return;
        activeScope = scope;

        tabs.forEach((t) => {
          const isActive = t.dataset.scope === scope;
          t.classList.toggle('active', isActive);
          /** @type {HTMLElement} */ (t).style.borderBottomColor =
            isActive ? 'var(--fe-accent, #58a6ff)' : 'transparent';
          /** @type {HTMLElement} */ (t).style.color =
            isActive ? 'var(--fg, #e6edf3)' : 'var(--fg-dim, #6e7681)';
        });

        userPane.style.display = scope === 'user' ? '' : 'none';
        wsPane.style.display = scope === 'workspace' ? '' : 'none';

        // Toggle workspace class on modal to hide toggle/uninstall/install via CSS
        modal.classList.toggle('ext-scope-workspace', scope === 'workspace');

        if (scope === 'workspace') loadWorkspaceSettings();
      });
    });
  }

  // ── User settings (existing) ──
  async function loadCustomSettings() {
    try {
      const res = await window.__explorerBusRequest('ext:custom_settings_get', {}, 8000);
      const settings = res?.payload?.settings || {};
      const keys = Object.keys(settings);
      deps.customSettingsInputEl.value = keys.length
        ? JSON.stringify(settings, null, 2)
        : '';
    } catch (_) {
      deps.customSettingsInputEl.value = '';
    }
  }

  // ── Workspace settings ──
  async function loadWorkspaceSettings() {
    const input = /** @type {HTMLTextAreaElement|null} */ (
      document.getElementById('editor-ext-workspace-settings-input'));
    if (!input) return;
    try {
      const res = await window.__explorerBusRequest('ext:workspace_settings_get', {}, 8000);
      const settings = res?.payload?.settings || {};
      const keys = Object.keys(settings);
      input.value = keys.length ? JSON.stringify(settings, null, 2) : '';
    } catch (_) {
      input.value = '';
    }
  }

  function installWorkspaceSettingsSaveHandler() {
    const saveBtn = /** @type {HTMLButtonElement|null} */ (
      document.getElementById('editor-ext-workspace-settings-save'));
    const input = /** @type {HTMLTextAreaElement|null} */ (
      document.getElementById('editor-ext-workspace-settings-input'));
    if (!saveBtn || !input) return;

    saveBtn.addEventListener('click', async () => {
      const raw = input.value.trim();
      let parsed = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          deps.toast('Invalid JSON: ' + /** @type {any} */ (e).message);
          return;
        }
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          deps.toast('Settings must be a JSON object');
          return;
        }
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const res = await deps.busRequest('ext:workspace_settings_set', { settings: parsed }, 15000);
        if (res?.payload?.ok) {
          deps.toast(`Workspace settings saved (${res.payload.count} keys) — reloading adapter…`);
          deps.reloadEditorIframe();
        } else {
          deps.toast(res?.payload?.error || 'Save failed');
        }
      } catch (e) {
        deps.toast(/** @type {any} */ (e)?.message || 'Save failed');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  async function refreshEditorSettingsModal() {
    const currentTheme = deps.getEditorViewState()?.theme || 'github-dark-default';
    try {
      const res = await fetch('/api/app/file_editor_cm6/ui/monaco_editor/available_themes', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const themes = data?.themes || [];
        const active = themes.find((t) => t.id === currentTheme);
        const label = active ? active.label : currentTheme;
        deps.themeSummaryEl.textContent = `${label} — ${themes.length} available`;
      } else {
        deps.themeSummaryEl.textContent = currentTheme;
      }
    } catch (_) {
      deps.themeSummaryEl.textContent = currentTheme;
    }

    try {
      if (typeof window.__explorerBusRequest === 'function') {
        const res = await window.__explorerBusRequest('ext:list', {}, 8000);
        const exts = res?.payload?.extensions || [];
        const active = exts.filter((e) => e.active);
        const user = exts.filter((e) => e.source === 'user');
        deps.extSummaryEl.textContent =
          `${active.length} active, ${user.length} user-installed, ${exts.length} total`;
      }
    } catch (_) {
      deps.extSummaryEl.textContent = 'Click to manage';
    }

    try {
      if (typeof window.__explorerBusSend === 'function') {
        window.__explorerBusSend('watcher:getConfig', {});
      }
    } catch (_) {}
  }

  function installCustomSettingsSaveHandler() {
    deps.customSettingsSaveEl.addEventListener('click', async () => {
      const raw = deps.customSettingsInputEl.value.trim();
      let parsed = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          deps.toast('Invalid JSON: ' + /** @type {any} */ (e).message);
          return;
        }
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          deps.toast('Settings must be a JSON object');
          return;
        }
      }
      deps.customSettingsSaveEl.disabled = true;
      deps.customSettingsSaveEl.textContent = 'Saving…';
      try {
        const res = await deps.busRequest('ext:custom_settings_set', { settings: parsed }, 15000);
        if (res?.payload?.ok) {
          deps.toast(`Custom settings saved (${res.payload.count} keys) — reloading adapter…`);
          deps.reloadEditorIframe();
        } else {
          deps.toast(res?.payload?.error || 'Save failed');
        }
      } catch (e) {
        deps.toast(/** @type {any} */ (e)?.message || 'Save failed');
      } finally {
        deps.customSettingsSaveEl.disabled = false;
        deps.customSettingsSaveEl.textContent = 'Save';
      }
    });
  }

  return {
    loadCustomSettings,
    loadWorkspaceSettings,
    refreshEditorSettingsModal,
    installCustomSettingsSaveHandler,
    installWorkspaceSettingsSaveHandler,
    installScopeTabs,
    getActiveScope: () => activeScope,
  };
}
