// @ts-check

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
          deps.toast('Invalid JSON: ' + e.message);
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
        deps.toast(e?.message || 'Save failed');
      } finally {
        deps.customSettingsSaveEl.disabled = false;
        deps.customSettingsSaveEl.textContent = 'Save';
      }
    });
  }

  return { loadCustomSettings, refreshEditorSettingsModal, installCustomSettingsSaveHandler };
}
