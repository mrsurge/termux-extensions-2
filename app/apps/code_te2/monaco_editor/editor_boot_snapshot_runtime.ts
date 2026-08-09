interface MonacoModelLike {
  getLanguageId?(): string;
}

interface EditorBootSnapshotRuntimeDeps {
  getBootSnapshot(): unknown;
  getCachedPrefs(): unknown;
  setCachedPrefs(value: unknown): void;
  getCurrentPath(): string | null;
  setCurrentPath(value: string | null): void;
  getBaseSha256(): string | null;
  setBaseSha256(value: string | null): void;
  getLastContentSha256(): string | null;
  setLastContentSha256(value: string | null): void;
  getModel(): MonacoModelLike | null;
  setModel(value: MonacoModelLike | null): void;
  createFileModel(content: string, lang: string, absPath: string): MonacoModelLike;
  applyLanguageToModel(model: MonacoModelLike, languageId: string, filePath: string): void;
  languageFromPath(path: string): string;
}

interface BootSnapshotLike {
  host_state?: Record<string, unknown>;
  editor_ssot?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readBootFile(snapshot: BootSnapshotLike | null): Record<string, unknown> | null {
  return asRecord(snapshot && snapshot.editor_ssot ? snapshot.editor_ssot.file : null);
}

export function applyBootSnapshotToEditor(
  deps: EditorBootSnapshotRuntimeDeps,
): void {
  const snapshot = asRecord(deps.getBootSnapshot()) as BootSnapshotLike | null;
  if (!snapshot) return;

  const editorSsot = asRecord(snapshot.editor_ssot);
  const hostState = asRecord(snapshot.host_state);
  const snapshotPrefs = asRecord(editorSsot && editorSsot.preferences)
    || asRecord(hostState && hostState.preferences);
  if (snapshotPrefs && !deps.getCachedPrefs()) {
    deps.setCachedPrefs({ preferences: snapshotPrefs });
  }

  const snapshotFile = readBootFile(snapshot);
  const nextPathRaw = (
    (snapshotFile && typeof snapshotFile.path === 'string' ? snapshotFile.path : null)
    || (editorSsot && typeof editorSsot.currentPath === 'string' ? editorSsot.currentPath : null)
    || (hostState && typeof hostState.currentPath === 'string' ? hostState.currentPath : null)
    || (hostState && typeof hostState.lastFile === 'string' ? hostState.lastFile : null)
  );
  const nextPath = typeof nextPathRaw === 'string' && nextPathRaw.trim() ? nextPathRaw : null;
  if (nextPath && nextPath !== deps.getCurrentPath()) {
    deps.setCurrentPath(nextPath);
  }

  if (!snapshotFile || !nextPath || deps.getModel()) {
    return;
  }

  const content = typeof snapshotFile.content === 'string' ? snapshotFile.content : '';
  const languageId = deps.languageFromPath(nextPath);
  const nextModel = deps.createFileModel(content, languageId, nextPath);
  deps.setModel(nextModel);
  deps.applyLanguageToModel(nextModel, languageId, nextPath);

  const baseSha256 = typeof snapshotFile.base_sha256 === 'string' ? snapshotFile.base_sha256 : deps.getBaseSha256();
  const contentSha256 = typeof snapshotFile.content_sha256 === 'string' ? snapshotFile.content_sha256 : deps.getLastContentSha256();
  deps.setBaseSha256(baseSha256 || null);
  deps.setLastContentSha256(contentSha256 || null);
}
