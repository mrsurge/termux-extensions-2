interface EditorJumpPayloadLike {
  line?: number | string;
  column?: number | string;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
}

interface EditorModelLike {
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
}

interface EditorInstanceLike {
  revealLine?(line: number, scrollType?: number): void;
  revealLineInCenter?(line: number, scrollType?: number): void;
  revealLineNearTop?(line: number, scrollType?: number): void;
  getTopForLineNumber?(line: number): number;
  setScrollTop?(scrollTop: number): void;
  setPosition?(position: { lineNumber: number; column: number }): void;
  focus?(): void;
}

function asPayload(value: unknown): EditorJumpPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorJumpPayloadLike
    : null;
}

function asModel(value: unknown): EditorModelLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorModelLike
    : null;
}

function asEditor(value: unknown): EditorInstanceLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorInstanceLike
    : null;
}

export function applyJumpToLine(
  editorInstance: unknown,
  modelInstance: unknown,
  payload: unknown,
): void {
  try {
    const typedPayload = asPayload(payload);
    const typedEditor = asEditor(editorInstance);
    const typedModel = asModel(modelInstance);
    if (!typedPayload) return;
    if (!typedEditor || !typedModel) return;

    let line = typedPayload.line;
    let col = typedPayload.column;
    if (typeof line === 'string' && /^\d+$/.test(line)) line = parseInt(line, 10);
    if (typeof col === 'string' && /^\d+$/.test(col)) col = parseInt(col, 10);
    if (!Number.isFinite(line)) return;
    line = Math.max(1, Math.min(typedModel.getLineCount(), Number(line)));
    if (!Number.isFinite(col)) col = 1;
    col = Math.max(1, Math.min(typedModel.getLineMaxColumn(line), Number(col)));

    const focus = typedPayload.focus;
    const scrollY = typedPayload.scroll_y;
    const scrollToTop = typedPayload.scroll_to_top;

    if (scrollToTop) {
      try {
        if (
          typeof typedEditor.getTopForLineNumber === 'function'
          && typeof typedEditor.setScrollTop === 'function'
        ) {
          typedEditor.setScrollTop(typedEditor.getTopForLineNumber(line));
        }
      } catch (_) {}
    } else if (typeof scrollY === 'string' && String(scrollY).toLowerCase() === 'center') {
      try { typedEditor.revealLineInCenter?.(line, 0); } catch (_) {}
    } else {
      try { typedEditor.revealLineNearTop?.(line, 0); } catch (_) {}
    }

    if (focus === false) return;
    try { typedEditor.setPosition?.({ lineNumber: line, column: col }); } catch (_) {}
    try { typedEditor.focus?.(); } catch (_) {}
  } catch (_) {}
}
