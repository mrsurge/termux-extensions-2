export function shouldDropMirrorForPath(payloadPath, currentPath) {
  return !!(currentPath && String(payloadPath) !== String(currentPath));
}
