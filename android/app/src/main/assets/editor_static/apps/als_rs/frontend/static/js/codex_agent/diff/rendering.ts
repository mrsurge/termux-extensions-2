import {
  createPathScrollLabel,
  pathScrollLabelHtml,
  scrollPathLabelsToEnd,
} from '../path_label.ts';
import type { TranscriptCardMetadata } from '../transcript_card_metadata.ts';
import { countPatchChanges, diffFileIcon } from './summary.ts';

type HighlightResult = {
  value: string;
};

declare const hljs: {
  highlight(code: string, options: { language: string; ignoreIllegals: boolean }): HighlightResult;
};

type DiffBlockState = {
  text: string;
  path: string;
};

type DiffOp = {
  type: 'common' | 'del' | 'add';
  value: string;
};

type IntralinePart = {
  text: string;
  changed: boolean;
};

type IntralinePair = {
  leftParts: IntralinePart[];
  rightParts: IntralinePart[];
};

type DiffRenderMode = 'auto' | 'heuristic-only';

type DiffRenderState = {
  mode: DiffRenderMode;
  jsDiffEnabled: boolean;
  jsDiffLoaded: boolean;
  jsDiffLoading: boolean;
  jsDiffActive: boolean;
  jsDiffCdnUrl: string;
};

type JsDiffChange = {
  value?: string;
  added?: boolean;
  removed?: boolean;
};

type JsDiffApi = {
  diffWords(leftText: string, rightText: string): JsDiffChange[];
  diffChars(leftText: string, rightText: string): JsDiffChange[];
};

type DiffTableRow = {
  kind: 'file' | 'meta' | 'code';
  cls: string;
  path: string;
  oldLine: string;
  newLine: string;
  gutterText: string;
  display: string;
  codeHtml: string;
  activePath: string;
  wholeLineEmphasis?: boolean;
};

type DiffAlignmentPair = {
  deletionIndex: number;
  additionIndex: number;
  similarity: number;
};

type DiffRowEntry = {
  block: HTMLElement;
  row?: HTMLElement;
};

type CreatedRow = {
  row: HTMLElement;
  body: HTMLElement;
};

type DiffRenderingContext = {
  getDiffRow(
    id: string,
    path: string,
    parentEl?: HTMLElement | null,
    metadata?: TranscriptCardMetadata | null,
  ): DiffRowEntry;
  createRow(kind: string, cls?: string): CreatedRow;
  escapeHtml(text: string): string;
  toRelativePath(path: string | null | undefined): string;
  isDiffSyntaxEnabled(): boolean;
  detectLangFromPath?(path: string | null | undefined): string | null;
  resolveHljsLanguage?(lang: string | null | undefined): string | null;
  setLastEventType(value: string): void;
  maybeAutoScroll(force?: boolean): void;
  timelineEl: HTMLElement | null;
  postTe2OpenRequest(target: { path: string; line: number; column: number }): void;
};

type DiffBlockElement = HTMLElement & {
  __diffRender?: DiffBlockState;
};

export function bindDiffRendering(ctx: DiffRenderingContext) {
  const {
    getDiffRow,
    createRow,
    escapeHtml,
    toRelativePath,
    isDiffSyntaxEnabled,
    detectLangFromPath,
    resolveHljsLanguage,
    setLastEventType,
    maybeAutoScroll,
    timelineEl,
    postTe2OpenRequest,
  } = ctx;
  const JSDIFF_CDN_URL = 'https://cdn.jsdelivr.net/npm/diff@8.0.2/+esm';
  const DIFF_RENDER_MODE_STORAGE_KEY = 'codex_diff_render_mode';
  const DIFF_RENDER_MODE_AUTO: DiffRenderMode = 'auto';
  const DIFF_RENDER_MODE_HEURISTIC_ONLY: DiffRenderMode = 'heuristic-only';
  let jsDiffApi: JsDiffApi | null = null;
  let jsDiffLoadPromise: Promise<JsDiffApi | null> | null = null;
  let diffRenderMode = readStoredDiffRenderMode();

  function normalizeDiffRenderMode(value: string | null | undefined): DiffRenderMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === DIFF_RENDER_MODE_HEURISTIC_ONLY
      || normalized === 'heuristic'
      || normalized === 'fallback'
      || normalized === 'off'
      || normalized === 'disable-jsdiff'
    ) {
      return DIFF_RENDER_MODE_HEURISTIC_ONLY;
    }
    return DIFF_RENDER_MODE_AUTO;
  }

  function readStoredDiffRenderMode(): DiffRenderMode {
    if (typeof window === 'undefined' || !window.localStorage) return DIFF_RENDER_MODE_AUTO;
    try {
      return normalizeDiffRenderMode(window.localStorage.getItem(DIFF_RENDER_MODE_STORAGE_KEY));
    } catch {
      return DIFF_RENDER_MODE_AUTO;
    }
  }

  function persistDiffRenderMode(mode: DiffRenderMode): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(DIFF_RENDER_MODE_STORAGE_KEY, mode);
    } catch {}
  }

  function isJsDiffEnabled(): boolean {
    return diffRenderMode !== DIFF_RENDER_MODE_HEURISTIC_ONLY;
  }

  function hasJsDiffApi(value: unknown): value is JsDiffApi {
    return Boolean(
      value
      && typeof (value as JsDiffApi).diffWords === 'function'
      && typeof (value as JsDiffApi).diffChars === 'function',
    );
  }

  function getJsDiffApi(): JsDiffApi | null {
    if (!isJsDiffEnabled()) return null;
    return hasJsDiffApi(jsDiffApi) ? jsDiffApi : null;
  }

  function getDiffRenderState(): DiffRenderState {
    return {
      mode: diffRenderMode,
      jsDiffEnabled: isJsDiffEnabled(),
      jsDiffLoaded: hasJsDiffApi(jsDiffApi),
      jsDiffLoading: Boolean(jsDiffLoadPromise),
      jsDiffActive: Boolean(getJsDiffApi()),
      jsDiffCdnUrl: JSDIFF_CDN_URL,
    };
  }

  function renderDiffBlock(block: HTMLElement | null, text: string | null | undefined, path: string | null | undefined): void {
    if (!(block instanceof HTMLElement)) return;
    const diffBlock = block as DiffBlockElement;
    diffBlock.__diffRender = {
      text: typeof text === 'string' ? text : '',
      path: typeof path === 'string' ? path : '',
    };
    diffBlock.innerHTML = formatDiff(text || '', path);
    scrollPathLabelsToEnd(diffBlock);
  }

  function rerenderKnownDiffBlocks(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.diff-block').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const state = (node as DiffBlockElement).__diffRender;
      if (!state || typeof state !== 'object') return;
      node.innerHTML = formatDiff(state.text || '', state.path || '');
      scrollPathLabelsToEnd(node);
    });
  }

  function preloadJsDiff(): Promise<JsDiffApi | null> | null {
    if (getJsDiffApi() || jsDiffLoadPromise) return jsDiffLoadPromise;
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    if (!isJsDiffEnabled()) return null;
    jsDiffLoadPromise = import(JSDIFF_CDN_URL)
      .then((mod: unknown) => {
        if (!hasJsDiffApi(mod)) return null;
        jsDiffApi = mod;
        rerenderKnownDiffBlocks();
        return jsDiffApi;
      })
      .catch((error) => {
        jsDiffLoadPromise = null;
        console.warn('[diff] Failed to load jsdiff CDN module; using fallback intraline logic.', error);
        return null;
      });
    return jsDiffLoadPromise;
  }

  function setDiffRenderMode(nextMode: string | null | undefined): DiffRenderState {
    diffRenderMode = normalizeDiffRenderMode(nextMode);
    persistDiffRenderMode(diffRenderMode);
    rerenderKnownDiffBlocks();
    if (isJsDiffEnabled()) {
      preloadJsDiff();
    }
    return getDiffRenderState();
  }

  function addDiff(
    id: string,
    text: string | null | undefined,
    path: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ): void {
    const entry = getDiffRow(id, path, parentEl, metadata);
    const meta = entry.row?.querySelector(':scope > .meta');
    if (meta) {
      const { additions, deletions } = countPatchChanges(text || '');
      const language = detectLangFromPath?.(path);
      meta.classList.add('diff-shortstat');
      const fileType = language ? `<span class="diff-file-type">${escapeHtml(language)}</span>` : '';
      const icon = diffFileIcon(language);
      const iconClass = icon.startsWith('language-') ? `diff-language-icon ${icon}` : `codicon codicon-${icon}`;
      meta.innerHTML = `<span class="${iconClass}" aria-hidden="true"></span>${fileType}<span>diff</span><span class="diff-count added">+${additions}</span><span class="diff-count deleted">-${deletions}</span>`;
      meta.setAttribute('aria-label', `diff: ${additions} added, ${deletions} deleted`);
      entry.row?.appendChild(meta);
    }
    renderDiffBlock(entry.block, text || '', path);
    setLastEventType('diff');
    maybeAutoScroll();
  }

  function addDeclinedDiff(_id: string, text: string | null | undefined, path: string): void {
    const { row, body } = createRow('diff', 'diff-declined');
    row.classList.add('declined');
    if (path) {
      const pathLabel = document.createElement('div');
      pathLabel.className = 'declined-label';
      const prefix = document.createElement('strong');
      prefix.textContent = 'DECLINED: ';
      pathLabel.append(prefix, createPathScrollLabel(document, toRelativePath(path), {
        title: path,
      }));
      body.appendChild(pathLabel);
    }
    const block = document.createElement('div');
    block.className = 'diff-block';
    renderDiffBlock(block, text || '', path);
    body.appendChild(block);
    setLastEventType('diff');
    maybeAutoScroll();
  }

  function tokenizeDiffWords(text: string): string[] {
    if (typeof text !== 'string' || !text) return [];
    return text.match(/(\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]+)/g) || Array.from(text);
  }

  function tokenizeDiffChars(text: string): string[] {
    return Array.from(text || '');
  }

  function tokenizeLineAlignmentTokens(text: string): string[] {
    return tokenizeDiffWords(text).filter((token) => token && !/^\s+$/.test(token));
  }

  function buildLcsTable(leftTokens: string[], rightTokens: string[]): number[][] {
    const table = Array.from({ length: leftTokens.length + 1 }, () => Array<number>(rightTokens.length + 1).fill(0));
    for (let leftIdx = leftTokens.length - 1; leftIdx >= 0; leftIdx -= 1) {
      for (let rightIdx = rightTokens.length - 1; rightIdx >= 0; rightIdx -= 1) {
        if (leftTokens[leftIdx] === rightTokens[rightIdx]) {
          table[leftIdx][rightIdx] = table[leftIdx + 1][rightIdx + 1] + 1;
        } else {
          table[leftIdx][rightIdx] = Math.max(table[leftIdx + 1][rightIdx], table[leftIdx][rightIdx + 1]);
        }
      }
    }
    return table;
  }

  function buildWeightedLcsTable(leftTokens: string[], rightTokens: string[]): number[][] {
    const table = Array.from({ length: leftTokens.length + 1 }, () => Array<number>(rightTokens.length + 1).fill(0));
    for (let leftIdx = leftTokens.length - 1; leftIdx >= 0; leftIdx -= 1) {
      for (let rightIdx = rightTokens.length - 1; rightIdx >= 0; rightIdx -= 1) {
        if (leftTokens[leftIdx] === rightTokens[rightIdx]) {
          table[leftIdx][rightIdx] = leftTokens[leftIdx].length + table[leftIdx + 1][rightIdx + 1];
        } else {
          table[leftIdx][rightIdx] = Math.max(table[leftIdx + 1][rightIdx], table[leftIdx][rightIdx + 1]);
        }
      }
    }
    return table;
  }

  function diffTokenSequences(leftTokens: string[], rightTokens: string[]): DiffOp[] {
    const table = buildLcsTable(leftTokens, rightTokens);
    const ops: DiffOp[] = [];
    let leftIdx = 0;
    let rightIdx = 0;
    while (leftIdx < leftTokens.length && rightIdx < rightTokens.length) {
      if (leftTokens[leftIdx] === rightTokens[rightIdx]) {
        ops.push({ type: 'common', value: leftTokens[leftIdx] });
        leftIdx += 1;
        rightIdx += 1;
        continue;
      }
      if (table[leftIdx + 1][rightIdx] >= table[leftIdx][rightIdx + 1]) {
        ops.push({ type: 'del', value: leftTokens[leftIdx] });
        leftIdx += 1;
      } else {
        ops.push({ type: 'add', value: rightTokens[rightIdx] });
        rightIdx += 1;
      }
    }
    while (leftIdx < leftTokens.length) {
      ops.push({ type: 'del', value: leftTokens[leftIdx] });
      leftIdx += 1;
    }
    while (rightIdx < rightTokens.length) {
      ops.push({ type: 'add', value: rightTokens[rightIdx] });
      rightIdx += 1;
    }
    return ops;
  }

  function sumTokenWeights(tokens: string[]): number {
    return tokens.reduce((total, token) => total + token.length, 0);
  }

  function measureCharSimilarity(leftText: string, rightText: string): number {
    const leftChars = tokenizeDiffChars(leftText);
    const rightChars = tokenizeDiffChars(rightText);
    if (!leftChars.length || !rightChars.length) return 0;
    const sharedChars = buildLcsTable(leftChars, rightChars)[0][0];
    return sharedChars / Math.max(leftChars.length, rightChars.length, 1);
  }

  function shouldRefineCharLevel(leftText: string, rightText: string): boolean {
    if (!leftText || !rightText) return false;
    if (leftText.length > 160 || rightText.length > 160) return false;
    if (!/\S/.test(leftText) || !/\S/.test(rightText)) return false;
    return measureCharSimilarity(leftText, rightText) >= 0.5;
  }

  function measureLinePairSimilarity(leftText: string, rightText: string): number {
    const leftTokens = tokenizeLineAlignmentTokens(leftText);
    const rightTokens = tokenizeLineAlignmentTokens(rightText);
    if (!leftTokens.length || !rightTokens.length) return 0;
    const sharedWeight = buildWeightedLcsTable(leftTokens, rightTokens)[0][0];
    const totalWeight = Math.max(sumTokenWeights(leftTokens), sumTokenWeights(rightTokens), 1);
    return sharedWeight / totalWeight;
  }

  function alignChangedLineRuns(deletions: DiffTableRow[], additions: DiffTableRow[], threshold = 0.45): DiffAlignmentPair[] {
    if (!deletions.length || !additions.length) return [];
    const scores = deletions.map((deletion) => additions.map((addition) => measureLinePairSimilarity(deletion.display || '', addition.display || '')));
    const rowCount = deletions.length;
    const colCount = additions.length;
    const dp = Array.from({ length: rowCount + 1 }, () => Array<number>(colCount + 1).fill(0));

    for (let rowIdx = rowCount - 1; rowIdx >= 0; rowIdx -= 1) {
      for (let colIdx = colCount - 1; colIdx >= 0; colIdx -= 1) {
        const benefit = scores[rowIdx][colIdx] - threshold;
        const skipDeletion = dp[rowIdx + 1][colIdx];
        const skipAddition = dp[rowIdx][colIdx + 1];
        const match = benefit > 0 ? benefit + dp[rowIdx + 1][colIdx + 1] : Number.NEGATIVE_INFINITY;
        dp[rowIdx][colIdx] = Math.max(skipDeletion, skipAddition, match);
      }
    }

    const pairs: DiffAlignmentPair[] = [];
    let rowIdx = 0;
    let colIdx = 0;
    while (rowIdx < rowCount && colIdx < colCount) {
      const benefit = scores[rowIdx][colIdx] - threshold;
      const skipDeletion = dp[rowIdx + 1][colIdx];
      const skipAddition = dp[rowIdx][colIdx + 1];
      const match = benefit > 0 ? benefit + dp[rowIdx + 1][colIdx + 1] : Number.NEGATIVE_INFINITY;
      if (match > Number.NEGATIVE_INFINITY && match >= skipDeletion && match >= skipAddition) {
        pairs.push({
          deletionIndex: rowIdx,
          additionIndex: colIdx,
          similarity: scores[rowIdx][colIdx],
        });
        rowIdx += 1;
        colIdx += 1;
        continue;
      }
      if (skipDeletion >= skipAddition) {
        rowIdx += 1;
      } else {
        colIdx += 1;
      }
    }
    return pairs;
  }

  function appendDiffPart(parts: IntralinePart[], text: string, changed: boolean): void {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.changed === changed) {
      last.text += text;
      return;
    }
    parts.push({ text, changed });
  }

  function mergeDiffParts(targetParts: IntralinePart[], sourceParts: IntralinePart[]): void {
    sourceParts.forEach((part) => appendDiffPart(targetParts, part.text, part.changed));
  }

  function buildIntralineParts(leftText: string, rightText: string, allowCharRefine = true): IntralinePair | null {
    const leftParts: IntralinePart[] = [];
    const rightParts: IntralinePart[] = [];
    const ops = diffTokenSequences(tokenizeDiffWords(leftText), tokenizeDiffWords(rightText));
    const pendingLeft: string[] = [];
    const pendingRight: string[] = [];

    function flushPending(): void {
      const leftPendingText = pendingLeft.join('');
      const rightPendingText = pendingRight.join('');
      pendingLeft.length = 0;
      pendingRight.length = 0;
      if (!leftPendingText && !rightPendingText) return;
      const shouldRefineChars = allowCharRefine && shouldRefineCharLevel(leftPendingText, rightPendingText);
      if (shouldRefineChars) {
        const refined = buildIntralineParts(leftPendingText, rightPendingText, false);
        if (refined) {
          mergeDiffParts(leftParts, refined.leftParts);
          mergeDiffParts(rightParts, refined.rightParts);
          return;
        }
      }
      appendDiffPart(leftParts, leftPendingText, true);
      appendDiffPart(rightParts, rightPendingText, true);
    }

    const tokenOps = allowCharRefine ? ops : diffTokenSequences(tokenizeDiffChars(leftText), tokenizeDiffChars(rightText));
    tokenOps.forEach((op: DiffOp) => {
      if (op.type === 'common') {
        flushPending();
        appendDiffPart(leftParts, op.value, false);
        appendDiffPart(rightParts, op.value, false);
        return;
      }
      if (op.type === 'del') {
        pendingLeft.push(op.value);
        return;
      }
      pendingRight.push(op.value);
    });
    flushPending();

    const unchangedChars = leftParts.reduce((total, part) => total + (part.changed ? 0 : part.text.length), 0);
    const totalChars = Math.max(leftText.length, rightText.length, 1);
    const hasChangedSegments = leftParts.some((part) => part.changed) || rightParts.some((part) => part.changed);
    if (!hasChangedSegments || unchangedChars < 2 || unchangedChars / totalChars < 0.2) {
      return null;
    }
    return { leftParts, rightParts };
  }

  function buildJsDiffCharParts(leftText: string, rightText: string): IntralinePair | null {
    const api = getJsDiffApi();
    if (!api) return null;
    const leftParts: IntralinePart[] = [];
    const rightParts: IntralinePart[] = [];
    let hasChangedSegments = false;
    api.diffChars(leftText, rightText).forEach((change: JsDiffChange) => {
      const value = typeof change?.value === 'string' ? change.value : '';
      if (!value) return;
      if (change.added) {
        appendDiffPart(rightParts, value, true);
        hasChangedSegments = true;
        return;
      }
      if (change.removed) {
        appendDiffPart(leftParts, value, true);
        hasChangedSegments = true;
        return;
      }
      appendDiffPart(leftParts, value, false);
      appendDiffPart(rightParts, value, false);
    });
    return hasChangedSegments ? { leftParts, rightParts } : null;
  }

  function buildJsDiffIntralineParts(leftText: string, rightText: string): IntralinePair | null {
    const api = getJsDiffApi();
    if (!api) return null;
    const leftParts: IntralinePart[] = [];
    const rightParts: IntralinePart[] = [];
    let pendingLeft = '';
    let pendingRight = '';

    function flushPending(): void {
      const leftPendingText = pendingLeft;
      const rightPendingText = pendingRight;
      pendingLeft = '';
      pendingRight = '';
      if (!leftPendingText && !rightPendingText) return;
      const shouldRefineChars = shouldRefineCharLevel(leftPendingText, rightPendingText);
      if (shouldRefineChars) {
        const refined = buildJsDiffCharParts(leftPendingText, rightPendingText);
        if (refined) {
          mergeDiffParts(leftParts, refined.leftParts);
          mergeDiffParts(rightParts, refined.rightParts);
          return;
        }
      }
      appendDiffPart(leftParts, leftPendingText, true);
      appendDiffPart(rightParts, rightPendingText, true);
    }

    api.diffWords(leftText, rightText).forEach((change: JsDiffChange) => {
      const value = typeof change?.value === 'string' ? change.value : '';
      if (!value) return;
      if (change.added) {
        pendingRight += value;
        return;
      }
      if (change.removed) {
        pendingLeft += value;
        return;
      }
      flushPending();
      appendDiffPart(leftParts, value, false);
      appendDiffPart(rightParts, value, false);
    });
    flushPending();

    const unchangedChars = leftParts.reduce((total, part) => total + (part.changed ? 0 : part.text.length), 0);
    const totalChars = Math.max(leftText.length, rightText.length, 1);
    const hasChangedSegments = leftParts.some((part) => part.changed) || rightParts.some((part) => part.changed);
    if (!hasChangedSegments || unchangedChars < 2 || unchangedChars / totalChars < 0.2) {
      return null;
    }
    return { leftParts, rightParts };
  }

  function renderDiffPartsHtml(parts: IntralinePart[], emphasisClass: string, path: string): string {
    const container = document.createElement('div');
    container.innerHTML = renderDiffCodeHtml(parts.map(part => part.text).join(''), path);
    // Walk decoded text so diff offsets survive syntax spans, entities, and Unicode.
    const walker = document.createTreeWalker(container, 4);
    const nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let partIndex = 0;
    let partOffset = 0;
    for (const node of nodes) {
      const text = node.textContent || '';
      const replacement = document.createDocumentFragment();
      let offset = 0;
      while (offset < text.length && partIndex < parts.length) {
        const part = parts[partIndex];
        const length = Math.min(text.length - offset, part.text.length - partOffset);
        if (length > 0) {
          const fragment = document.createTextNode(text.slice(offset, offset + length));
          if (part.changed) {
            const span = document.createElement('span');
            span.className = emphasisClass;
            span.append(fragment);
            replacement.append(span);
          } else {
            replacement.append(fragment);
          }
          offset += length;
          partOffset += length;
        }
        if (partOffset === part.text.length) {
          partIndex += 1;
          partOffset = 0;
        }
      }
      node.parentNode?.replaceChild(replacement, node);
    }
    return container.innerHTML;
  }

  function hasMeaningfulChangedContent(parts: IntralinePart[]): boolean {
    return parts.some((part) => part.changed && /\S/.test(part.text));
  }

  function markWholeLineEmphasis(row: DiffTableRow | undefined): void {
    if (!row || row.kind !== 'code') return;
    row.wholeLineEmphasis = true;
  }

  function renderDiffCodeHtml(display: string, activePath: string): string {
    let codeHtml = escapeHtml(display);
    if (isDiffSyntaxEnabled() && typeof hljs !== 'undefined' && display.trim()) {
      try {
        const langHint = detectLangFromPath?.(activePath) || null;
        const lang = resolveHljsLanguage?.(langHint) || null;
        if (lang) {
          codeHtml = hljs.highlight(display, { language: lang, ignoreIllegals: true }).value;
        }
      } catch {}
    }
    return codeHtml;
  }

  function applyIntralineHighlights(rows: DiffTableRow[]): void {
    let idx = 0;
    while (idx < rows.length) {
      const row = rows[idx];
      if (!row || row.kind !== 'code' || (row.cls !== 'diff-del' && row.cls !== 'diff-add')) {
        idx += 1;
        continue;
      }

      const deletions: DiffTableRow[] = [];
      while (idx < rows.length && rows[idx]?.kind === 'code' && rows[idx].cls === 'diff-del') {
        deletions.push(rows[idx]);
        idx += 1;
      }

      const additions: DiffTableRow[] = [];
      let addIdx = idx;
      while (addIdx < rows.length && rows[addIdx]?.kind === 'code' && rows[addIdx].cls === 'diff-add') {
        additions.push(rows[addIdx]);
        addIdx += 1;
      }

      if (!deletions.length) {
        additions.forEach((addition) => markWholeLineEmphasis(addition));
        idx = addIdx;
        continue;
      }

      if (!additions.length) {
        deletions.forEach((deletion) => markWholeLineEmphasis(deletion));
        continue;
      }

      const alignedPairs = alignChangedLineRuns(deletions, additions);
      const matchedDeletionIndices = new Set<number>();
      const matchedAdditionIndices = new Set<number>();
      alignedPairs.forEach(({ deletionIndex, additionIndex }) => {
        matchedDeletionIndices.add(deletionIndex);
        matchedAdditionIndices.add(additionIndex);
        const deletion = deletions[deletionIndex];
        const addition = additions[additionIndex];
        const pair = buildJsDiffIntralineParts(deletion.display, addition.display)
          || buildIntralineParts(deletion.display, addition.display);
        if (!pair || (!hasMeaningfulChangedContent(pair.leftParts) && !hasMeaningfulChangedContent(pair.rightParts))) {
          markWholeLineEmphasis(deletion);
          markWholeLineEmphasis(addition);
          return;
        }
        deletion.codeHtml = renderDiffPartsHtml(pair.leftParts, 'diff-intraline-change diff-intraline-del', deletion.activePath);
        addition.codeHtml = renderDiffPartsHtml(pair.rightParts, 'diff-intraline-change diff-intraline-add', addition.activePath);
      });

      deletions.forEach((deletion, deletionIndex) => {
        if (!matchedDeletionIndices.has(deletionIndex)) {
          markWholeLineEmphasis(deletion);
        }
      });
      additions.forEach((addition, additionIndex) => {
        if (!matchedAdditionIndices.has(additionIndex)) {
          markWholeLineEmphasis(addition);
        }
      });

      idx = addIdx;
    }
  }

  function renderDiffRowHtml(row: DiffTableRow): string {
    let codeHtml = row.codeHtml || renderDiffCodeHtml(row.display || '', row.activePath || '');
    if (row.wholeLineEmphasis && row.cls === 'diff-add' && codeHtml) {
      codeHtml = `<span class="diff-intraline-change diff-intraline-add">${codeHtml}</span>`;
    } else if (row.wholeLineEmphasis && row.cls === 'diff-del' && codeHtml) {
      codeHtml = `<span class="diff-intraline-change diff-intraline-del">${codeHtml}</span>`;
    }
    const safePath = row.path ? escapeHtml(String(row.path)) : '';
    const safeOldLine = escapeHtml(String(row.oldLine || ''));
    const safeNewLine = escapeHtml(String(row.newLine || ''));
    const rowClasses = ['diff-line', row.cls, row.wholeLineEmphasis ? 'diff-full-line' : ''].filter(Boolean).join(' ');
    return `<tr class="${rowClasses}" data-path="${safePath}" data-old-line="${safeOldLine}" data-new-line="${safeNewLine}"><td class="diff-gutter transcript-line-no">${escapeHtml(row.gutterText || '')}</td><td class="diff-text">${codeHtml}</td></tr>`;
  }

  function formatDiff(text: string, filePath?: string | null): string {
    if (!text) return '';
    const diffGitCount = (text.match(/^diff --git /gm) || []).length;
    const showFileHeaders = diffGitCount > 1 || !filePath;
    let oldLine = 0;
    let newLine = 0;
    let maxOldLen = 1;
    let maxNewLen = 1;

    text.split('\n').forEach((line) => {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          const oldCount = parseInt(match[2] || '1', 10);
          newLine = parseInt(match[3], 10);
          const newCount = parseInt(match[4] || '1', 10);
          maxOldLen = Math.max(maxOldLen, String(oldLine + oldCount).length);
          maxNewLen = Math.max(maxNewLen, String(newLine + newCount).length);
        }
      }
    });

    oldLine = 0;
    newLine = 0;
    const explicitFilePath = filePath || null;
    let currentFilePath = explicitFilePath;
    const fileGutter = ''.padStart(maxOldLen, ' ') + '│' + ''.padStart(maxNewLen, ' ') + ' ';
    const rows: DiffTableRow[] = [];
    text.split('\n').forEach((line) => {
      let cls = 'diff-context';
      let display = line;
      let changeMarker = ' ';
      let oldNo = '';
      let newNo = '';

      if (line.startsWith('diff --git ')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          let bpath = parts[3];
          if (bpath.startsWith('b/')) bpath = bpath.slice(2);
          if (showFileHeaders || !explicitFilePath) {
            currentFilePath = bpath || currentFilePath;
          }
        }
        oldLine = 0;
        newLine = 0;
        if (!showFileHeaders) return;
        const relLabel = currentFilePath ? (toRelativePath(currentFilePath) || currentFilePath) : 'file';
        rows.push({
          kind: 'file',
          cls: 'diff-file',
          path: currentFilePath || '',
          oldLine: '',
          newLine: '',
          gutterText: fileGutter,
          display: '',
          codeHtml: pathScrollLabelHtml(relLabel, escapeHtml, {
            className: 'diff-file-path-label',
            strong: true,
            basenameClass: 'diff-filename',
          }),
          activePath: currentFilePath || '',
        });
        return;
      }

      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('similarity index') || line.startsWith('rename from') || line.startsWith('rename to')) {
        return;
      }

      const activePath = currentFilePath || filePath || '';

      if (line.startsWith('@@')) {
        cls = 'diff-hunk';
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
        if (match) {
          const oldStart = parseInt(match[1], 10);
          const oldCount = parseInt(match[2] || '1', 10);
          const newStart = parseInt(match[3], 10);
          const newCount = parseInt(match[4] || '1', 10);
          const oldEnd = Math.max(oldStart, oldStart + oldCount - 1);
          const newEnd = Math.max(newStart, newStart + newCount - 1);
          const oldRange = oldCount === 1 ? `${oldStart}` : `${oldStart}-${oldEnd}`;
          const newRange = newCount === 1 ? `${newStart}` : `${newStart}-${newEnd}`;
          display = `Lines ${oldRange} → ${newRange}`;
          oldLine = oldStart;
          newLine = newStart;
        }
        const hunkGutter = ''.padStart(maxOldLen, ' ') + '│' + ''.padStart(maxNewLen, ' ') + ' ';
        rows.push({
          kind: 'meta',
          cls,
          path: activePath,
          oldLine: String(oldLine || ''),
          newLine: String(newLine || ''),
          gutterText: hunkGutter,
          display,
          codeHtml: escapeHtml(display),
          activePath,
        });
        return;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        cls = 'diff-add';
        changeMarker = '+';
        newNo = String(newLine);
        newLine += 1;
        display = line.slice(1);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        cls = 'diff-del';
        changeMarker = '-';
        oldNo = String(oldLine);
        oldLine += 1;
        display = line.slice(1);
      } else if (line.startsWith(' ')) {
        changeMarker = ' ';
        oldNo = String(oldLine);
        newNo = String(newLine);
        oldLine += 1;
        newLine += 1;
        display = line.slice(1);
      } else {
        display = line;
      }

      const padOld = oldNo ? oldNo.padStart(maxOldLen, ' ') : ''.padStart(maxOldLen, ' ');
      const padNew = newNo ? newNo.padStart(maxNewLen, ' ') : ''.padStart(maxNewLen, ' ');
      const gutterText = `${padOld}│${padNew}${changeMarker} `;
      rows.push({
        kind: 'code',
        cls,
        path: activePath,
        oldLine: String(oldNo || ''),
        newLine: String(newNo || ''),
        gutterText,
        display,
        activePath,
        codeHtml: '',
      });
    });
    if (!rows.length) return '';
    applyIntralineHighlights(rows);
    return `<table class="diff-table" role="presentation"><tbody>${rows.map((row) => renderDiffRowHtml(row)).join('')}</tbody></table>`;
  }

  function bindDiffClickHandler() {
    timelineEl?.addEventListener('click', (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLElement)) return;
      const lineEl = target.closest('.diff-line');
      if (!(lineEl instanceof HTMLElement)) return;
      const path = lineEl.getAttribute('data-path') || '';
      const newLine = lineEl.getAttribute('data-new-line') || '';
      const oldLine = lineEl.getAttribute('data-old-line') || '';
      const line = parseInt(newLine || oldLine, 10);
      if (!path || !Number.isFinite(line)) return;
      if (line <= 0) return;
      try {
        lineEl.classList.add('tap-flash');
        setTimeout(() => lineEl.classList.remove('tap-flash'), 180);
      } catch {}
      postTe2OpenRequest({ path, line, column: 1 });
    });
  }

  preloadJsDiff();

  return {
    addDiff,
    addDeclinedDiff,
    formatDiff,
    renderDiffBlock,
    getDiffRenderState,
    setDiffRenderMode,
    bindDiffClickHandler,
  };
}
