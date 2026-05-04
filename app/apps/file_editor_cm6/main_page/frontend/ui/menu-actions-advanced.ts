// @ts-check

/**
 * @param {{
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   els: {
 *     miToggleAutosave: HTMLElement,
 *     miToggleDiffs: HTMLElement,
 *     miToggleDraftDiffs: HTMLElement,
 *     miToggleReadonly: HTMLElement,
 *     miTrackEdits: HTMLElement,
 *     miTrackAgentSidebarEdits: HTMLElement,
 *   },
 *   getEditorViewState: () => any,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   setMenuChecked: (el: HTMLElement, checked: boolean) => void,
 *   getCurrentPath: () => string,
 *   getCurrentPathExists: () => boolean,
 *   showAutosaveModal: (fileLabel: string, hasOtherDrafts: boolean) => Promise<boolean>,
 *   basename: (path: string) => string,
 *   getUnsaved: () => boolean,
 *   saveFile: () => Promise<any>,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   markUnsaved: (flag: boolean) => void,
 *   toast: (msg: string, kind?: any) => void,
 * }} deps
 */
export function installAdvancedMenuActions(deps: any) {
  let preTrackingPrefs: { showInlineDiffs: boolean; readOnly: boolean } | null = null;
  const s = () => deps.getEditorViewState();
  const anyTracking = () => !!(s()?.trackAgentEdits || s()?.trackAgentSidebarEdits);

  async function restorePreTrackingPrefsIfIdle() {
    if (anyTracking() || !preTrackingPrefs) return;
    await deps.updatePreference('showInlineDiffs', !!preTrackingPrefs.showInlineDiffs);
    await deps.updatePreference('readOnly', !!preTrackingPrefs.readOnly);
    preTrackingPrefs = null;
  }

  async function disableAllEditTracking(reason?: string) {
    if (s()?.trackAgentEdits) await deps.updatePreference('trackAgentEdits', false);
    if (s()?.trackAgentSidebarEdits) await deps.updatePreference('trackAgentSidebarEdits', false);
    await restorePreTrackingPrefsIfIdle();
    if (reason) deps.toast(reason, 'warn');
  }

  async function toggleTrackedEditPreference(targetKey: string, otherKey: string) {
    const enabling = !(s()?.[targetKey]);
    if (enabling) {
      if (!preTrackingPrefs) {
        preTrackingPrefs = {
          showInlineDiffs: s()?.showInlineDiffs ?? true,
          readOnly: s()?.readOnly ?? false,
        };
      }
      await deps.updatePreference('showInlineDiffs', true);
      await deps.updatePreference('readOnly', true);
      if (s()?.[otherKey]) await deps.updatePreference(otherKey, false);
      const success = await deps.updatePreference(targetKey, true);
      if (!success) deps.toast('Failed to enable edit tracking');
      return;
    }
    const success = await deps.updatePreference(targetKey, false);
    if (!success) {
      deps.toast('Failed to disable edit tracking');
      return;
    }
    await restorePreTrackingPrefsIfIdle();
  }

  deps.bindMenuToggle(deps.els.miToggleAutosave, async () => {
    const currentlyEnabled = !!(s()?.autoSave);
    if (currentlyEnabled) {
      const success = await deps.updatePreference('autoSave', false);
      if (!success) {
        deps.toast('Failed to update preference');
        deps.setMenuChecked(deps.els.miToggleAutosave, true);
      }
      return;
    }
    const currentPath = deps.getCurrentPath();
    if (!currentPath || !deps.getCurrentPathExists()) {
      deps.toast('Open a file before enabling autosave');
      deps.setMenuChecked(deps.els.miToggleAutosave, false);
      return;
    }
    const confirmed = await deps.showAutosaveModal(deps.basename(currentPath), deps.getUnsaved());
    if (!confirmed) {
      deps.setMenuChecked(deps.els.miToggleAutosave, false);
      return;
    }
    if (deps.getUnsaved() && currentPath && deps.getCurrentPathExists()) {
      const saved = await deps.saveFile();
      if (!saved) {
        deps.toast('Autosave not enabled: saving failed');
        deps.setMenuChecked(deps.els.miToggleAutosave, false);
        return;
      }
    }
    try { await deps.apiPost('editor/discard_draft', { path: currentPath }); } catch (err) { console.warn('[Autosave] Failed to discard existing draft', err); }
    const success = await deps.updatePreference('autoSave', true);
    if (!success) {
      deps.toast('Failed to update preference');
      deps.setMenuChecked(deps.els.miToggleAutosave, false);
      return;
    }
    if (s()) s().autoSave = true;
    deps.markUnsaved(false);
    if (s()?.showDraftDiffs) await deps.updatePreference('showDraftDiffs', false);
    if (anyTracking() && !s()?.readOnly) await disableAllEditTracking('Auto-track edits disabled (incompatible with autosave)');
  });

  deps.bindMenuToggle(deps.els.miToggleDiffs, async () => {
    const turningOff = !!(s()?.showInlineDiffs);
    const success = await deps.updatePreference('showInlineDiffs', !turningOff);
    if (!success) { deps.toast('Failed to update preference'); return; }
    if (turningOff && anyTracking()) await disableAllEditTracking('Auto-track edits disabled (requires git diffs)');
  });

  deps.bindMenuToggle(deps.els.miToggleDraftDiffs, async () => {
    const turningOn = !(s()?.showDraftDiffs);
    if (turningOn && s()?.autoSave) {
      await deps.updatePreference('autoSave', false);
      deps.toast('Autosave disabled (draft diffs require draft mode)', 'warn');
    }
    const success = await deps.updatePreference('showDraftDiffs', turningOn);
    if (!success) deps.toast('Failed to update preference');
  });

  deps.bindMenuToggle(deps.els.miToggleReadonly, async () => {
    const goingEditable = !!(s()?.readOnly);
    const success = await deps.updatePreference('readOnly', !goingEditable);
    if (success) {
      deps.toast(s()?.readOnly ? 'Editor is now read-only' : 'Editor is now editable', 'info');
      if (goingEditable && s()?.autoSave && anyTracking()) {
        await disableAllEditTracking('Auto-track edits disabled (incompatible with autosave)');
      }
    } else {
      deps.toast('Failed to toggle read-only mode');
    }
  });

  deps.bindMenuToggle(deps.els.miTrackEdits, async () => {
    await toggleTrackedEditPreference('trackAgentEdits', 'trackAgentSidebarEdits');
  });
  deps.bindMenuToggle(deps.els.miTrackAgentSidebarEdits, async () => {
    await toggleTrackedEditPreference('trackAgentSidebarEdits', 'trackAgentEdits');
  });
}
