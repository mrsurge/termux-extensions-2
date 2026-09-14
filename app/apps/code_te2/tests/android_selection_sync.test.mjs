import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// Exercise the maintained source when available and the published ESM on CI.
const suffix = 'vs/editor/browser/controller/editContext/textArea/';
const fork = resolve('../../../worktrees/vscode-te2-diff/src', suffix);
const useSource = process.env.TE2_TEST_PUBLISHED_MONACO !== '1' && existsSync(fork);
const root = useSource ? fork : resolve('../../static/vendor/monaco-editor-core/esm', suffix);
const ext = useSource ? 'ts' : 'js';
const win = new Window();
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
Object.assign(globalThis, { window: win, document: win.document,
  HTMLElement: win.HTMLElement, UIEvent: win.UIEvent, MouseEvent: win.MouseEvent });
const bundle = await build({ stdin: { contents: `export * from './textAreaEditContextInput.${ext}'; export * from './textAreaEditContextState.${ext}';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } });
const { TextAreaInput, TextAreaWrapper, TextAreaState } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=android-selection-runtime.js').toString('base64')}`);

function fixture(chrome) {
  const textarea = document.createElement('textarea'); document.body.append(textarea);
  const wrapper = new TextAreaWrapper(textarea);
  let projected = TextAreaState.createAndroidImeLine('hello world', 5, 5, null, 7);
  const input = new TextAreaInput({ getScreenReaderContent: () => projected }, wrapper, 3,
    { isAndroid: true, isChrome: chrome, isFirefox: !chrome, isSafari: false },
    { isScreenReaderOptimized: () => false, onDidChangeScreenReaderOptimized: () => ({ dispose() {} }) }, { trace() {}, getLevel: () => 0 });
  const selections = [], edits = [];
  input.onSelectionChangeRequest(s => {
    selections.push([s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn]);
    projected = TextAreaState.createAndroidImeLine('hello world', s.selectionStartColumn - 1, s.positionColumn - 1, null, 7);
    input.writeNativeTextAreaContent('selection callback');
  });
  input.onAndroidImeType(e => edits.push(e));
  textarea.focus(); input.refreshFocusState();
  const move = (start, end = start, direction = 'forward') => {
    textarea.setSelectionRange(start, end, direction);
    document.dispatchEvent(new win.Event('selectionchange'));
  };
  return { textarea, wrapper, input, selections, edits, move,
    stale: () => { projected = TextAreaState.createAndroidImeLine('other', 1, 1, null, 8); },
    dispose() { input.dispose(); wrapper.dispose(); textarea.remove(); } };
}

for (const chrome of [false, true]) {
  test(`Android ${chrome ? 'Chromium' : 'Gecko'} selection-only movement is immediate and does not write`, () => {
    const f = fixture(chrome);
    try {
      const value = f.textarea.value;
      let writes = 0;
      const write = f.wrapper.setSelectionRange.bind(f.wrapper);
      f.wrapper.setSelectionRange = (...args) => { writes++; return write(...args); };
      f.move(3); f.move(8); f.move(8);
      assert.deepEqual(f.selections, [[7, 3, 7, 3], [7, 8, 7, 8]]);
      assert.equal(writes, 0); assert.equal(f.textarea.value, value); assert.equal(f.edits.length, 0);
      f.move(2, 5, 'backward');
      assert.deepEqual(f.selections.at(-1), [7, 5, 7, 2]);
    } finally { f.dispose(); }
  });
}

test('Android rejects guard positions, changed text, stale projection and unfocused events', () => {
  const f = fixture(false);
  try {
    f.move(0); f.move(f.textarea.value.length);
    assert.equal(f.selections.length, 0);
    const original = f.textarea.value;
    f.textarea.value = '\u21ddchanged\n\n'; f.move(3);
    assert.equal(f.selections.length, 0);
    f.textarea.value = original; f.stale(); f.move(4);
    assert.equal(f.selections.length, 0);
    f.textarea.blur(); f.move(5);
    assert.equal(f.selections.length, 0);
  } finally { f.dispose(); }
});

test('Android pending input retains ownership over selection events', () => {
  const f = fixture(false);
  try {
    f.textarea.dispatchEvent(new win.InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }));
    f.move(3);
    assert.equal(f.selections.length, 0);
  } finally { f.dispose(); }
});

test('programmatic textarea synchronization is not echoed as an IME movement', () => {
  const f = fixture(false);
  try {
    f.stale();
    f.input.writeNativeTextAreaContent('model selection changed');
    document.dispatchEvent(new win.Event('selectionchange'));
    assert.equal(f.selections.length, 0);
    assert.equal(f.edits.length, 0);
  } finally { f.dispose(); }
});

test('Android movement tolerates composition noise and subsequent input edits the new position', async () => {
  const f = fixture(false);
  try {
    f.textarea.dispatchEvent(new win.CompositionEvent('compositionstart', { data: '' }));
    f.textarea.dispatchEvent(new win.KeyboardEvent('keydown', { keyCode: 229, isComposing: true }));
    f.move(3);
    assert.deepEqual(f.selections, [[7, 3, 7, 3]]);
    f.textarea.value = '\u21ddheXllo world\n\n';
    f.textarea.setSelectionRange(4, 4);
    f.textarea.dispatchEvent(new win.InputEvent('input', { data: 'X', inputType: 'insertCompositionText', isComposing: true }));
    await new Promise(resolve => win.requestAnimationFrame(() => setTimeout(resolve, 10)));
    assert.equal(f.edits.length, 1);
    assert.equal(f.edits[0].rangeStartOffset, 2);
    assert.equal(f.edits[0].rangeEndOffset, 2);
    assert.equal(f.edits[0].text, 'X');
  } finally { f.dispose(); }
});

test('guard mapping uses UTF-16 columns and retains empty-line caret boundaries', () => {
  const prior = TextAreaState.createAndroidImeLine('a\u{1f600}b', 0, 0, null, 9);
  const moved = new TextAreaState(prior.value, 4, 4, null, 0, 9);
  assert.equal(TextAreaState.deduceAndroidImeSelection(prior, moved).positionColumn, 4);
  assert.equal(TextAreaState.deduceAndroidImeSelection(prior, new TextAreaState(prior.value, 4, 4, null, 0, 10)), null);
  const empty = TextAreaState.createAndroidImeLine('', 0, 0, null, 1);
  assert.equal(TextAreaState.deduceAndroidImeSelection(empty, empty), null);
});

test.after(() => win.happyDOM.abort());
