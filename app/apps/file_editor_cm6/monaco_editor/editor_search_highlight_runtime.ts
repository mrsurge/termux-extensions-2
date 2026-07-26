import {
  minimapFindMatch,
  overviewRulerFindMatchForeground,
} from "../../../static/vendor/monaco-editor-core/esm/vs/platform/theme/common/colorRegistry.js";
import {
  themeColorFromId,
} from "../../../static/vendor/monaco-editor-core/esm/vs/platform/theme/common/themeService.js";

interface SearchHighlightPayload {
  active: boolean;
  projectPath: string;
  query: string;
  isRegex: boolean;
  isCaseSensitive: boolean;
  isWholeWords: boolean;
}

interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoFindMatchLike {
  range?: MonacoRangeLike;
}

interface MonacoModelLike {
  findMatches?(
    searchString: string,
    searchScope: unknown,
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
    limitResultCount?: number,
  ): MonacoFindMatchLike[];
}

interface MonacoDecorationCollectionLike {
  set?(decorations: MonacoDecorationLike[]): void;
  clear?(): void;
}

interface MonacoEditorLike {
  createDecorationsCollection?(): MonacoDecorationCollectionLike;
  deltaDecorations?(
    oldDecorations: unknown[],
    newDecorations: MonacoDecorationLike[],
  ): unknown[];
  getOption?(id: number): unknown;
}

interface MonacoDecorationLike {
  range: MonacoRangeLike;
  options: Record<string, unknown>;
}

interface DecorationChannelState {
  editor: MonacoEditorLike | null;
  collection: MonacoDecorationCollectionLike | null;
  decorationIds: unknown[];
}

interface SearchHighlightDeps {
  getCurrentPath(): string | null;
  getEditor(): unknown;
  getModel(): unknown;
  schedule(callback: () => void, delayMs: number): unknown;
}

const DEFAULT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";
const WORD_SEPARATORS_OPTION_ID = 148;
const MAX_FIND_DECORATIONS = 1000;
const MAX_APPLY_ATTEMPTS = 12;
const APPLY_RETRY_DELAY_MS = 25;
const MINIMAP_POSITION_INLINE = 1;
const OVERVIEW_RULER_LANE_CENTER = 2;

const searchDecorationState: DecorationChannelState = {
  editor: null,
  collection: null,
  decorationIds: [],
};
const codeInspectorDecorationState: DecorationChannelState = {
  editor: null,
  collection: null,
  decorationIds: [],
};
let activeHighlight: SearchHighlightPayload | null = null;
let activeApplyToken = 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asEditor(value: unknown): MonacoEditorLike | null {
  return asRecord(value) as MonacoEditorLike | null;
}

function asModel(value: unknown): MonacoModelLike | null {
  return asRecord(value) as MonacoModelLike | null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePayload(payload: unknown): SearchHighlightPayload | null {
  const record = asRecord(payload);
  if (!record || record.active === false) {
    return null;
  }
  const query = stringValue(record.query).trim();
  if (!query) {
    return null;
  }
  return {
    active: true,
    projectPath: stringValue(record.projectPath).replace(/\/+$/, ""),
    query,
    isRegex: record.isRegex === true,
    isCaseSensitive: record.isCaseSensitive === true,
    isWholeWords: record.isWholeWords === true,
  };
}

function wordSeparators(
  editor: MonacoEditorLike,
  wholeWords: boolean,
): string | null {
  if (!wholeWords) return null;
  const configured = editor.getOption?.(WORD_SEPARATORS_OPTION_ID);
  return typeof configured === "string" ? configured : DEFAULT_WORD_SEPARATORS;
}

function findRanges(
  editor: MonacoEditorLike,
  model: MonacoModelLike,
  request: SearchHighlightPayload,
): MonacoRangeLike[] {
  if (!model.findMatches) {
    return [];
  }
  try {
    return model
      .findMatches(
        request.query,
        null,
        request.isRegex,
        request.isCaseSensitive,
        wordSeparators(editor, request.isWholeWords),
        false,
        MAX_FIND_DECORATIONS,
      )
      .map((match) => match.range)
      .filter((range): range is MonacoRangeLike => Boolean(range));
  } catch (error) {
    console.warn("[SearchHighlight] findMatches failed", error);
    return [];
  }
}

function matchDecoration(range: MonacoRangeLike): MonacoDecorationLike {
  return {
    range,
    options: {
      description: "te2-search-find-match",
      stickiness: 1,
      zIndex: 10,
      className: "findMatch",
      inlineClassName: "findMatchInline",
      showIfCollapsed: true,
      overviewRuler: {
        color: themeColorFromId(overviewRulerFindMatchForeground),
        position: OVERVIEW_RULER_LANE_CENTER,
      },
      minimap: {
        color: themeColorFromId(minimapFindMatch),
        position: MINIMAP_POSITION_INLINE,
      },
    },
  };
}

function setDecorations(
  editor: MonacoEditorLike,
  decorations: MonacoDecorationLike[],
  state: DecorationChannelState,
): void {
  if (state.editor && state.editor !== editor) {
    clearDecorationChannel(state);
  }
  state.editor = editor;
  if (editor.createDecorationsCollection) {
    if (!state.collection) {
      state.collection = editor.createDecorationsCollection();
    }
    state.collection?.set?.(decorations);
    return;
  }
  if (editor.deltaDecorations) {
    state.decorationIds = editor.deltaDecorations(
      state.decorationIds,
      decorations,
    );
  }
}

function clearDecorationChannel(state: DecorationChannelState): void {
  if (state.collection?.clear) {
    state.collection.clear();
  }
  state.collection = null;
  if (state.editor?.deltaDecorations && state.decorationIds.length > 0) {
    state.decorationIds = state.editor.deltaDecorations(
      state.decorationIds,
      [],
    );
  } else {
    state.decorationIds = [];
  }
  state.editor = null;
}

function normalizeDecorationRange(value: unknown): MonacoRangeLike | null {
  const range = asRecord(value);
  if (!range) return null;
  const startLineNumber = Number(range.startLineNumber);
  const startColumn = Number(range.startColumn);
  const endLineNumber = Number(range.endLineNumber);
  const endColumn = Number(range.endColumn);
  if (
    !Number.isFinite(startLineNumber) ||
    !Number.isFinite(startColumn) ||
    !Number.isFinite(endLineNumber) ||
    !Number.isFinite(endColumn) ||
    startLineNumber <= 0 ||
    startColumn <= 0 ||
    endLineNumber <= 0 ||
    endColumn <= 0
  ) {
    return null;
  }
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

export function replaceCodeInspectorHighlights(
  editorValue: unknown,
  rangesValue: unknown,
): void {
  const ranges = Array.isArray(rangesValue)
    ? rangesValue
        .map(normalizeDecorationRange)
        .filter((range): range is MonacoRangeLike => range !== null)
    : [];
  const editor = asEditor(editorValue);
  if (!editor) {
    if (!ranges.length) clearDecorationChannel(codeInspectorDecorationState);
    return;
  }
  setDecorations(
    editor,
    ranges.map(matchDecoration),
    codeInspectorDecorationState,
  );
}

export function clearCodeInspectorHighlights(): void {
  clearDecorationChannel(codeInspectorDecorationState);
}

export function clearSearchHighlight(_editorValue: unknown): void {
  activeApplyToken += 1;
  activeHighlight = null;
  clearDecorationChannel(searchDecorationState);
}

function applySearchHighlight(
  deps: SearchHighlightDeps,
  request: SearchHighlightPayload,
): boolean {
  const currentPath = deps.getCurrentPath();
  if (!currentPath) {
    return false;
  }
  const editor = asEditor(deps.getEditor());
  const model = asModel(deps.getModel());
  if (!editor || !model) {
    return false;
  }
  if (!isPathInProject(currentPath, request.projectPath)) {
    setDecorations(editor, [], searchDecorationState);
    return true;
  }

  const decorations = findRanges(editor, model, request).map(matchDecoration);
  setDecorations(editor, decorations, searchDecorationState);
  return true;
}

function isPathInProject(currentPath: string, projectPath: string): boolean {
  if (!projectPath) {
    return true;
  }
  const normalizedCurrent = currentPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return (
    normalizedCurrent === normalizedProject ||
    normalizedCurrent.startsWith(`${normalizedProject}/`)
  );
}

function scheduleApply(
  deps: SearchHighlightDeps,
  request: SearchHighlightPayload,
  token: number,
  attempt: number,
): void {
  if (activeApplyToken !== token || activeHighlight !== request) return;
  if (applySearchHighlight(deps, request)) return;
  if (attempt >= MAX_APPLY_ATTEMPTS) return;
  deps.schedule(
    () => scheduleApply(deps, request, token, attempt + 1),
    APPLY_RETRY_DELAY_MS,
  );
}

function armSearchHighlight(
  request: SearchHighlightPayload,
  deps: SearchHighlightDeps,
): void {
  activeHighlight = request;
  activeApplyToken += 1;
  scheduleApply(deps, request, activeApplyToken, 0);
}

export function reapplySearchHighlight(deps: SearchHighlightDeps): void {
  const request = activeHighlight;
  if (!request) {
    return;
  }
  armSearchHighlight(request, deps);
}

export function handleSearchHighlight(
  payload: unknown,
  deps: SearchHighlightDeps,
): void {
  const request = normalizePayload(payload);
  if (!request) {
    clearSearchHighlight(deps.getEditor());
    return;
  }
  armSearchHighlight(request, deps);
}
