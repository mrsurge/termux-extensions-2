import type { EditorOpenTransactionStore, EditorPositionLike } from './editor_open_contract.ts';

const memories = new WeakMap<EditorOpenTransactionStore, Map<string, EditorPositionLike>>();
const LIMIT = 100;

export function rememberOpenCursor(store: EditorOpenTransactionStore, path: string | null, position: EditorPositionLike | null | undefined): void {
  if (!path || !position || !Number.isSafeInteger(position.lineNumber) || !Number.isSafeInteger(position.column)
    || position.lineNumber < 1 || position.column < 1) return;
  let memory = memories.get(store);
  if (!memory) { memory = new Map(); memories.set(store, memory); }
  memory.delete(path);
  memory.set(path, { lineNumber: position.lineNumber, column: position.column });
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value!);
}

export function restoreOpenCursor(store: EditorOpenTransactionStore, path: string, editor: {
  setPosition?(position: EditorPositionLike): void;
  focus?(): void;
  getScrollTop?(): number;
  setScrollTop?(value: number): void;
}, model: { getLineCount?(): number; getLineMaxColumn?(line: number): number }, fallbackLine: number): void {
  const saved = memories.get(store)?.get(path);
  const lineNumber = Math.max(1, Math.min(model.getLineCount?.() || Number.MAX_SAFE_INTEGER, saved?.lineNumber || fallbackLine));
  const column = Math.max(1, Math.min(model.getLineMaxColumn?.(lineNumber) || Number.MAX_SAFE_INTEGER, saved?.column || 1));
  const scrollTop = editor.getScrollTop?.();
  editor.setPosition?.({ lineNumber, column });
  editor.focus?.();
  // Cursor restoration must not replace the independently restored viewport.
  if (scrollTop !== undefined) editor.setScrollTop?.(scrollTop);
}
