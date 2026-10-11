import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(mobile = true) {
  const result = await build({ stdin: {
    contents: `export * from './monaco_editor/editor_mobile_special_keys_utils.ts';
      export * from './monaco_editor/editor_mobile_ctrl_helper_utils.ts';
      export * from './src/mobile-input/editor-special-key-bridge.ts';`,
    resolveDir: process.cwd(), sourcefile: 'palette-test.ts',
  }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  const win = new Window();
  Object.defineProperty(win.navigator, 'userAgent', { value: mobile ? 'Mozilla Android Mobile' : 'Desktop' });
  Object.assign(globalThis, { window: win, document: win.document, KeyboardEvent: win.KeyboardEvent, CustomEvent: win.CustomEvent, Event: win.Event, HTMLElement: win.HTMLElement });
  document.body.innerHTML = '<div class="fe-root"><div class="fe-editor-container"><div id="editor-frame"><div id="editor"><textarea class="inputarea"></textarea></div></div></div></div>';
  const dom = document.getElementById('editor'), input = dom.querySelector('textarea');
  const commands = [], typed = [];
  const editor = { getDomNode: () => dom, focus: () => input.focus(), trigger: (_source, _command, payload) => typed.push(payload.text),
    getAction: id => ({ run() {
      commands.push(id);
      let widget = document.querySelector('.quick-input-widget');
      if (!widget) { widget = document.createElement('div'); widget.className = 'quick-input-widget'; widget.innerHTML = '<input>'; document.body.append(widget); }
      widget.querySelector('input').focus();
    } }),
  };
  const binding = runtime.bindMobileEditorSpecialKeys(editor, win);
  input.focus();
  const press = title => {
    const button = [...document.querySelectorAll('button')].find(e => e.title === title);
    assert.ok(button, title);
    const event = new win.Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 } });
    button.dispatchEvent(event);
  };
  return { win, runtime, editor, input, commands, typed, press, cleanup() { binding?.dispose(); runtime.clearVendoredCtrlHelper(editor); win.happyDOM.abort(); } };
}

test('one-shot Shift composes with Ctrl bytes, opens palette, and keeps palette focus', async () => {
  const f = await fixture();
  try {
    const append = document.head.appendChild.bind(document.head);
    document.head.appendChild = element => {
      if (element.tagName === 'SCRIPT') { queueMicrotask(() => element.onload(new f.win.Event('load'))); return element; }
      return append(element);
    };
    await f.runtime.rebindVendoredCtrlHelper(f.editor, {});
    f.press('Shift next key'); f.press('Control');
    assert.equal(f.runtime.currentMobileEditorModifiers(f.win).shiftArmed, true);
    f.win.term.input('\u0010');
    assert.deepEqual(f.commands, ['editor.action.te2QuickAccess']);
    assert.equal(f.runtime.currentMobileEditorModifiers(f.win).shiftArmed, false);
    const palette = document.querySelector('.quick-input-widget input');
    palette.value = 'find'; palette.setSelectionRange(4, 4);
    f.runtime.dispatchMobileEditorKey(f.editor, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, f.win);
    assert.equal(document.activeElement, palette);
    assert.equal(palette.selectionStart, 3);
    let enter = false;
    palette.addEventListener('keydown', e => { if (e.key === 'Enter') enter = true; });
    palette.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(enter, true);
    assert.equal([...document.querySelectorAll('button')].some(button => button.title === 'Enter'), false);
    assert.deepEqual(f.typed, []);
    f.input.focus(); f.press('Shift next key'); f.press('Control');
    f.win.term.input('\u000f');
    assert.deepEqual(f.commands, ['editor.action.te2QuickAccess', 'editor.action.quickOutline']);
    assert.equal(f.runtime.currentMobileEditorModifiers(f.win).shiftArmed, false);
  } finally { f.cleanup(); }
});

test('Shift affects committed text once, leaves composition alone and Sel stays sticky', async () => {
  const f = await fixture();
  try {
    f.press('Shift next key');
    const composing = new f.win.InputEvent('beforeinput', { bubbles: true, cancelable: true, isComposing: true, inputType: 'insertCompositionText', data: 'a' });
    f.input.dispatchEvent(composing);
    assert.equal(composing.defaultPrevented, false); assert.deepEqual(f.typed, []);
    assert.equal(f.runtime.currentMobileEditorModifiers(f.win).shiftArmed, true);
    f.input.dispatchEvent(new f.win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'a' }));
    assert.deepEqual(f.typed, ['A']);
    assert.equal(f.runtime.currentMobileEditorModifiers(f.win).shiftArmed, false);
    f.press('Toggle selection (Shift)'); f.press('Shift next key'); f.press('Tab');
    const state = f.runtime.currentMobileEditorModifiers(f.win);
    assert.equal(state.shift, true); assert.equal(state.shiftArmed, false);
  } finally { f.cleanup(); }
});

test('desktop Ctrl+Shift+P/O use existing actions, without mobile controls', async () => {
  const f = await fixture(false);
  try {
    for (const key of ['p', 'o']) {
      f.input.focus();
      f.input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    }
    assert.deepEqual(f.commands, ['editor.action.te2QuickAccess', 'editor.action.quickOutline']);
    assert.equal(document.querySelector('.te2-mobile-special-key-panel'), null);
  } finally { f.cleanup(); }
});

test('Ctrl+colon opens unprefixed access but plain colon, Ctrl+semicolon and composition are untouched', async () => {
  const f = await fixture(false);
  try {
    for (const options of [
      { key: ':', ctrlKey: false },
      { key: ';', ctrlKey: true },
      { key: ':', ctrlKey: true, altKey: true },
      { key: ':', ctrlKey: true, isComposing: true },
    ]) {
      f.input.focus();
      const event = new f.win.KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      f.input.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    }
    assert.deepEqual(f.commands, []);
    f.input.focus();
    const event = new f.win.KeyboardEvent('keydown', { key: ':', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    f.input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.commands, ['editor.action.te2QuickAccess']);
    assert.equal(document.activeElement.closest('.quick-input-widget') !== null, true);
  } finally { f.cleanup(); }
});

test('bootstrap action reuses the empty-prefix provider and leaves stock prefixed actions intact', async () => {
  const script = await readFile('../../../scripts/build_monaco_bootstrap_bundle.mjs', 'utf8');
  const actionSource = script.slice(script.indexOf('class Te2QuickAccessAction'), script.indexOf('let languageContributionsPromise'));
  let action;
  const KeyCode = { F1: 59, KeyP: 46, Semicolon: 85 };
  const KeyMod = { CtrlCmd: 2048, Shift: 1024 };
  const serviceId = {};
  const focus = {};
  vm.runInNewContext(actionSource, {
    monacoNs: { KeyCode, KeyMod }, EditorContextKeys: { focus }, IQuickInputService: serviceId,
    EditorAction: class { constructor(options) { this.options = options; } },
    registerEditorAction: Action => { action = new Action(); },
  });
  assert.equal(action.options.id, 'editor.action.te2QuickAccess');
  assert.equal(action.options.kbOpts.primary, KeyCode.F1);
  assert.equal(action.options.kbOpts.kbExpr, focus);
  assert.deepEqual([...action.options.kbOpts.secondary], [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Semicolon]);
  assert.equal(action.options.kbOpts.weight, 101);
  const shown = [];
  action.run({ get(id) { assert.equal(id, serviceId); return { quickAccess: { show: prefix => shown.push(prefix) } }; } });
  assert.deepEqual(shown, ['']);
  for (const [file, prefix] of [['standaloneCommandsQuickAccess.js', 'StandaloneCommandsQuickAccessProvider.PREFIX'], ['standaloneGotoSymbolQuickAccess.js', 'AbstractGotoSymbolQuickAccessProvider.PREFIX'], ['standaloneGotoLineQuickAccess.js', 'StandaloneGotoLineQuickAccessProvider.PREFIX']]) {
    const stock = await readFile(`../../static/vendor/monaco-editor-core/esm/vs/editor/standalone/browser/quickAccess/${file}`, 'utf8');
    assert.ok(stock.includes(`quickAccess.show(${prefix}`));
  }
});
