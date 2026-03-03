export function applyMirrorContentToModel(model, content, setApplyingRemoteFn) {
  if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(true);
  try {
    var fullRange = model.getFullModelRange();
    model.applyEdits([{ range: fullRange, text: content }]);
  } finally {
    if (typeof setApplyingRemoteFn === 'function') setApplyingRemoteFn(false);
  }
}
