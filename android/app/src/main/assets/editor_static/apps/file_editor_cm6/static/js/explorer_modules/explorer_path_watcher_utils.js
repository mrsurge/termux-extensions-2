export function getParentRel(rel) {
  if (!rel || rel === '.') return '.';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
}

export function normalizeWatcherRel(rel) {
  if (typeof rel !== 'string') return '';
  const normalized = rel.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  return normalized;
}

export function collectWatcherRels(payload) {
  const out = new Set();
  const src = payload && typeof payload === 'object' ? payload : {};
  ['created', 'changed', 'deleted'].forEach((key) => {
    const items = Array.isArray(src[key]) ? src[key] : [];
    items.forEach((rel) => {
      const norm = normalizeWatcherRel(rel);
      if (!norm) return;
      out.add(norm);
    });
  });
  return out;
}

export function isWatcherRelInOpenDir(rel, openDir) {
  if (!openDir) return false;
  if (rel === openDir) return true;
  return rel.startsWith(openDir + '/');
}
