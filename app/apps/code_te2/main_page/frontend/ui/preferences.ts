
/**
 * @param {{
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   requestBackendEditorPreferenceUpdate?: (payload: any) => Promise<any>,
 *   getClientId: () => string | null,
 *   setEditorViewState: (state: any) => void,
 *   setMenuChecked: (el: any, checked: boolean) => void,
 *   applyFontScale: (scale: number) => void,
 *   getMenuItems: () => Record<string, any>
 * }} deps
 */
export function createPreferencesController(deps: any) {
  function setMenuItemLabel(el: unknown, label: string) {
    const node = el instanceof HTMLElement ? el : null;
    const labelNode = node ? node.querySelector('span') : null;
    if (labelNode) {
      labelNode.textContent = label;
    } else if (node) {
      node.textContent = label;
    }
  }

  function syncSaveModeMenu(m: Record<string, any>, state: any) {
    const autoSave = !!state.autoSave;
    const item = m.miToggleAutosave;
    setMenuItemLabel(item, autoSave ? 'Draft Mode' : 'Auto Save');
    if (item instanceof HTMLElement) {
      item.classList.remove('fe-menu-item-checked');
      item.setAttribute('role', 'menuitem');
      item.removeAttribute('aria-checked');
      item.title = autoSave
        ? 'Switch to Draft Mode. Edits stay in the draft cache until saved.'
        : 'Switch to Auto Save. Current drafts will be saved before autosave is enabled.';
    }
  }

  async function fetchEditorState() {
    try {
      const resp = await fetch('/api/app/code_te2/editor/view_state', { cache: 'no-store' });
      const json = await resp.json();
      return json?.data || null;
    } catch (err) {
      console.error('[EditorState] Failed to fetch:', err);
      return null;
    }
  }

  function applyStateToMenus(state: any) {
    const m = deps.getMenuItems();
    deps.setMenuChecked(m.miToggleLines, state.showLineNumbers);
    deps.setMenuChecked(m.miToggleSyntax, state.showSyntax);
    deps.setMenuChecked(m.miToggleCloseBrackets, state.autoCloseBrackets);
    deps.setMenuChecked(m.miToggleAutocomplete, state.autocompletion);
    deps.setMenuChecked(m.miToggleInlayHints, state.showInlayHints !== false);
    deps.setMenuChecked(m.miToggleShading, state.showShading);
    deps.setMenuChecked(m.miToggleIndentGuides, state.showIndentGuides);
    deps.setMenuChecked(m.miToggleWrap, state.wordWrap);
    syncSaveModeMenu(m, state);
    const autoSave = !!state.autoSave;
    const showDraftDiffs = !autoSave && !!state.showDraftDiffs;
    const showCommitDiffs = !showDraftDiffs && !!state.showInlineDiffs;
    deps.setMenuChecked(m.miToggleDiffs, showCommitDiffs);
    deps.setMenuChecked(m.miToggleDraftDiffs, showDraftDiffs);
    deps.setMenuChecked(m.miToggleColorPicker, state.colorPicker);
    deps.setMenuChecked(m.miToggleReadonly, state.readOnly);
    deps.setMenuChecked(m.miToggleMinimap, state.showMinimap);
    deps.setMenuChecked(m.miToggleStickyScroll, state.stickyScroll);
    deps.setMenuChecked(m.miTrackAgentSidebarEdits, state.trackAgentSidebarEdits);
    deps.applyFontScale(state.fontScale ?? 0.85);
  }

  function applyPreferencesChangedPayload(payload: any) {
    const nextState = payload && typeof payload === 'object'
      ? (payload.view_state && typeof payload.view_state === 'object'
        ? payload.view_state
        : (payload.preferences && typeof payload.preferences === 'object'
          && payload.preferences.editor && typeof payload.preferences.editor === 'object'
          ? payload.preferences.editor
          : null))
      : null;
    if (!nextState) return false;
    deps.setEditorViewState(nextState);
    applyStateToMenus(nextState);
    return true;
  }

  async function updatePreference(key: string, value: any) {
    try {
      console.log('[Preference] updatePreference request', key, value);
      const body: { key: string; value: any; nicegui_client_id?: string } = { key, value };
      const clientId = deps.getClientId();
      if (clientId) body.nicegui_client_id = clientId;
      const resp = typeof deps.requestBackendEditorPreferenceUpdate === 'function'
        ? await deps.requestBackendEditorPreferenceUpdate(body)
        : await deps.apiPost('editor/update_preference', body);
      const viewState = resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object'
        ? resp.data
        : resp;
      if (viewState && typeof viewState === 'object' && Object.keys(viewState).length > 0) {
        deps.setEditorViewState(viewState);
        applyStateToMenus(viewState);
        console.log('[Preference] updatePreference applied', key, value);
        return true;
      }
      console.error(`[Preference] Update ${key} failed: empty or invalid response`, resp);
      return false;
    } catch (err) {
      console.error(`[Preference] Failed to update ${key}:`, err);
      return false;
    }
  }

  async function refreshMenuState() {
    const state = await fetchEditorState();
    if (!state) return;
    applyStateToMenus(state);
    deps.setEditorViewState(state);
  }

  return {
    fetchEditorState,
    updatePreference,
    refreshMenuState,
    applyStateToMenus,
    applyPreferencesChangedPayload,
  };
}
