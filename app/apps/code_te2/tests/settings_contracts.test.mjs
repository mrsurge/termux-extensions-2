import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['main_page/frontend/ui/settings-contracts.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { configProperties, settingsRequest } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('settings boundary retains nested config values and narrows extension metadata', async () => {
  const calls = [];
  const settings = { 'example.nested': { list: [1, false, null, { text: '🍊' }] } };
  const schema = { properties: { 'example.nested': { type: 'object', default: settings['example.nested'] } } };
  const request = settingsRequest(async (...args) => {
    calls.push(args);
    return { ok: true, settings, schema, extensions: [{ id: 'example.ext', languages: ['python', 7],
      configuration_values: settings, source: 'user', active: true, has_config: true }], count: 3 };
  });
  const reply = await request('explorer.extensions.list', {}, 1000);
  assert.deepEqual(reply.settings, settings);
  assert.deepEqual(reply.schema, schema);
  assert.deepEqual(reply.extensions[0].configuration_values, settings);
  assert.deepEqual(reply.extensions[0].languages, ['python']);
  assert.equal(reply.extensions[0].active, true);
  assert.equal(reply.count, 3);
  assert.deepEqual(calls, [['explorer.extensions.list', {}, 1000]]);
});

test('schema decoder retains mixed enums, defaults, array items and number bounds', () => {
  const props = configProperties({ properties: {
    mixed: { type: ['object', 'string'], default: { enabled: false }, anyOf: [{ enum: ['auto', null] }] },
    numbers: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 12 } },
    malformed: { description: 5, type: [1, 'boolean'], anyOf: [null] },
  } });
  assert.deepEqual(props.mixed.default, { enabled: false });
  assert.deepEqual(props.mixed.anyOf[0].enum, ['auto', null]);
  assert.equal(props.numbers.items.minimum, 0);
  assert.equal(props.numbers.items.maximum, 12);
  assert.equal(props.malformed.description, undefined);
  assert.deepEqual(props.malformed.type, ['boolean']);
  assert.deepEqual(configProperties(null), {});
});
