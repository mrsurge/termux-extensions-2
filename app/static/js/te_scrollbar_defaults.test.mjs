import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('TE2 shared web chrome uses the Electron native scrollbar rules', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const web = await read('./te_ui.js');
  const electron = await read('../../../desktop_client/electron/src/shared/chromium-scrollbars.ts');
  const rules = electron.match(/CHROMIUM_SCROLLBAR_STYLE = `([\s\S]+?)`;/)?.[1];
  assert.ok(rules);
  assert.ok(web.includes('style.textContent = `' + rules + '`;'));
  for (const template of ['index', 'app_shell']) {
    assert.match(await read(`../../templates/${template}.html`), /src="\/static\/js\/te_ui\.js"/);
  }
});
