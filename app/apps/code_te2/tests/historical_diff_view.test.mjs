import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundle = await build({
  stdin: {
    contents: `export * from './monaco_editor/historical_diff_view.ts';
      export * from './main_page/frontend/secondary-history-content.ts';`,
    resolveDir: import.meta.dirname + '/..',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser',
});
const { mountHistoricalDiffView, parseSecondaryHistoryContent } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

function content() {
  return {
    kind: 'historicalDiff', revision: 1, projectPath: '/project', projectGeneration: 2,
    snapshotId: 'a'.repeat(64), commitId: 'b'.repeat(40), parentId: null, fileIndex: 0,
    original: { state: 'absent', path: null, id: null, text: null },
    modified: { state: 'text', path: 'file.py', id: 'c'.repeat(40), text: 'hello\n' },
  };
}

function harness(overrides = {}) {
  const window = new Window();
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const controller = new AbortController();
  const models = [];
  const controls = [];
  const calls = [];
  const options = {
    container, content: content(), signal: controller.signal,
    languageForPath: () => 'python',
    prepareSyntax: async (language, path) => { calls.push(['syntax', language, path]); },
    monaco: {
      Uri: { from: (value) => value },
      editor: {
        ShowLightbulbIconMode: { Off: 'off' },
        createModel(text, language, uri) {
          const model = { text, language, uri, disposed: 0, dispose() { this.disposed++; } };
          models.push(model);
          return model;
        },
        createDiffEditor(root, config) {
          const editor = {
            root, config, pair: null, disposed: 0,
            setModel(pair) { this.pair = pair; },
            dispose() { this.disposed++; },
            layout() { calls.push('layout'); },
            getOriginalEditor() { return { onDidFocusEditorWidget() { return { dispose() {} }; } }; },
            getModifiedEditor() { return {
              onDidFocusEditorWidget() { return { dispose() {} }; },
              focus() { calls.push('focus'); },
              trigger(source, command) { calls.push([source, command]); },
              getAction(id) { return { async run() { calls.push(id); } }; },
            }; },
          };
          controls.push(editor);
          return editor;
        },
      },
    },
    ...overrides,
  };
  return { window, container, controller, models, controls, calls, options };
}

test('historical special keys navigate but cannot dispatch mutations', async () => {
  const h = harness();
  const view = await mountHistoricalDiffView(h.options);
  const key = (value) => ({ key: value, code: '', keyCode: 0 });
  assert.equal(await view.specialKey(key('ArrowDown'), { ctrl: false, alt: false, shift: true }), true);
  assert.ok(h.calls.some(call => Array.isArray(call) && call[1] === 'cursorDownSelect'));
  assert.equal(await view.specialKey(key('f'), { ctrl: true, alt: false }), true);
  assert.ok(h.calls.includes('actions.find'));
  const length = h.calls.length;
  assert.equal(await view.specialKey(key('v'), { ctrl: true, alt: false }), false);
  assert.equal(h.calls.length, length);
  view.dispose();
});

test('strict content decoder rejects malformed identities, states and oversized UTF-8', () => {
  const valid = content();
  assert.deepEqual(parseSecondaryHistoryContent(valid), valid);
  for (const changes of [
    { kind: 'workingFile' }, { revision: -1 }, { fileIndex: 0.5 },
    { commitId: 'HEAD' }, { snapshotId: 'short' }, { projectGeneration: NaN },
    { original: valid.modified }, { modified: valid.original },
    { modified: { ...valid.modified, state: 'unknown' } },
    { modified: { ...valid.modified, text: 'é'.repeat(192001) } },
    { original: { ...valid.original, text: 'not absent' } },
  ]) assert.throws(() => parseSecondaryHistoryContent({ ...valid, ...changes }));
  assert.doesNotThrow(() => parseSecondaryHistoryContent({ ...valid,
    modified: { ...valid.modified, text: '' },
  }));
});

test('read-only diff owns isolated models, retains find, and disposes exactly once', async () => {
  const h = harness();
  const view = await mountHistoricalDiffView(h.options);
  assert.equal(h.models.length, 2);
  assert.equal(h.models[0].text, '');
  assert.equal(h.models[1].text, 'hello\n');
  assert.equal(h.models[1].language, 'python');
  assert.ok(h.models.every((model) => model.uri.scheme === 'te2-history'));
  assert.notEqual(h.models[0].uri.path, h.models[1].uri.path);
  const config = h.controls[0].config;
  assert.equal(config.readOnly, true);
  assert.equal(config.domReadOnly, true);
  assert.equal(config.originalEditable, false);
  assert.equal(config['semanticHighlighting.enabled'], false);
  assert.equal(config.inlayHints.enabled, 'off');
  assert.equal(config.renderValidationDecorations, 'off');
  view.focus(); view.layout(); await view.find();
  assert.ok(h.calls.includes('actions.find'));
  h.controller.abort(); view.dispose();
  assert.equal(h.controls[0].disposed, 1);
  assert.equal(h.controls[0].pair, null);
  assert.ok(h.models.every((model) => model.disposed === 1));
  assert.equal(h.container.children.length, 0);
  await h.window.happyDOM.close();
});

test('repeated views cannot collide and disposing one preserves the other', async () => {
  const h = harness();
  const first = await mountHistoricalDiffView(h.options);
  const second = await mountHistoricalDiffView(h.options);
  assert.notEqual(h.models[0].uri.authority, h.models[2].uri.authority);
  first.dispose();
  assert.equal(h.container.children.length, 1);
  assert.equal(h.models[2].disposed, 0);
  second.dispose();
  await h.window.happyDOM.close();
});

test('unavailable sides show status, not fabricated empty diff models', async () => {
  for (const state of ['binary', 'tooLarge', 'invalidUtf8', 'unsupported']) {
    const h = harness();
    h.options.content.modified = { ...h.options.content.modified, state, text: null };
    const view = await mountHistoricalDiffView(h.options);
    assert.equal(h.models.length, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.container.firstElementChild.getAttribute('role'), 'status');
    assert.ok(h.container.textContent.includes('file.py'));
    view.dispose();
    await h.window.happyDOM.close();
  }
});

test('abort during syntax preparation prevents late model creation', async () => {
  let complete;
  const h = harness({ prepareSyntax: () => new Promise((resolve) => { complete = resolve; }) });
  const mounting = mountHistoricalDiffView(h.options);
  h.controller.abort(); complete();
  await assert.rejects(mounting, { name: 'AbortError' });
  assert.equal(h.models.length, 0);
  assert.equal(h.container.children.length, 0);
  await h.window.happyDOM.close();
});

test('failed editor construction cleans up both models', async () => {
  const h = harness();
  h.options.monaco.editor.createDiffEditor = () => { throw new Error('failed'); };
  await assert.rejects(mountHistoricalDiffView(h.options), /failed/);
  assert.ok(h.models.every((model) => model.disposed === 1));
  assert.equal(h.container.children.length, 0);
  await h.window.happyDOM.close();
});

test('deleted files retain their original content and an absent modified side', async () => {
  const h = harness();
  const selected = content();
  selected.parentId = 'd'.repeat(40);
  selected.original = { ...selected.modified, path: 'old.py' };
  selected.modified = { state: 'absent', path: null, id: null, text: null };
  h.options.content = selected;
  const view = await mountHistoricalDiffView(h.options);
  assert.equal(h.models[0].text, 'hello\n');
  assert.equal(h.models[1].text, '');
  assert.ok(h.models[0].uri.path.endsWith('/old.py'));
  view.dispose();
  await h.window.happyDOM.close();
});

test('rename compares both pinned paths and installs lexical support for each', async () => {
  const h = harness();
  h.options.content.parentId = 'd'.repeat(40);
  h.options.content.original = { state: 'text', path: 'old.py', id: 'e'.repeat(40), text: 'old\n' };
  const view = await mountHistoricalDiffView(h.options);
  assert.equal(h.models[0].text, 'old\n');
  assert.equal(h.models[1].text, 'hello\n');
  assert.deepEqual(h.calls, [['syntax', 'python', 'old.py'], ['syntax', 'python', 'file.py']]);
  view.dispose();
  await h.window.happyDOM.close();
});

test('syntax preparation failure removes its mount without constructing models', async () => {
  const h = harness({ prepareSyntax: async () => { throw new Error('syntax failed'); } });
  await assert.rejects(mountHistoricalDiffView(h.options), /syntax failed/);
  assert.equal(h.models.length, 0);
  assert.equal(h.container.children.length, 0);
  await h.window.happyDOM.close();
});

test('pre-aborted and malformed requests never mount DOM', async () => {
  const h = harness();
  h.controller.abort();
  await assert.rejects(mountHistoricalDiffView(h.options), { name: 'AbortError' });
  h.options.content.commitId = 'HEAD';
  await assert.rejects(mountHistoricalDiffView(h.options), /hash/);
  assert.equal(h.container.children.length, 0);
  await h.window.happyDOM.close();
});
