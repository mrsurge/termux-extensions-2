export function formatHunkHeader(hunk) {
  const newEnd = hunk.newStart + hunk.newLines - 1;
  if (hunk.newLines === 1) {
    return `Line ${hunk.newStart}`;
  }
  return `Lines ${hunk.newStart}–${newEnd}`;
}

export function truncateText(text, limit = 40) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

export function formatDiffBaseLabel(info, withPrefix = true) {
  if (!info || info.mode === 'none') {
    return withPrefix ? 'Status: (no git)' : 'No Git';
  }
  const commit = info.commit || null;
  const short = (commit && commit.short) || info.ref || 'HEAD';
  const summary = commit && commit.subject ? truncateText(commit.subject, 36) : '';
  const prefix = withPrefix ? 'Status: ' : '';
  return summary ? `${prefix}${short} · ${summary}` : `${prefix}${short}`;
}

export function firstDiffLine(change) {
  const hunks = change?.hunks || [];
  for (const h of hunks) {
    if (typeof h?.newStart === 'number' && h.newStart > 0) return h.newStart;
    if (typeof h?.oldStart === 'number' && h.oldStart > 0) return h.oldStart;
  }
  return 1;
}
