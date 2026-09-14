/** Strict boundary for the host-owned immutable historical content projection. */
export type HistoricalBlobSide =
  | { state: 'absent'; path: null; id: null; text: null }
  | { state: 'text'; path: string; id: string; text: string }
  | { state: 'binary' | 'tooLarge' | 'invalidUtf8' | 'unsupported'; path: string; id: string; text: null };

export interface SecondaryHistoryContent {
  kind: 'historicalDiff';
  revision: number;
  projectPath: string;
  projectGeneration: number;
  snapshotId: string;
  commitId: string;
  parentId: string | null;
  fileIndex: number;
  original: HistoricalBlobSide;
  modified: HistoricalBlobSide;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid historical content object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error('Invalid historical identity');
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid historical revision');
  }
  return value;
}

function hash(value: unknown, length: number): string {
  const result = text(value);
  if (result.length !== length || !/^[0-9a-f]+$/.test(result)) {
    throw new Error('Invalid historical hash');
  }
  return result;
}

function side(value: unknown): HistoricalBlobSide {
  const data = record(value);
  if (data.state === 'absent') {
    if (data.path !== null || data.id !== null || data.text !== null) {
      throw new Error('Absent historical side contains data');
    }
    return { state: 'absent', path: null, id: null, text: null };
  }
  const path = text(data.path);
  const id = hash(data.id, 40);
  if (data.state === 'text') {
    if (typeof data.text !== 'string' || new TextEncoder().encode(data.text).byteLength > 375 * 1024) {
      throw new Error('Invalid or oversized historical text');
    }
    return { state: 'text', path, id, text: data.text };
  }
  if (data.text !== null || !['binary', 'tooLarge', 'invalidUtf8', 'unsupported'].includes(String(data.state))) {
    throw new Error('Invalid historical side state');
  }
  return { state: data.state as 'binary' | 'tooLarge' | 'invalidUtf8' | 'unsupported', path, id, text: null };
}

export function parseSecondaryHistoryContent(value: unknown): SecondaryHistoryContent {
  const data = record(value);
  if (data.kind !== 'historicalDiff') throw new Error('Unknown secondary content kind');
  const original = side(data.original);
  const modified = side(data.modified);
  if (original.state === 'absent' && modified.state === 'absent') {
    throw new Error('Historical comparison has no file');
  }
  const parentId = data.parentId === null ? null : hash(data.parentId, 40);
  if (parentId === null && original.state !== 'absent') {
    throw new Error('Root commit has an original side');
  }
  return {
    kind: 'historicalDiff', revision: integer(data.revision),
    projectPath: text(data.projectPath), projectGeneration: integer(data.projectGeneration),
    snapshotId: hash(data.snapshotId, 64), commitId: hash(data.commitId, 40),
    parentId, fileIndex: integer(data.fileIndex), original, modified,
  };
}
