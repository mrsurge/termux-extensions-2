import type { CodeInspectorMode } from './editor_touch_menu_utils.ts';

type JsonObject = Record<string, unknown>;
type CodeInspectorStatus = 'loading' | 'ready' | 'empty' | 'unsupported' | 'error';
type CallHierarchyDirection = 'incoming' | 'outgoing';

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
  getLineContent?(lineNumber: number): string;
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
  replaceHighlights(ranges: JsonObject[]): void;
  openLocation?(location: JsonObject): Promise<unknown>;
  notify?(message: string): boolean;
  logError(message: string, error: unknown): void;
}

export interface CodeInspectorRuntime {
  start(mode: CodeInspectorMode): void;
  goToDefinition(): void;
  handleCommand(params: JsonObject): void;
  reapplyHighlights(): void;
  clearHighlights(): void;
  dispose(): void;
}

const MODE_LABELS: Record<CodeInspectorMode, string> = {
  callHierarchy: 'Call hierarchy',
  references: 'References',
  implementations: 'Implementations',
};
const LOCATION_PREVIEW_MAX_CHARS = 240;
const LOCATION_PREVIEW_LEADING_CONTEXT = 40;

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

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathsEqual(left: string, right: string): boolean {
  return Boolean(left) && normalizedPath(left) === normalizedPath(right);
}

function rangeStart(value: unknown): { line: number; column: number } {
  const range = isRecord(value) ? value as RangeLike : {};
  return {
    line: finitePositive(range.startLineNumber),
    column: finitePositive(range.startColumn),
  };
}

function oneLinePreview(line: string, column: number): string {
  const hitOffset = Math.max(0, column - 1);
  const windowStart = Math.max(0, hitOffset - LOCATION_PREVIEW_LEADING_CONTEXT);
  const rawWindow = line.slice(
    windowStart,
    windowStart + LOCATION_PREVIEW_MAX_CHARS * 2,
  );
  const prefix = windowStart > 0 ? '...' : '';
  const suffix =
    windowStart + rawWindow.length < line.length ? '...' : '';
  const budget = Math.max(
    0,
    LOCATION_PREVIEW_MAX_CHARS - prefix.length - suffix.length,
  );
  const compact = rawWindow.replace(/\s+/g, ' ').trim();
  return `${prefix}${compact.slice(0, budget)}${suffix}`;
}

function locationPreview(
  location: JsonObject,
  currentPath: string,
  model: ModelLike | null,
): string {
  const path = asString(location.path);
  const position = rangeStart(location.selectionRange ?? location.range);
  if (model?.getLineContent && pathsEqual(path, currentPath)) {
    try {
      const preview = oneLinePreview(
        model.getLineContent(position.line),
        position.column,
      );
      if (preview) return preview;
    } catch {
      // Retain the WBA preview if the live model is between transitions.
    }
  }
  return oneLinePreview(asString(location.preview), 1);
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
  currentPath: string,
  model: ModelLike | null,
): JsonObject {
  const path = asString(location.path);
  const position = rangeStart(location.selectionRange ?? location.range);
  return {
    id: `location:${fileIndex}:${locationIndex}:${path}:${position.line}:${position.column}`,
    type: 'location',
    label: `${position.line}:${position.column}`,
    description: locationPreview(location, currentPath, model),
    path,
    uri: asString(location.uri),
    range: location.range ?? null,
    selectionRange: location.selectionRange ?? location.range ?? null,
    originRange: location.originRange ?? null,
    children: [],
  };
}

function locationTree(
  locations: JsonObject[],
  currentPath: string,
  model: ModelLike | null,
): JsonObject[] {
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
    descriptionKind: 'path',
    path,
    uri: asString(entries[0]?.uri),
    children: entries.map((entry, locationIndex) =>
      locationNode(entry, fileIndex, locationIndex, currentPath, model)
    ),
  }));
}

function callNode(
  item: JsonObject,
  branch = 'root',
  direction: CallHierarchyDirection = 'incoming',
): JsonObject {
  const sessionId = asString(item.sessionId);
  const itemId = asString(item.itemId);
  const path = asString(item.path);
  const id = `call:${branch}:${sessionId}:${itemId}`;
  return {
    id,
    type: 'call',
    label: asString(item.name) || basename(path) || 'Call',
    description: path,
    descriptionKind: 'path',
    detail: asString(item.detail),
    path,
    uri: asString(item.uri),
    range: item.range ?? null,
    selectionRange: item.selectionRange ?? item.range ?? null,
    sessionId,
    itemId,
    providerHandle: item.providerHandle ?? null,
    direction,
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

function collectHighlightRanges(
  nodes: JsonObject[],
  currentPath: string,
  ranges: JsonObject[] = [],
): JsonObject[] {
  for (const node of nodes) {
    if (node.type === 'location' && pathsEqual(asString(node.path), currentPath)) {
      const range = isRecord(node.selectionRange)
        ? node.selectionRange
        : isRecord(node.range)
          ? node.range
          : null;
      if (range) ranges.push(range);
    }
    collectHighlightRanges(asArray(node.children), currentPath, ranges);
  }
  return ranges;
}

export function createEditorCodeInspectorRuntime(
  deps: CodeInspectorRuntimeDeps,
): CodeInspectorRuntime {
  let requestSequence = 0;
  let projection: CodeInspectorProjection | null = null;
  let disposed = false;
  let definitionRequestSequence = 0;
  const expanding = new Set<string>();

  function syncHighlights(): void {
    const currentPath = deps.getCurrentPath();
    const current = projection;
    if (
      !currentPath ||
      !current ||
      current.status !== 'ready' ||
      (current.mode !== 'references' && current.mode !== 'implementations')
    ) {
      deps.replaceHighlights([]);
      return;
    }
    deps.replaceHighlights(
      collectHighlightRanges(current.tree, currentPath),
    );
  }

  function publish(next: CodeInspectorProjection): void {
    projection = next;
    syncHighlights();
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

  function isDefinitionCurrent(sequence: number, target: JsonObject): boolean {
    if (disposed || sequence !== definitionRequestSequence) return false;
    const editor = deps.getEditor();
    const model = editor?.getModel?.();
    return (
      deps.getCurrentPath() === target.path &&
      (model?.getVersionId?.() ?? 0) === target.modelVersion
    );
  }

  function notify(message: string): void {
    if (deps.notify?.(message) === false) {
      deps.logError(
        'Code Inspector notification publish failed',
        new Error('editor_rpc_disconnected'),
      );
    }
  }

  async function runGoToDefinition(): Promise<void> {
    const editor = deps.getEditor();
    const path = deps.getCurrentPath();
    const position = editor ? targetPosition(editor) : null;
    if (!editor || !path || !position) return;

    definitionRequestSequence += 1;
    const sequence = definitionRequestSequence;
    const target = buildTarget(editor, path, position);
    try {
      const reply = resultPayload(await deps.editorWorkbenchCall(
        'definition',
        {
          path,
          languageId: target.languageId,
          lineNumber: position.lineNumber,
          column: position.column,
        },
        { timeoutMs: 20000 },
      ));
      if (!isDefinitionCurrent(sequence, target)) return;
      const location = asArray(reply.result)[0];
      if (!location) {
        if (reply.ok === false && reply.unsupported !== true) {
          deps.logError(
            'Go to Definition request failed',
            reply.error ?? 'definition_failed',
          );
          notify('Go to Definition failed.');
        } else if (reply.unsupported === true) {
          notify('No definition provider supports this file.');
        } else {
          notify('No definition found.');
        }
        return;
      }

      const destinationPath = asString(location.path);
      if (!destinationPath) {
        deps.logError(
          'Go to Definition returned a location without a path',
          location,
        );
        notify('Definition target has no file path.');
        return;
      }
      if (!deps.openLocation) {
        deps.logError(
          'Go to Definition navigation is unavailable',
          new Error('open_location_unavailable'),
        );
        return;
      }
      const destination = rangeStart(
        location.selectionRange ?? location.range,
      );
      await deps.openLocation({
        path: destinationPath,
        line: destination.line,
        column: destination.column,
        focus: false,
        scroll_y: 'center',
        reason: 'code_inspector_definition',
        request_id: `definition_${Date.now()}_${sequence}`,
      });
    } catch (error) {
      if (!isDefinitionCurrent(sequence, target)) return;
      deps.logError('Go to Definition request failed', error);
      notify('Go to Definition failed.');
    }
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
        ? items.map((item, index) => callNode(item, `root:${index}`, 'incoming'))
        : locationTree(items, path, editor.getModel?.() ?? null);
      const summary: JsonObject = {
        label: MODE_LABELS[mode],
        count: items.length,
      };
      if (mode === 'callHierarchy') summary.direction = 'incoming';
      else summary.fileCount = tree.length;
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
      if (
        mode === 'callHierarchy' &&
        !unsupported &&
        reply.ok !== false &&
        tree.length
      ) {
        await expand({
          requestId,
          nodeId: tree[0].id,
        });
      }
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
      !nodeId
    ) {
      return;
    }
    const node = visitNodes(current.tree, (candidate) => candidate.id === nodeId);
    const direction = node?.direction === 'incoming' || node?.direction === 'outgoing'
      ? node.direction
      : null;
    if (
      !node ||
      node.type !== 'call' ||
      !direction ||
      node.childrenState === 'loaded'
    ) {
      return;
    }
    const expansionKey = `${nodeId}:${direction}`;
    if (expanding.has(expansionKey)) return;
    const sessionId = asString(node.sessionId);
    const itemId = asString(node.itemId);
    if (!sessionId || !itemId) return;

    expanding.add(expansionKey);
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
      if (!activeNode || activeNode.direction !== direction) return;
      const items = asArray(reply.result);
      activeNode.children = items.map((item, index) =>
        callNode(item, `${nodeId}:${index}`, direction)
      );
      activeNode.childrenState = reply.ok === false ? 'error' : 'loaded';
      activeNode.error = reply.ok === false ? reply.error ?? 'Call hierarchy failed' : null;
      publishRevision({ tree: projection.tree });
    } catch (error) {
      if (projection?.requestId !== requestId) return;
      const activeNode = visitNodes(projection.tree, (candidate) => candidate.id === nodeId);
      if (!activeNode || activeNode.direction !== direction) return;
      activeNode.childrenState = 'error';
      activeNode.error = error instanceof Error ? error.message : String(error);
      publishRevision({ tree: projection.tree });
    } finally {
      expanding.delete(expansionKey);
    }
  }

  async function switchDirection(params: JsonObject): Promise<void> {
    const current = projection;
    const requestId = asString(params.requestId);
    const direction = params.direction === 'incoming' || params.direction === 'outgoing'
      ? params.direction
      : null;
    if (
      !current ||
      current.mode !== 'callHierarchy' ||
      current.requestId !== requestId ||
      !direction
    ) {
      return;
    }
    if (current.summary.direction === direction) return;

    const tree: JsonObject[] = current.tree.map((node) => ({
      ...node,
      direction,
      childrenState: 'unloaded',
      children: [],
    }));
    publishRevision({
      summary: {
        ...current.summary,
        direction,
      },
      tree,
    });
    if (tree.length) {
      await expand({
        requestId,
        nodeId: tree[0].id,
      });
    }
  }

  function start(mode: CodeInspectorMode): void {
    void run(mode);
  }

  function goToDefinition(): void {
    void runGoToDefinition();
  }

  function handleCommand(params: JsonObject): void {
    const retained = projectionFromValue(params.projection);
    if (params.action === 'expand' || params.action === 'direction') {
      if (
        retained &&
        (!projection || retained.requestId !== projection.requestId)
      ) {
        projection = retained;
        requestSequence = Math.max(requestSequence, retained.requestSequence);
      }
      if (params.action === 'direction') {
        void switchDirection(params);
      } else {
        void expand(params);
      }
    } else if (params.action === 'release') {
      void releaseSessions(retained ?? projection);
    }
  }

  function reapplyHighlights(): void {
    syncHighlights();
  }

  function clearHighlights(): void {
    deps.replaceHighlights([]);
  }

  function dispose(): void {
    disposed = true;
    expanding.clear();
    clearHighlights();
    projection = null;
  }

  return {
    start,
    goToDefinition,
    handleCommand,
    reapplyHighlights,
    clearHighlights,
    dispose,
  };
}
