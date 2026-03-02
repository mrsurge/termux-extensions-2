export function installMarkerNavBindings(monacoObj, editorInstance, onJump) {
  try {
    if (!editorInstance || editorInstance.__te2MarkerNavBound || !monacoObj || !monacoObj.KeyMod || !monacoObj.KeyCode) return;
    editorInstance.__te2MarkerNavBound = true;
    editorInstance.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyCode.F8, function () { onJump(1); });
    editorInstance.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyMod.Shift | monacoObj.KeyCode.F8, function () { onJump(-1); });
  } catch (_) {}
}

export function jumpToMarker(monacoObj, editorInstance, modelInstance, dir) {
  try {
    if (!editorInstance || !modelInstance || !monacoObj) return;
    var markers = monacoObj.editor.getModelMarkers({ resource: modelInstance.uri }) || [];
    if (!markers.length) return;
    markers.sort(function (a, b) {
      if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
      return a.startColumn - b.startColumn;
    });
    var pos = editorInstance.getPosition ? editorInstance.getPosition() : null;
    var line = pos && pos.lineNumber ? pos.lineNumber : 1;
    var col = pos && pos.column ? pos.column : 1;
    var idx = -1;
    if (dir > 0) {
      for (var i = 0; i < markers.length; i++) {
        var m = markers[i];
        if (m.startLineNumber > line || (m.startLineNumber === line && m.startColumn > col)) { idx = i; break; }
      }
      if (idx === -1) idx = 0;
    } else {
      for (var j = markers.length - 1; j >= 0; j--) {
        var m2 = markers[j];
        if (m2.startLineNumber < line || (m2.startLineNumber === line && m2.startColumn < col)) { idx = j; break; }
      }
      if (idx === -1) idx = markers.length - 1;
    }
    var hit = markers[idx];
    if (!hit) return;
    var targetLine = Math.max(1, Number(hit.startLineNumber || 1));
    var targetCol = Math.max(1, Number(hit.startColumn || 1));
    try { editorInstance.setPosition({ lineNumber: targetLine, column: targetCol }); } catch (_) {}
    try { editorInstance.revealLineInCenter(targetLine, 0); } catch (_) {}
    try { editorInstance.focus(); } catch (_) {}
  } catch (_) {}
}
