import type { EditorViewState } from '../../../main.ts';
import { settingsRequest, type SettingsRequest, type SettingsNotify, type ExtensionSummary, objectValue, configProperties, type ConfigProperty } from './settings-contracts.ts';
// @ts-check

import type { RequestThemeCatalog } from '../../../src/theme_catalog.ts';
import { createSettingsRefreshController } from './settings-refresh.ts';
import { createSettingsManagerController } from './settings-manager.ts';
import { createSettingsConfigModalController } from './settings-config-modal.ts';
import { createSettingsInstallController } from './settings-install.ts';
import { createSettingsThemesController } from './settings-themes.ts';
import { createSettingsModalsController } from './settings-modals.ts';

interface Dependencies {  els: {
    settingsModal: HTMLElement,
    settingsClose: HTMLElement,
    settingsConsoleWorkerId: HTMLElement,
    settingsClientIdentity: HTMLElement,
    settingsClientCopy: HTMLButtonElement,
    settingsClientReset: HTMLButtonElement,
    menuEditorSettings: HTMLElement,
    extManagerModal: HTMLElement,
    extManagerClose: HTMLElement,
    settingsExtStrip: HTMLElement,
    themesModal: HTMLElement,
    themesClose: HTMLElement,
    themesList: HTMLElement,
    settingsThemeStrip: HTMLElement,
    settingsThemeSummary: HTMLElement,
    settingsCursorStyle: HTMLElement,
    extConfigModal: HTMLElement,
    extConfigTitle: HTMLElement,
    extConfigForm: HTMLElement,
    extConfigClose: HTMLElement,
    extConfigCancel: HTMLElement,
    extConfigSave: HTMLButtonElement,
    extManagerInstallBtn: HTMLButtonElement,
    extCustomSettingsInput: HTMLTextAreaElement,
    extCustomSettingsSave: HTMLButtonElement,
    extSummary: HTMLElement,
    extManagerList: HTMLElement,
  },
  closeAllMenus: () => void,
  getEditorViewState: () => EditorViewState | null,
  getUiPrefs: () => Record<string, unknown>,
  setEditorTheme: (themeId: string) => void,
  updatePreference: (key: string, value: unknown) => Promise<boolean>,
  pickerAvailable: () => boolean,
  pickFile: (startPath: string) => Promise<string | null>,
  getStartPath: () => string,
  busRequest: SettingsRequest,
  busNotify: SettingsNotify,
  requestLanguageBackendSet: (mode: "code-server" | "web-workers") => Promise<unknown>,
  reloadEditorFrame: () => void,
  getConsoleWorkerId: () => string | null,
  getClientIdentity: () => {clientInstanceId: string, provider: string, label: string},
  resetClientIdentity: () => Promise<void>,
  toast: (msg: string, ms?: number) => void,
  requestThemeCatalog: RequestThemeCatalog;
  refreshTerminalDestinationSettings: () => Promise<void>;
}

export function createSettingsBootstrap(deps: Dependencies) {
  const busRequest = settingsRequest(deps.busRequest);
  let settingsManagerController: ReturnType<typeof createSettingsManagerController> | null = null;
  let settingsConfigModalController: ReturnType<typeof createSettingsConfigModalController> | null = null;

  const requestThemeCatalog: RequestThemeCatalog = deps.requestThemeCatalog;

  const settingsRefreshController = createSettingsRefreshController({
    requestThemeCatalog,
    getEditorViewState: deps.getEditorViewState,
    getUiPrefs: deps.getUiPrefs,
    settingsModalEl: deps.els.settingsModal,
    themeSummaryEl: deps.els.settingsThemeSummary,
    cursorStyleEl: deps.els.settingsCursorStyle,
    extSummaryEl: deps.els.extSummary,
    customSettingsInputEl: deps.els.extCustomSettingsInput,
    customSettingsSaveEl: deps.els.extCustomSettingsSave,
    extManagerModalEl: deps.els.extManagerModal,
    busRequest: deps.busRequest,
    busNotify: deps.busNotify,
    requestLanguageBackendSet: deps.requestLanguageBackendSet,
    toast: deps.toast,
    reloadEditorFrame: deps.reloadEditorFrame,
    updatePreference: deps.updatePreference,
  });

  function openExtConfigModal(extId: string, displayName: string, schema: unknown, currentValues: unknown) {
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
    await deps.refreshTerminalDestinationSettings?.();
    return settingsRefreshController.refreshEditorSettingsModal();
  }

  const settingsModalsController = createSettingsModalsController({
    settingsModalEl: deps.els.settingsModal,
    settingsCloseEl: deps.els.settingsClose,
    settingsConsoleWorkerIdEl: deps.els.settingsConsoleWorkerId,
    settingsClientIdentityEl: deps.els.settingsClientIdentity,
    settingsClientCopyEl: deps.els.settingsClientCopy,
    settingsClientResetEl: deps.els.settingsClientReset,
    menuEditorSettingsEl: deps.els.menuEditorSettings,
    extManagerModalEl: deps.els.extManagerModal,
    extManagerCloseEl: deps.els.extManagerClose,
    settingsExtStripEl: deps.els.settingsExtStrip,
    closeAllMenus: deps.closeAllMenus,
    refreshEditorSettingsModal: () => refreshEditorSettingsModal(),
    refreshEditorExtManagerModal: () => refreshEditorExtManagerModal(),
    loadCustomSettings: () => loadCustomSettings(),
    getConsoleWorkerId: deps.getConsoleWorkerId,
    getClientIdentity: deps.getClientIdentity,
    resetClientIdentity: deps.resetClientIdentity,
    toast: deps.toast,
  });
  settingsModalsController.install();

  const settingsThemesController = createSettingsThemesController({
    requestThemeCatalog,
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
    reloadEditorFrame: deps.reloadEditorFrame,
    toast: deps.toast,
  });
  settingsConfigModalController.install();

  settingsManagerController = createSettingsManagerController({
    extManagerListEl: deps.els.extManagerList,
    busRequest: deps.busRequest,
    reloadEditorFrame: deps.reloadEditorFrame,
    openExtConfigModal,
    getActiveScope: () => settingsRefreshController.getActiveScope(),
    toast: deps.toast,
  });

  settingsRefreshController.installCustomSettingsSaveHandler();
  settingsRefreshController.installWorkspaceSettingsSaveHandler();
  settingsRefreshController.installScopeTabs();
  settingsRefreshController.installLanguageBackendPreference();
  settingsRefreshController.installCursorStylePreference();

  const settingsInstallController = createSettingsInstallController({
    installBtn: deps.els.extManagerInstallBtn,
    pickerAvailable: deps.pickerAvailable,
    pickFile: deps.pickFile,
    getStartPath: deps.getStartPath,
    busRequest: deps.busRequest,
    refreshExtManager: () => refreshEditorExtManagerModal(),
    reloadEditorFrame: deps.reloadEditorFrame,
    openExtConfigModal,
    toast: deps.toast,
  });
  settingsInstallController.install();

  window.addEventListener('code-te2:extension-installed', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = objectValue(event.detail);
    const extension = objectValue(detail.extension), schema = objectValue(detail.schema);
    if (!extension || typeof extension.id !== 'string' || !schema || typeof schema !== 'object') return;
    if (!Object.keys(configProperties(schema)).length) return;
    openExtConfigModal(extension.id, typeof extension.display_name === 'string' ? extension.display_name : extension.id, schema, {});
  });
  window.addEventListener('code-te2:extension-configure', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const { extId, displayName } = objectValue(event.detail);
    if (typeof extId !== 'string' || !extId) return;
    void settingsManagerController.openExtensionSettings(extId,
      typeof displayName === 'string' ? displayName : extId).catch((error: unknown) => {
      deps.toast(error instanceof Error ? error.message : 'Failed to load config');
    });
  });
  window.addEventListener('code-te2:extension-contributions-changed', () => {
    if (deps.els.extManagerModal.classList.contains('show')) void refreshEditorExtManagerModal();
    if (deps.els.settingsModal.classList.contains('show')) void refreshEditorSettingsModal();
    if (deps.els.themesModal.classList.contains('show')) void settingsThemesController.refreshEditorThemesModal();
  });

}
