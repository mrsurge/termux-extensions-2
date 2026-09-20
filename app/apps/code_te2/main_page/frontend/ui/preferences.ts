type State = Record<string, unknown>;
interface PreferencesDeps {
  requestBackendEditorStateGet(): Promise<unknown>;
  requestBackendEditorPreferenceUpdate(payload: State): Promise<unknown>;
  getClientId(): string | null;
  setEditorViewState(state: State | null): void;
  setMenuChecked(element: Element | null | undefined, checked: boolean): void;
  applyFontScale(scale: number): void;
  getMenuItems(): Record<string, HTMLElement | null>;
}
function record(value: unknown): State | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as State : null;
}

// Preferences have one transport: owning host RPC plus pushed state projections.
export function createPreferencesController(deps: PreferencesDeps) {
  function setMenuItemLabel(el: unknown, label: string) {
    const node = el instanceof HTMLElement ? el : null;
    const labelNode = node ? node.querySelector('span') : null;
    if (labelNode) {
      labelNode.textContent = label;
    } else if (node) {
      node.textContent = label;
    }
  }

  function syncSaveModeMenu(m: Record<string, HTMLElement | null>, state: State) {
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
      const snapshot = record(await deps.requestBackendEditorStateGet());
      if (!record(snapshot?.view_state)) throw new Error("Editor state unavailable");
      return record(snapshot?.view_state);
    } catch (err) {
      console.error('[EditorState] Failed to fetch:', err);
      return null;
    }
  }

  function applyStateToMenus(state: State | null) {
    if (!state) return;
    const m = deps.getMenuItems();
    deps.setMenuChecked(m.miToggleLines, !!state.showLineNumbers);
    deps.setMenuChecked(m.miToggleSyntax, !!state.showSyntax);
    deps.setMenuChecked(m.miToggleCloseBrackets, !!state.autoCloseBrackets);
    deps.setMenuChecked(m.miToggleAutocomplete, !!state.autocompletion);
    deps.setMenuChecked(m.miToggleInlayHints, state.showInlayHints !== false);
    deps.setMenuChecked(m.miToggleShading, !!state.showShading);
    deps.setMenuChecked(m.miToggleIndentGuides, !!state.showIndentGuides);
    deps.setMenuChecked(m.miToggleWrap, !!state.wordWrap);
    syncSaveModeMenu(m, state);
    const autoSave = !!state.autoSave;
    const showDraftDiffs = !autoSave && !!state.showDraftDiffs;
    const showCommitDiffs = !showDraftDiffs && !!state.showInlineDiffs;
    deps.setMenuChecked(m.miToggleDiffs, showCommitDiffs);
    deps.setMenuChecked(m.miToggleDraftDiffs, showDraftDiffs);
    deps.setMenuChecked(m.miToggleColorPicker, !!state.colorPicker);
    deps.setMenuChecked(m.miToggleReadonly, !!state.readOnly);
    deps.setMenuChecked(m.miToggleMinimap, !!state.showMinimap);
    deps.setMenuChecked(m.miToggleStickyScroll, !!state.stickyScroll);
    deps.setMenuChecked(m.miTrackAgentSidebarEdits, !!state.trackAgentSidebarEdits);
    deps.applyFontScale(typeof state.fontScale === "number" ? state.fontScale : 0.85);
  }

  function applyPreferencesChangedPayload(payload: unknown) {
    const data = record(payload);
    const nextState = record(data?.view_state) || record(record(data?.preferences)?.editor);
    if (!nextState) return false;
    deps.setEditorViewState(nextState);
    applyStateToMenus(nextState);
    return true;
  }

  async function updatePreference(key: string, value: unknown) {
    try {
      console.log('[Preference] updatePreference request', key, value);
      const body: { key: string; value: unknown; nicegui_client_id?: string } = { key, value };
      const clientId = deps.getClientId();
      if (clientId) body.nicegui_client_id = clientId;
      const resp = record(await deps.requestBackendEditorPreferenceUpdate(body));
      if (!resp || resp.ok === false) throw new Error("Preference update failed");
      const viewState = record(resp.data);
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
