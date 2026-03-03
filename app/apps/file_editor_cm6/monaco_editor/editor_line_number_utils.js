export function applyLineNumberSizingForEditors(editor, diffEditor, model, gitHeadModel, gitDiskModel) {
  try {
    if (!editor || !window.monaco) return;
    var maxLines = 1;
    try { if (model && model.getLineCount) maxLines = Math.max(maxLines, model.getLineCount()); } catch (_) {}
    try { if (gitHeadModel && gitHeadModel.getLineCount) maxLines = Math.max(maxLines, gitHeadModel.getLineCount()); } catch (_) {}
    try { if (gitDiskModel && gitDiskModel.getLineCount) maxLines = Math.max(maxLines, gitDiskModel.getLineCount()); } catch (_) {}
    var digits = String(maxLines || 1).length;
    var minChars = Math.max(4, digits + 1);
    if (diffEditor && diffEditor.getOriginalEditor && diffEditor.getModifiedEditor) {
      var diffMin = Math.max(4, digits + 1);
      try { diffEditor.getOriginalEditor().updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
      try { diffEditor.getModifiedEditor().updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
      try { editor.updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
    } else {
      try { editor.updateOptions({ lineNumbersMinChars: minChars }); } catch (_) {}
    }
  } catch (_) {}
}
