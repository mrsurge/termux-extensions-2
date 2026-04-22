interface EditorSocketLike {
  connected?: boolean;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface WorkbenchDidChangePayload {
  path?: string;
  text?: string;
  languageId?: string;
  generation?: number;
}

export function wbEmitDidChange(
  editorSocket: EditorSocketLike | null | undefined,
  payload: WorkbenchDidChangePayload | null | undefined,
  currentGenerationFn?: (() => number) | null,
): boolean {
  try {
    if (!editorSocket || !editorSocket.connected || typeof editorSocket.emit !== 'function') return false;
    if (!payload || !payload.path) return false;
    const fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : 0;
    editorSocket.emit('editor_workbench_did_change', {
      path: payload.path,
      text: String(payload.text || ''),
      languageId: String(payload.languageId || ''),
      generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : fallback,
    });
    return true;
  } catch (_) {
    return false;
  }
}
