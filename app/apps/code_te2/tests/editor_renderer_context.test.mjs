import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './monaco_editor/editor_renderer_context.ts';
  export * from './src/rpc/socketio-topology.ts';
  export * from './monaco_editor/editor_rpc_host_action_runtime.ts';
  export * from './monaco_editor/editor_workbench_barrier_utils.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const primary = { clientInstanceId: 'client_aaaaaaaaaaaa', clientRole: 'primary' };
const secondary = { clientInstanceId: 'client_bbbbbbbbbbbb', mainPageClientInstanceId: primary.clientInstanceId, clientRole: 'secondary' };

test('renderer identity is a validated immutable snapshot, independent of later page identity changes', () => {
  api.configureCodeTe2SocketIdentity(primary);
  const a = api.createEditorRendererContext();
  const input = { ...secondary }, b = api.createEditorRendererContext(input);
  input.clientInstanceId = 'client_cccccccccccc';
  api.configureCodeTe2SocketIdentity({ clientInstanceId: 'client_dddddddddddd' });
  assert.equal(a.socketQuery().client_instance_id, primary.clientInstanceId);
  assert.equal(b.socketQuery().client_instance_id, secondary.clientInstanceId);
  assert.equal(b.socketQuery().main_page_client_instance_id, primary.clientInstanceId);
  assert.equal(b.socketQuery().client_role, 'secondary');
  assert.equal(Object.isFrozen(b.identity), true);
  assert.throws(() => api.createEditorRendererContext({ ...secondary, mainPageClientInstanceId: '' }), /main-page identity/);
});

test('two renderers sharing a window keep readiness, project switching and barriers independent', () => {
  const win = {}, a = api.createEditorRendererContext(primary), b = api.createEditorRendererContext(secondary);
  function runtime(context) {
    const handlers = new Map(); let ready = 0;
    const handle = api.createEditorRpcHostActionRuntime({
      getWindow: () => win, getReadinessState: () => context.readiness,
      getEditor: () => null, getDiffEditor: () => null, replayOpenFileAfterBaton() {},
      onAdapterReady: () => ready++, notifyEditorRpc: () => true,
      onEditorRpcNotification: (method, handler) => { handlers.set(method, handler); return () => handlers.delete(method); },
    });
    handle.connect();
    return { handle, handlers, ready: () => ready };
  }
  const ra = runtime(a), rb = runtime(b);
  const adapter = [...ra.handlers.values()][0], switching = [...ra.handlers.values()][1];
  adapter({ status: 'ready', project: '/a' });
  assert.equal(a.readiness.__te2AdapterReady, true);
  assert.equal(b.readiness.__te2AdapterReady, false);
  const barrier = readiness => api.wbIsBarrierOpen({ readiness, editor: {}, model: {}, currentPath: '/a/file',
    currentGeneration: 2, wbFlow: { openAckGeneration: 2, openAckPath: '/a/file' } });
  assert.equal(barrier(a.readiness), true); assert.equal(barrier(b.readiness), false);
  switching({ projectPath: '/next', switchId: 'switch-a' });
  assert.equal(a.readiness.__te2ProjectSwitchInProgress, true);
  assert.equal(b.readiness.__te2ProjectSwitchInProgress, false);
  assert.equal(b.readiness.__te2AdapterProject, null);
  assert.deepEqual(win, {});
  ra.handle.dispose(); adapter({ status: 'ready', project: '/stale' });
  assert.equal(ra.ready(), 1); assert.equal(rb.ready(), 0);
  assert.equal(a.readiness.__te2AdapterProject, '/next');
  rb.handle.dispose();
});
