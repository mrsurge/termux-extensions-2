import { getBooleanPref } from './editor_pref_read_utils.ts';
import { registerEditorInputOwner } from './editor_input_owner.ts';

interface KeyboardEditor {
  focus?(): void;
  hasTextFocus?(): boolean;
  addAction?(action: { id: string; label: string; run(): Promise<void> | void }): unknown;
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return value !== null && typeof value === 'object' && 'dispose' in value && typeof value.dispose === 'function';
}

export function installEditorKeyboardRuntime(deps: {
  root: HTMLElement;
  getEditor(): KeyboardEditor | null;
  getPrefs(): unknown;
  updatePreference(key: string, value: boolean): Promise<unknown>;
}) {
  const bound = new WeakSet<object>();
  const actions = new Set<{ dispose(): void }>();
  let disposed = false;
  let toggling = false;
  const current = () => deps.getEditor();
  const windowRef = deps.root.ownerDocument.defaultView;
  if (!windowRef) throw new Error('Working editor keyboard requires a window.');
  const win = windowRef;
  const doc = deps.root.ownerDocument;
  const owner = registerEditorInputOwner(deps.root, () => current()?.hasTextFocus?.() === true);
  async function toggleRelative(): Promise<void> {
    if (disposed || toggling) return;
    toggling = true;
    try {
      await deps.updatePreference('relativeLineNumbers', !getBooleanPref(deps.getPrefs(), 'relativeLineNumbers'));
    } catch (error) {
      console.warn('[keyboard] relative line numbers update failed', error);
    } finally { toggling = false; }
  }
  const query = (event: Event) => {
    if (!owner.isActive()) return;
    const detail: unknown = 'detail' in event ? event.detail : undefined;
    if (detail !== null && typeof detail === 'object') {
      Object.assign(detail, { enabled: getBooleanPref(deps.getPrefs(), 'relativeLineNumbers') });
    }
  };
  const action = (event: Event) => {
    if (!owner.isActive()) return;
    if ('detail' in event && event.detail === 'relative-numbers') void toggleRelative();
  };
  const focus = () => { if (owner.isActive()) current()?.focus?.(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
      || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey
      || !owner.isActive() || !current()?.hasTextFocus?.()) return;
    const direction = event.code === 'Comma' ? -1 : event.code === 'Period' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    win.dispatchEvent(new win.CustomEvent('code-te2:cycle-file-tab', { detail: direction }));
  };
  win.addEventListener('code-te2:relative-numbers-query', query);
  win.addEventListener('code-te2:palette-action', action);
  win.addEventListener('code-te2:focus-editor', focus);
  doc.addEventListener('keydown', keydown, true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener('code-te2:relative-numbers-query', query);
    win.removeEventListener('code-te2:palette-action', action);
    win.removeEventListener('code-te2:focus-editor', focus);
    doc.removeEventListener('keydown', keydown, true);
    win.removeEventListener('pagehide', dispose);
    owner.dispose();
    for (const action of actions) action.dispose();
    actions.clear();
  }
  win.addEventListener('pagehide', dispose, { once: true });
  return {
    dispose,
    bindEditor() {
      if (disposed) return;
      const editor = current();
      if (!editor || bound.has(editor)) return;
      bound.add(editor);
      const action = editor.addAction?.({ id: 'te2.toggleRelativeLineNumbers', label: 'Toggle Relative Line Numbers',
        run: () => { owner.activate(); return toggleRelative(); } });
      if (isDisposable(action)) actions.add(action);
    },
  };
}
