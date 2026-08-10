export function applyLineNumberSizingForEditors(
  editor: MonacoRuntimeEditorLike | null | unknown,
  diffEditor: MonacoRuntimeDiffEditorLike | null | unknown,
  model: MonacoRuntimeModelLike | null | unknown,
  gitHeadModel: MonacoRuntimeModelLike | null | unknown,
  gitDiskModel: MonacoRuntimeModelLike | null | unknown,
): void {
  try {
    const editorInstance = editor as MonacoRuntimeEditorLike | null;
    const diffEditorInstance = diffEditor as MonacoRuntimeDiffEditorLike | null;
    const modelInstance = model as MonacoRuntimeModelLike | null;
    const gitHeadModelInstance = gitHeadModel as MonacoRuntimeModelLike | null;
    const gitDiskModelInstance = gitDiskModel as MonacoRuntimeModelLike | null;
    if (!editorInstance || !window.monaco) return;
    let maxLines = 1;
    try { if (modelInstance && modelInstance.getLineCount) maxLines = Math.max(maxLines, modelInstance.getLineCount()); } catch (_) {}
    try { if (gitHeadModelInstance && gitHeadModelInstance.getLineCount) maxLines = Math.max(maxLines, gitHeadModelInstance.getLineCount()); } catch (_) {}
    try { if (gitDiskModelInstance && gitDiskModelInstance.getLineCount) maxLines = Math.max(maxLines, gitDiskModelInstance.getLineCount()); } catch (_) {}
    const digits = String(maxLines || 1).length;
    const minChars = Math.max(4, digits + 1);
    if (diffEditorInstance && diffEditorInstance.getOriginalEditor && diffEditorInstance.getModifiedEditor) {
      try { diffEditorInstance.getOriginalEditor()?.updateOptions?.({ lineNumbersMinChars: minChars }); } catch (_) {}
      try { diffEditorInstance.getModifiedEditor()?.updateOptions?.({ lineNumbersMinChars: minChars }); } catch (_) {}
      try { editorInstance.updateOptions?.({ lineNumbersMinChars: minChars }); } catch (_) {}
    } else {
      try { editorInstance.updateOptions?.({ lineNumbersMinChars: minChars }); } catch (_) {}
    }
  } catch (_) {}
}
