import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';

async function load(entry, plugins = []) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
}
const { createEditorRuntimeLifetime } = await load('monaco_editor/editor_runtime_lifetime.ts');

test('runtime connection ownership closes only its namespace sockets, once, including late construction', async () => {
  const { createEditorSocketConnectionOwner } = await load('monaco_editor/editor_socket_listener_owner.ts');
  const first = createEditorSocketConnectionOwner(), second = createEditorSocketConnectionOwner();
  const calls = [];
  const socket = name => ({ disconnect() { calls.push(name); if (name === 'broken') throw Error('fixture'); } });
  const editor = socket('editor'); first.own(editor);first.own(editor);first.own(socket('broken'));first.own(socket('wba'));
  second.own(socket('survivor'));
  first.dispose();first.dispose();
  assert.deepEqual(calls,['editor','broken','wba']);
  first.own(socket('late'));assert.equal(calls.at(-1),'late');
  second.dispose();assert.equal(calls.at(-1),'survivor');
});

test('editor connection teardown removes socket hooks and fences captured notifications', async () => {
  const { registerEditorSocketConnectionHandlers } = await load('monaco_editor/editor_socket_connection_runtime.ts');
  const socket = new EventEmitter(), notifications = [], ready = [];
  let removed = 0;
  const binding = registerEditorSocketConnectionHandlers(socket, {
    emitToHost: event => ready.push(event),
    rpcNotifications: { onNotification(method, handler) { notifications.push([method, handler]); return () => removed++; } },
  });
  const connect = socket.listeners('connect')[0];
  socket.emit('connect'); assert.equal(ready.length, 2);
  binding.dispose(); binding.dispose(); connect();
  for (const [, handler] of notifications) handler({});
  assert.equal(ready.length, 2); assert.equal(removed, notifications.length);
  assert.equal(socket.listenerCount('connect'), 0); assert.equal(socket.listenerCount('disconnect'), 0);
});

test('instance cleanup is ordered, idempotent and survives individual failures', () => {
  const calls = [], errors = [];
  const life = createEditorRuntimeLifetime({ setTimeoutFn: () => 1, clearTimeoutFn() {}, onCleanupError: error => errors.push(error) });
  life.addCleanup(() => { calls.push('provider'); throw Error('failed provider cleanup'); });
  life.addCleanup(() => calls.push('mirror'));
  life.addCleanup(() => { calls.push('transport'); life.dispose(); });
  life.dispose(); life.dispose();
  assert.deepEqual(calls, ['provider', 'mirror', 'transport']); assert.equal(errors.length, 1);
  assert.equal(life.isDisposed(), true);
  life.addCleanup(() => calls.push('late resource'));
  assert.equal(calls.at(-1), 'late resource');
});

test('timers belong to one lifetime and stale callbacks cannot execute', () => {
  const timers = new Map(), cleared = [], calls = [];
  let id = 0;
  const deps = { setTimeoutFn(callback) { const timer = ++id; timers.set(timer, callback); return timer; },
    clearTimeoutFn(timer) { cleared.push(timer); timers.delete(timer); } };
  const a = createEditorRuntimeLifetime(deps), b = createEditorRuntimeLifetime(deps);
  const aid = a.setTimeout(() => calls.push('a'), 1), bid = b.setTimeout(() => calls.push('b'), 1);
  const stale = timers.get(aid);
  a.addCleanup(() => { a.setTimeout(() => calls.push('cleanup timer'), 1); });
  a.dispose(); stale();
  assert.deepEqual(cleared, [aid, 3]); assert.equal(timers.has(bid), true);
  timers.get(bid)(); assert.deepEqual(calls, ['b']);
  assert.throws(() => a.setTimeout(() => {}, 1), /disposed/);
  b.dispose(); assert.deepEqual(cleared, [aid, 3]);
});

test('cleared timers and removed cleanup callbacks are not retained', () => {
  let callback, clears = 0, calls = 0;
  const life = createEditorRuntimeLifetime({ setTimeoutFn(fn) { callback = fn; return 1; }, clearTimeoutFn() { clears++; } });
  const remove = life.addCleanup(() => calls++); remove();
  const timer = life.setTimeout(() => calls++, 1);
  life.clearTimeout(timer); callback(); assert.equal(calls, 0);
  life.clearTimeout(timer); life.dispose();
  callback(); assert.equal(calls, 0); assert.equal(clears, 1);
});

test('preferences fetched after disposal cannot create a Monaco editor', async () => {
  const { ensureEditorWithPrefs } = await load('monaco_editor/editor_editor_lifecycle.ts');
  let disposed = false, finish, created = 0;
  const pending = ensureEditorWithPrefs({ isDisposed: () => disposed, getEditor: () => null,
    getEditorContainer: () => ({}), getMonaco: () => ({ editor: { create() { created++; } } }),
    getCachedPrefs: () => null, setCachedPrefs() { assert.fail('late preferences mutated disposed state'); },
    fetchSSOTState: () => new Promise(resolve => { finish = resolve; }) });
  disposed = true; finish({}); assert.equal(await pending, null); assert.equal(created, 0);
});

test('scroll teardown releases subscriptions and cannot schedule again through stale callbacks', async () => {
  const { installScrollPublisherRuntime } = await load('monaco_editor/editor_scroll_publisher_runtime.ts');
  const callbacks = [], removed = [], cancelled = [];
  let sends = 0, schedules = 0;
  const runtime = installScrollPublisherRuntime({
    getEditor: () => ({
      onDidScrollChange(callback) { callbacks.push(callback); return { dispose() { removed.push('scroll'); } }; },
      onDidChangeCursorPosition(callback) { callbacks.push(callback); return { dispose() { removed.push('cursor'); } }; },
    }), canInstall: () => true, setInstalled() {}, getCurrentPath: () => '/a', getModel: () => ({}),
    buildScrollStatePayload: () => ({ path: '/a' }), updateBreadcrumbCursor() {},
    notifyEditorRpc() { sends++; return true; }, shouldSendImmediately: () => false,
    scheduleSend() { schedules++; return 7; }, clearScheduledSend: timer => cancelled.push(timer),
  });
  callbacks[0](); assert.equal(schedules, 1);
  runtime.dispose(); runtime.dispose();
  callbacks.forEach(callback => callback());
  assert.equal(runtime.flush(), false); assert.equal(sends, 0); assert.equal(schedules, 1);
  assert.deepEqual(removed, ['scroll', 'cursor']); assert.deepEqual(cancelled, [7]);
});

for (const stage of ['monaco', 'socket', 'theme', 'editor', 'catalog']) {
  test(`disposed startup cannot publish readiness or apply late ${stage} work`, async () => {
    const { bootMonacoRuntime } = await load('monaco_editor/editor_monaco_boot_runtime.ts', [{ name: 'stub-bootstrap', setup(builder) {
      builder.onResolve({ filter: /monaco\.bootstrap\.bundle\.js$/ }, () => ({ path: 'bootstrap', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const loadMonaco = () => globalThis.__testMonacoLoader();', loader: 'js' }));
    } }]);
    const oldWorker = globalThis.Worker, oldLoader = globalThis.__testMonacoLoader;
    globalThis.Worker = class Worker {};
    let disposed = false, finish;
    const calls = [];
    const wait = key => key === stage ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({});
    globalThis.__testMonacoLoader = () => wait('monaco');
    const deps = { isDisposed: () => disposed,
      getWindow: () => ({ navigator: { userAgent: '' } }), getApiBase: () => '', getBootSnapshot: () => null,
      getCachedPrefs: () => ({}), languageWorkersEnabled: () => stage !== 'catalog', getWorkerLogOnce: () => ({}),
      ensureTe2DiffTheme() {}, connectEditorHostActions() {}, connectEditorSocket: () => wait('socket'),
      ensureDocumentTheme: () => wait('theme'), ensureDocumentSyntax: async () => {},
      applyBootSnapshot: () => calls.push('snapshot'), ensureEditorWithPrefs: () => wait('editor'),
      ensureWorkbenchLanguageCatalogInstalled: () => wait('catalog'),
      installWorkbenchLanguageBridgeProviders: () => calls.push('providers'),
      applyActiveModelLanguage: () => calls.push('language'), collectBootLanguageIds: () => [], warnIfPlaintextOnlyLanguages() {},
      emitToHost: () => calls.push('ready-event'), updateDebug() {}, onReady: () => calls.push('ready'), onError: error => { throw error; } };
    try {
      const boot = bootMonacoRuntime(deps);
      for (let n = 0; n < 20 && !finish; n++) await Promise.resolve();
      assert.equal(typeof finish, 'function');
      const before = [...calls]; disposed = true; finish({});
      await boot; await Promise.resolve();
      assert.deepEqual(calls, before);
    } finally {
      if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker;
      if (oldLoader === undefined) delete globalThis.__testMonacoLoader; else globalThis.__testMonacoLoader = oldLoader;
    }
  });
}
