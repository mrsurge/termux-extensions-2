export function isMirrorPayloadValid(payload) {
  return !!(payload && payload.path && typeof payload.content === 'string');
}
