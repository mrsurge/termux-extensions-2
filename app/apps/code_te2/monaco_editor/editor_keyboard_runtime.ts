import { getBooleanPref } from './editor_pref_read_utils.ts';

interface KeyboardEditor {
  focus(): void;
  hasTextFocus(): boolean;
  addAction?(action: { id: string; label: string; run(): Promise<void> | void }): unknown;
}

export function installEditorKeyboardRuntime(deps: {
  getEditor(): unknown;
  getPrefs(): unknown;
  updatePreference(key: string, value: boolean): Promise<unknown>;
}) {
  const bound = new WeakSet<object>();
  let toggling = false;
  const current = () => deps.getEditor() as KeyboardEditor | null;
  async function toggleRelative(): Promise<void> {
    if (toggling) return;
    toggling = true;
    try {
      await deps.updatePreference('relativeLineNumbers', !getBooleanPref(deps.getPrefs(), 'relativeLineNumbers'));
    } catch (error) {
      console.warn('[keyboard] relative line numbers update failed', error);
    } finally { toggling = false; }
  }
  const query = (event: Event) => {
    if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
      event.detail.enabled = getBooleanPref(deps.getPrefs(), 'relativeLineNumbers');
    }
  };
  const action = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === 'relative-numbers') void toggleRelative();
  };
  const focus = () => current()?.focus();
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
      || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || !current()?.hasTextFocus()) return;
    const direction = event.code === 'Comma' ? -1 : event.code === 'Period' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.dispatchEvent(new CustomEvent('code-te2:cycle-file-tab', { detail: direction }));
  };
  window.addEventListener('code-te2:relative-numbers-query', query);
  window.addEventListener('code-te2:palette-action', action);
  window.addEventListener('code-te2:focus-editor', focus);
  document.addEventListener('keydown', keydown, true);
  function dispose() {
    window.removeEventListener('code-te2:relative-numbers-query', query);
    window.removeEventListener('code-te2:palette-action', action);
    window.removeEventListener('code-te2:focus-editor', focus);
    document.removeEventListener('keydown', keydown, true);
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return {
    bindEditor() {
      const editor = current();
      if (!editor || bound.has(editor)) return;
      bound.add(editor);
      editor.addAction?.({ id: 'te2.toggleRelativeLineNumbers', label: 'Toggle Relative Line Numbers', run: toggleRelative });
    },
  };
}
