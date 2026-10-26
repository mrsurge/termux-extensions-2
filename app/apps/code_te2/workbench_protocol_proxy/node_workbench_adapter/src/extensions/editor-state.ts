import { isUnknownArray } from '../protocol/value-types.ts';
// Code OSS IEditorPropertiesChangeData; null means unchanged, [] means empty.
export interface EditorRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface EditorSelection extends EditorRange {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

export interface EditorProperties {
  selections: { selections: EditorSelection[]; source: string } | null;
  visibleRanges: EditorRange[] | null;
  options: {
    tabSize: number; indentSize: number; originalIndentSize: number | "tabSize";
    insertSpaces: boolean; cursorStyle: number; lineNumbers: number;
  } | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !isUnknownArray(value);
}

function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error("Invalid editor property integer");
  }
  return value;
}

function range(value: unknown): EditorRange {
  if (!record(value)) throw new Error("Invalid editor range");
  const result = {
    startLineNumber: integer(value.startLineNumber), startColumn: integer(value.startColumn),
    endLineNumber: integer(value.endLineNumber), endColumn: integer(value.endColumn),
  };
  if (result.endLineNumber < result.startLineNumber ||
      result.endLineNumber === result.startLineNumber && result.endColumn < result.startColumn) {
    throw new Error("Reversed editor range");
  }
  return result;
}

function selection(value: unknown): EditorSelection {
  if (!record(value)) throw new Error("Invalid editor selection");
  const result = range(value);
  return { ...result,
    selectionStartLineNumber: integer(value.selectionStartLineNumber ?? result.startLineNumber),
    selectionStartColumn: integer(value.selectionStartColumn ?? result.startColumn),
    positionLineNumber: integer(value.positionLineNumber ?? result.endLineNumber),
    positionColumn: integer(value.positionColumn ?? result.endColumn),
  };
}

function list(value: unknown): unknown[] {
  if (!isUnknownArray(value) || value.length > 1024) throw new Error("Invalid editor property list");
  return value;
}

export function editorProperties(params: Record<string, unknown>): EditorProperties {
  const result: EditorProperties = { selections: null, visibleRanges: null, options: null };
  const source = typeof params.source === "string" &&
    ["mouse", "keyboard", "code.navigation", "code.jump"].includes(params.source) ? params.source : "api";
  if (params.selections !== undefined) {
    const selections = list(params.selections);
    if (!selections.length) throw new Error("Missing editor selection");
    result.selections = { selections: selections.map(selection), source };
  } else if (params.selection !== undefined && params.visibleRanges === undefined && params.options === undefined) {
    // Legacy selection-only peers and command callers retain their existing lane.
    result.selections = { selections: [selection(params.selection)], source };
  }
  if (params.visibleRanges !== undefined) result.visibleRanges = list(params.visibleRanges).map(range);
  if (params.options !== undefined) {
    const value = params.options;
    if (!record(value) || typeof value.insertSpaces !== "boolean") throw new Error("Invalid editor options");
    result.options = {
      tabSize: integer(value.tabSize), indentSize: integer(value.indentSize),
      originalIndentSize: value.originalIndentSize === "tabSize" ? "tabSize" : integer(value.originalIndentSize),
      insertSpaces: value.insertSpaces, cursorStyle: integer(value.cursorStyle, 1, 6),
      lineNumbers: integer(value.lineNumbers, 0, 4),
    };
  }
  if (!result.selections && !result.visibleRanges && !result.options) throw new Error("Empty editor properties");
  return result;
}
