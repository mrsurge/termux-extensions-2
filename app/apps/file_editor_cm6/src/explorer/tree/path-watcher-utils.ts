export function getParentRel(rel: string): string {
  if (!rel || rel === '.') return '.';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
}
