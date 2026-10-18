// TE2's small extension of the pinned standalone providers. No vendored edits.
import { Registry } from '../app/static/vendor/monaco-editor-core/esm/vs/platform/registry/common/platform.js';
import { Extensions } from '../app/static/vendor/monaco-editor-core/esm/vs/platform/quickinput/common/quickAccess.js';
import { HelpQuickAccessProvider } from '../app/static/vendor/monaco-editor-core/esm/vs/platform/quickinput/browser/helpQuickAccess.js';
import { StandaloneGotoLineQuickAccessProvider } from '../app/static/vendor/monaco-editor-core/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import { DisposableStore } from '../app/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';

export function relativePosition(editor, value) {
  const match = /^(\d+)(?::?)([jk])(?::(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const model = editor.getModel();
  const origin = editor.getPosition();
  if (!model || !origin) return null;
  const distance = Number(match[1]);
  const requestedColumn = match[3] === undefined ? 1 : Number(match[3]);
  if (!Number.isSafeInteger(distance) || !Number.isSafeInteger(requestedColumn)) return null;
  const lineNumber = Math.max(1, Math.min(model.getLineCount(), origin.lineNumber + (match[2].toLowerCase() === 'j' ? distance : -distance)));
  const column = Math.max(1, Math.min(model.getLineMaxColumn(lineNumber), requestedColumn));
  return { lineNumber, column, label: `Press Enter to go to line ${lineNumber}, column ${column} (${distance} lines ${match[2].toLowerCase() === 'j' ? 'down' : 'up'}).` };
}

class Te2GotoLineProvider extends StandaloneGotoLineQuickAccessProvider {
  shouldPreviewPosition(editor, value) {
    // Pinned EditorOption.lineNumbers (76), RenderLineNumbersType.Relative (2).
    // Inspect actual presentation: inline diffs intentionally use absolute gutters.
    return editor.getOptions?.().get(76)?.renderType !== 2 || relativePosition(editor, value) !== null;
  }
  parsePosition(editor, value) {
    const relative = relativePosition(editor, value);
    if (relative) return relative;
    // Never let Monaco's permissive parseInt turn incomplete relative syntax
    // into an absolute jump. Preserve its existing absolute/offset syntax.
    if (/[jk]/i.test(value)) return { label: 'Use :8:k or :8:j, optionally followed by :column.' };
    return super.parsePosition(editor, value);
  }
}

class Te2RootProvider extends HelpQuickAccessProvider {
  provide(picker) {
    const disposables = new DisposableStore();
    const state = { enabled: false };
    window.dispatchEvent(new CustomEvent('code-te2:relative-numbers-query', { detail: state }));
    const picks = [
      ...this.getQuickAccessProviders().filter(p => p.prefix && p.prefix !== '?'),
      { label: 'rn', description: `Relative Line Numbers: ${state.enabled ? 'On' : 'Off'} — Toggle`, action: 'relative-numbers' },
      { label: 'e', description: 'Open / Focus Explorer', action: 'explorer' },
    ];
    const update = () => {
      const query = picker.value.trim().toLowerCase();
      const exact = picks.filter(item => item.label === query);
      picker.items = exact.length ? exact : picks.filter(item => !query || `${item.label} ${item.description}`.toLowerCase().includes(query));
    };
    update();
    disposables.add(picker.onDidChangeValue(update));
    disposables.add(picker.onDidAccept(() => {
      const item = picker.selectedItems[0];
      if (!item) return;
      if (item.action) {
        picker.hide();
        window.dispatchEvent(new CustomEvent('code-te2:palette-action', { detail: item.action }));
      } else this.quickInputService.quickAccess.show(item.prefix, { preserveValue: true });
    }));
    return disposables;
  }
}

export function installTe2QuickAccess() {
  const registry = Registry.as(Extensions.Quickaccess);
  // The existing descriptor keeps the stock ':' help/command identity, while
  // our subclass inherits the pinned provider's dependency-injection metadata.
  const goto = registry.getQuickAccessProvider(':');
  if (goto?.prefix === ':') goto.ctor = Te2GotoLineProvider;
  registry.registerQuickAccessProvider({ ctor: Te2RootProvider, prefix: '', helpEntries: [{ description: 'Quick Access' }] });
}
