export function splitBreadcrumbPathParts(path) {
  return String(path || '').split('/').filter(Boolean);
}
