
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
export function createPreferencesController(deps) {
  async function fetchEditorState() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/view_state', { cache: 'no-store' });
      const json = await resp.json();
      return json?.data || null;
    } catch (err) {
      console.error('[EditorState] Failed to fetch:', err);
      return null;
    }
  }

  function applyStateToMenus(state) {
    const m = deps.getMenuItems();
    deps.setMenuChecked(m.miToggleLines, state.showLineNumbers);
    deps.setMenuChecked(m.miToggleSyntax, state.showSyntax);
    deps.setMenuChecked(m.miToggleCloseBrackets, state.autoCloseBrackets);
    deps.setMenuChecked(m.miToggleAutocomplete, state.autocompletion);
    deps.setMenuChecked(m.miToggleShading, state.showShading);
    deps.setMenuChecked(m.miToggleIndentGuides, state.showIndentGuides);
    deps.setMenuChecked(m.miToggleWrap, state.wordWrap);
    deps.setMenuChecked(m.miToggleAutosave, state.autoSave);
    deps.setMenuChecked(m.miToggleDiffs, state.showInlineDiffs);
    deps.setMenuChecked(m.miToggleDraftDiffs, state.showDraftDiffs);
    deps.setMenuChecked(m.miToggleColorPicker, state.colorPicker);
    deps.setMenuChecked(m.miToggleReadonly, state.readOnly);
    deps.setMenuChecked(m.miToggleMinimap, state.showMinimap);
    deps.setMenuChecked(m.miToggleStickyScroll, state.stickyScroll);
    deps.setMenuChecked(m.miTrackEdits, state.trackAgentEdits);
    deps.setMenuChecked(m.miTrackAgentSidebarEdits, state.trackAgentSidebarEdits);
    deps.applyFontScale(state.fontScale ?? 0.85);
  }

  async function updatePreference(key, value) {
    try {
      console.log('[Preference] updatePreference request', key, value);
      const body = /** @type {any} */ ({ key, value });
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

  return { fetchEditorState, updatePreference, refreshMenuState, applyStateToMenus };
}
