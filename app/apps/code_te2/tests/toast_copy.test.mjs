import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundle = await build({ entryPoints: ['../../static/js/te_ui.js'], bundle: true, write: false, format: 'iife', platform: 'browser' });
function fixture(clipboard) {
  const win = new Window({ url: 'http://localhost/' });
  Object.defineProperty(win.navigator, 'clipboard', { value: clipboard, configurable: true });
  win.eval(bundle.outputFiles[0].text);
  return win;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('shared toast copies original plain message, reports locally and can copy again', async () => {
  const copies = [], win = fixture({ writeText: async text => copies.push(text) });
  try {
    const text = 'Error <tag>\nsecond line';
    win.teUI.toast(text, { persistent: true });
    const toast = win.document.querySelector('.te-toast');
    const button = toast.querySelector('.te-toast-copy');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.textContent, text);
    assert.equal(button.querySelector('tag'), null);
    button.click(); await settle();
    assert.equal(toast.querySelector('[role=status]').textContent, 'Copied');
    button.click(); await settle();
    assert.deepEqual(copies, [text, text]);
    assert.equal(win.document.querySelectorAll('.te-toast').length, 1);
  } finally { await win.happyDOM.abort(); }
});

test('toast close invokes onClose once and does not copy', async () => {
  let copied = 0, closed = 0;
  const win = fixture({ writeText: async () => copied++ });
  try {
    win.teUI.toast('Close me', { persistent: true, onClose: () => closed++ });
    win.document.querySelector('.te-toast-close').click(); await settle();
    assert.equal(closed, 1); assert.equal(copied, 0);
    assert.equal(win.document.querySelector('.te-toast'), null);
  } finally { await win.happyDOM.abort(); }
});

test('clipboard failures report failure without recursive notifications', async () => {
  const win = fixture({ writeText: async () => { throw Error('denied'); } });
  try {
    win.document.execCommand = () => false;
    win.teUI.toast('Denied', { persistent: true });
    win.document.querySelector('.te-toast-copy').click(); await settle();
    assert.equal(win.document.querySelector('.te-toast-copy-status').textContent, 'Could not copy to clipboard');
    assert.equal(win.document.querySelectorAll('.te-toast').length, 1);
  } finally { await win.happyDOM.abort(); }
});

test('legacy copy fallback preserves textarea focus and selection and removes its listener', async () => {
  const win = fixture(undefined);
  try {
    const input = win.document.createElement('textarea');
    input.value = 'editor text'; win.document.body.append(input); input.focus(); input.setSelectionRange(2, 4);
    const writes = [];
    win.document.execCommand = command => {
      assert.equal(command, 'copy');
      const event = new win.Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type, text) => writes.push([type, text]) } });
      input.dispatchEvent(event);
      return true;
    };
    win.teUI.toast('diagnostic', { persistent: true });
    const button = win.document.querySelector('.te-toast-copy');
    const down = new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down); assert.equal(down.defaultPrevented, true);
    button.click(); await settle();
    assert.deepEqual(writes, [['text/plain', 'diagnostic']]);
    assert.equal(win.document.activeElement, input);
    assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 4);
    input.dispatchEvent(new win.Event('copy', { bubbles: true, cancelable: true }));
    assert.equal(writes.length, 1);
  } finally { await win.happyDOM.abort(); }
});

test('pending copy is single-flight and original toast expiry is retained', async () => {
  let calls = 0, finish, expired = 0;
  const win = fixture({ writeText: () => { calls++; return new Promise(resolve => finish = resolve); } });
  try {
    win.teUI.toast('short', { duration: 10, onClose: () => expired++ });
    const button = win.document.querySelector('.te-toast-copy');
    button.click(); button.click(); assert.equal(calls, 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(expired, 1); assert.equal(win.document.querySelector('.te-toast'), null);
    finish(); await settle();
    assert.equal(win.document.querySelector('.te-toast'), null);
  } finally { await win.happyDOM.abort(); }
});
