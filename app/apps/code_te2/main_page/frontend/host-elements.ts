export type RequireElement = (selector: string) => HTMLElement;

export interface HostElements {
  cacheStateBadge: HTMLElement;
  container: HTMLElement;
  editorFrameEl: HTMLElement;
  root: HTMLElement;
  sidebarDrawerEl: HTMLElement;
  issuesBadgesEl: HTMLButtonElement;
  statusEl: HTMLElement;
  menuFileBtn: HTMLElement;
  menuFileDD: HTMLElement;
  menuEditBtn: HTMLElement;
  menuEditDD: HTMLElement;
  menuEditorBtn: HTMLElement;
  menuEditorDD: HTMLElement;
  menuViewBtn: HTMLElement;
  menuViewDD: HTMLElement;
  fileTabsViewport: HTMLElement;
  fileTabsTrack: HTMLElement;
  runActiveBtn: HTMLButtonElement;
  stopRunProfilesBtn: HTMLButtonElement;
  miNew: HTMLElement;
  miOpen: HTMLElement;
  miSave: HTMLElement;
  miSaveAs: HTMLElement;
  miClose: HTMLElement;
  miQuit: HTMLElement;
  miRunProfiles: HTMLElement;
  miInstallPagePreview: HTMLElement;
  miDebugProjects: HTMLElement;
  miUndo: HTMLElement;
  miRedo: HTMLElement;
  miCut: HTMLElement;
  miCopy: HTMLElement;
  miPaste: HTMLElement;
  miSelectAll: HTMLElement;
  miToggleLines: HTMLElement;
  miToggleSyntax: HTMLElement;
  miToggleCloseBrackets: HTMLElement;
  miToggleAutocomplete: HTMLElement;
  miToggleInlayHints: HTMLElement;
  miToggleShading: HTMLElement;
  miToggleIndentGuides: HTMLElement;
  miToggleWrap: HTMLElement;
  miToggleAutosave: HTMLElement;
  miToggleDiffs: HTMLElement;
  miToggleDraftDiffs: HTMLElement;
  miToggleColorPicker: HTMLElement;
  miToggleReadonly: HTMLElement;
  miToggleStickyScroll: HTMLElement;
  miTrackAgentSidebarEdits: HTMLElement;
  miFind: HTMLElement;
  miGoto: HTMLElement;
  miExportDiagnostics: HTMLElement;
  miEditorSettings: HTMLElement;
  miToggleMinimap: HTMLElement;
  editorSettingsModal: HTMLElement;
  editorSettingsClose: HTMLElement;
  editorSettingsConsoleWorkerId: HTMLElement;
  editorSettingsClientIdentity: HTMLElement;
  editorSettingsClientCopy: HTMLButtonElement;
  editorSettingsClientReset: HTMLButtonElement;
  editorSettingsExtStrip: HTMLElement;
  editorSettingsExtSummary: HTMLElement;
  editorSettingsThemeStrip: HTMLElement;
  editorSettingsThemeSummary: HTMLElement;
  editorThemesModal: HTMLElement;
  editorThemesClose: HTMLElement;
  editorThemesList: HTMLElement;
  editorExtManagerModal: HTMLElement;
  editorExtManagerClose: HTMLElement;
  editorExtManagerInstallBtn: HTMLButtonElement;
  editorExtManagerList: HTMLElement;
  extCustomSettingsInput: HTMLTextAreaElement;
  extCustomSettingsSave: HTMLButtonElement;
  extConfigModal: HTMLElement;
  extConfigTitle: HTMLElement;
  extConfigClose: HTMLElement;
  extConfigForm: HTMLElement;
  extConfigCancel: HTMLElement;
  extConfigSave: HTMLButtonElement;
}

export function captureHostElements(requireEl: RequireElement): HostElements {
  return {
    cacheStateBadge: requireEl('#fe-file-draft-badge'),
    container: requireEl('#editor-container'),
    editorFrameEl: requireEl('#editor-frame'),
    root: requireEl('.fe-root'),
    sidebarDrawerEl: requireEl('#agent-drawer'),
    issuesBadgesEl: requireEl('#fe-issues-badges') as HTMLButtonElement,
    statusEl: requireEl('#fe-status'),
    menuFileBtn: requireEl('#menu-file-btn'),
    menuFileDD: requireEl('#menu-file-dd'),
    menuEditBtn: requireEl('#menu-edit-btn'),
    menuEditDD: requireEl('#menu-edit-dd'),
    menuEditorBtn: requireEl('#menu-editor-btn'),
    menuEditorDD: requireEl('#menu-editor-dd'),
    menuViewBtn: requireEl('#menu-view-btn'),
    menuViewDD: requireEl('#menu-view-dd'),
    fileTabsViewport: requireEl('#recent-file-tabs'),
    fileTabsTrack: requireEl('#recent-file-tabs-track'),
    runActiveBtn: requireEl('#run-active-file-btn') as HTMLButtonElement,
    stopRunProfilesBtn: requireEl('#stop-run-profiles-btn') as HTMLButtonElement,
    miNew: requireEl('#mi-new'),
    miOpen: requireEl('#mi-open'),
    miSave: requireEl('#mi-save'),
    miSaveAs: requireEl('#mi-saveas'),
    miClose: requireEl('#mi-close'),
    miQuit: requireEl('#mi-quit'),
    miRunProfiles: requireEl('#mi-run-profiles'),
    miInstallPagePreview: requireEl('#mi-install-page-preview'),
    miDebugProjects: requireEl('#mi-debug-projects'),
    miUndo: requireEl('#mi-undo'),
    miRedo: requireEl('#mi-redo'),
    miCut: requireEl('#mi-cut'),
    miCopy: requireEl('#mi-copy'),
    miPaste: requireEl('#mi-paste'),
    miSelectAll: requireEl('#mi-selectall'),
    miToggleLines: requireEl('#mi-toggle-lines'),
    miToggleSyntax: requireEl('#mi-toggle-syntax'),
    miToggleCloseBrackets: requireEl('#mi-toggle-closebrackets'),
    miToggleAutocomplete: requireEl('#mi-toggle-autocomplete'),
    miToggleInlayHints: requireEl('#mi-toggle-inlay-hints'),
    miToggleShading: requireEl('#mi-toggle-shading'),
    miToggleIndentGuides: requireEl('#mi-toggle-indent-guides'),
    miToggleWrap: requireEl('#mi-toggle-wrap'),
    miToggleAutosave: requireEl('#mi-toggle-autosave'),
    miToggleDiffs: requireEl('#mi-toggle-diffs'),
    miToggleDraftDiffs: requireEl('#mi-toggle-draft-diffs'),
    miToggleColorPicker: requireEl('#mi-toggle-color-picker'),
    miToggleReadonly: requireEl('#mi-toggle-readonly'),
    miToggleStickyScroll: requireEl('#mi-toggle-sticky-scroll'),
    miTrackAgentSidebarEdits: requireEl('#mi-track-agent-sidebar-edits'),
    miFind: requireEl('#mi-find'),
    miGoto: requireEl('#mi-goto'),
    miExportDiagnostics: requireEl('#mi-export-diagnostics'),
    miEditorSettings: requireEl('#mi-editor-settings'),
    miToggleMinimap: requireEl('#mi-toggle-minimap'),
    editorSettingsModal: requireEl('#editor-settings-modal'),
    editorSettingsClose: requireEl('#editor-settings-close'),
    editorSettingsConsoleWorkerId: requireEl('#editor-settings-console-worker-id'),
    editorSettingsClientIdentity: requireEl('#editor-settings-client-identity'),
    editorSettingsClientCopy: requireEl('#editor-settings-client-copy') as HTMLButtonElement,
    editorSettingsClientReset: requireEl('#editor-settings-client-reset') as HTMLButtonElement,
    editorSettingsExtStrip: requireEl('#editor-settings-ext-strip'),
    editorSettingsExtSummary: requireEl('#editor-settings-ext-summary'),
    editorSettingsThemeStrip: requireEl('#editor-settings-theme-strip'),
    editorSettingsThemeSummary: requireEl('#editor-settings-theme-summary'),
    editorThemesModal: requireEl('#editor-themes-modal'),
    editorThemesClose: requireEl('#editor-themes-close'),
    editorThemesList: requireEl('#editor-themes-list'),
    editorExtManagerModal: requireEl('#editor-ext-manager-modal'),
    editorExtManagerClose: requireEl('#editor-ext-manager-close'),
    editorExtManagerInstallBtn: requireEl('#editor-ext-manager-install') as HTMLButtonElement,
    editorExtManagerList: requireEl('#editor-ext-manager-list'),
    extCustomSettingsInput: requireEl('#editor-ext-custom-settings-input') as HTMLTextAreaElement,
    extCustomSettingsSave: requireEl('#editor-ext-custom-settings-save') as HTMLButtonElement,
    extConfigModal: requireEl('#ext-config-modal'),
    extConfigTitle: requireEl('#ext-config-title'),
    extConfigClose: requireEl('#ext-config-close'),
    extConfigForm: requireEl('#ext-config-form'),
    extConfigCancel: requireEl('#ext-config-cancel'),
    extConfigSave: requireEl('#ext-config-save') as HTMLButtonElement,
  };
}
