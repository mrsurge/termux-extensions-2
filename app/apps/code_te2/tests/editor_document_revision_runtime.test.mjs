import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { Window } from 'happy-dom';

const appRoot = path.resolve(import.meta.dirname, '..');
let moduleSequence = 0;

async function importTypeScript(relativePath) {
  const result = await build({
    entryPoints: [path.join(appRoot, relativePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleSequence++}`;
  return import(url);
}

test('document revision runtime accepts equal/newer projections and rejects stale or unfenced state', async () => {
  const runtime = await importTypeScript('monaco_editor/editor_document_revision_runtime.ts');
  runtime.resetDocumentRevisionRuntime();

  assert.equal(runtime.acceptDocumentProjection('/project/a.py', 2), true);
  assert.equal(runtime.acceptDocumentProjection('/project/a.py', 2), true);
  assert.equal(runtime.acceptDocumentProjection('/project/a.py', 1), false);
  assert.equal(runtime.acceptDocumentProjection('/project/a.py', undefined), false);
  assert.equal(runtime.acceptDocumentProjection('/project/b.py', 0), true);
  assert.equal(runtime.currentDocumentRevision('/project/a.py'), 2);
  assert.equal(runtime.isCurrentDocumentProjection('/project/a.py', 2), true);

  runtime.resetDocumentRevisionRuntime();
  assert.equal(runtime.currentDocumentRevision('/project/a.py'), null);
});

test('boot snapshot materializes only a revision-fenced client file', async () => {
  const runtime = await importTypeScript('monaco_editor/editor_boot_snapshot_runtime.ts');
  const state = {
    snapshot: {
      editor_ssot: {
        currentPath: '/project/a.py',
        file: {
          path: '/project/a.py',
          content: 'revision two',
          content_sha256: 'content-two',
          base_sha256: 'base-two',
          document_revision: 2,
        },
      },
    },
    model: null,
    currentPath: null,
    created: [],
  };
  const deps = {
    getBootSnapshot: () => state.snapshot,
    getCachedPrefs: () => null,
    setCachedPrefs() {},
    getCurrentPath: () => state.currentPath,
    setCurrentPath: (value) => { state.currentPath = value; },
    getBaseSha256: () => null,
    setBaseSha256() {},
    getLastContentSha256: () => null,
    setLastContentSha256() {},
    getModel: () => state.model,
    setModel: (value) => { state.model = value; },
    createFileModel: (content, languageId, path) => {
      const model = { content, languageId, path };
      state.created.push(model);
      return model;
    },
    applyLanguageToModel() {},
    languageFromPath: () => 'python',
  };

  runtime.applyBootSnapshotToEditor(deps);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].content, 'revision two');

  state.model = null;
  state.snapshot.editor_ssot.file = {
    ...state.snapshot.editor_ssot.file,
    content: 'delayed revision one',
    document_revision: 1,
  };
  runtime.applyBootSnapshotToEditor(deps);
  assert.equal(state.created.length, 1);
});

test('mirror handler rejects delayed content and compares self source with stable client identity', async () => {
  const { registerEditorSaveMirrorSocketHandlers } = await importTypeScript(
    'monaco_editor/editor_save_mirror_socket_handlers.ts',
  );
  const handlers = new Map();
  const state = {
    content: 'initial',
    baseSha: null,
    contentSha: null,
    applying: false,
    unsaved: null,
  };
  const metrics = new Map();
  const model = {
    getValue: () => state.content,
    getFullModelRange: () => ({ startLineNumber: 1 }),
    applyEdits: (edits) => {
      state.content = edits[0].text;
    },
  };
  const notifications = {
    onNotification(method, handler) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
  };

  registerEditorSaveMirrorSocketHandlers(
    { on() {} },
    {
      rpcNotifications: notifications,
      getCurrentPath: () => '/project/a.py',
      getModel: () => model,
      getBaseSha256: () => state.baseSha,
      setBaseSha256: (value) => { state.baseSha = value; },
      getLastContentSha256: () => state.contentSha,
      setLastContentSha256: (value) => { state.contentSha = value; },
      getLastLocalEditAt: () => 0,
      getMirrorHotWindowMs: () => 0,
      getClientInstanceId: () => 'client_aaaaaaaaaaaa',
      setApplyingRemote: (value) => { state.applying = value; },
      applyLineNumberSizing() {},
      emitToHost() {},
      setUnsavedTrace: (_reason, value) => { state.unsaved = value; },
      requestDraftDiff() {},
      clearDraftDiffDecorations() {},
      getAutoSave: () => false,
      requestGitBaselines() {},
      incrementMirrorState(metric) {
        metrics.set(metric, (metrics.get(metric) ?? 0) + 1);
      },
      syncMirrorDebug() {},
    },
  );

  const mirror = handlers.get('editor.mirror.updated');
  assert.equal(typeof mirror, 'function');
  mirror({
    path: '/project/a.py',
    content: 'revision two',
    source_client: 'client_bbbbbbbbbbbb',
    document_revision: 2,
    unsaved: true,
  });
  assert.equal(state.content, 'revision two');

  mirror({
    path: '/project/a.py',
    content: 'delayed revision one',
    source_client: 'client_bbbbbbbbbbbb',
    document_revision: 1,
    unsaved: true,
  });
  assert.equal(state.content, 'revision two');

  mirror({
    path: '/project/a.py',
    content: 'self revision three',
    source_client: 'client_aaaaaaaaaaaa',
    document_revision: 3,
    unsaved: true,
  });
  assert.equal(state.content, 'revision two');
  assert.equal(metrics.get('drop_self'), 1);
});

test('host chrome accepts only the current client path and newest shared revision', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCustomEvent = globalThis.CustomEvent;
  const domWindow = new Window();
  globalThis.window = domWindow;
  globalThis.document = domWindow.document;
  globalThis.CustomEvent = domWindow.CustomEvent;
  try {
    const { createHostEditorEventsRuntime } = await importTypeScript(
      'main_page/frontend/host-editor-events-runtime.ts',
    );
    const applied = [];
    const issues = document.createElement('div');
    const runtime = createHostEditorEventsRuntime({
      applyCacheIndicator: (payload) => applied.push(payload),
      triggerExternalRefresh() {},
      applyAutosavePreference() {},
      setLastSha256() {},
      getCurrentPath: () => '/project/a.py',
      getRestoredSessionActive: () => false,
      setRestoredSessionActive() {},
      setRestoredSessionPath() {},
      issuesBadgesEl: issues,
      setIssuesButtonsEnabled() {},
      toast() {},
    });
    runtime.install();

    window.dispatchEvent(new window.CustomEvent('code-te2:editor-cache-state', {
      detail: {
        path: '/project/b.py',
        state: 'mid_session',
        unsaved: true,
        document_revision: 5,
      },
    }));
    window.dispatchEvent(new window.CustomEvent('code-te2:editor-cache-state', {
      detail: {
        path: '/project/a.py',
        state: 'mid_session',
        unsaved: true,
        document_revision: 2,
      },
    }));
    window.dispatchEvent(new window.CustomEvent('code-te2:editor-cache-state', {
      detail: {
        path: '/project/a.py',
        state: 'clean',
        unsaved: false,
        document_revision: 1,
      },
    }));

    assert.equal(applied.length, 1);
    assert.equal(applied[0].unsaved, true);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.CustomEvent = previousCustomEvent;
  }
});
