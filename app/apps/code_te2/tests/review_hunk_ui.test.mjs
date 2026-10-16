import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
const built = await build({ stdin: { contents: `export * from './src/explorer/search/review-results-renderer.ts'; export * from './monaco_editor/editor_save_mirror_socket_handlers.ts'; export { EDITOR_RPC_NOTIFICATIONS } from './monaco_editor/editor_rpc_contract.ts';`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const hash = text => createHash('sha256').update(text).digest('hex');

test('Revert hunk confirms and sends the captured backend item identity without opening the file', async () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  const calls = [];
  win.teUI = { dialog: { confirm: async () => true } };
  try {
    const renderer = api.createExplorerReviewResultsRenderer({ revertHunk: async (...args) => calls.push(args), toast() {}, openFileAndMaybeJump: async () => { throw Error('must not open'); } });
    const root = document.createElement('div'); document.body.append(root);
    renderer.renderReviewResults(root, { results: [{ rel: 'a.py', identity: 'server-receipt', has_draft: true,
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [{ type: 'context', text: 'before' }, { type: 'add-draft', text: 'changed' }] }] }] });
    const button = [...root.querySelectorAll('button')].find(node => node.textContent === 'Revert hunk');
    win.teUI.dialog.confirm = async () => false;
    await button.onclick({ stopPropagation() {} });
    assert.deepEqual(calls, []);
    assert.equal(button.disabled, false);
    win.teUI.dialog.confirm = async () => true;
    await button.onclick({ stopPropagation() {} });
    assert.deepEqual(calls, [['a.py', 'server-receipt', 0]]);
    assert.equal(button.disabled, true);
    assert.ok(root.querySelector('.is-context'));
  } finally { win.happyDOM.abort(); }
});

test('conditional draft mirror applies even during hot window only when current model matches expected content', () => {
  const notifications = new Map();
  let text = 'current draft';
  let applied = 0;
  const intelligence = [];
  const model = { getValue: () => text, getFullModelRange: () => ({}), applyEdits: edits => { text = edits[0].text; applied++; } };
  api.registerEditorSaveMirrorSocketHandlers({}, {
    onGuardedDraftApplied: (...args) => intelligence.push(args),
    rpcNotifications: { onNotification: (name, fn) => notifications.set(name, fn) },
    getCurrentPath: () => '/project/review-mirror-test.py', getModel: () => model,
    getClientInstanceId: () => 'client', getLastContentSha256: () => null,
    getLastLocalEditAt: () => Date.now(), getMirrorHotWindowMs: () => 99999,
    incrementMirrorState() {}, syncMirrorDebug() {}, setApplyingRemote() {},
    setLastContentSha256() {}, applyLineNumberSizing() {}, setUnsavedTrace() {}, emitToHost() {},
    requestDraftDiff() {}, clearDraftDiffDecorations() {},
  });
  const receive = notifications.get(api.EDITOR_RPC_NOTIFICATIONS.mirrorUpdated);
  receive({ path: '/project/review-mirror-test.py', content: 'reverted draft', expected_content_sha256: hash(text),
    content_sha256: hash('reverted draft'), document_revision: 10, unsaved: true });
  assert.equal(applied, 1);
  assert.deepEqual(intelligence, [['/project/review-mirror-test.py', 'reverted draft']]);
  text = 'newer unpublished edit';
  receive({ path: '/project/review-mirror-test.py', content: 'stale revert', expected_content_sha256: hash('reverted draft'),
    content_sha256: hash('stale revert'), document_revision: 11, unsaved: true });
  assert.equal(applied, 1);
  assert.equal(text, 'newer unpublished edit');
  assert.equal(intelligence.length, 1);
});

test('Explorer overlay chrome, checkbox tree and captured multi-hunk save/revert', async () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  const calls = [], saves = [];
  win.teUI = { dialog: { confirm: async () => true } };
  try {
    const renderer = api.createExplorerReviewResultsRenderer({ revertHunks: async (...args) => calls.push(args),
      saveHunks: async (...args) => { saves.push(args); return {diskSaved:true, draftReconciled:true}; },
      hasExplorerRpc: () => true, notifyExplorer: (...args) => saves.push(args), toast() {},
      openFileAndMaybeJump: async () => { throw Error('header must not navigate'); } });
    const root = document.createElement('div'); document.body.append(root);
    const entry = { rel: 'src/a.py', identity: 'receipt', has_draft: true,
      hunks: [1, 20, 40].map(n => ({oldStart:n, newStart:n, lines:[{type:'add-draft', text:'changed'}]})) };
    const render = value => renderer.renderReviewResults(root, {results:[value]});
    render(entry);
    const parent = root.querySelector('.fe-search-file-header input');
    const children = [...root.querySelectorAll('.fe-search-hunk-header-row input')];
    assert.equal(children.length, 3);
    parent.click();
    assert.ok(children.every(check => check.checked));
    children[1].click();
    assert.equal(parent.checked, false);
    assert.equal(parent.indeterminate, true);
    const save = [...root.querySelectorAll('button')].find(node => node.textContent === 'Save Selected');
    assert.equal(save.disabled, false);
    const group = root.querySelector('.fe-review-group');
    render(entry);
    assert.equal(root.querySelector('.fe-review-group'), group);
    assert.equal(parent.indeterminate, true);
    const toggle = root.querySelector('.fe-search-change-toggle');
    toggle.click(); assert.equal(root.querySelector('.fe-search-change-body').hidden, true);
    toggle.click(); assert.equal(root.querySelector('.fe-search-change-body').hidden, false);
    const hunk = root.querySelector('.fe-search-hunk-toggle');
    hunk.click(); assert.equal(root.querySelector('.fe-search-diff-rows').hidden, true);
    hunk.click(); assert.equal(root.querySelector('.fe-search-diff-rows').hidden, false);
    const revert = [...root.querySelectorAll('button')].find(node => node.textContent === 'Revert Selected');
    await revert.onclick();
    assert.deepEqual(calls, [['src/a.py', 'receipt', [0, 2]]]);
    render({...entry, identity:'new receipt'});
    assert.ok([...root.querySelectorAll('input')].every(check => !check.checked && !check.indeterminate));
    root.querySelector('.fe-search-file-header input').click();
    const newSave = [...root.querySelectorAll('button')].find(node => node.textContent === 'Save Selected');
    assert.equal(newSave.disabled, false);
    await newSave.onclick();
    assert.deepEqual(saves[0], ['src/a.py', 'new receipt', [0, 1, 2]]);
  } finally { win.happyDOM.abort(); }
});

test('partial Save sends only selected indexes; new files retain whole-file Save', async () => {
  const win = new Window();
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement });
  const calls = [];
  try {
    const renderer = api.createExplorerReviewResultsRenderer({hasExplorerRpc: () => true, toast() {},
      saveHunks: async (...args) => { calls.push(args); return {diskSaved:true, draftReconciled:true}; },
      saveFiles: async files => { calls.push(files); return {saved_count:1}; } });
    const root = document.createElement('div'); document.body.append(root);
    const entry = {rel:'a.py', identity:'receipt', has_draft:true, diskExists:true,
      hunks:[1,20].map(n => ({oldStart:n,newStart:n,lines:[{type:'add-draft',text:'x'}]}))};
    renderer.renderReviewResults(root,{results:[entry]});
    root.querySelector('[data-hunk-index="1"]').click();
    const save = () => [...root.querySelectorAll('button')].find(node => node.textContent === 'Save Selected');
    await save().onclick();
    assert.deepEqual(calls, [['a.py','receipt',[1]]]);
    renderer.renderReviewResults(root,{results:[{...entry,identity:'newfile',diskExists:false}]});
    root.querySelector('[data-hunk-index="0"]').click();
    assert.equal(save().disabled,true);
    root.querySelector('.fe-search-file-header input').click();
    assert.equal(save().disabled,false);
    await save().onclick();
    assert.deepEqual(calls[1],['a.py']);
  } finally { win.happyDOM.abort(); }
});

test('guarded metadata-only save advances editor base without replacing text or publishing a WBA edit', () => {
  const notifications = new Map(), bases = [], unsaved = [];
  const text = 'unchanged full draft', digest = hash(text);
  api.registerEditorSaveMirrorSocketHandlers({}, {
    rpcNotifications:{onNotification:(name,fn) => notifications.set(name,fn)},
    getCurrentPath:() => '/project/partial-save.py', getModel:() => ({getValue:() => text}),
    getClientInstanceId:() => 'client', getLastContentSha256:() => digest,
    setBaseSha256:value => bases.push(value), setLastContentSha256() {},
    getLastLocalEditAt:() => Date.now(), getMirrorHotWindowMs:() => 99999,
    incrementMirrorState() {}, syncMirrorDebug() {}, emitToHost() {},
    setUnsavedTrace:(_, value) => unsaved.push(value), requestDraftDiff() {}, clearDraftDiffDecorations() {},
    onGuardedDraftApplied:() => {throw Error('metadata is not a text edit');},
  });
  const receive = notifications.get(api.EDITOR_RPC_NOTIFICATIONS.mirrorUpdated);
  receive({path:'/project/partial-save.py',content:text,expected_content_sha256:digest,
    content_sha256:digest,base_sha256:hash('new disk'),unsaved:true,document_revision:1});
  assert.deepEqual(bases,[hash('new disk')]);
  assert.deepEqual(unsaved,[true]);
  receive({path:'/project/partial-save.py',content:text,expected_content_sha256:digest,
    content_sha256:digest,base_sha256:digest,unsaved:false,document_revision:2});
  assert.deepEqual(unsaved,[true,false]);
});
