interface MarkerLike extends MonacoRuntimeMarkerLike {
  startLineNumber: number;
  startColumn: number;
}

export function installMarkerNavBindings(
  monacoObj: MonacoRuntimeGlobal | null | undefined,
  editorInstance: MonacoRuntimeEditorLike | null | unknown,
  onJump: (dir: number) => void,
): void {
  try {
    const editor = editorInstance as MonacoRuntimeEditorLike | null;
    if (!editor || editor.__te2MarkerNavBound || !monacoObj || !monacoObj.KeyMod || !monacoObj.KeyCode || !editor.addCommand) return;
    if (typeof monacoObj.KeyMod.Alt !== 'number' || typeof monacoObj.KeyCode.F8 !== 'number') return;
    editor.__te2MarkerNavBound = true;
    editor.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyCode.F8, () => { onJump(1); });
    if (typeof monacoObj.KeyMod.Shift === 'number') {
      editor.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyMod.Shift | monacoObj.KeyCode.F8, () => { onJump(-1); });
    }
  } catch (_) {}
}

export function jumpToMarker(
  monacoObj: MonacoRuntimeGlobal | null | undefined,
  editorInstance: MonacoRuntimeEditorLike | null | unknown,
  modelInstance: MonacoRuntimeModelLike | null | unknown,
  dir: number,
): void {
  try {
    const editor = editorInstance as MonacoRuntimeEditorLike | null;
    const model = modelInstance as MonacoRuntimeModelLike | null;
    if (!editor || !model || !monacoObj || !monacoObj.editor || !monacoObj.editor.getModelMarkers || !model.uri) return;
    const markers = (monacoObj.editor.getModelMarkers({ resource: model.uri }) || [])
      .filter((marker): marker is MarkerLike => typeof marker.startLineNumber === 'number' && typeof marker.startColumn === 'number');
    if (!markers.length) return;
    markers.sort((a, b) => {
      if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
      return a.startColumn - b.startColumn;
    });
    const pos = editor.getPosition ? editor.getPosition() : null;
    const line = pos && pos.lineNumber ? pos.lineNumber : 1;
    const col = pos && pos.column ? pos.column : 1;
    let idx = -1;
    if (dir > 0) {
      for (let index = 0; index < markers.length; index += 1) {
        const marker = markers[index];
        if (marker.startLineNumber > line || (marker.startLineNumber === line && marker.startColumn > col)) {
          idx = index;
          break;
        }
      }
      if (idx === -1) idx = 0;
    } else {
      for (let index = markers.length - 1; index >= 0; index -= 1) {
        const marker = markers[index];
        if (marker.startLineNumber < line || (marker.startLineNumber === line && marker.startColumn < col)) {
          idx = index;
          break;
        }
      }
      if (idx === -1) idx = markers.length - 1;
    }
    const hit = markers[idx];
    if (!hit) return;
    const targetLine = Math.max(1, Number(hit.startLineNumber || 1));
    const targetCol = Math.max(1, Number(hit.startColumn || 1));
    try { editor.setPosition?.({ lineNumber: targetLine, column: targetCol }); } catch (_) {}
    try { editor.revealLineInCenter?.(targetLine, 0); } catch (_) {}
    try { editor.focus?.(); } catch (_) {}
  } catch (_) {}
}
