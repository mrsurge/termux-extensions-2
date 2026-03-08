export function createFileModel(monacoObj, fileUriFactory, content, lang, absPath, onAfterCreate) {
  var m;
  try {
    var uri = fileUriFactory(absPath);
    if (uri) m = monacoObj.editor.createModel(content || '', lang || 'plaintext', uri);
  } catch (_) {}
  if (!m) m = monacoObj.editor.createModel(content || '', lang || 'plaintext');
  try { onAfterCreate(); } catch (_) {}
  return m;
}
