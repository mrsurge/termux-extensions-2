import type { CodeInspectorMode } from './editor_touch_menu_utils.ts';

type JsonObject = Record<string, unknown>;
type CodeInspectorStatus = 'loading' | 'ready' | 'empty' | 'unsupported' | 'error';

interface PositionLike {
  lineNumber: number;
  column: number;
}

interface RangeLike {
  startLineNumber?: unknown;
  startColumn?: unknown;
  endLineNumber?: unknown;
  endColumn?: unknown;
}

interface ModelLike {
  uri?: { toString(): string };
  getLanguageId?(): string;
  getVersionId?(): number;
  getWordAtPosition?(position: PositionLike): { word?: string } | null;
}

interface EditorLike {
  getModel?(): ModelLike | null;
  getPosition?(): PositionLike | null;
  getSelection?(): {
    isEmpty?(): boolean;
    getStartPosition?(): PositionLike;
  } | null;
}

interface CodeInspectorProjection {
  revision: number;
  requestId: string;
  requestSequence: number;
  status: CodeInspectorStatus;
  mode: CodeInspectorMode;
  target: JsonObject;
  summary: JsonObject;
  tree: JsonObject[];
  error: unknown;
}

interface CodeInspectorRuntimeDeps {
  getEditor(): EditorLike | null;
  getCurrentPath(): string | null;
  editorWorkbenchCall(
    method: string,
    params?: JsonObject,
    opts?: { timeoutMs?: number },
  ): Promise<unknown>;
  publishProjection(projection: CodeInspectorProjection): boolean;
  logError(message: string, error: unknown): void;
}

export interface CodeInspectorRuntime {
  start(mode: CodeInspectorMode): void;
  handleCommand(params: JsonObject): void;
  dispose(): void;
}

const MODE_LABELS: Record<CodeInspectorMode, string> = {
  callHierarchy: 'Call hierarchy',
  references: 'References',
  implementations: 'Implementations',
};

function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finitePositive(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function rangeStart(value: unknown): { line: number; column: number } {
  const range = isRecord(value) ? value as RangeLike : {};
  return {
    line: finitePositive(range.startLineNumber),
    column: finitePositive(range.startColumn),
  };
}

function targetPosition(editor: EditorLike): PositionLike | null {
  const selection = editor.getSelection?.();
  if (selection && selection.isEmpty?.() === false) {
    const start = selection.getStartPosition?.();
    if (start) return start;
  }
  return editor.getPosition?.() ?? null;
}

function resultPayload(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function projectionFromValue(value: unknown): CodeInspectorProjection | null {
  if (!isRecord(value)) return null;
  const mode = value.mode;
  const status = value.status;
  if (
    mode !== 'references' &&
    mode !== 'implementations' &&
    mode !== 'callHierarchy'
  ) {
    return null;
  }
  if (
    status !== 'loading' &&
    status !== 'ready' &&
    status !== 'empty' &&
    status !== 'unsupported' &&
    status !== 'error'
  ) {
    return null;
  }
  const requestId = asString(value.requestId);
  if (!requestId) return null;
  return {
    revision: Math.max(0, Number(value.revision) || 0),
    requestId,
    requestSequence: Math.max(0, Number(value.requestSequence) || 0),
    status,
    mode,
    target: isRecord(value.target) ? value.target : {},
    summary: isRecord(value.summary) ? value.summary : {},
    tree: asArray(value.tree),
    error: value.error ?? null,
  };
}

function locationNode(
  location: JsonObject,
  fileIndex: number,
  locationIndex: number,
): JsonObject {
  const path = asString(location.path);
  const position = rangeStart(location.selectionRange ?? location.range);
  return {
    id: `location:${fileIndex}:${locationIndex}:${path}:${position.line}:${position.column}`,
    type: 'location',
    label: `${position.line}:${position.column}`,
    description: basename(path),
    path,
    uri: asString(location.uri),
    range: location.range ?? null,
    selectionRange: location.selectionRange ?? location.range ?? null,
    originRange: location.originRange ?? null,
    children: [],
  };
}

function locationTree(locations: JsonObject[]): JsonObject[] {
  const grouped = new Map<string, JsonObject[]>();
  for (const location of locations) {
    const path = asString(location.path) || asString(location.uri);
    if (!path) continue;
    const current = grouped.get(path);
    if (current) current.push(location);
    else grouped.set(path, [location]);
  }
  return [...grouped.entries()].map(([path, entries], fileIndex) => ({
    id: `file:${fileIndex}:${path}`,
    type: 'file',
    label: basename(path),
    description: path,
    path,
    uri: asString(entries[0]?.uri),
    children: entries.map((entry, locationIndex) =>
      locationNode(entry, fileIndex, locationIndex)
    ),
  }));
}

function callNode(item: JsonObject, branch = 'root'): JsonObject {
  const sessionId = asString(item.sessionId);
  const itemId = asString(item.itemId);
  const path = asString(item.path);
  const id = `call:${branch}:${sessionId}:${itemId}`;
  return {
    id,
    type: 'call',
    label: asString(item.name) || basename(path) || 'Call',
    description: asString(item.detail) || path,
    path,
    uri: asString(item.uri),
    range: item.range ?? null,
    selectionRange: item.selectionRange ?? item.range ?? null,
    sessionId,
    itemId,
    providerHandle: item.providerHandle ?? null,
    children: [
      directionNode(id, sessionId, itemId, 'incoming'),
      directionNode(id, sessionId, itemId, 'outgoing'),
    ],
  };
}

function directionNode(
  parentId: string,
  sessionId: string,
  itemId: string,
  direction: 'incoming' | 'outgoing',
): JsonObject {
  return {
    id: `${parentId}:${direction}`,
    type: 'direction',
    label: direction === 'incoming' ? 'Incoming calls' : 'Outgoing calls',
    direction,
    sessionId,
    itemId,
    childrenState: 'unloaded',
    children: [],
  };
}

function visitNodes(
  nodes: JsonObject[],
  predicate: (node: JsonObject) => boolean,
): JsonObject | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const children = asArray(node.children);
    const match = visitNodes(children, predicate);
    if (match) return match;
  }
  return null;
}

function collectSessions(nodes: JsonObject[], sessions = new Set<string>()): Set<string> {
  for (const node of nodes) {
    const sessionId = asString(node.sessionId);
    if (sessionId) sessions.add(sessionId);
    collectSessions(asArray(node.children), sessions);
  }
  return sessions;
}

export function createEditorCodeInspectorRuntime(
  deps: CodeInspectorRuntimeDeps,
): CodeInspectorRuntime {
  let requestSequence = 0;
  let projection: CodeInspectorProjection | null = null;
  let disposed = false;
  const expanding = new Set<string>();

  function publish(next: CodeInspectorProjection): void {
    projection = next;
    if (!deps.publishProjection(next)) {
      deps.logError('Code Inspector projection publish failed', new Error('editor_rpc_disconnected'));
    }
  }

  function publishRevision(patch: Partial<CodeInspectorProjection>): void {
    if (!projection) return;
    publish({
      ...projection,
      ...patch,
      revision: projection.revision + 1,
    });
  }

  async function releaseSessions(current: CodeInspectorProjection | null): Promise<void> {
    if (!current || current.mode !== 'callHierarchy') return;
    const releases = [...collectSessions(current.tree)].map((sessionId) =>
      deps.editorWorkbenchCall(
        'call_hierarchy_release',
        { sessionId },
        { timeoutMs: 4000 },
      ).catch(() => null)
    );
    await Promise.all(releases);
  }

  function buildTarget(editor: EditorLike, path: string, position: PositionLike): JsonObject {
    const model = editor.getModel?.();
    return {
      path,
      uri: model?.uri?.toString() ?? '',
      line: position.lineNumber,
      column: position.column,
      symbol: model?.getWordAtPosition?.(position)?.word ?? '',
      languageId: model?.getLanguageId?.() ?? '',
      modelVersion: model?.getVersionId?.() ?? 0,
    };
  }

  function isCurrent(requestId: string, target: JsonObject): boolean {
    if (disposed || projection?.requestId !== requestId) return false;
    const editor = deps.getEditor();
    const model = editor?.getModel?.();
    return (
      deps.getCurrentPath() === target.path &&
      (model?.getVersionId?.() ?? 0) === target.modelVersion
    );
  }

  async function run(mode: CodeInspectorMode): Promise<void> {
    const editor = deps.getEditor();
    const path = deps.getCurrentPath();
    const position = editor ? targetPosition(editor) : null;
    if (!editor || !path || !position) return;

    requestSequence = Math.max(requestSequence + 1, Date.now());
    const requestId = `code_inspector_${Date.now()}_${requestSequence}`;
    const target = buildTarget(editor, path, position);
    publish({
      revision: 0,
      requestId,
      requestSequence,
      status: 'loading',
      mode,
      target,
      summary: { label: MODE_LABELS[mode], count: 0 },
      tree: [],
      error: null,
    });

    const method = mode === 'references'
      ? 'references'
      : mode === 'implementations'
        ? 'implementations'
        : 'call_hierarchy_prepare';
    try {
      const reply = resultPayload(await deps.editorWorkbenchCall(
        method,
        {
          path,
          languageId: target.languageId,
          lineNumber: position.lineNumber,
          column: position.column,
        },
        { timeoutMs: 20000 },
      ));
      if (!isCurrent(requestId, target)) return;
      const items = asArray(reply.result);
      const unsupported = reply.unsupported === true;
      const tree = mode === 'callHierarchy'
        ? items.map((item, index) => callNode(item, `root:${index}`))
        : locationTree(items);
      const summary: JsonObject = {
        label: MODE_LABELS[mode],
        count: items.length,
      };
      if (mode !== 'callHierarchy') summary.fileCount = tree.length;
      publishRevision({
        status: unsupported
          ? 'unsupported'
          : tree.length
            ? 'ready'
            : reply.ok === false
              ? 'error'
              : 'empty',
        summary,
        tree,
        error: reply.ok === false ? reply.error ?? 'Code navigation failed' : null,
      });
    } catch (error) {
      if (!isCurrent(requestId, target)) return;
      publishRevision({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function expand(params: JsonObject): Promise<void> {
    const current = projection;
    const requestId = asString(params.requestId);
    const nodeId = asString(params.nodeId);
    if (
      !current ||
      current.mode !== 'callHierarchy' ||
      current.requestId !== requestId ||
      !nodeId ||
      expanding.has(nodeId)
    ) {
      return;
    }
    const node = visitNodes(current.tree, (candidate) => candidate.id === nodeId);
    const direction = node?.direction === 'incoming' || node?.direction === 'outgoing'
      ? node.direction
      : null;
    if (!node || !direction || node.childrenState === 'loaded') return;
    const sessionId = asString(node.sessionId);
    const itemId = asString(node.itemId);
    if (!sessionId || !itemId) return;

    expanding.add(nodeId);
    node.childrenState = 'loading';
    node.children = [];
    publishRevision({ tree: current.tree });
    try {
      const reply = resultPayload(await deps.editorWorkbenchCall(
        direction === 'incoming'
          ? 'call_hierarchy_incoming'
          : 'call_hierarchy_outgoing',
        { sessionId, itemId },
        { timeoutMs: 20000 },
      ));
      if (projection?.requestId !== requestId) return;
      const activeNode = visitNodes(projection.tree, (candidate) => candidate.id === nodeId);
      if (!activeNode) return;
      const items = asArray(reply.result);
      activeNode.children = items.map((item, index) =>
        callNode(item, `${nodeId}:${index}`)
      );
      activeNode.childrenState = reply.ok === false ? 'error' : 'loaded';
      activeNode.error = reply.ok === false ? reply.error ?? 'Call hierarchy failed' : null;
      publishRevision({ tree: projection.tree });
    } catch (error) {
      if (projection?.requestId !== requestId) return;
      const activeNode = visitNodes(projection.tree, (candidate) => candidate.id === nodeId);
      if (!activeNode) return;
      activeNode.childrenState = 'error';
      activeNode.error = error instanceof Error ? error.message : String(error);
      publishRevision({ tree: projection.tree });
    } finally {
      expanding.delete(nodeId);
    }
  }

  function start(mode: CodeInspectorMode): void {
    void run(mode);
  }

  function handleCommand(params: JsonObject): void {
    const retained = projectionFromValue(params.projection);
    if (params.action === 'expand') {
      if (
        retained &&
        (!projection || retained.requestId !== projection.requestId)
      ) {
        projection = retained;
        requestSequence = Math.max(requestSequence, retained.requestSequence);
      }
      void expand(params);
    } else if (params.action === 'release') {
      void releaseSessions(retained ?? projection);
    }
  }

  function dispose(): void {
    disposed = true;
    expanding.clear();
    projection = null;
  }

  return { start, handleCommand, dispose };
}
