interface MonacoPositionLike {
  [key: string]: unknown;
}

interface MonacoDisposableLike {
  dispose?(): void;
}

interface MonacoTextModelLike extends MonacoDisposableLike {
  getValue?(): string;
  setValue?(value: string): void;
  getLanguageId?(): string;
}

interface MonacoEditorLike {
  getScrollTop?(): number;
  getPosition?(): MonacoPositionLike | null;
  setScrollTop?(value: number): void;
  setPosition?(value: MonacoPositionLike): void;
  saveViewState?(): unknown;
  restoreViewState?(value: unknown): void;
}

interface MonacoDiffEditorLike {
  getModifiedEditor?(): MonacoEditorLike | null;
  getOriginalEditor?(): MonacoEditorLike | null;
  getModel?(): Record<string, unknown> | null;
  setModel?(value: Record<string, unknown> | null): void;
  getLineChanges?(): unknown;
  getDiffComputationResult?(): unknown;
  onDidUpdateDiff?(listener: () => void): void;
  __te2DraftZoneOrderBound?: boolean;
  __te2_onDidUpdateDiffBound?: boolean;
}

interface MonacoEditorNamespaceLike {
  createModel(value: string, language: string): MonacoTextModelLike;
  setModelLanguage(model: MonacoTextModelLike, language: string): void;
}

interface MonacoRefLike {
  editor: MonacoEditorNamespaceLike;
}

interface GitBaselinePayloadLike {
  path?: unknown;
  tracked?: unknown;
  head_content?: unknown;
  disk_content?: unknown;
  head_sha256?: unknown;
  disk_sha256?: unknown;
}

interface EditorGitBaselineRuntimeDeps {
  getMonaco(): MonacoRefLike | null;
  getCurrentPath(): string | null;
  getEditor(): MonacoEditorLike | null;
  getDiffEditor(): MonacoDiffEditorLike | null;
  getModel(): MonacoTextModelLike | null;
  getGitHeadModel(): MonacoTextModelLike | null;
  setGitHeadModel(model: MonacoTextModelLike | null): void;
  getGitDiskModel(): MonacoTextModelLike | null;
  setGitDiskModel(model: MonacoTextModelLike | null): void;
  getLastLocalEditAt(): number;
  getBaselineApplyIdleMs(): number;
  setPendingGitBaselinePayload(payload: GitBaselinePayloadLike | null): void;
  schedulePendingGitBaselineApply(): void;
  setLastGitBaselines(payload: GitBaselinePayloadLike | null): void;
  getShowInlineDiffs(): boolean;
  getShowDraftDiffs(): boolean;
  getShowDraftInsertions(): boolean;
  disposeGitBaselines(): void;
  ensurePlainEditorWithPrefs(): MonacoEditorLike | null;
  ensureDiffEditorWithPrefs(): MonacoDiffEditorLike | null;
  languageFromPath(path: string): string;
  applyLineNumberSizing(): void;
  layoutEditors(): void;
  installDraftZoneOrderingHook(): void;
  reapplyDraftZones(): void;
  requestDraftDiff(reason: string): void;
  ensureTouchSelection(reason: string): void;
  setDebugGit(value: string): void;
  setDebugFlags(value: string): void;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function restoreViewState(
  editor: MonacoEditorLike | null,
  scrollTop: number | null,
  position: MonacoPositionLike | null,
): void {
  try {
    if (editor && scrollTop != null && typeof editor.setScrollTop === 'function') {
      editor.setScrollTop(scrollTop);
    }
    if (editor && position && typeof editor.setPosition === 'function') {
      editor.setPosition(position);
    }
  } catch (_) {}
}

function updateOrCreateModel(
  monacoRef: MonacoRefLike,
  model: MonacoTextModelLike | null,
  content: string,
  language: string,
): MonacoTextModelLike {
  if (!model) return monacoRef.editor.createModel(content, language);
  try {
    const current = model.getValue ? String(model.getValue()) : '';
    if (current !== String(content) && typeof model.setValue === 'function') {
      model.setValue(content);
    }
  } catch (_) {
    try { if (typeof model.setValue === 'function') model.setValue(content); } catch (_) {}
  }
  try { monacoRef.editor.setModelLanguage(model, language); } catch (_) {}
  return model;
}

function scheduleLineChangeDebug(diffEditor: MonacoDiffEditorLike | null, deps: EditorGitBaselineRuntimeDeps): void {
  if (!diffEditor) return;

  try {
    if (!diffEditor.__te2_onDidUpdateDiffBound && typeof diffEditor.onDidUpdateDiff === 'function') {
      diffEditor.__te2_onDidUpdateDiffBound = true;
      diffEditor.onDidUpdateDiff(() => {
        try {
          let lineChanges: unknown = null;
          try { lineChanges = typeof diffEditor.getLineChanges === 'function' ? diffEditor.getLineChanges() : null; } catch (_) { lineChanges = null; }
          const count = Array.isArray(lineChanges) ? lineChanges.length : (lineChanges === null ? 'null' : '0');
          deps.setDebugGit('git=on lc=' + String(count));
        } catch (_) {}
      });
    }
  } catch (_) {}

  try {
    const update = (tag: string) => {
      try {
        let lineChanges: unknown = null;
        try { lineChanges = typeof diffEditor.getLineChanges === 'function' ? diffEditor.getLineChanges() : null; } catch (_) { lineChanges = null; }
        const count = Array.isArray(lineChanges) ? lineChanges.length : (lineChanges === null ? 'null' : '0');
        deps.setDebugGit('git=on lc=' + String(count) + (tag ? ' ' + tag : ''));
        if (tag === 't800' && (!Array.isArray(lineChanges) || lineChanges.length === 0)) {
          try {
            let result: unknown = null;
            let diffModel: Record<string, unknown> | null = null;
            try { result = typeof diffEditor.getDiffComputationResult === 'function' ? diffEditor.getDiffComputationResult() : null; } catch (_) { result = null; }
            try { diffModel = typeof diffEditor.getModel === 'function' ? diffEditor.getModel() : null; } catch (_) { diffModel = null; }
            console.warn('[Monaco][GitDiff] lc still empty after t800', {
              path: deps.getCurrentPath(),
              diffResult: result,
              modelKeys: diffModel ? Object.keys(diffModel) : null,
            });
          } catch (_) {}
        }
      } catch (_) {}
    };

    update('t0');
    setTimeout(() => { update('t200'); }, 200);
    setTimeout(() => { update('t800'); }, 800);
  } catch (_) {}
}

export function applyGitBaselines(
  deps: EditorGitBaselineRuntimeDeps,
  payload: GitBaselinePayloadLike | null | undefined,
): void {
  try {
    const currentPath = deps.getCurrentPath();
    const payloadPath = asString(payload && payload.path);
    if (!payloadPath || !currentPath) {
      console.log('[GitBaselines] skip: no path/currentPath');
      return;
    }
    if (String(payloadPath) !== String(currentPath)) {
      console.log('[GitBaselines] skip: path mismatch', payloadPath, currentPath);
      return;
    }

    const monacoRef = deps.getMonaco();
    if (!monacoRef) {
      console.log('[GitBaselines] skip: no monaco');
      return;
    }

    const baselineIdleMs = deps.getBaselineApplyIdleMs();
    if (baselineIdleMs > 0 && deps.getDiffEditor() && deps.getLastLocalEditAt() > 0) {
      const ageMs = Date.now() - deps.getLastLocalEditAt();
      if (ageMs < baselineIdleMs) {
        console.log('[GitBaselines] deferred by idle guard, ageMs=' + ageMs + ' threshold=' + baselineIdleMs);
        deps.setPendingGitBaselinePayload(payload || null);
        deps.schedulePendingGitBaselineApply();
        deps.setDebugGit('git=defer ' + String(baselineIdleMs - ageMs) + 'ms');
        return;
      }
    }

    deps.setLastGitBaselines(payload || null);

    let savedScrollTop: number | null = null;
    let savedPosition: MonacoPositionLike | null = null;
    try {
      const currentDiffEditor = deps.getDiffEditor();
      const activeEditor = currentDiffEditor && typeof currentDiffEditor.getModifiedEditor === 'function'
        ? currentDiffEditor.getModifiedEditor()
        : deps.getEditor();
      if (activeEditor && typeof activeEditor.getScrollTop === 'function') {
        savedScrollTop = activeEditor.getScrollTop();
      }
      if (activeEditor && typeof activeEditor.getPosition === 'function') {
        savedPosition = activeEditor.getPosition() || null;
      }
    } catch (_) {}

    const showCommitDiff = deps.getShowInlineDiffs();
    const showDiskDraftDiff = deps.getShowDraftDiffs();
    if (!showCommitDiff && !showDiskDraftDiff) {
      deps.disposeGitBaselines();
      if (deps.getDiffEditor()) deps.ensurePlainEditorWithPrefs();
      return;
    }

    const tracked = payload && payload.tracked === true;
    let head = asString(payload && payload.head_content);
    const disk = asString(payload && payload.disk_content) || '';
    const headSha = asString(payload && payload.head_sha256);
    const diskSha = asString(payload && payload.disk_sha256);

    const hasGitDiff = !!(tracked && head != null && headSha && diskSha && headSha !== diskSha);
    const liveModel = deps.getModel();
    if (!hasGitDiff) {
      head = liveModel && typeof liveModel.getValue === 'function' ? liveModel.getValue() : '';
    }

    const language = deps.languageFromPath(currentPath);
    const nextHeadModel = updateOrCreateModel(monacoRef, deps.getGitHeadModel(), head || '', language);
    deps.setGitHeadModel(nextHeadModel);
    const nextDiskModel = updateOrCreateModel(monacoRef, deps.getGitDiskModel(), disk, language);
    deps.setGitDiskModel(nextDiskModel);
    const originalModel = showCommitDiff ? nextHeadModel : nextDiskModel;
    const diffKind = showCommitDiff ? 'commit' : 'disk-draft';

    let diffEditor = deps.ensureDiffEditorWithPrefs();
    let needsSetModel = true;
    try {
      if (diffEditor && typeof diffEditor.getModel === 'function') {
        const diffModel = diffEditor.getModel();
        if (diffModel && diffModel.original === originalModel && diffModel.modified === liveModel) {
          needsSetModel = false;
          console.log('[GitBaselines] models match: needsSetModel=false kind=' + diffKind + ' hasGitDiff=' + hasGitDiff);
        } else {
          console.log('[GitBaselines] models differ: needsSetModel=true kind=' + diffKind);
        }
      }
    } catch (_) {}

    if (needsSetModel) {
      try {
        let modifiedViewState: unknown = null;
        try {
          const modifiedEditor = diffEditor && typeof diffEditor.getModifiedEditor === 'function'
            ? diffEditor.getModifiedEditor()
            : null;
          if (modifiedEditor && typeof modifiedEditor.saveViewState === 'function') {
            modifiedViewState = modifiedEditor.saveViewState();
          }
        } catch (_) {}

        const diffModel: Record<string, unknown> = {
          original: originalModel,
          modified: liveModel,
        };
        if (diffEditor && typeof diffEditor.setModel === 'function') {
          diffEditor.setModel(diffModel);
        }

        try {
          const modifiedEditor = diffEditor && typeof diffEditor.getModifiedEditor === 'function'
            ? diffEditor.getModifiedEditor()
            : null;
          if (modifiedEditor && modifiedViewState && typeof modifiedEditor.restoreViewState === 'function') {
            modifiedEditor.restoreViewState(modifiedViewState);
          }
        } catch (_) {}

        deps.setDebugFlags('flags=stock-diff:' + diffKind);
      } catch (error) {
        console.warn('[Monaco] diffEditor.setModel failed', error);
        deps.disposeGitBaselines();
        deps.ensurePlainEditorWithPrefs();
        return;
      }
    }

    deps.applyLineNumberSizing();
    deps.layoutEditors();

    try { deps.installDraftZoneOrderingHook(); } catch (error) { console.warn('[DraftDiff] Failed to install zone ordering hook', error); }
    try {
      diffEditor = deps.getDiffEditor();
      if (diffEditor && typeof diffEditor.onDidUpdateDiff === 'function' && !diffEditor.__te2DraftZoneOrderBound) {
        diffEditor.__te2DraftZoneOrderBound = true;
        diffEditor.onDidUpdateDiff(() => {
          try { if (deps.getShowDraftDiffs()) setTimeout(() => { deps.reapplyDraftZones(); }, 0); } catch (_) {}
        });
      }
    } catch (_) {}
    try { if (deps.getShowDraftDiffs()) setTimeout(() => { deps.reapplyDraftZones(); }, 0); } catch (_) {}
    try { if (deps.getShowDraftInsertions()) setTimeout(() => { deps.requestDraftDiff('baseline'); }, 0); } catch (_) {}

    scheduleLineChangeDebug(deps.getDiffEditor(), deps);

    deps.ensureTouchSelection('gitdiff');
    setTimeout(() => { deps.ensureTouchSelection('gitdiff-tick'); }, 0);

    const currentDiffEditor = deps.getDiffEditor();
    const restoreEditor = currentDiffEditor && typeof currentDiffEditor.getModifiedEditor === 'function'
      ? currentDiffEditor.getModifiedEditor()
      : deps.getEditor();
    if (savedScrollTop != null) {
      restoreViewState(restoreEditor, savedScrollTop, savedPosition);
      setTimeout(() => { restoreViewState(restoreEditor, savedScrollTop, savedPosition); }, 50);
      setTimeout(() => { restoreViewState(restoreEditor, savedScrollTop, savedPosition); }, 300);
    }
  } catch (error) {
    console.warn('[Monaco] applyGitBaselines failed', error);
  }
}
