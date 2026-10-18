import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWatcherExcludes } from '../workbench_protocol_proxy/node_workbench_adapter/dist/client/configuration.mjs';
import { resubscribeWatcher } from '../workbench_protocol_proxy/node_workbench_adapter/dist/workspace/lifecycle.mjs';

function fixture() {
  const files = new Map([
    ['/user.json', JSON.stringify({ 'files.watcherExclude': { '**/target/**': true, '.git/objects/**': false } })],
    ['/project/.vscode/settings.json', JSON.stringify({ 'files.watcherExclude': { '**/node_modules/**': true, '**/target/**': false } })],
  ]);
  const configuration = { env: { TE2_USER_SETTINGS_PATH: '/user.json' }, extensions: [], rawExtensionConfigs: null,
    readTextFileSync: path => files.get(path), joinPath: (...parts) => parts.join('/'), uriForPath: path => ({ path }), log() {} };
  return { files, configuration };
}

test('watcher combines VS Code defaults, user and workspace boolean overrides', () => {
  const { configuration } = fixture();
  const excludes = resolveWatcherExcludes(configuration, '/project');
  assert.ok(excludes.includes('.git/subtree-cache/**'));
  assert.ok(excludes.includes('**/node_modules/**'));
  assert.ok(excludes.includes('**/.git/*.lock'));
  assert.ok(!excludes.includes('.git/objects/**'));
  assert.ok(!excludes.includes('**/target/**'));
});

test('each watcher resubscription resolves current settings instead of retaining old exclusions', async () => {
  const { files, configuration } = fixture();
  const calls = [];
  const runtime = { state: { workspaceFolder: '/project' }, watcher: { mgmtIpc: {
    listen: () => ({ event() {}, dispose() {} }), call: async (...args) => calls.push(args),
  }, fsWatcherSub: null }, randomUuid: () => 'session', log() {}, onEvent() {},
    uriForPath: path => ({ path }), getWatcherExcludes: root => resolveWatcherExcludes(configuration, root) };
  await resubscribeWatcher(runtime);
  files.set('/project/.vscode/settings.json', JSON.stringify({ 'files.watcherExclude': { '**/new-output/**': true } }));
  await resubscribeWatcher(runtime);
  assert.ok(calls[0][2][3].excludes.includes('**/node_modules/**'));
  assert.ok(!calls[1][2][3].excludes.includes('**/node_modules/**'));
  assert.ok(calls[1][2][3].excludes.includes('**/new-output/**'));
});
