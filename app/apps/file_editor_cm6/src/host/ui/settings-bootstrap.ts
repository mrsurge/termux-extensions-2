// @ts-check

import { createSettingsRefreshController } from './settings-refresh.ts';
import { createSettingsManagerController } from './settings-manager.ts';
import { createSettingsConfigModalController } from './settings-config-modal.ts';
import { createSettingsInstallController } from './settings-install.ts';
import { createSettingsThemesController } from './settings-themes.ts';
import { createSettingsModalsController } from './settings-modals.ts';

/**
 * @param {{
 *   els: {
 *     settingsModal: HTMLElement,
 *     settingsClose: HTMLElement,
 *     menuEditorSettings: HTMLElement,
 *     extManagerModal: HTMLElement,
 *     extManagerClose: HTMLElement,
 *     settingsExtStrip: HTMLElement,
 *     themesModal: HTMLElement,
 *     themesClose: HTMLElement,
 *     themesList: HTMLElement,
 *     settingsThemeStrip: HTMLElement,
 *     settingsThemeSummary: HTMLElement,
 *     extConfigModal: HTMLElement,
 *     extConfigTitle: HTMLElement,
 *     extConfigForm: HTMLElement,
 *     extConfigClose: HTMLElement,
 *     extConfigCancel: HTMLElement,
 *     extConfigSave: HTMLButtonElement,
 *     extManagerInstallBtn: HTMLButtonElement,
 *     extCustomSettingsInput: HTMLTextAreaElement,
 *     extCustomSettingsSave: HTMLButtonElement,
 *     extSummary: HTMLElement,
 *     extManagerList: HTMLElement,
 *   },
 *   closeAllMenus: () => void,
 *   getEditorViewState: () => any,
 *   setEditorTheme: (themeId: string) => void,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   pickerAvailable: () => boolean,
 *   pickFile: (startPath: string) => Promise<string | null>,
 *   getStartPath: () => string,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   busNotify: (event: string, payload?: any) => void,
 *   reloadEditorIframe: () => void,
 *   toast: (msg: string, ms?: number) => void,
 * }} deps
 */
export function createSettingsBootstrap(deps) {
  let settingsManagerController = null;
  let settingsConfigModalController = null;

  const settingsRefreshController = createSettingsRefreshController({
    getEditorViewState: deps.getEditorViewState,
    themeSummaryEl: deps.els.settingsThemeSummary,
    extSummaryEl: deps.els.extSummary,
    customSettingsInputEl: deps.els.extCustomSettingsInput,
    customSettingsSaveEl: deps.els.extCustomSettingsSave,
    busRequest: deps.busRequest,
    busNotify: deps.busNotify,
    toast: deps.toast,
    reloadEditorIframe: deps.reloadEditorIframe,
  });

  function openExtConfigModal(extId, displayName, schema, currentValues) {
    const scope = settingsRefreshController.getActiveScope();
    settingsConfigModalController?.openExtConfigModal(extId, displayName, schema, currentValues, scope);
  }

  async function refreshEditorExtManagerModal() {
    return settingsManagerController?.refreshEditorExtManagerModal();
  }

  async function loadCustomSettings() {
    return settingsRefreshController.loadCustomSettings();
  }

  async function refreshEditorSettingsModal() {
    return settingsRefreshController.refreshEditorSettingsModal();
  }

  const settingsModalsController = createSettingsModalsController({
    settingsModalEl: deps.els.settingsModal,
    settingsCloseEl: deps.els.settingsClose,
    menuEditorSettingsEl: deps.els.menuEditorSettings,
    extManagerModalEl: deps.els.extManagerModal,
    extManagerCloseEl: deps.els.extManagerClose,
    settingsExtStripEl: deps.els.settingsExtStrip,
    closeAllMenus: deps.closeAllMenus,
    refreshEditorSettingsModal: () => refreshEditorSettingsModal(),
    refreshEditorExtManagerModal: () => refreshEditorExtManagerModal(),
    loadCustomSettings: () => loadCustomSettings(),
  });
  settingsModalsController.install();

  const settingsThemesController = createSettingsThemesController({
    themesModalEl: deps.els.themesModal,
    themesCloseEl: deps.els.themesClose,
    themesListEl: deps.els.themesList,
    settingsThemeStripEl: deps.els.settingsThemeStrip,
    settingsThemeSummaryEl: deps.els.settingsThemeSummary,
    getEditorViewState: deps.getEditorViewState,
    setEditorTheme: deps.setEditorTheme,
    updatePreference: deps.updatePreference,
    toast: deps.toast,
  });
  settingsThemesController.install();

  settingsConfigModalController = createSettingsConfigModalController({
    modalEl: deps.els.extConfigModal,
    titleEl: deps.els.extConfigTitle,
    formEl: deps.els.extConfigForm,
    closeBtn: deps.els.extConfigClose,
    cancelBtn: deps.els.extConfigCancel,
    saveBtn: deps.els.extConfigSave,
    busRequest: deps.busRequest,
    refreshExtManager: () => refreshEditorExtManagerModal(),
    reloadEditorIframe: deps.reloadEditorIframe,
    toast: deps.toast,
  });
  settingsConfigModalController.install();

  settingsManagerController = createSettingsManagerController({
    extManagerListEl: deps.els.extManagerList,
    busRequest: deps.busRequest,
    reloadEditorIframe: deps.reloadEditorIframe,
    openExtConfigModal,
    getActiveScope: () => settingsRefreshController.getActiveScope(),
    toast: deps.toast,
  });

  settingsRefreshController.installCustomSettingsSaveHandler();
  settingsRefreshController.installWorkspaceSettingsSaveHandler();
  settingsRefreshController.installScopeTabs();

  const settingsInstallController = createSettingsInstallController({
    installBtn: deps.els.extManagerInstallBtn,
    pickerAvailable: deps.pickerAvailable,
    pickFile: deps.pickFile,
    getStartPath: deps.getStartPath,
    busRequest: deps.busRequest,
    refreshExtManager: () => refreshEditorExtManagerModal(),
    reloadEditorIframe: deps.reloadEditorIframe,
    openExtConfigModal,
    toast: deps.toast,
  });
  settingsInstallController.install();

}
