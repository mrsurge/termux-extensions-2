import { buildDiagnosticMention } from '../src/diagnostics/diagnostic-mention';
import type { DiagnosticMarker } from '../src/diagnostics/problems-panel';

interface ProblemModel {
  uri: { fsPath: string };
  isDisposed(): boolean;
  getVersionId(): number;
}

interface ProblemEditor {
  getContainerDomNode(): HTMLElement | null;
  getModel(): ProblemModel | null;
  onDidDispose(listener: () => void): { dispose(): void };
}

interface MentionDeps {
  getModel(): unknown;
  getCurrentPath(): string | null;
  sendEditorMentionRequest(payload: Record<string, unknown>): boolean;
}

const bindings = new WeakSet<object>();
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function diagnostic(value: unknown): DiagnosticMarker | null {
  const marker = record(value);
  if (!marker || typeof marker.message !== 'string') return null;
  for (const key of ['startLineNumber', 'startColumn', 'endLineNumber', 'endColumn']) {
    const position = marker[key];
    if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 1) return null;
  }
  const start = marker.startLineNumber as number, end = marker.endLineNumber as number;
  if (end < start || (end === start && (marker.endColumn as number) < (marker.startColumn as number))) return null;
  const code = marker.code;
  if (code !== undefined && typeof code !== 'string' && typeof code !== 'number') {
    const coded = record(code);
    if (!coded || (typeof coded.value !== 'string' && typeof coded.value !== 'number')) return null;
  }
  if (marker.source !== undefined && typeof marker.source !== 'string') return null;
  if (marker.severity !== undefined && typeof marker.severity !== 'number') return null;
  return marker as DiagnosticMarker;
}

/** Local widget intent only; the existing editor sender attaches Sidebar proof. */
export function installProblemMentionBinding(editor: ProblemEditor, deps: MentionDeps): void {
  if (!editor || typeof editor.getContainerDomNode !== 'function' || typeof editor.getModel !== 'function'
    || typeof editor.onDidDispose !== 'function') return;
  // getDomNode() belongs to the current model view and is replaced by setModel.
  const node = editor.getContainerDomNode();
  if (!node || bindings.has(editor)) return;
  bindings.add(editor);
  const mention = (event: Event): void => {
    const snapshot = record((event as CustomEvent<unknown>).detail);
    const model = editor.getModel();
    const path = deps.getCurrentPath();
    if (!snapshot || !model || !path || snapshot.model !== model || deps.getModel() !== model
      || model.isDisposed() || snapshot.version !== model.getVersionId() || model.uri.fsPath !== path) return;
    const marker = diagnostic(snapshot.marker);
    if (!marker) return;
    if (!deps.sendEditorMentionRequest({ ...buildDiagnosticMention(path, marker) })) {
      console.warn('[mention] no connected editor/agent presentation for inline problem');
    }
  };
  node.addEventListener('te2:problem-mention', mention);
  const subscription = editor.onDidDispose(() => {
    node.removeEventListener('te2:problem-mention', mention);
    bindings.delete(editor);
    subscription.dispose();
  });
}
