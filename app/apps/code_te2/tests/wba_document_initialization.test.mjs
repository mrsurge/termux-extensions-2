import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { WorkbenchDocumentRegistry } from '../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/document-registry.mjs';

// Execute the built WorkbenchClient, replacing only its two external connection
// constructors. Registry, connect barrier, initialize and open wrapper are real.
const entry = fileURLToPath(new URL('../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs', import.meta.url));
const built = await build({ entryPoints: [entry], write: false, bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) },
  plugins: [{ name: 'connection-fixtures', setup(builder) {
    builder.onResolve({ filter: /^\.\// }, args => {
      if (args.importer !== entry) return;
      if (args.path === './management.mjs' || args.path === './extension-host.mjs') {
        return { path: args.path, namespace: 'connection-fixture' };
      }
      return { path: pathToFileURL(path.resolve(args.resolveDir, args.path)).href, external: true };
    });
    builder.onLoad({ filter: /.*/, namespace: 'connection-fixture' }, args => ({ contents:
      args.path.includes('management')
        ? 'export const discoverServerRootPath = () => {}; export const commitFromServerRootPath = () => {}; export const loadProductVersionFromAppRoot = () => {}; export async function connectManagementSession(runtime, params) { return globalThis.__initializationConnections.management(runtime, params); }'
        : 'export async function connectExtensionHostSession(runtime, params) { return globalThis.__initializationConnections.extension(runtime, params); }', loader: 'js' }));
  } }],
});
let WorkbenchClient;
try {
  ({ WorkbenchClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`));
} catch (error) {
  // Avoid dumping a complete in-memory module URL in test failures.
  throw new Error(String(error.message).replace(/data:[^ ]+/g, '<in-memory module>'));
}

function fixture() {
  const client = Object.create(WorkbenchClient.prototype);
  const events = [];
  const registry = new WorkbenchDocumentRegistry({
    extRpcIds: { ExtHostDocumentsAndEditors: 1, ExtHostDocuments: 2, ExtHostEditorTabs: 3 },
    uriToString: uri => uri.external,
    uriForPath: path => ({ path, scheme: 'file', external: `file://${path}` }),
    workspacePath: () => '/workspace', resolveLanguageId: () => 'python',
    sendExt(_id, method, args) { events.push({ method, args: structuredClone(args) }); },
    sendExtAwaitTerminalReply() { throw new Error('initialization must not wait for a language ACK'); },
    activateLanguage: async () => {}, isPathClientForeground: () => false,
    isPathProjectedForeground: () => false, log() {},
  });
  Object.assign(client, {
    _documentInitializationEpoch: 0, _documentRegistry: registry,
    _resetSessionCaches() { registry.clearLocal(); },
    _managementRuntime() {}, _extensionHostRuntime() {},
    _activateInitializedDocuments() {},
    _startupMark(phase) { events.push({ phase }); },
    _webviews: { activatePrimaryViews: async () => {} },
    _openFilePending: 0, _openingPaths: new Map(),
    _completionWarmup: { notify() {} }, _completionReadyPaths: new Set(),
    _documentContentRuntime() { return {
      extConnected: () => true, documentRegistry: registry,
      readTextFile() { throw new Error('extension open must not bypass the initial draft'); },
    }; },
    async _runWithClientEditorFacade(params) {
      assert.ok(registry.getByPath(params.path), 'open ran before backend initialization');
      events.push({ phase: 'attach' });
      return { ok: true };
    },
  });
  const text = 'import msgspec  # ty: ignore[unresolved-import]\n';
  const sha = createHash('sha256').update(text).digest('hex');
  const initialDocuments = { projectPath: '/workspace', projectGeneration: 1, openStateRevision: 1,
    documents: [{ path: '/workspace/codec.py', text, contentSha256: sha,
      contentIdentity: `sha256:${sha}`, baseSha256: null, dirty: true }] };
  return { client, registry, events, initialDocuments, text };
}

test('actual connect initializes the draft before connect ACK and any waiting foreground open', async () => {
  const f = fixture();
  let release;
  const network = new Promise(resolve => { release = resolve; });
  globalThis.__initializationConnections = { management: async () => ({}), extension: async () => { await network; return { ok: true }; } };
  try {
    const connected = f.client.connect({ initialDocuments: f.initialDocuments });
    const opening = f.client.openFile({ path: '/workspace/codec.py', clientInstanceId: 'client_test', generation: 1 });
    const extensionOpening = f.client._tryOpenDocument({ path: '/workspace/codec.py', scheme: 'file', external: 'file:///workspace/codec.py' });
    await Promise.resolve();
    assert.equal(f.registry.size, 0);
    assert.equal(f.events.some(event => event.phase === 'attach'), false);
    release();
    await connected;
    await opening;
    await extensionOpening;
    const delta = f.events.find(event => event.method === '$acceptDocumentsAndEditorsDelta');
    assert.equal(delta.args[0].addedDocuments[0].lines.join('\n'), f.text);
    assert.equal(delta.args[0].addedDocuments[0].isDirty, true);
    assert.ok(f.events.indexOf(delta) < f.events.findIndex(event => event.phase === 'connect.ready'));
    assert.equal(f.events.filter(event => event.method === '$acceptModelChanged').length, 0);
  } finally { delete globalThis.__initializationConnections; }
});

test('a failed or superseded connect cannot fall back to disk or attach a stale document', async () => {
  const f = fixture();
  globalThis.__initializationConnections = { management: async () => ({}), extension: async () => { throw new Error('connection failed'); } };
  try {
    await assert.rejects(f.client.connect({ initialDocuments: f.initialDocuments }), /connection failed/);
    await assert.rejects(f.client.openFile({ path: '/workspace/codec.py' }), /connection failed/);
    assert.equal(f.registry.size, 0);
    let release;
    const network = new Promise(resolve => { release = resolve; });
    globalThis.__initializationConnections.extension = async () => { await network; return {}; };
    const pending = f.client.connect({ initialDocuments: f.initialDocuments });
    f.client._documentInitializationEpoch += 1; // same invalidation as disconnect
    release();
    await assert.rejects(pending, /superseded/);
    assert.equal(f.registry.size, 0);
  } finally { delete globalThis.__initializationConnections; }
});
