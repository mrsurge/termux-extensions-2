export function splitBreadcrumbPathParts(path: string | null | undefined): string[] {
  return String(path || '').split('/').filter(Boolean);
}
