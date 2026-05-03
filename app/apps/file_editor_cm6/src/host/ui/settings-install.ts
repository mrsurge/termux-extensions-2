
import { EXPLORER_RPC_METHODS } from '../../explorer/rpc/contract.ts';

/**
 * @param {{
 *   installBtn: HTMLButtonElement,
 *   pickerAvailable: () => boolean,
 *   pickFile: (startPath: string) => Promise<string | null>,
 *   getStartPath: () => string,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   refreshExtManager: () => Promise<any> | void,
 *   reloadEditorFrame: () => void,
 *   openExtConfigModal: (extId: string, displayName: string, schema: any, currentValues: any) => void,
 *   toast: (msg: string, ms?: number) => void
 * }} deps
 */
export function createSettingsInstallController(deps) {
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
        const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsInstall, { vsix_path: picked }, 60000);
        if (res?.ok) {
          const ext = res.extension || {};
          const schema = res.config_schema || {};
          deps.toast(`Installed: ${ext.display_name || ext.id || 'ok'} — reloading…`);
          void deps.refreshExtManager();
          deps.reloadEditorFrame();
          if (schema && Object.keys(schema.properties || schema || {}).length) {
            deps.openExtConfigModal(ext.id, ext.display_name, schema, {});
          }
        } else {
          deps.toast(res?.error || 'Install failed');
        }
      } catch (e) {
        deps.toast(/** @type {any} */ (e)?.message || 'Install failed');
      } finally {
        deps.installBtn.disabled = false;
        deps.installBtn.textContent = '+ Install';
      }
    });
  }

  return { install };
}
