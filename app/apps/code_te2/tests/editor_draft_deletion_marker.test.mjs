import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['monaco_editor/editor_draft_diff_runtime.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { applyDraftDiffDecorations } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture({ lineCount = 5, full = false, inline = false, enabled = true, legacy = false } = {}) {
  let decorations = [], collection = null, clears = 0;
  const editor = legacy
    ? { deltaDecorations(_ids, next) { decorations = next; return ['legacy']; } }
    : { createDecorationsCollection() {
        return { set(next) { decorations = next; } };
      } };
  const deps = {
    getCurrentPath: () => '/draft.txt', getEditor: () => editor,
    getDiffEditor: () => inline ? {} : null,
    getModel: () => ({ getLineCount: () => lineCount, getLineLength: () => 1000 }),
    getMonaco: () => ({ Range: class {
      constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
        Object.assign(this, { startLineNumber, startColumn, endLineNumber, endColumn });
      }
    } }),
    getDocument: () => null,
    getShowDraftDiffs: () => full, getShowDraftInsertions: () => enabled,
    getShowInlineDiffs: () => inline,
    clearDraftDiffDecorations() { decorations = []; clears++; },
    clearDraftDiffZones() {}, setDebugDraft() {}, applyEditorTypography() {},
    getDraftDecoCollection: () => collection,
    setDraftDecoCollection(next) { collection = next; },
    getDraftDecoIds: () => [], setDraftDecoIds() {}, setDraftZoneIds() {},
    getLastDraftZones: () => null, setLastDraftZones() {},
    getIsApplyingDraftZones: () => false, setIsApplyingDraftZones() {},
    getIgnoreNextModifiedViewZonesEvent: () => false, setIgnoreNextModifiedViewZonesEvent() {},
    getReapplyDraftZonesScheduled: () => false, setReapplyDraftZonesScheduled() {},
    schedule() {},
  };
  return { apply(hunks, path = '/draft.txt') {
    applyDraftDiffDecorations(deps, { path, hunks });
  }, get decorations() { return decorations; }, get clears() { return clears; } };
}

const deletion = (newStart, count = 1) => ({ oldStart: 1, oldLines: count, newStart, newLines: 0,
  lines: Array.from({ length: count }, () => ({ type: 'del-draft', text: 'removed' })) });
const markers = f => f.decorations.filter(d => d.options.description === 'te2-draft-deletion');

test('a consecutive deletion gets one boundary marker, with a useful count', () => {
  const f = fixture(); f.apply([deletion(3, 4)]);
  assert.equal(markers(f).length, 1);
  assert.equal(markers(f)[0].range.startLineNumber, 2);
  assert.equal(markers(f)[0].options.linesDecorationsTooltip, '4 deleted draft lines');
  assert.equal(markers(f)[0].options.isWholeLine, false);
});

test('wrapped-line deletion anchors to the end of its logical line, not its first visual row', () => {
  const f = fixture(); f.apply([deletion(4)]);
  assert.equal(markers(f)[0].range.startLineNumber, 3);
  assert.equal(markers(f)[0].range.startColumn, Number.MAX_VALUE);
  assert.equal(markers(f)[0].range.endColumn, Number.MAX_VALUE);
});

test('beginning, end and entirely deleted documents retain an in-model anchor', () => {
  for (const [lineCount, newStart, expectedLine, top] of [
    [5, 1, 1, true], [5, 6, 5, false], [1, 1, 1, true],
  ]) {
    const f = fixture({ lineCount }); f.apply([deletion(newStart)]);
    const marker = markers(f)[0];
    assert.equal(marker.range.startLineNumber, expectedLine);
    assert.equal(marker.options.linesDecorationsClassName.includes('glyph-top'), top);
    assert.equal(marker.range.startColumn, top ? 1 : Number.MAX_VALUE);
  }
});

test('equal-size, growing and shrinking replacements get blue highlighting but no deletion caret', () => {
  for (const [removed, added] of [[1, 1], [1, 3], [4, 1]]) {
    const f = fixture(); const hunk = deletion(2, removed);
    hunk.newLines = added;
    hunk.lines.push(...Array.from({ length: added }, () => ({ type: 'add-draft', text: 'replacement' })));
    f.apply([hunk]);
    assert.equal(markers(f).length, 0);
    assert.equal(f.decorations.filter(d => d.options.className === 'te2-draft-add-line').length, added);
  }
});

test('independent deletion-only hunks still mark gaps alongside modified hunks', () => {
  const f = fixture(); const modified = deletion(2, 2);
  modified.newLines = 1;
  modified.lines.push({ type: 'add-draft', text: 'modified' });
  f.apply([modified, deletion(5, 2)]);
  assert.equal(markers(f).length, 1);
  assert.equal(markers(f)[0].range.startLineNumber, 4);
});

test('missing/malformed counts and contradictory replacement payloads do not imply a gap', () => {
  for (const newLines of [undefined, null, '0', -1, 1]) {
    const f = fixture(); f.apply([{ ...deletion(2), newLines }]);
    assert.equal(markers(f).length, 0);
  }
  const f = fixture(); const contradictory = deletion(2);
  contradictory.lines.push({ type: 'add-draft', text: 'not a gap' });
  f.apply([contradictory]); assert.equal(markers(f).length, 0);
});

test('inline/full diff keeps stock deletion widgets without duplicate gutter carets', () => {
  for (const options of [{ full: true }, { inline: true }, { enabled: false }]) {
    const f = fixture(options); f.apply([deletion(2)]);
    assert.equal(markers(f).length, 0);
  }
});

test('refresh removes old markers, ignores stale file payloads and supports legacy collections', () => {
  for (const legacy of [false, true]) {
    const f = fixture({ legacy }); f.apply([deletion(2)]);
    assert.equal(markers(f).length, 1);
    f.apply([], '/other.txt'); assert.equal(markers(f).length, 1);
    f.apply([]); assert.equal(markers(f).length, 0);
  }
});

test('marker CSS uses a translucent non-interactive theme-aware triangle', () => {
  const source = readFileSync('monaco_editor/inline_host.ts', 'utf8');
  assert.match(source, /\.te2-draft-delete-glyph\s*\{[^}]*opacity: 0\.65;[^}]*pointer-events: none;/);
  assert.match(source, /border-left: 4px solid var\(--vscode-editorGutter-deletedBackground, #f14c4c\)/);
  assert.match(source, /\.te2-draft-delete-glyph-top::after\s*\{\s*top: -4px;\s*bottom: auto;/);
});
