import { settingsRequest, type SettingsRequest, type SettingsNotify, type ExtensionSummary, objectValue, configProperties, type ConfigProperty } from './settings-contracts.ts';

import { EXPLORER_RPC_METHODS } from '../../../src/explorer/rpc/contract.ts';

interface Dependencies {  installBtn: HTMLButtonElement,
  pickerAvailable: () => boolean,
  pickFile: (startPath: string) => Promise<string | null>,
  getStartPath: () => string,
  busRequest: SettingsRequest,
  refreshExtManager: () => Promise<unknown> | void,
  reloadEditorFrame: () => void,
  openExtConfigModal: (extId: string, displayName: string, schema: unknown, currentValues: unknown) => void,
  toast: (msg: string, ms?: number) => void
}

export function createSettingsInstallController(deps: Dependencies) {
  const busRequest = settingsRequest(deps.busRequest);
  function install() {
    deps.installBtn.addEventListener('click', async () => {
      if (!deps.pickerAvailable()) {
        deps.toast('File picker unavailable');
        return;
      }
      const picked = await deps.pickFile(deps.getStartPath());
      if (!picked) return;
      if (!picked.toLowerCase().endsWith('.vsix')) {
        deps.toast('Not a .vsix file');
        return;
      }

      deps.installBtn.disabled = true;
      deps.installBtn.textContent = 'Installing…';
      try {
        const res = await busRequest(EXPLORER_RPC_METHODS.extensionsInstall, { vsix_path: picked }, 60000);
        if (res?.ok) {
          const ext = res.extension || {};
          const schema = res.config_schema || {};
          deps.toast(`Installed: ${ext.display_name || ext.id || 'ok'} — restarting adapter…`);
          void deps.refreshExtManager();
          if (schema && Object.keys(schema.properties || schema || {}).length) {
            deps.openExtConfigModal(ext.id, ext.display_name, schema, {});
          }
        } else {
          deps.toast(res?.error || 'Install failed');
        }
      } catch (e) {
        deps.toast((e as { message?: string })?.message || 'Install failed');
      } finally {
        deps.installBtn.disabled = false;
        deps.installBtn.textContent = '+ Install';
      }
    });
  }

  return { install };
}
