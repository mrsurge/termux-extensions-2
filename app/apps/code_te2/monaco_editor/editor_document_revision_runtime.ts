const MAX_DOCUMENT_REVISIONS = 256;

const documentRevisions = new Map<string, number>();

function normalizedPath(path: unknown): string {
  return typeof path === 'string' ? path.trim() : '';
}

export function parseDocumentRevision(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export function acceptDocumentProjection(path: unknown, revision: unknown): boolean {
  const key = normalizedPath(path);
  const parsed = parseDocumentRevision(revision);
  if (!key || parsed === null) return false;

  const previous = documentRevisions.get(key);
  if (previous !== undefined && parsed < previous) return false;

  documentRevisions.delete(key);
  documentRevisions.set(key, parsed);
  while (documentRevisions.size > MAX_DOCUMENT_REVISIONS) {
    const oldest = documentRevisions.keys().next().value;
    if (typeof oldest !== 'string') break;
    documentRevisions.delete(oldest);
  }
  return true;
}

export function isCurrentDocumentProjection(path: unknown, revision: unknown): boolean {
  const key = normalizedPath(path);
  const parsed = parseDocumentRevision(revision);
  return !!key && parsed !== null && documentRevisions.get(key) === parsed;
}

export function resetDocumentRevisionRuntime(): void {
  documentRevisions.clear();
}

export function currentDocumentRevision(path: unknown): number | null {
  const key = normalizedPath(path);
  return key && documentRevisions.has(key) ? documentRevisions.get(key) ?? null : null;
}
