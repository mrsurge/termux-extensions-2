import assert from 'node:assert/strict';
import test from 'node:test';
import { localWordWrap } from '../src/local-word-wrap.ts';

test('wrap defaults are client-local; panes share bounded, expiring exceptions', () => {
  const saved = new Map();
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value),
  } });
  const a = localWordWrap('a'), pane = localWordWrap('a'), b = localWordWrap('b');
  assert.equal(a.value(null, true), true);
  a.toggle('/file');
  assert.equal(pane.value('/file', false), false);
  assert.equal(b.value('/file', true), true);
  a.toggle('/file');
  const entries = () => JSON.parse(saved.get('code_te2_word_wrap:a')).overrides;
  assert.deepEqual(entries(), []);
  for (let i = 0; i < 130; i++) a.toggle('/' + i);
  assert.equal(entries().length, 128);
  assert.equal(pane.value('/0'), true);
  saved.set('code_te2_word_wrap:a', JSON.stringify({base:true, overrides:[{path:'/old', used:0}]}));
  assert.equal(a.value('/old'), true);
  assert.deepEqual(entries(), []);
  a.toggle('/file');
  a.toggle(null);
  assert.equal(a.value('/file'), false);
  assert.deepEqual(entries(), []);
});
