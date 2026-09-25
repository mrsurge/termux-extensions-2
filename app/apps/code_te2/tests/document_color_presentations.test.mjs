import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderRegistry } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/provider-registry.mjs';
import { provideColorPresentations } from '../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/intelligence/document-colors.mjs';

const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 };

for (const scheme of ['file', 'vscode-remote']) {
  test(`color presentations dispatch matching ${scheme} providers without waiting`, async () => {
    const registry = new ProviderRegistry();
    for (const [handle, selector] of [
      [1, { language: 'css', scheme, pattern: '**/*.css' }],
      [2, { language: 'css' }],
      [3, { language: 'css', scheme, pattern: '**/*.other' }],
      [4, { language: 'css', scheme: 'untitled' }],
    ]) registry.registerFromRequest('$registerDocumentColorProvider', [handle, [selector]]);
    const calls = [];
    const runtime = {
      ensureConnected() {},
      languageFeaturesRpcId: 1,
      defaultAuthority: () => 'test-host',
      documentScheme: () => scheme,
      languageIdFromPath: () => 'css',
      findAllProviderHandles: (kind, document) => registry.findAllProviderHandlesForDocument(kind, document),
      waitFor: async () => assert.fail('Registered matching providers must not enter discovery wait'),
      didChange: () => assert.fail('Presentations must not synchronize document text'),
      uriForPath: (path, authority) => ({ scheme, path, authority }),
      sendExtPending: (_id, method, args) => {
        calls.push({ method, args });
        return { promise: Promise.resolve({ type: 9, result: [{ label: `color-${args[0]}`, textEdit: { range, text: '#ffffff' } }] }) };
      },
      log() {}, warn() {},
    };
    const result = await provideColorPresentations(runtime, {
      path: '/project/static/style.css',
      colorInfo: { color: [1, 1, 1, 1], range },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.providerCount, 2);
    assert.deepEqual(calls.map(call => call.args[0]).sort(), [1, 2]);
    for (const call of calls) {
      assert.equal(call.method, '$provideColorPresentations');
      assert.deepEqual(call.args[1], { scheme, path: '/project/static/style.css', authority: 'test-host' });
    }
    assert.equal(result.result.presentations.length, 2);
    assert.deepEqual(result.result.presentations[0].textEdit, { range, text: '#ffffff' });
  });
}
