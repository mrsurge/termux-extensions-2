import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture() {
  const result = await build({ entryPoints: ['monaco_editor/editor_hover_command_runtime.ts'],
    bundle: true, write: false, format: 'esm', platform: 'node' });
  const { createEditorHoverCommandRuntime } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  let handler, generation = 1, disposed = false;
  let context = { uri: 'file:///work/main.rs', path: '/work/main.rs', languageId: 'rust', version: 3 };
  const calls = [];
  const runtime = createEditorHoverCommandRuntime({
    registerCommand(id, fn) { assert.equal(id, 'te2.extensionHoverCommand'); handler = fn; return { dispose() { disposed = true; } }; },
    getContext: () => context, getGeneration: () => generation,
    execute: async params => { calls.push(params); return { ok: true }; },
  });
  const prepare = (trust = true, command = 'rust-analyzer.hoverRefCommandProxy?0') => runtime.prepare([
    { value: `[6 implementations](command:${command})`, isTrusted: trust },
  ], context)[0];
  const token = content => JSON.parse(decodeURIComponent(content.value.match(/command:te2.extensionHoverCommand\?([^)]*)/)[1]))[0];
  return { runtime, calls, prepare, token, invoke: value => handler(null, value),
    changeVersion() { context = { ...context, version: 4 }; }, reconnect() { generation++; }, isDisposed: () => disposed };
}

test('trusted Rust hover proxy uses a private gateway and preserves scalar arguments', async () => {
  const f = await fixture(), content = f.prepare();
  assert.deepEqual(content.isTrusted, { enabledCommands: ['te2.extensionHoverCommand'] });
  await f.invoke(f.token(content));
  assert.equal(f.calls[0].command, 'rust-analyzer.hoverRefCommandProxy');
  assert.deepEqual(f.calls[0].arguments, [0]);
  assert.equal(f.calls[0].surface, 'hover');
});

test('untrusted and non-allowlisted command links are never promoted', async () => {
  const f = await fixture();
  for (const trust of [undefined, false, { enabledCommands: ['other.command'] }]) {
    // Pass undefined explicitly to the runtime rather than the fixture default.
    const content = f.runtime.prepare([{ value: '[link](command:test.run?0)', isTrusted: trust }],
      { uri: 'file:///work/main.rs', path: '/work/main.rs', languageId: 'rust', version: 3 })[0];
    assert.equal(content.value, '[link](command:test.run?0)');
    assert.deepEqual(content.isTrusted, trust);
  }
  const allowed = f.prepare({ enabledCommands: ['rust-analyzer.hoverRefCommandProxy'] });
  await f.invoke(f.token(allowed));
  assert.equal(f.calls.length, 1);
});

test('malformed command arguments do not get a gateway', async () => {
  const f = await fixture();
  assert.ok(!f.prepare(true, 'test.run?not-json').value.includes('te2.extensionHoverCommand'));
});

for (const action of ['changeVersion', 'reconnect', 'reset', 'supersede', 'dispose']) {
  test(`hover commands fence ${action}`, async () => {
    const f = await fixture(), old = f.token(f.prepare());
    if (action === 'reset' || action === 'dispose') f.runtime[action]();
    else if (action === 'supersede') f.prepare();
    else f[action]();
    await assert.rejects(f.invoke(old), /stale/);
    assert.equal(f.calls.length, 0);
    if (action === 'dispose') assert.equal(f.isDisposed(), true);
  });
}
