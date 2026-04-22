interface MonacoModelLike {
  getValue?(): string;
}

export function shouldDropMirrorForSha(
  payloadSha: unknown,
  lastContentSha256: string | null | undefined,
  model: unknown,
  payloadContent: unknown,
): boolean {
  if (payloadSha && lastContentSha256 && String(payloadSha) === String(lastContentSha256)) return true;
  const typedModel = model != null && typeof model === 'object' && !Array.isArray(model)
    ? model as MonacoModelLike
    : null;
  if (typedModel && typeof typedModel.getValue === 'function' && typedModel.getValue() === payloadContent) return true;
  return false;
}
