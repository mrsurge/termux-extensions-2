interface MonacoRangeCtorLike {
  new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): unknown;
}

interface MonacoLike {
  Range: MonacoRangeCtorLike;
}

interface MonacoTextModelLike {
  getLineCount?(): number;
  getLineLength?(lineNumber: number): number;
  getLineContent?(lineNumber: number): string;
}

interface MonacoDecorationsCollectionLike {
  set?(decorations: unknown[]): void;
}

interface MonacoViewZoneAccessorLike {
  addZone(zone: Record<string, unknown>): unknown;
}

interface MonacoCodeEditorLike {
  createDecorationsCollection?(): MonacoDecorationsCollectionLike;
  deltaDecorations?(oldDecorations: unknown[], newDecorations: unknown[]): unknown[];
  changeViewZones?(callback: (accessor: MonacoViewZoneAccessorLike) => void): void;
}

interface MonacoModifiedEditorLike {
  onDidChangeViewZones?(listener: () => void): void;
}

interface MonacoDiffEditorLike {
  getModifiedEditor?(): MonacoModifiedEditorLike | null;
  __te2DraftZoneOrderingHook?: boolean;
}

interface DraftZoneLike {
  after: number;
  text: string;
  lines: number;
}

interface DraftDiffLineLike {
  type?: unknown;
  text?: unknown;
}

interface DraftDiffHunkLike {
  oldStart?: unknown;
  newStart?: unknown;
  lines?: unknown;
}

interface DraftDiffPayloadLike {
  path?: unknown;
  hunks?: unknown;
  ms?: unknown;
  error?: unknown;
}

interface EditorDraftDiffRuntimeDeps {
  getCurrentPath(): string | null;
  getEditor(): MonacoCodeEditorLike | null;
  getDiffEditor(): MonacoDiffEditorLike | null;
  getModel(): MonacoTextModelLike | null;
  getMonaco(): MonacoLike | null;
  getDocument(): Document | null;
  getShowDraftDiffs(): boolean;
  getShowInlineDiffs(): boolean;
  clearDraftDiffDecorations(): void;
  clearDraftDiffZones(): void;
  setDebugDraft(value: string): void;
  applyEditorTypography(node: HTMLElement): void;
  getDraftDecoCollection(): MonacoDecorationsCollectionLike | null;
  setDraftDecoCollection(value: MonacoDecorationsCollectionLike | null): void;
  getDraftDecoIds(): unknown[];
  setDraftDecoIds(value: unknown[]): void;
  setDraftZoneIds(value: unknown[]): void;
  getLastDraftZones(): DraftZoneLike[] | null;
  setLastDraftZones(value: DraftZoneLike[] | null): void;
  getIsApplyingDraftZones(): boolean;
  setIsApplyingDraftZones(value: boolean): void;
  getIgnoreNextModifiedViewZonesEvent(): boolean;
  setIgnoreNextModifiedViewZonesEvent(value: boolean): void;
  getReapplyDraftZonesScheduled(): boolean;
  setReapplyDraftZonesScheduled(value: boolean): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function ensureDraftDecoCollection(
  deps: EditorDraftDiffRuntimeDeps,
): MonacoDecorationsCollectionLike | null {
  try {
    const existing = deps.getDraftDecoCollection();
    if (existing) return existing;

    const editor = deps.getEditor();
    if (!editor || typeof editor.createDecorationsCollection !== 'function') return null;

    const created = editor.createDecorationsCollection();
    deps.setDraftDecoCollection(created || null);
    return created || null;
  } catch (_) {
    return null;
  }
}

export function applyDraftZones(
  deps: EditorDraftDiffRuntimeDeps,
  zones: DraftZoneLike[] | null | undefined,
): void {
  deps.setLastDraftZones(zones && zones.length ? zones.slice() : null);
  deps.clearDraftDiffZones();

  const editor = deps.getEditor();
  const doc = deps.getDocument();
  if (!zones || !zones.length || !editor || !doc || typeof editor.changeViewZones !== 'function') return;

  deps.setIsApplyingDraftZones(true);
  const nextZoneIds: unknown[] = [];
  try {
    deps.setIgnoreNextModifiedViewZonesEvent(true);
    editor.changeViewZones((accessor) => {
      for (const zone of zones) {
        const node = doc.createElement('div');
        node.className = 'te2-draft-del-zone';
        node.textContent = zone.text || '';
        node.style.whiteSpace = 'pre';
        deps.applyEditorTypography(node);
        try {
          const id = accessor.addZone({
            afterLineNumber: zone.after,
            heightInLines: Math.max(1, zone.lines || 1),
            domNode: node,
          });
          nextZoneIds.push(id);
        } catch (_) {}
      }
    });
  } catch (_) {
    nextZoneIds.length = 0;
  }
  deps.setIsApplyingDraftZones(false);
  deps.setDraftZoneIds(nextZoneIds);
}

export function reapplyDraftZones(deps: EditorDraftDiffRuntimeDeps): void {
  try {
    if (deps.getIsApplyingDraftZones()) return;
    const zones = deps.getLastDraftZones();
    if (!zones || !zones.length) return;
    applyDraftZones(deps, zones);
  } catch (_) {}
}

export function installDraftZoneOrderingHook(deps: EditorDraftDiffRuntimeDeps): void {
  try {
    const diffEditor = deps.getDiffEditor();
    if (!diffEditor || diffEditor.__te2DraftZoneOrderingHook) return;
    const modifiedEditor = typeof diffEditor.getModifiedEditor === 'function'
      ? diffEditor.getModifiedEditor()
      : null;
    if (!modifiedEditor || typeof modifiedEditor.onDidChangeViewZones !== 'function') return;

    diffEditor.__te2DraftZoneOrderingHook = true;
    modifiedEditor.onDidChangeViewZones(() => {
      try {
        if (deps.getIgnoreNextModifiedViewZonesEvent()) {
          deps.setIgnoreNextModifiedViewZonesEvent(false);
          return;
        }
        if (deps.getReapplyDraftZonesScheduled()) return;
        if (!deps.getShowInlineDiffs()) return;
        if (!deps.getShowDraftDiffs()) return;
        const zones = deps.getLastDraftZones();
        if (!zones || !zones.length) return;

        deps.setReapplyDraftZonesScheduled(true);
        deps.schedule(() => {
          deps.setReapplyDraftZonesScheduled(false);
          try { reapplyDraftZones(deps); } catch (_) {}
        }, 0);
      } catch (_) {}
    });
  } catch (_) {}
}

export function applyDraftDiffDecorations(
  deps: EditorDraftDiffRuntimeDeps,
  payload: DraftDiffPayloadLike | null | undefined,
): void {
  try {
    const payloadPath = asString(payload && payload.path);
    const currentPath = deps.getCurrentPath();
    if (!payloadPath || !currentPath) return;
    if (payloadPath !== String(currentPath)) return;

    const editor = deps.getEditor();
    const monacoRef = deps.getMonaco();
    const model = deps.getModel();
    if (!editor || !monacoRef || !model) return;

    if (!deps.getShowDraftDiffs()) {
      deps.clearDraftDiffDecorations();
      return;
    }

    const hunks = asArray<DraftDiffHunkLike>(payload && payload.hunks);
    const ms = payload && payload.ms != null ? payload.ms : null;

    let debug = false;
    try { debug = !!(window as Window & { __debugDraftDiffs?: boolean }).__debugDraftDiffs; } catch (_) { debug = false; }

    let addLines = 0;
    let delLines = 0;
    const decorations: Array<Record<string, unknown>> = [];
    const zones: DraftZoneLike[] = [];

    let lineCount = 0;
    try { lineCount = model.getLineCount ? model.getLineCount() : 0; } catch (_) { lineCount = 0; }
    if (!lineCount || lineCount < 1) {
      deps.clearDraftDiffDecorations();
      deps.setDebugDraft('draft=empty');
      return;
    }

    const clampLine = (value: number): number => {
      if (value < 1) return 1;
      if (value > lineCount) return lineCount;
      return value;
    };

    let debugLines: string[] | null = null;
    if (debug) {
      debugLines = [];
      console.groupCollapsed(
        '[DraftDiff] apply ' + payloadPath +
        ' hunks=' + String(hunks.length) +
        ' lines=' + String(lineCount) +
        (ms != null ? (' ms=' + String(ms)) : ''),
      );
    }

    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
      const hunk = hunks[hunkIndex];
      const lines = asArray<DraftDiffLineLike>(hunk && hunk.lines);
      if (!lines.length) continue;

      let oldLine = asNumber(hunk && hunk.oldStart, 1);
      let newLine = asNumber(hunk && hunk.newStart, 1);
      if (debug && debugLines) {
        debugLines.push(
          'hunk#' + hunkIndex +
          ' oldStart=' + String(oldLine) +
          ' newStart=' + String(newLine) +
          ' lines=' + String(lines.length),
        );
      }

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const type = asString(line && line.type);
        if (type === 'context') {
          oldLine += 1;
          newLine += 1;
          continue;
        }

        if (type === 'add-draft') {
          addLines += 1;
          const lineNumber = clampLine(newLine);
          if (lineNumber < 1 || lineNumber > lineCount) {
            newLine += 1;
            continue;
          }

          let lineLength = 0;
          try { lineLength = model.getLineLength ? model.getLineLength(lineNumber) : 0; } catch (_) { lineLength = 0; }
          if (debug && debugLines) {
            let sample = '';
            try {
              sample = model.getLineContent ? model.getLineContent(lineNumber) : '';
              if (sample && sample.length > 140) sample = sample.slice(0, 140) + '...';
            } catch (_) {}
            debugLines.push(
              '  add hunk#' + hunkIndex +
              ' line#' + lineIndex +
              ' newLine=' + String(newLine) +
              ' -> lno=' + String(lineNumber) +
              ' len=' + String(lineLength) +
              ' sample=' + JSON.stringify(sample),
            );
          }

          decorations.push({
            range: new monacoRef.Range(lineNumber, 1, lineNumber, 1),
            options: { isWholeLine: true, className: 'te2-draft-add-line' },
          });
          newLine += 1;
          continue;
        }

        if (type === 'del-draft') {
          const anchor = clampLine(newLine);
          if (anchor < 1 || anchor > lineCount) {
            oldLine += 1;
            continue;
          }

          const delBlock: string[] = [];
          const delBlockPreview: string[] = [];
          const blockStartIndex = lineIndex;
          while (lineIndex < lines.length) {
            const nextLine = lines[lineIndex];
            const nextType = asString(nextLine && nextLine.type);
            if (nextType !== 'del-draft') break;
            delLines += 1;
            const text = asString(nextLine && nextLine.text);
            delBlock.push(text);
            if (debug && debugLines) {
              delBlockPreview.push(text.length > 140 ? text.slice(0, 140) + '...' : text);
            }
            oldLine += 1;
            lineIndex += 1;
          }
          lineIndex -= 1;

          if (debug && debugLines) {
            let sample = '';
            try {
              sample = model.getLineContent ? model.getLineContent(anchor) : '';
              if (sample && sample.length > 140) sample = sample.slice(0, 140) + '...';
            } catch (_) {}
            debugLines.push(
              '  del-block hunk#' + hunkIndex +
              ' lines#' + String(blockStartIndex) + '-' + String(lineIndex) +
              ' newLine=' + String(newLine) +
              ' anchor=' + String(anchor) +
              ' count=' + String(delBlock.length) +
              ' del=' + JSON.stringify(delBlockPreview.join('\\n')) +
              ' sample=' + JSON.stringify(sample),
            );
          }

          decorations.push({
            range: new monacoRef.Range(anchor, 1, anchor, 1),
            options: {
              isWholeLine: false,
              linesDecorationsClassName: 'te2-draft-del-marker',
            },
          });
          zones.push({
            after: anchor - 1,
            text: delBlock.join('\n'),
            lines: delBlock.length,
          });
          continue;
        }

        oldLine += 1;
        newLine += 1;
      }
    }

    if (debug && debugLines) {
      try {
        const lines = decorations
          .map((decoration) => {
            const range = decoration && typeof decoration === 'object'
              ? (decoration as { range?: { startLineNumber?: number } }).range
              : null;
            return range && typeof range.startLineNumber === 'number' ? range.startLineNumber : null;
          })
          .filter((value): value is number => typeof value === 'number')
          .sort((left, right) => left - right);
        let overlaps = 0;
        for (let index = 1; index < lines.length; index += 1) {
          if (lines[index] === lines[index - 1]) overlaps += 1;
        }
        console.log(
          '[DraftDiff] summary add=' + String(addLines) +
          ' del=' + String(delLines) +
          ' decorations=' + String(decorations.length) +
          ' zones=' + String(zones.length) +
          ' overlaps=' + String(overlaps),
        );
      } catch (_) {}
      for (const line of debugLines) console.log('[DraftDiff] ' + line);
      console.groupEnd();
    }

    const collection = ensureDraftDecoCollection(deps);
    if (collection && typeof collection.set === 'function') {
      collection.set(decorations);
    } else if (typeof editor.deltaDecorations === 'function') {
      deps.setDraftDecoIds(editor.deltaDecorations(deps.getDraftDecoIds(), decorations));
    }

    applyDraftZones(deps, zones);
    try {
      if (deps.getShowInlineDiffs()) installDraftZoneOrderingHook(deps);
    } catch (error) {
      console.warn('[DraftDiff] Failed to install zone ordering hook', error);
    }

    let tag = 'draft=+' + String(addLines) + ' -' + String(delLines);
    if (ms != null) tag += ' ' + String(ms) + 'ms';
    deps.setDebugDraft(tag);
    if (payload && payload.error) console.warn('[DraftDiff] error', payload.error);
  } catch (error) {
    console.warn('[DraftDiff] apply failed', error);
  }
}
