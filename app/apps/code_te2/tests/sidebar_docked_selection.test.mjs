import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const built = await build({
  entryPoints: ['main_page/frontend/sidebar-shortcuts/docked-selection.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { DockedSelection, bindDockedFocus } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const a = { key: 'a' }, b = { key: 'b' }, detached = { key: 'detached' };

test('detached activation retains the most recently displayed eligible surface', () => {
  const selection = new DockedSelection();
  assert.equal(selection.resolve([a, b], a, b), a);
  assert.equal(selection.resolve([a, b, detached], detached, b), detached);
  // Detaching the selected surface restores the last docked one, not a blank.
  assert.equal(selection.resolve([a, b], detached, b), a);
  assert.equal(selection.resolve([a, b], detached, b), a);
  // Actual focus/selection of the visible surface can make it foreground.
  assert.equal(selection.resolve([a, b], b, a), b);
  assert.equal(selection.resolve([a, b], detached, a), b);
});

test('hidden/closed/project-excluded surfaces cannot survive in rendering history', () => {
  const selection = new DockedSelection();
  selection.resolve([a, b], a, b);
  assert.equal(selection.resolve([b], detached, a), b);
  assert.equal(selection.resolve([], detached, a), null);
  assert.equal(selection.resolve([a, b], detached, b), b);
});

test('cold rendering uses eligible MRU and never changes caller state', () => {
  const selection = new DockedSelection();
  const eligible = Object.freeze([a, b]);
  const active = Object.freeze({ key: 'detached' });
  assert.equal(selection.resolve(eligible, active, b), b);
  assert.deepEqual(active, { key: 'detached' });
  assert.deepEqual(eligible, [a, b]);
});

test('an eligible foreground takes precedence and separate clients have separate history', () => {
  const first = new DockedSelection(), second = new DockedSelection();
  first.resolve([a, b], a, b);
  second.resolve([a, b], b, a);
  assert.equal(first.resolve([a, b], detached, b), a);
  assert.equal(second.resolve([a, b], detached, a), b);
  assert.equal(first.resolve([a, b], b, a), b);
});

test('frame focus observes current activeElement and disposal cancels delayed blur', async () => {
  const win = new Window();
  const frame = win.document.createElement('iframe');
  win.document.body.append(frame);
  const observed = [];
  const dispose = bindDockedFocus(win, win.document, () => observed.push(win.document.activeElement));
  try {
    frame.focus();
    assert.equal(observed.at(-1), frame);
    observed.length = 0;
    win.dispatchEvent(new win.Event('blur'));
    assert.equal(observed.length, 0, 'blur checks after activeElement updates');
    await new Promise(resolve => win.setTimeout(resolve, 10));
    assert.deepEqual(observed, [frame]);
    win.dispatchEvent(new win.Event('blur'));
    dispose();
    observed.length = 0;
    win.document.dispatchEvent(new win.Event('focusin'));
    await new Promise(resolve => win.setTimeout(resolve, 10));
    assert.equal(observed.length, 0);
  } finally {
    dispose();
    win.happyDOM.abort();
  }
});
