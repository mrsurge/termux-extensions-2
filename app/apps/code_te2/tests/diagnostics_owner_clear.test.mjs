import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { WorkbenchClient } from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/workbench-client.mjs';
import { DiagnosticsSnapshotStore } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/diagnostics-snapshot.mjs';
import { handleExtHostRequest } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/ext-host-dispatch.mjs';
import { encodeExtRequestJsonArgs } from '../workbench_protocol_proxy/node_workbench_adapter/dist/protocol/wire-encoding.mjs';
import { createWorkbenchEventHandler } from '../workbench_protocol_proxy/node_workbench_adapter/dist/server/event-bridge.mjs';

async function importTs(file) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { VendorMarkerService } = await importTs('monaco_editor/vscode_document_intelligence_vendor/markerService.ts');
const { VendorMainThreadDiagnostics } = await importTs('monaco_editor/vscode_document_intelligence_vendor/mainThreadDiagnostics.ts');
const { registerEditorWbaRuntimeHandlers } = await importTs('monaco_editor/editor_wba_runtime_handlers.ts');
const uri = path => ({ scheme: 'file', path, external: `file://${path}` });
const marker = { severity: 8, message: 'old error', startLineNumber: 12, startColumn: 1, endLineNumber: 12, endColumn: 7 };

function fixture() {
  const service = new VendorMarkerService();
  const frontend = new VendorMainThreadDiagnostics({ markerService: service });
  const notifications = new Map();
  registerEditorWbaRuntimeHandlers({ onNotification(method, handler) {
    notifications.set(method, handler); return () => notifications.delete(method);
  } }, {
    getModel: () => null, getCurrentPath: () => '/workspace/a.py',
    absPathFromVscodeUri: value => value?.replace('file://', ''),
    applyDiagnosticsUpdate: event => frontend.applyChangeMany(event),
  });
  const snapshots = new DiagnosticsSnapshotStore({ uriToString: resource => resource.external });
  const browser = [], pipe = [], replies = [];
  const handler = createWorkbenchEventHandler({
    wb: { status: () => ({}) }, state: { config: {}, session: {} },
    eventLog: [], eventLogMax: 20, eventTruncStrMax: 1000, eventTruncArrMax: 100,
    nowMs: () => 1, wsClientCount: () => 1, log() {},
    wsBroadcastNotification(_method, event) {
      browser.push(event);
      notifications.get('te2.event')?.(event);
    },
    writePushLine: event => pipe.push(event.params),
  });
  // Cross the real WorkbenchClient -> runtime factory -> dispatcher boundary,
  // including the production argument-decoding allowlist and snapshot hook.
  const client = Object.create(WorkbenchClient.prototype);
  client.state = {};
  client._debugExtReqSeen = 200; client._debugExtReplySeen = 50; client._debugMainThreadReplySeen = 80;
  client._extensionActivity = { handleRequest: () => ({ handled: false }) };
  client._webviews = { handleMainThreadRequest: () => ({ handled: false }) };
  client._extensionEditorNavigation = { handleMainThreadRequest: () => ({ handled: false }) };
  client._extensionCommands = { handleMainThreadRequest: () => ({ handled: false }) };
  client._providerRegistry = { registerFromRequest: () => ({ handled: false, logs: [], events: [] }) };
  client._diagnosticSnapshots = snapshots;
  client._startupMark = () => {};
  client.ext = { protocol: { send: bytes => replies.push(bytes) } };
  client.onEvent = handler;
  let req = 0;
  const diagnosticsId = client._extHostDispatchRuntime().rpcIds.MainThreadDiagnostics;
  assert.equal(diagnosticsId, 16, 'pinned code-server Diagnostics actor');
  function dispatch(method, args, rpcId = diagnosticsId) {
    const bytes = encodeExtRequestJsonArgs({ req: ++req, rpcId, method, args });
    const decoded = client._extensionHostRuntime().decodeExtMessage(bytes);
    if (rpcId === diagnosticsId) assert.notEqual(decoded.skippedArgsParse, true);
    return handleExtHostRequest(client._extHostDispatchRuntime(), decoded);
  }
  return { service, frontend, snapshots, browser, pipe, replies, dispatch };
}

test('wire-level owner clear evicts retained replay and reaches editor plus backend pipe', () => {
  const f = fixture();
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/a.py'), [marker]], [uri('/workspace/b.py'), [marker]]]]);
  f.dispatch('$changeMany', ['other', [[uri('/workspace/a.py'), [marker]]]]);
  assert.equal(f.service.read().length, 3);
  assert.equal(f.snapshots.stats().resources, 3);
  f.dispatch('$clear', ['ty']);
  assert.equal(f.service.read({ owner: 'ty' }).length, 0);
  assert.equal(f.service.read({ owner: 'other' }).length, 1);
  assert.equal(f.snapshots.stats().resources, 1);
  assert.deepEqual(f.snapshots.buildResyncEvents().map(event => event.args[0]), ['other']);
  assert.equal(f.pipe.at(-1).type, 'diagnostics/clear');
  assert.equal(f.pipe.at(-1).owner, 'ty');
  assert.equal(f.browser.at(-1).type, 'diagnostics/clear');
  // A late/reconnected frontend must not resurrect the cleared owner.
  const late = new VendorMarkerService();
  const lateDiagnostics = new VendorMainThreadDiagnostics({ markerService: late });
  for (const event of f.snapshots.buildResyncEvents()) lateDiagnostics.applyChangeMany(event);
  assert.equal(late.read({ owner: 'ty' }).length, 0);
  assert.equal(late.read({ owner: 'other' }).length, 1);
});

test('per-resource clearing, repeated owner clear and new diagnostics preserve their distinct semantics', () => {
  const f = fixture();
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/a.py'), [marker]], [uri('/workspace/b.py'), [marker]]]]);
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/a.py'), []]]]);
  assert.equal(f.service.read({ owner: 'ty' }).length, 1);
  f.dispatch('$clear', ['ty']); f.dispatch('$clear', ['ty']);
  assert.equal(f.service.read().length, 0);
  assert.equal(f.snapshots.stats().bytes, 0);
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/c.py'), [marker]]]]);
  assert.equal(f.service.read().length, 1);
  assert.equal(f.snapshots.stats().resources, 1);
});

test('malformed or foreign-actor clears never clear a diagnostic owner', () => {
  const f = fixture();
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/a.py'), [marker]]]]);
  for (const args of [[], [''], [null], [123]]) f.dispatch('$clear', args);
  f.dispatch('$clear', ['ty'], 38);
  assert.equal(f.service.read().length, 1);
  assert.equal(f.snapshots.stats().resources, 1);
  assert.equal(f.pipe.filter(event => event.type === 'diagnostics/clear').length, 0);
});

test('frontend clear reports all affected resources even when another owner remains', () => {
  const f = fixture();
  f.dispatch('$changeMany', ['ty', [[uri('/workspace/a.py'), [marker]], [uri('/workspace/b.py'), [marker]]]]);
  f.dispatch('$changeMany', ['other', [[uri('/workspace/a.py'), [marker]]]]);
  const stats = f.frontend.applyChangeMany({ type: 'diagnostics/clear', owner: 'ty' });
  assert.equal(stats.clearedOwner, true);
  assert.deepEqual(stats.resources.sort(), ['file:///workspace/a.py', 'file:///workspace/b.py']);
  assert.equal(f.service.read().length, 1);
});
