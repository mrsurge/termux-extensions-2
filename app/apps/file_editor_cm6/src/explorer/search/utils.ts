export interface ExplorerDiffBaseCommitInfo {
  hash?: string;
  short?: string;
  subject?: string;
}

export interface ExplorerDiffBaseInfo {
  mode?: string;
  commit?: ExplorerDiffBaseCommitInfo | null;
  ref?: string | null;
}

export interface ExplorerDiffHunkLike {
  newStart?: number;
  newLines?: number;
  oldStart?: number;
}

export interface ExplorerDiffChangeLike {
  hunks?: ReadonlyArray<ExplorerDiffHunkLike>;
}

export function formatHunkHeader(hunk: ExplorerDiffHunkLike): string {
  const newStart = typeof hunk.newStart === 'number' ? hunk.newStart : 1;
  const newLines = typeof hunk.newLines === 'number' ? hunk.newLines : 0;
  const newEnd = newStart + newLines - 1;
  if (newLines <= 1) {
    return `Line ${newStart}`;
  }
  return `Lines ${newStart}\u2013${newEnd}`;
}

export function truncateText(text: string | null | undefined, limit = 40): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}\u2026`;
}

export function formatDiffBaseLabel(
  info: ExplorerDiffBaseInfo | null | undefined,
  withPrefix = true,
): string {
  if (!info || info.mode === 'none') {
    return withPrefix ? 'Status: (no git)' : 'No Git';
  }
  const commit = info.commit ?? null;
  const short = commit?.short || info.ref || 'HEAD';
  const summary = commit?.subject ? truncateText(commit.subject, 36) : '';
  const prefix = withPrefix ? 'Status: ' : '';
  return summary ? `${prefix}${short} · ${summary}` : `${prefix}${short}`;
}

export function firstDiffLine(change: ExplorerDiffChangeLike | null | undefined): number {
  const hunks = Array.isArray(change?.hunks) ? change.hunks : [];
  for (const hunk of hunks) {
    if (typeof hunk?.newStart === 'number' && hunk.newStart > 0) {
      return hunk.newStart;
    }
    if (typeof hunk?.oldStart === 'number' && hunk.oldStart > 0) {
      return hunk.oldStart;
    }
  }
  return 1;
}
