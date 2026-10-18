import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { addProblemMentionAction } from '../../../../scripts/monaco_problem_mentions.mjs';

const source = readFileSync(new URL('../../../static/vendor/monaco-editor-core/esm/vs/editor/contrib/gotoError/browser/gotoErrorWidget.js', import.meta.url), 'utf8');
const transformed = addProblemMentionAction(source);
const built = await build({
  stdin: { contents: `
export * from './monaco_editor/editor_problem_mention_runtime.ts';
export * from './monaco_editor/editor_mention_request_runtime.ts';
export * from './monaco_editor/editor_ui_editor_runtime.ts';
export * from './src/diagnostics/diagnostic-mention.ts';
export * from './src/diagnostics/problems-panel.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=problem_mentions.test.bundle.mjs').toString('base64')}`);
const marker = { severity: 8, message: 'Unknown binding', source: 'rust-analyzer',
  code: { value: 'E0425' }, startLineNumber: 8, startColumn: 3, endLineNumber: 9, endColumn: 6 };

function fixture() {
  const window = new Window();
  const node = window.document.createElement('div');
  let view = window.document.createElement('div');
  node.appendChild(view);
  let current = { uri: { fsPath: '/project/test.rs' }, getVersionId: () => version, isDisposed: () => disposed };
  let projected = current, version = 1, disposed = false, path = '/project/test.rs';
  const callbacks = [], sent = [], actions = [];
  const editor = {
    getDomNode: () => view, getContainerDomNode: () => node, getModel: () => current,
    onDidDispose(callback) { callbacks.push(callback); return { dispose() {} }; },
    getPosition: () => null, revealPositionNearTop() {}, focus() {},
  };
  const deps = { getModel: () => projected, getCurrentPath: () => path,
    sendEditorMentionRequest(payload) { sent.push(payload); return true; } };
  const context = {
    PeekViewWidget: class { _fillHead() {} show() {} _relayout() {} },
    MenuId: class {}, getFlatActionBarActions: () => [],
    Te2MentionAction: class {
      constructor(id, label, css, enabled, run) { Object.assign(this, { id, label, css, enabled, run }); }
      dispose() { this.disposed = true; }
    },
    Range: { lift: m => ({ getStartPosition: () => ({ lineNumber: m.startLineNumber, column: m.startColumn }) }) },
    nls: { localize: () => '' }, basename: () => 'test.rs',
    SeverityIcon: { className: () => '' }, MarkerSeverity: { toSeverity: n => n },
  };
  const start = transformed.indexOf('let MarkerNavigationWidget = class');
  const end = transformed.indexOf('MarkerNavigationWidget = MarkerNavigationWidget_1 = __decorate(');
  const Widget = vm.runInNewContext('var MarkerNavigationWidget_1;\n' + transformed.slice(start, end) + '\nMarkerNavigationWidget;', context);
  const widget = Object.create(Widget.prototype);
  Object.assign(widget, {
    editor, _contextKeyService: {}, _menuService: { getMenuActions: () => [] },
    _disposables: { add: value => value },
    _actionbarWidget: { actionRunner: { onWillRun: () => ({ dispose() {} }) },
      push: action => { if (!Array.isArray(action)) actions.push(action); } },
    _container: window.document.createElement('div'), _message: { update() {}, getHeightInLines: () => 1 },
    _themeService: { getColorTheme: () => ({}) }, _applyTheme() {}, _icon: {}, setTitle() {},
  });
  widget._fillHead(node);
  return { window, node, editor, deps, widget, action: actions[0], sent,
    version() { version++; }, disposeModel() { disposed = true; },
    switchModel() { current = { ...current }; }, mismatchProjection() { projected = {}; },
    replaceView() { const next = window.document.createElement('div'); view.replaceWith(next); view = next; },
    switchPath() { path = '/project/other.rs'; }, disposeEditor() { callbacks.forEach(fn => fn()); } };
}

test('pinned widget adapter refuses upstream drift or double application', () => {
  assert.throws(() => addProblemMentionAction(source.replace('showAtMarker(marker, markerIdx, markerCount)', 'showOtherMarker(marker)')), /Pinned Problems widget changed/);
  assert.throws(() => addProblemMentionAction(transformed), /Pinned Problems widget changed/);
});

test('real widget action sends its displayed diagnostic, not the editor selection', () => {
  const f = fixture();
  const runtime = api.createEditorUiEditorRuntime({ ...f.deps, getMonaco: () => null });
  runtime.installMarkerNavBindings(f.editor);
  assert.equal(f.action.enabled, false);
  f.widget.showAtMarker(marker, 1, 1);
  assert.equal(f.action.enabled, true);
  f.action.run();
  assert.deepEqual(f.sent, [{ path: '/project/test.rs', lineNo: 8, col: 3, endLineNo: 9, endCol: 6,
    content: '[error] E0425: Unknown binding (rust-analyzer)' }]);
  f.widget.updateMarker({ ...marker, severity: 4, message: 'New diagnostic', code: 0 });
  f.action.run();
  assert.equal(f.sent[1].content, '[warning] 0: New diagnostic (rust-analyzer)');
});

test('stale peek clears intent and a fresh marker can enable it again', () => {
  const f = fixture(); api.installProblemMentionBinding(f.editor, f.deps);
  f.widget.showAtMarker(marker, 1, 1);
  f.widget.showStale(); f.action.run();
  assert.equal(f.action.enabled, false); assert.equal(f.sent.length, 0);
  f.widget.updateMarker(marker); f.action.run();
  assert.equal(f.action.enabled, true); assert.equal(f.sent.length, 1);
});

test('model view replacement retains the real widget-to-editor mention listener', () => {
  const f = fixture(); api.installProblemMentionBinding(f.editor, f.deps);
  f.replaceView();
  api.installProblemMentionBinding(f.editor, f.deps);
  f.widget.showAtMarker(marker, 1, 1); f.action.run();
  assert.equal(f.sent.length, 1);
  f.disposeEditor(); f.action.run(); assert.equal(f.sent.length, 1);
});

test('shared editor sender reports acknowledged success and failure without replay', async () => {
  for (const outcome of ['success', 'reject', 'disconnected', 'no_target', 'error']) {
    const toasts = [], requests = [];
    const send = api.createEditorMentionSender({
      isConnected: () => outcome !== 'disconnected',
      buildTargetedPayload(payload) {
        if (outcome === 'no_target') throw new Error('no target');
        return { ...payload, target: { clientId: 'exact-client' } };
      },
      async request(payload) {
        requests.push(payload);
        if (outcome === 'error') throw new Error('disconnected');
        return { ok: outcome !== 'reject' };
      }, toast: message => toasts.push(message),
    });
    const accepted = send({ path: '/test' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(accepted, !['disconnected', 'no_target'].includes(outcome));
    assert.equal(requests.length, accepted ? 1 : 0);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0] === 'Mentioned in conversation', outcome === 'success');
    if (accepted) assert.equal(requests[0].target.clientId, 'exact-client');
  }
});

test('inline diff binds only the modified editor through the existing setup path', () => {
  const f = fixture(); const original = fixture(); const oldWindow = globalThis.window;
  globalThis.window = f.window;
  try {
    const runtime = api.createEditorUiEditorRuntime({ ...f.deps,
      getEditor: () => original.editor,
      getDiffEditor: () => ({ getModifiedEditor: () => f.editor }),
    });
    runtime.ensureTouchSelection('diff');
    f.widget.showAtMarker(marker, 1, 1); f.action.run();
    original.widget.showAtMarker(marker, 1, 1); original.action.run();
    assert.equal(f.sent.length, 1); assert.equal(original.sent.length, 0);
  } finally { globalThis.window = oldWindow; }
});

test('version/model/path/projection/disposal fences reject late actions', () => {
  for (const change of ['version', 'switchModel', 'switchPath', 'mismatchProjection', 'disposeModel', 'disposeEditor']) {
    const f = fixture(); api.installProblemMentionBinding(f.editor, f.deps);
    f.widget.showAtMarker(marker, 1, 1); f[change](); f.action.run();
    assert.equal(f.sent.length, 0, change);
  }
});

test('binding is unique and malformed local widget events are rejected', () => {
  const f = fixture();
  api.installProblemMentionBinding(f.editor, f.deps); api.installProblemMentionBinding(f.editor, f.deps);
  f.widget.showAtMarker(marker, 1, 1); f.action.run();
  assert.equal(f.sent.length, 1);
  for (const invalid of [null, {}, { ...marker, startLineNumber: -1 }, { ...marker, endLineNumber: 1 },
    { ...marker, source: {} }, { ...marker, code: { value: {} } }]) {
    f.node.dispatchEvent(new f.window.CustomEvent('te2:problem-mention', {
      detail: { model: f.editor.getModel(), version: 1, marker: invalid },
    }));
  }
  assert.equal(f.sent.length, 1);
});

test('Explorer diagnostic rows retain the same mention format as inline peek', () => {
  const f = fixture(); const oldDocument = globalThis.document;
  globalThis.document = f.window.document;
  try {
    f.node.id = 'problems-container'; f.window.document.body.appendChild(f.node);
    const panel = api.createProblemsPanel({ onMention: payload => f.sent.push(payload) });
    panel.update({ '/project/test.rs': [marker] });
    f.node.querySelector('.problems-mention-btn').click();
    assert.deepEqual(f.sent[0], api.buildDiagnosticMention('/project/test.rs', marker));
    panel.destroy();
  } finally { globalThis.document = oldDocument; }
});
