import { EDITOR_RPC_METHODS } from './editor_rpc_contract.ts';
import {
  type DetailedLineRangeMappingLike,
  type ICodeEditorLike,
  type IDocumentDiff2Like,
} from './vscode_chat_editing_vendor/diffHunkWidget.ts';
import {
  ChatEditingHunkRenderer,
  type ChatEditingHunkRenderChange,
  type ChatEditingLineRangeLike,
  type MonacoCodeEditorForChatHunks,
} from './vscode_chat_editing_vendor/chatEditingHunkRenderer.ts';

interface MonacoRangeCtorLike {
  new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): unknown;
}

interface MonacoLike {
  Range?: MonacoRangeCtorLike;
}

interface MonacoTextModelLike {
  getLineCount?(): number;
  getVersionId?(): number;
  getOptions?(): { tabSize?: number };
  uri?: { toString?(): string };
}

interface MonacoCodeEditorLike {
  createDecorationsCollection?(): { set?(decorations: unknown[]): void };
  deltaDecorations?(oldDecorations: unknown[], newDecorations: unknown[]): unknown[];
  addOverlayWidget?(widget: unknown): void;
  removeOverlayWidget?(widget: unknown): void;
  layoutOverlayWidget?(widget: unknown): void;
  getModel?(): { getVersionId?(): number } | null;
  getOption?(option: unknown): number;
  getOptions?(): unknown;
  getLayoutInfo?(): { contentLeft: number; contentWidth: number; verticalScrollbarWidth: number };
  getScrollTop?(): number;
  getTopForLineNumber?(lineNumber: number): number;
  focus?(): void;
  onDidScrollChange?(listener: () => void): { dispose(): void };
  onDidLayoutChange?(listener: () => void): { dispose(): void };
}

interface AgentEditRangeLike {
  startLineNumber?: unknown;
  startColumn?: unknown;
  endLineNumber?: unknown;
  endColumn?: unknown;
}

interface AgentEditHunkLike {
  hunkId?: unknown;
  kind?: unknown;
  state?: unknown;
  summary?: unknown;
  message?: unknown;
  modifiedRange?: AgentEditRangeLike;
  originalRange?: AgentEditRangeLike;
  range?: AgentEditRangeLike;
}

interface AgentEditLike {
  editId?: unknown;
  revision?: unknown;
  state?: unknown;
  uri?: unknown;
  rel?: unknown;
  label?: unknown;
  description?: unknown;
  hunks?: unknown;
  modifiedRange?: AgentEditRangeLike;
  range?: AgentEditRangeLike;
}

interface AgentEditSourceLike {
  conversationId?: unknown;
  sessionId?: unknown;
  threadId?: unknown;
  edits?: unknown;
}

interface AgentEditReviewRuntimeDeps {
  getDocument(): Document | null;
  getEditor(): unknown;
  getModel(): unknown;
  getMonaco(): unknown;
  getCurrentPath(): string | null;
  rpcCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  schedule(callback: () => void, delayMs: number): unknown;
}

interface NormalizedAgentEdit {
  conversationId: string;
  sessionId: string;
  threadId: string;
  projectPath: string;
  uri: string;
  rel: string;
  editId: string;
  revision: number | null;
  state: string;
  label: string;
  description: string;
  hunkId: string;
  hunkState: string;
  summary: string;
  message: string;
  lineNumber: number;
  originalRange: ChatEditingLineRangeLike | null;
  modifiedRange: ChatEditingLineRangeLike;
  originalLines: string[];
  modifiedLines: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asLine(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(1, Math.floor(numberValue));
}

function normalizeRange(range: AgentEditRangeLike | null | undefined, fallbackLine: number): ChatEditingLineRangeLike | null {
  if (!range) return null;
  const startLineNumber = asLine(range.startLineNumber, fallbackLine);
  const endLineNumber = asLine(range.endLineNumber, startLineNumber);
  const startColumn = asLine(range.startColumn, 1);
  const endColumn = asLine(range.endColumn, 1);
  return {
    startLineNumber,
    startColumn,
    endLineNumber: Math.max(startLineNumber, endLineNumber),
    endColumn,
  };
}

function asStringLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/\r$/, ''));
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }
  return [];
}

function hunkOriginalLines(hunk: AgentEditHunkLike | null): string[] {
  const record = asRecord(hunk);
  if (!record) return [];
  for (const key of ['originalLines', 'deletedLines', 'removedLines']) {
    const lines = asStringLines(record[key]);
    if (lines.length) return lines;
  }
  return [];
}

function hunkModifiedLines(hunk: AgentEditHunkLike | null): string[] {
  const record = asRecord(hunk);
  if (!record) return [];
  for (const key of ['modifiedLines', 'addedLines']) {
    const lines = asStringLines(record[key]);
    if (lines.length) return lines;
  }
  return [];
}

function asRevision(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.floor(numberValue) : null;
}

function normalizeFileUri(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('file://')) {
    try {
      return 'file://' + encodeURI(decodeURIComponent(new URL(text).pathname)).replace(/%2F/g, '/');
    } catch (_) {
      return text;
    }
  }
  if (text.startsWith('/')) {
    try {
      return new URL('file://' + text).toString();
    } catch (_) {
      return text;
    }
  }
  return text;
}

function pathToFileUri(path: string | null): string {
  if (!path) return '';
  return normalizeFileUri(path);
}

function activeModelUri(deps: AgentEditReviewRuntimeDeps): string {
  try {
    const model = deps.getModel() as MonacoTextModelLike | null;
    const modelUri = model?.uri?.toString?.();
    if (modelUri) return normalizeFileUri(modelUri);
  } catch (_) {}
  return pathToFileUri(deps.getCurrentPath());
}

function rangeStartLine(range: AgentEditRangeLike | null | undefined): number | null {
  if (!range) return null;
  const line = Number(range.startLineNumber);
  return Number.isFinite(line) ? Math.max(1, Math.floor(line)) : null;
}

function hunkLine(edit: AgentEditLike, hunk: AgentEditHunkLike | null): number {
  return (
    rangeStartLine(hunk?.modifiedRange) ??
    rangeStartLine(hunk?.range) ??
    rangeStartLine(hunk?.originalRange) ??
    rangeStartLine(edit.modifiedRange) ??
    rangeStartLine(edit.range) ??
    1
  );
}

function collectTopLevelEdits(payload: Record<string, unknown>): unknown[] {
  const edits = asArray(payload.edits);
  if (edits.length) return edits;
  const sources = asArray(payload.sources);
  const collected: unknown[] = [];
  for (const source of sources) {
    const sourceRecord = asRecord(source);
    if (!sourceRecord) continue;
    for (const edit of asArray(sourceRecord.edits)) collected.push({ source: sourceRecord, edit });
  }
  return collected;
}

function normalizeEdits(payload: Record<string, unknown>, activeUri: string): NormalizedAgentEdit[] {
  const result: NormalizedAgentEdit[] = [];
  const projectPath = asString(payload.projectPath || payload.project || payload.projectRoot);
  for (const rawItem of collectTopLevelEdits(payload)) {
    const itemRecord = asRecord(rawItem);
    const sourceRecord = asRecord(itemRecord?.source) || {};
    const editRecord = asRecord(itemRecord?.edit) || itemRecord;
    if (!editRecord) continue;

    const edit = editRecord as AgentEditLike;
    const editUri = normalizeFileUri(asString(edit.uri) || asString(payload.uri));
    if (activeUri && editUri && editUri !== activeUri) continue;

    const hunks = asArray(edit.hunks);
    const renderHunks = hunks.length ? hunks : [null];
    for (let index = 0; index < renderHunks.length; index += 1) {
      const hunkRecord = asRecord(renderHunks[index]) as AgentEditHunkLike | null;
      const editId = asString(edit.editId) || `edit-${String(result.length + 1)}`;
      const hunkId = asString(hunkRecord?.hunkId) || (hunks.length ? `hunk-${String(index + 1)}` : '');
      const lineNumber = hunkLine(edit, hunkRecord);
      const modifiedRange = normalizeRange(hunkRecord?.modifiedRange || hunkRecord?.range || edit.modifiedRange || edit.range, lineNumber)
        || { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 };
      result.push({
        conversationId: asString(editRecord.conversationId) || asString(sourceRecord.conversationId) || asString(payload.conversationId),
        sessionId: asString(editRecord.sessionId) || asString(sourceRecord.sessionId) || asString(payload.sessionId),
        threadId: asString(editRecord.threadId) || asString(sourceRecord.threadId) || asString(payload.threadId),
        projectPath,
        uri: editUri || activeUri,
        rel: asString(edit.rel),
        editId,
        revision: asRevision(edit.revision),
        state: asString(edit.state) || 'pending',
        label: asString(edit.label) || 'Agent edit',
        description: asString(edit.description),
        hunkId,
        hunkState: asString(hunkRecord?.state) || asString(edit.state) || 'pending',
        summary: asString(hunkRecord?.summary),
        message: asString(hunkRecord?.message),
        lineNumber,
        originalRange: normalizeRange(hunkRecord?.originalRange, lineNumber),
        modifiedRange,
        originalLines: hunkOriginalLines(hunkRecord),
        modifiedLines: hunkModifiedLines(hunkRecord),
      });
    }
  }
  return result;
}

export function createAgentEditReviewRuntime(deps: AgentEditReviewRuntimeDeps) {
  let renderer: ChatEditingHunkRenderer | null = null;
  let rendererEditor: MonacoCodeEditorLike | null = null;
  let rendererModel: MonacoTextModelLike | null = null;
  const relayoutDisposables: Array<{ dispose(): void }> = [];

  function clear(): void {
    try { renderer?.clear(); } catch (_) {}
  }

  function editorSupportsDiffHunkWidget(editor: MonacoCodeEditorLike | null): editor is MonacoCodeEditorLike & ICodeEditorLike {
    return !!editor
      && typeof editor.addOverlayWidget === 'function'
      && typeof editor.removeOverlayWidget === 'function'
      && typeof editor.layoutOverlayWidget === 'function'
      && typeof editor.getOptions === 'function'
      && typeof editor.getLayoutInfo === 'function'
      && typeof editor.getScrollTop === 'function'
      && typeof editor.getTopForLineNumber === 'function'
      && typeof editor.focus === 'function';
  }

  async function sendDecision(edit: NormalizedAgentEdit, decision: 'accept' | 'reject'): Promise<boolean> {
    try {
      await deps.rpcCall(EDITOR_RPC_METHODS.agentEditsDecide, {
        decision,
        conversationId: edit.conversationId,
        sessionId: edit.sessionId,
        threadId: edit.threadId,
        projectPath: edit.projectPath,
        uri: edit.uri,
        editId: edit.editId,
        hunkId: edit.hunkId,
        knownRevision: edit.revision,
        ts: Date.now(),
      }, { timeoutMs: 5000 });
      return true;
    } catch (error) {
      console.warn('[AgentEditReview] decision failed', error);
      return false;
    }
  }

  function createDiffInfo(edit: NormalizedAgentEdit): IDocumentDiff2Like {
    return {
      keep: async () => {
        return sendDecision(edit, 'accept');
      },
      undo: async () => {
        return sendDecision(edit, 'reject');
      },
    };
  }

  function createChange(edit: NormalizedAgentEdit): DetailedLineRangeMappingLike {
    return {
      modified: { startLineNumber: edit.lineNumber },
      editId: edit.editId,
      hunkId: edit.hunkId,
      uri: edit.uri,
    };
  }

  function relayoutOverlays(): void {
    try { renderer?.relayout(); } catch (_) {}
  }

  function installRelayoutListeners(editor: MonacoCodeEditorLike): void {
    if (relayoutDisposables.length) return;
    const scroll = editor.onDidScrollChange?.(() => relayoutOverlays());
    const layout = editor.onDidLayoutChange?.(() => relayoutOverlays());
    if (scroll) relayoutDisposables.push(scroll);
    if (layout) relayoutDisposables.push(layout);
  }

  function apply(payload: unknown): void {
    const payloadRecord = asRecord(payload);
    if (!payloadRecord) {
      clear();
      return;
    }
    const activeUri = activeModelUri(deps);
    const payloadUri = normalizeFileUri(asString(payloadRecord.uri));
    if (payloadUri && activeUri && payloadUri !== activeUri) return;

    const edits = normalizeEdits(payloadRecord, activeUri);
    if (!edits.length || payloadRecord.cleared === true) {
      clear();
      return;
    }

    const editor = deps.getEditor() as MonacoCodeEditorLike | null;
    const monaco = deps.getMonaco() as MonacoLike | null;
    const model = deps.getModel() as MonacoTextModelLike | null;
    const RangeCtor = monaco?.Range;
    if (!editor || !model || !RangeCtor || !editorSupportsDiffHunkWidget(editor)) return;

    installRelayoutListeners(editor);
    if (!renderer || rendererEditor !== editor || rendererModel !== model) {
      try { renderer?.clear(); } catch (_) {}
      renderer = new ChatEditingHunkRenderer({
        document: deps.getDocument() || document,
        editor: editor as MonacoCodeEditorForChatHunks,
        model,
        RangeCtor,
      });
      rendererEditor = editor;
      rendererModel = model;
    }

    const pendingChanges: ChatEditingHunkRenderChange[] = edits
      .filter((edit) => edit.hunkState === 'pending')
      .map((edit) => ({
        hunkId: edit.hunkId,
        state: edit.hunkState,
        original: edit.originalRange,
        modified: edit.modifiedRange,
        originalLines: edit.originalLines,
        modifiedLines: edit.modifiedLines,
        diffInfo: createDiffInfo(edit),
        change: createChange(edit),
      }));

    try {
      renderer.render(pendingChanges);
    } catch (error) {
      console.warn('[AgentEditReview] failed to render chat editing hunks', error);
    }
  }

  return {
    apply,
    clear,
    scheduleReapply(payload: unknown): void {
      deps.schedule(() => { apply(payload); }, 0);
    },
    dispose(): void {
      clear();
      for (const disposable of relayoutDisposables.splice(0)) {
        try { disposable.dispose(); } catch (_) {}
      }
      renderer = null;
      rendererEditor = null;
      rendererModel = null;
    },
  };
}
