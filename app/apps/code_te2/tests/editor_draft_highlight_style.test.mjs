import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('monaco_editor/inline_host.ts', 'utf8');
const draftCss = source.slice(source.indexOf('#editor-frame .monaco-editor .te2-draft-add-line,'), source.indexOf('#editor-frame .monaco-editor .margin-view-overlays'));

test('draft backgrounds halve alpha without fading text or changing review semantics', () => {
  const backgrounds = [...draftCss.matchAll(/background: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)];
  assert.deepEqual(backgrounds.map(match => Number(match[4])), [0.12, 0.09, 0.06, 0.08, 0.15, 0.08]);
  assert.deepEqual(backgrounds.map(match => match.slice(1, 4).map(Number)), [[56, 139, 253], ...Array(5).fill([210, 153, 34])]);
  assert.doesNotMatch(draftCss, /\bopacity\s*:/);
  assert.match(draftCss, /color: #e6b450/);
  assert.match(draftCss, /\.inline-deleted-text\s*\{\s*background: rgba\(210, 153, 34, 0\.15\) !important/);
  assert.doesNotMatch(draftCss, /pointer-events|display: none|visibility: hidden/);
});

test('draft tints stay closer to light and dark theme backgrounds', () => {
  for (const match of draftCss.matchAll(/background: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)) {
    const tint = match.slice(1, 4).map(Number);
    const alpha = Number(match[4]);
    for (const base of [[255, 255, 255], [13, 17, 23]]) {
      const distance = opacity => Math.hypot(...tint.map((channel, i) => (channel - base[i]) * opacity));
      assert.ok(distance(alpha) > 0, 'retain a visible tint');
      assert.equal(distance(alpha), distance(alpha * 2) / 2);
    }
  }
});

test('normal Git/history diff theme remains unchanged', () => {
  const theme = readFileSync('monaco_editor/editor_diff_theme_utils.ts', 'utf8');
  assert.match(theme, /'diffEditor.insertedLineBackground': 'rgba\(46, 160, 67, 0\.18\)'/);
  assert.match(theme, /'diffEditor.removedTextBackground': 'rgba\(248, 81, 73, 0\.24\)'/);
});
