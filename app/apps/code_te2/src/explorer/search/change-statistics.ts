interface ChangeStatistics { added: number; deleted: number }
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Git summaries describe the full file. Display hunks may be omitted or filtered;
// a preview warning must never override independently available statistics.
export function changeStatistics(value: unknown): ChangeStatistics | null {
  const change = record(value);
  if (!change) return null;
  const summary = record(change.summary);
  if (summary && count(summary.added) && count(summary.deleted)) {
    return { added: summary.added, deleted: summary.deleted };
  }
  if (change.error || summary?.contentSuppressed || !Array.isArray(change.hunks)) return null;
  let added = 0, deleted = 0;
  for (const hunk of change.hunks) {
    const lines = record(hunk)?.lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const type = record(line)?.type;
      if (type === 'add' || type === 'add-draft') added++;
      if (type === 'del' || type === 'del-draft') deleted++;
    }
  }
  return { added, deleted };
}

export function isUntrackedChange(value: unknown): boolean {
  const change = record(value);
  return change?.status === '?' || change?.statusCode === '??' || change?.statusText === 'Untracked';
}

// Sum the retained projection, not rendered DOM. Untracked files are separate
// because ordinary git diff statistics do not include them.
export function totalChangeStatistics(changes: readonly unknown[]) {
  let added = 0, deleted = 0, untrackedAdded = 0, untrackedFiles = 0, unknown = 0;
  for (const change of changes) {
    const stats = changeStatistics(change);
    const untracked = isUntrackedChange(change);
    if (untracked) untrackedFiles++;
    if (!stats) { unknown++; continue; }
    if (untracked) untrackedAdded += stats.added;
    else { added += stats.added; deleted += stats.deleted; }
  }
  return { added, deleted, untrackedAdded, untrackedFiles, unknown };
}
