import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../workbench_protocol_proxy/node_workbench_adapter/src/client/workbench-client.ts', import.meta.url), 'utf8');
const span = source.slice(source.indexOf('async function spanTraceAsync<T>'), source.indexOf('function _shouldSkipSize'));
function fixture(enabled) {
  const records = [];
  const context = vm.createContext({ performance, process: { pid: 1 }, console: { error: (_prefix, data) => records.push(JSON.parse(data)) } });
  const code = `const STARTUP_TRACE_ENABLE = ${enabled}; let startupTraceCount = 0;
    const SPAN_TRACE_ENABLE = false; let _spanTraceRemaining = 0;
    ${span}; globalThis.trace = spanTraceAsync;`;
  vm.runInContext(transformSync(code, { loader: 'ts' }).code, context);
  return { records, trace: context.trace };
}

test('startup trace is gated and ignores ordinary requests', async () => {
  const disabled = fixture(false);
  assert.equal(await disabled.trace('connect.test', async () => 42), 42);
  assert.equal(disabled.records.length, 0);
  const enabled = fixture(true);
  await enabled.trace('hover', async () => 42);
  assert.equal(enabled.records.length, 0);
});

test('startup trace is bounded and preserves results', async () => {
  const { records, trace } = fixture(true);
  for (let i = 0; i < 101; i++) assert.equal(await trace('connect.test', async () => i), i);
  assert.equal(records.length, 200);
  assert.equal(records[0].phase, 'connect.test.begin');
  assert.equal(records[199].outcome, 'ok');
});

test('startup trace records failure without exposing error contents', async () => {
  const { records, trace } = fixture(true);
  const error = new Error('private payload');
  await assert.rejects(trace('connect.test', async () => { throw error; }), e => e === error);
  assert.equal(records[1].outcome, 'error');
  assert.equal(JSON.stringify(records).includes('private payload'), false);
});

test('connection readiness does not wait for sidebar activation', async () => {
  const method = source.slice(source.indexOf('  async connect('), source.indexOf('  private _captureClientEditorFacade'));
  let finishViews;
  const views = new Promise(resolve => { finishViews = resolve; });
  const context = vm.createContext({
    spanTraceAsync: (_name, fn) => fn(),
    connectManagementSession: async () => ({}),
    connectExtensionHostSession: async () => ({ ready: true }),
  });
  vm.runInContext(transformSync(`class Subject { ${method} }; globalThis.Subject = Subject;`, { loader: 'ts' }).code, context);
  const subject = new context.Subject();
  Object.assign(subject, {
    _resetSessionCaches() {}, _managementRuntime() {}, _extensionHostRuntime() {},
    _startupMark() {}, _webviews: { activatePrimaryViews: () => views },
  });
  const result = await subject.connect();
  assert.equal(result.ready, true);
  assert.equal(subject._connecting, false);
  finishViews();
});

test('startup milestones are once per phase, bounded, and debug gated', () => {
  const fields = source.slice(source.indexOf('  private readonly _startupMilestones'), source.indexOf('  onEvent: WorkbenchEventSink'));
  for (const enabled of [true, false]) {
    const records = [];
    const context = vm.createContext({ STARTUP_TRACE_ENABLE: enabled, process: { pid: 1 }, console: { error: (_prefix, data) => records.push(JSON.parse(data)) } });
    vm.runInContext(transformSync(`class Subject { ${fields} }; globalThis.Subject = Subject;`, { loader: 'ts' }).code, context);
    const subject = new context.Subject();
    for (let i = 0; i < 40; i++) {
      subject._startupMark(`test.${i}`);
      subject._startupMark(`test.${i}`);
    }
    assert.equal(records.length, enabled ? 32 : 0);
  }
});
