export function shouldRecreateOpenModel(monacoRef, monacoFileUriFn, model, absPath) {
  try {
    var want = monacoFileUriFn(monacoRef, absPath);
    return !!(want && model && model.uri && String(model.uri.toString()) !== String(want.toString()));
  } catch (_) {
    return false;
  }
}

export function applyOpenModelTextSafely(model, editor, content, setApplyingRemoteFn) {
  try {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(true);
    model.setValue(content || '');
  } catch (_) {
    editor.setValue(content || '');
  } finally {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(false);
  }
}
