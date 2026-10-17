import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('Shift+Enter uses the real flexible InputBox change/layout pipeline once', async () => {
  const win = new Window();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'KeyboardEvent', 'MutationObserver', 'Node']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? win : key === 'document' ? win.document : win[key], configurable: true, writable: true });
  }
  globalThis.self = win;
  const bundled = await build({ stdin: { contents: `
    export { InputBox } from '../../static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js';
    export { insertContentQueryNewline } from './src/explorer/search/content-query-keyboard.ts';`,
    resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'esm', loader: { '.css': 'empty' } });
  const { InputBox, insertContentQueryNewline } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const host = document.createElement('div'); document.body.append(host);
  const box = new InputBox(host, undefined, { flexibleHeight: true, inputBoxStyles: {} });
  const input = box.inputElement;
  const onKey = event => insertContentQueryNewline(event, box);
  input.addEventListener('keydown', onKey, true);
  const changes = [];
  box.onDidChange(value => changes.push(value));
  let unclaimed = 0;
  input.addEventListener('keydown', () => unclaimed++);
  try {
    box.value = 'abXYZcd'; changes.length = 0;
    input.focus(); input.setSelectionRange(2, 5);
    const newline = new win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(newline);
    assert.equal(newline.defaultPrevented, true);
    assert.equal(box.value, 'ab\ncd');
    assert.deepEqual(changes, ['ab\ncd']);
    assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 3);
    assert.equal(document.activeElement, input);
    assert.equal(unclaimed, 0);
    for (const options of [{}, { shiftKey: true, isComposing: true }, { shiftKey: true, ctrlKey: true }, { shiftKey: true, altKey: true }, { shiftKey: true, metaKey: true }]) {
      const event = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
      input.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(box.value, 'ab\ncd');
    }
    box.value = 'pasted\nmultiple\nlines';
    assert.equal(box.value, 'pasted\nmultiple\nlines');
  } finally {
    input.removeEventListener('keydown', onKey, true);
    box.dispose(); win.happyDOM.abort();
  }
});
