function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getParentRel(rel: string): string {
  if (!rel || rel === '.') return '.';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
}

export function normalizeWatcherRel(rel: unknown): string {
  if (typeof rel !== 'string') return '';
  return rel.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

export function collectWatcherRels(payload: unknown): Set<string> {
  const out = new Set<string>();
  const src = isRecord(payload) ? payload : {};
  for (const key of ['created', 'changed', 'deleted']) {
    const items = Array.isArray(src[key]) ? src[key] : [];
    for (const rel of items) {
      const normalized = normalizeWatcherRel(rel);
      if (normalized) {
        out.add(normalized);
      }
    }
  }
  return out;
}

export function isWatcherRelInOpenDir(rel: string, openDir: string): boolean {
  if (!openDir) return false;
  if (rel === openDir) return true;
  return rel.startsWith(`${openDir}/`);
}
