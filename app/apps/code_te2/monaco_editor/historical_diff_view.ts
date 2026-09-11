import type * as Monaco from '../../../static/vendor/monaco-editor-core/esm/vs/editor/editor.api';
import { historicalKeyCommand } from './historical_key_commands.ts';
import type { SyntheticEditorKey, SyntheticKeyModifiers } from '../src/mobile-input/terminal-special-key-bridge.ts';
import {
  parseSecondaryHistoryContent,
  type HistoricalBlobSide,
} from '../main_page/frontend/secondary-history-content.ts';

export interface HistoricalDiffView {
  focus(): void;
  find(): Promise<void>;
  specialKey(key: SyntheticEditorKey, modifiers: SyntheticKeyModifiers): Promise<boolean>;
  copy(): Promise<void>;
  layout(): void;
  dispose(): void;
}

export interface HistoricalDiffViewOptions {
  container: HTMLElement;
  content: unknown;
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>;
  signal: AbortSignal;
  languageForPath(path: string): string;
  /** TextMate/lexical setup only. Never install language intelligence here. */
  prepareSyntax(languageId: string, path: string): Promise<void>;
  sideBySide?: boolean;
}

let viewSequence = 0;

const unavailableLabels = {
  binary: 'Binary file', tooLarge: 'File exceeds the historical preview limit',
  invalidUtf8: 'File is not valid UTF-8', unsupported: 'Unsupported Git object',
} as const;

/** Owns only two immutable models and one diff control in a syntax-only realm. */
export async function mountHistoricalDiffView(options: HistoricalDiffViewOptions): Promise<HistoricalDiffView> {
  const content = parseSecondaryHistoryContent(options.content);
  const { container, monaco, signal } = options;
  signal.throwIfAborted();
  const root = container.ownerDocument.createElement('div');
  root.className = 'te2-historical-diff';
  root.style.cssText = 'height:100%;min-height:0;position:relative;';
  root.setAttribute('aria-label', 'Read-only historical comparison');
  container.append(root);
  const models: Monaco.editor.ITextModel[] = [];
  const listeners: Monaco.IDisposable[] = [];
  let originalFocused = false;
  let editor: Monaco.editor.IStandaloneDiffEditor | null = null;
  const activeControl = () => originalFocused ? editor?.getOriginalEditor() : editor?.getModifiedEditor();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    for (const listener of listeners) listener.dispose();
    // Detach before destroying either model; never disturb another view's DOM.
    editor?.setModel(null);
    editor?.dispose();
    editor = null;
    for (const model of models) model.dispose();
    root.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  const view: HistoricalDiffView = {
    dispose,
    focus: () => activeControl()?.focus(),
    layout: () => editor?.layout(),
    async find() { await activeControl()?.getAction('actions.find')?.run(); },
    async copy() {
      const control = activeControl();
      const selection = control?.getSelection();
      const model = control?.getModel();
      if (!selection || !model || selection.isEmpty()) return;
      const clipboard = container.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error('Clipboard unavailable');
      await clipboard.writeText(model.getValueInRange(selection));
    },
    async specialKey(key, modifiers) {
      const command = historicalKeyCommand(key, modifiers);
      if (!command || !editor) return false;
      if (command === 'copy') await view.copy();
      else if (command === 'actions.find') await view.find();
      else {
        const control = activeControl();
        control?.focus();
        control?.trigger('historical-special-key', command, null);
      }
      return true;
    },
  };
  try {
    const unavailable = [content.original, content.modified].filter(
      (side) => side.state !== 'text' && side.state !== 'absent',
    );
    if (unavailable.length) {
      // An unavailable side is not an empty file; never manufacture a deletion.
      root.setAttribute('role', 'status');
      root.style.whiteSpace = 'pre-wrap';
      root.textContent = unavailable.map((side) =>
        `${side.path}: ${unavailableLabels[side.state as keyof typeof unavailableLabels]}`,
      ).join('\n');
      return view;
    }
    const languages = new Map<string, string>();
    for (const side of [content.original, content.modified]) {
      if (side.path) languages.set(side.path, options.languageForPath(side.path));
    }
    for (const [path, language] of languages) {
      await options.prepareSyntax(language, path);
      signal.throwIfAborted();
    }
    const authority = `view-${++viewSequence}`;
    const create = (side: HistoricalBlobSide, label: string): Monaco.editor.ITextModel => {
      const uri = monaco.Uri.from({
        scheme: 'te2-history', authority,
        path: `/${content.snapshotId}/${content.commitId}/${label}/${side.id || 'absent'}/${side.path || 'empty'}`,
      });
      const model = monaco.editor.createModel(side.text || '', side.path ? languages.get(side.path) : 'plaintext', uri);
      models.push(model);
      return model;
    };
    const original = create(content.original, 'original');
    const modified = create(content.modified, 'modified');
    // The pinned standalone diff implementation consumes global options too,
    // although its published constructor type omits IGlobalEditorOptions.
    const editorOptions: Monaco.editor.IStandaloneDiffEditorConstructionOptions
      & Monaco.editor.IGlobalEditorOptions = {
      readOnly: true, domReadOnly: true, originalEditable: false,
      renderSideBySide: options.sideBySide ?? false, automaticLayout: true,
      'semanticHighlighting.enabled': false, renderValidationDecorations: 'off',
      inlayHints: { enabled: 'off' }, codeLens: false,
      quickSuggestions: false, suggestOnTriggerCharacters: false,
      inlineSuggest: { enabled: false }, parameterHints: { enabled: false },
      hover: { enabled: false }, contextmenu: false,
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off }, links: false,
      minimap: { enabled: false }, scrollBeyondLastLine: false,
    };
    editor = monaco.editor.createDiffEditor(root, editorOptions);
    // Menu focus must not forget which immutable side owns the selection.
    listeners.push(editor.getOriginalEditor().onDidFocusEditorWidget(() => { originalFocused = true; }));
    listeners.push(editor.getModifiedEditor().onDidFocusEditorWidget(() => { originalFocused = false; }));
    editor.setModel({ original, modified });
    return view;
  } catch (error) {
    dispose();
    throw error;
  }
}
