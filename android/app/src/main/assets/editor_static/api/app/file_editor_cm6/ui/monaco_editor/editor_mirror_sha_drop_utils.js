export function shouldDropMirrorForSha(payloadSha, lastContentSha256, model, payloadContent) {
  if (payloadSha && lastContentSha256 && String(payloadSha) === String(lastContentSha256)) return true;
  if (model && model.getValue && model.getValue() === payloadContent) return true;
  return false;
}
