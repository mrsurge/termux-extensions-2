
import { EXPLORER_RPC_METHODS } from '../../../src/explorer/rpc/contract.ts';

/**
 * @param {{
 *   extManagerListEl: HTMLElement,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   reloadEditorFrame: () => void,
 *   openExtConfigModal: (extId: string, displayName: string, schema: any, currentValues: any) => void,
 *   getActiveScope: () => string,
 *   toast: (msg: string, ms?: number) => void
 * }} deps
 */
export function createSettingsManagerController(deps: any) {
  async function refreshEditorExtManagerModal() {
    deps.extManagerListEl.textContent = 'Loading…';
    let extensions = [];
    let langSlots = {};
    try {
      const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsList, {}, 10000);
      extensions = res?.extensions || [];
      langSlots = res?.language_slots || {};
    } catch (e) {
      deps.extManagerListEl.textContent = `Failed to load: ${(e as { message?: string })?.message || 'unknown error'}`;
      return;
    }

    deps.extManagerListEl.innerHTML = '';
    if (!extensions.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '0.8';
      empty.textContent = 'No extensions registered.';
      deps.extManagerListEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';

    extensions
      .slice()
      .sort((a: any, b: any) => {
        // user extensions first, then builtins
        if (a.source !== b.source) return a.source === 'user' ? -1 : 1;
        return String(a.display_name || a.id).localeCompare(String(b.display_name || b.id));
      })
      .forEach((ext: any) => {
        const extId = String(ext.id || '').trim();
        if (!extId) return;
        const label = String(ext.display_name || extId);
        const version = String(ext.version || '');
        const isBuiltin = ext.source === 'builtin';
        const isActive = !!ext.active;
        const langs = ext.languages || [];
        const hasConfig = !!ext.has_config;

        const card = document.createElement('div');
        card.style.display = 'flex';
        card.style.alignItems = 'flex-start';
        card.style.gap = '10px';
        card.style.padding = '10px 12px';
        card.style.border = '1px solid var(--border, #333)';
        card.style.borderRadius = '10px';
        if (!isActive) card.style.opacity = '0.5';

        // Left: info
        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.minWidth = '0';

        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.alignItems = 'center';
        titleRow.style.gap = '6px';
        titleRow.style.flexWrap = 'wrap';

        const nameEl = document.createElement('span');
        nameEl.textContent = label;
        nameEl.style.fontWeight = '700';
        titleRow.appendChild(nameEl);

        if (version) {
          const verEl = document.createElement('span');
          verEl.textContent = `v${version}`;
          verEl.style.opacity = '0.5';
          verEl.style.fontSize = '12px';
          titleRow.appendChild(verEl);
        }

        const badge = document.createElement('span');
        badge.textContent = isBuiltin ? 'built-in' : 'user';
        badge.style.fontSize = '10px';
        badge.style.padding = '1px 6px';
        badge.style.borderRadius = '4px';
        badge.style.border = '1px solid var(--border, #333)';
        badge.style.opacity = '0.6';
        titleRow.appendChild(badge);
        info.appendChild(titleRow);

        if (langs.length) {
          const langEl = document.createElement('div');
          langEl.style.fontSize = '12px';
          langEl.style.opacity = '0.7';
          langEl.style.marginTop = '2px';
          langEl.textContent = langs.join(', ');
          info.appendChild(langEl);
        }

        card.appendChild(info);

        // Right: action buttons
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        actions.style.alignItems = 'center';
        actions.style.flexShrink = '0';

        // Active toggle
        const toggle = document.createElement('button');
        toggle.className = 'fe-btn ext-toggle-btn';
        toggle.textContent = isActive ? '●' : '○';
        toggle.title = isActive ? 'Deactivate' : 'Activate';
        toggle.style.fontSize = '14px';
        toggle.style.color = isActive ? 'var(--primary, #3b82f6)' : '';
        toggle.addEventListener('click', async () => {
          toggle.disabled = true;
          try {
            await deps.busRequest(EXPLORER_RPC_METHODS.extensionsToggle, {
              ext_id: extId,
              active: !isActive,
            }, 10000);
            deps.reloadEditorFrame();
            void refreshEditorExtManagerModal();
          } catch (e) {
            deps.toast((e as { message?: string })?.message || 'Toggle failed');
          } finally {
            toggle.disabled = false;
          }
        });
        actions.appendChild(toggle);

        // Configure button (only if extension has config)
        if (hasConfig) {
          const cfgBtn = document.createElement('button');
          cfgBtn.className = 'fe-btn';
          cfgBtn.textContent = '⚙';
          cfgBtn.title = 'Configure';
          cfgBtn.addEventListener('click', async () => {
            cfgBtn.disabled = true;
            try {
              const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsConfigSchemaGet, {
                ext_id: extId,
              }, 10000);
              const schema = res?.schema || {};
              const schemaKeys = Object.keys(schema?.properties || schema || {});
              const scope = deps.getActiveScope();

              const currentValues: Record<string, any> = {};
              if (scope === 'workspace') {
                // Load from .vscode/settings.json — extract keys matching this extension's schema
                try {
                  const wsRes = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsWorkspaceSettingsGet, {}, 5000);
                  const wsSettings = wsRes?.settings || {};
                  for (const k of schemaKeys) {
                    if (k in wsSettings) currentValues[k] = wsSettings[k];
                  }
                } catch (_) {}
              } else {
                // Load from global extension config
                try {
                  const listRes = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsList, {}, 5000);
                  const fullExt = (listRes?.extensions || []).find((e: any) => e.id === extId);
                  if (fullExt?.configuration_values) Object.assign(currentValues, fullExt.configuration_values);
                } catch (_) {}
              }
              deps.openExtConfigModal(extId, label, schema, currentValues);
            } catch (e) {
              deps.toast((e as { message?: string })?.message || 'Failed to load config');
            } finally {
              cfgBtn.disabled = false;
            }
          });
          actions.appendChild(cfgBtn);
        }

        // Uninstall button (only for user extensions)
        if (!isBuiltin) {
          const trash = document.createElement('button');
          trash.className = 'fe-btn ext-uninstall-btn';
          trash.textContent = '🗑';
          trash.title = 'Uninstall';
          trash.addEventListener('click', async () => {
            if (!window.confirm(`Uninstall ${label}?`)) return;
            trash.disabled = true;
            try {
              const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsUninstall, {
                ext_id: extId,
              }, 30000);
              if (res?.ok) {
                deps.toast(`Uninstalled: ${label} — reloading…`);
                deps.reloadEditorFrame();
                void refreshEditorExtManagerModal();
              } else {
                deps.toast(res?.error || 'Uninstall failed');
              }
            } catch (e) {
              deps.toast((e as { message?: string })?.message || 'Uninstall failed');
            } finally {
              trash.disabled = false;
            }
          });
          actions.appendChild(trash);
        }

        card.appendChild(actions);
        list.appendChild(card);
      });

    deps.extManagerListEl.appendChild(list);
  }

  return { refreshEditorExtManagerModal };
}
