import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';

const root = path.resolve(import.meta.dirname, '../../../..');
const source = (await readFile(path.join(root, 'app/static/js/file_picker.js'), 'utf8')).replace(/^import .*;\n/m, '').replace(/export \{\};\s*$/, '');
const definitions = JSON.parse(await readFile(path.join(root, 'app/static/vendor/seti-icons/definitions.json'), 'utf8'));
const iconSource = (await readFile(path.join(root, 'app/static/vendor/seti-icons/seti-icons.js'), 'utf8')).replace(/export /g, '');
const iconFetches = [];
const setiSvgs = JSON.parse(await readFile(path.join(root, 'app/static/vendor/seti-icons/icons.json'), 'utf8'));
const languageSource = (await readFile(path.join(root, 'app/static/vendor/seti-icons/language-icons.js'), 'utf8')).replace(/export /g, '');
const LANGUAGE_ICONS = vm.runInNewContext(languageSource + '\nLANGUAGE_ICONS;');
const getIconName = vm.runInNewContext(iconSource + '\ngetIconName;', {
  fetch: async url => { iconFetches.push(url); return { ok: true, json: async () => definitions }; }, console,
});
const providerSource = (await readFile(path.join(root, 'app/static/js/file_icons.js'), 'utf8')).replace(/^import .*;\n/gm, '').replace(/export /g, '');
function createProvider(fetchImpl = async url => {
  iconFetches.push(url);
  if (url.endsWith('definitions.json')) return new Response(JSON.stringify(definitions));
  const name = url.split('/').pop().replace(/\.svg$/, '');
  const svg = LANGUAGE_ICONS[name] || setiSvgs[name];
  return new Response(svg ? (svg.includes('xmlns=') ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')) + '\n' : '', { status: svg ? 200 : 404 });
}) {
  return vm.runInNewContext(providerSource + '\n({ getIcon, renderIcon, classifyFileName, FILE_TYPE_CODICONS });', {
    fetch: fetchImpl, encodeURIComponent, AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array,
  });
}
const provider = createProvider();
const workerSource = await readFile(path.join(root, 'app/static/js/file_picker_filter_worker.js'), 'utf8');
const entries = [
  { name: 'src', path: '/project/src', type: 'directory' },
  { name: 'readme.md', path: '/project/readme.md', type: 'file' },
  { name: 'data.json', path: '/project/data.json', type: 'file' },
];
const tick = (delay = 0) => new Promise(resolve => setTimeout(resolve, delay));

function filter(data) {
  let result;
  const self = { postMessage: value => { result = value; } };
  vm.runInNewContext(workerSource, { self });
  self.onmessage({ data });
  return result;
}

function setup(browse = async location => ({ entries, path: location }), workerMode = 'normal') {
  const window = new Window({ url: 'http://localhost/' });
  const calls = [];
  const workers = [];
  class Worker {
    constructor(url) { assert.equal(url, '/static/js/file_picker_filter_worker.js'); workers.push(this); }
    postMessage(data) { this.data = data; if (workerMode === 'hang') return; setTimeout(() => { if (!this.dead) this.onmessage({ data: filter(data) }); }, 0); }
    terminate() { this.dead = true; }
  }
  const fetch = async url => {
    calls.push(url);
    if (url.startsWith('/api/browse?')) {
      const data = await browse(new URL(url, 'http://localhost').searchParams.get('path'));
      return { ok: true, json: async () => ({ ok: true, data }) };
    }
    return { ok: true, json: async () => ({ ok: true, data: {} }) };
  };
  const paths = vm.runInNewContext(source + '\n({ toAbsolute, parentPath, simplifyAbsolute });', { window, document: window.document, console, fetch, URLSearchParams, Worker, performance, setTimeout, clearTimeout, getIcon: provider.getIcon, renderIcon: provider.renderIcon });
  const document = window.document;
  const open = options => window.teFilePicker.open({ startPath: '/project', ...options });
  const row = name => [...document.querySelectorAll('.te-fp-item')].find(item => item.textContent.includes(name));
  const click = element => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (element, value) => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { window, document, open, row, click, key, calls, workers, paths };
}

test('home aliases remain backend-owned and parent navigation has no platform assumptions', () => {
  const env = setup();
  assert.equal(env.paths.toAbsolute(null), '~');
  assert.equal(env.paths.toAbsolute('child'), '~/child');
  assert.equal(env.paths.simplifyAbsolute('~/child/../other'), '~/other');
  assert.equal(env.paths.simplifyAbsolute('~/../../other'), '~/../../other');
  assert.equal(env.paths.parentPath('~'), '~/..');
  assert.equal(env.paths.parentPath('~/..'), '~/../..');
  assert.equal(env.paths.parentPath('~/child/..'), '~/..');
  for (const home of ['/home/alice', '/root', '/data/data/com.termux/files/home']) {
    assert.equal(env.paths.parentPath(home), path.posix.dirname(home));
  }
  env.window.close();
});

for (const home of ['/home/alice', '/root', '/data/data/com.termux/files/home']) {
  test(`default home browse uses one request and follows the server's resolved path: ${home}`, async () => {
    const env = setup(async location => ({ entries, path: location === '~' ? home : location }));
    env.open({ mode: 'directory', startPath: undefined });
    await tick();
    let browses = env.calls.filter(url => url.startsWith('/api/browse?'));
    assert.equal(browses.length, 1);
    assert.equal(new URL(browses[0], 'http://localhost').searchParams.get('path'), '~');
    env.click(env.document.querySelector('.te-fp-btn-up'));
    await tick();
    browses = env.calls.filter(url => url.startsWith('/api/browse?'));
    assert.equal(new URL(browses.at(-1), 'http://localhost').searchParams.get('path'), path.posix.dirname(home));
    env.window.close();
  });
}

test('single click selects a directory, double click enters; Codicons load once', async () => {
  const env = setup(); const result = env.open({ mode: 'directory' }); await tick();
  const row = env.row('src'); env.click(row);
  assert.equal(env.calls.filter(url => url.startsWith('/api/browse?')).length, 1);
  assert.equal(row.getAttribute('aria-selected'), 'true');
  assert.equal(env.document.querySelector('.te-fp-btn-select').disabled, false);
  assert.ok(row.querySelector('.codicon-folder'));
  assert.ok(env.row('data.json').querySelector('.codicon-json'));
  row.dispatchEvent(new env.window.MouseEvent('dblclick', { bubbles: true })); await tick();
  assert.ok(env.calls.some(url => url.includes('path=%2Fproject%2Fsrc')));
  env.click(env.row('src')); env.click(env.document.querySelector('.te-fp-btn-select'));
  assert.equal((await result).type, 'directory');
  env.open({ mode: 'file' }); await tick();
  assert.equal(env.document.querySelectorAll('link[href="/static/vendor/codicons/codicon.css"]').length, 1);
});

test('touch requires two taps; keyboard Space selects and Enter enters', async () => {
  const env = setup(); env.open({ mode: 'directory' }); await tick();
  const row = env.row('src');
  const pointer = new env.window.Event('pointerdown'); Object.defineProperty(pointer, 'pointerType', { value: 'touch' });
  row.dispatchEvent(pointer); env.click(row);
  assert.equal(env.calls.filter(url => url.startsWith('/api/browse?')).length, 1);
  env.click(row); await tick();
  assert.equal(env.calls.filter(url => url.startsWith('/api/browse?')).length, 2);
  env.key(env.row('src'), ' ');
  assert.equal(env.row('src').getAttribute('aria-selected'), 'true');
  env.key(env.row('src'), 'Enter'); await tick();
  assert.equal(env.calls.filter(url => url.startsWith('/api/browse?')).length, 3);
});

test('file and save modes retain eligibility, filename and current-directory behavior', async () => {
  const env = setup(); const picked = env.open({ mode: 'file' }); await tick();
  env.click(env.row('src'));
  assert.equal(env.document.querySelector('.te-fp-btn-select').disabled, true);
  env.key(env.row('readme.md'), 'Enter'); assert.equal((await picked).name, 'readme.md');
  const saved = env.open({ mode: 'save' }); await tick(); env.click(env.row('data.json'));
  assert.equal(env.document.querySelector('.te-fp-input-name').value, 'data.json');
  env.click(env.document.querySelector('.te-fp-btn-select'));
  assert.equal((await saved).existed, true);
  const current = env.open({ mode: 'directory' }); await tick();
  env.click(env.document.querySelector('.te-fp-btn-current'));
  assert.equal((await current).path, '/project');
});

test('regex filters the current listing without requests, reports invalid patterns, and clears', async () => {
  const env = setup(); env.open({}); await tick();
  const count = env.calls.length; const input = env.document.querySelector('#te-fp-filter');
  input.value = '\\.json$'; input.dispatchEvent(new env.window.Event('input')); await tick(160);
  assert.equal(env.document.querySelectorAll('.te-fp-item').length, 1);
  assert.ok(env.row('data.json')); assert.equal(env.calls.length, count);
  input.value = '['; input.dispatchEvent(new env.window.Event('input')); await tick(160);
  assert.match(env.document.querySelector('.te-fp-filter-error').textContent, /Invalid/);
  input.value = ''; input.dispatchEvent(new env.window.Event('input'));
  assert.equal(env.document.querySelectorAll('.te-fp-item').length, 3);
  assert.equal(input.hasAttribute('aria-invalid'), false);
});

test('stale browse responses cannot replace a newer directory or a closed picker', async () => {
  let resolve;
  const env = setup(location => location === '/project' ? new Promise(done => { resolve = done; }) : Promise.resolve({ entries: [], path: '/new' }));
  const result = env.open({}); result.catch(() => {});
  env.click(env.document.querySelector('.te-fp-home')); await tick();
  resolve({ entries, path: '/project' }); await tick();
  assert.equal(env.document.querySelectorAll('.te-fp-item').length, 0);
  env.click(env.document.querySelector('.te-fp-btn-cancel'));
  assert.ok(env.document.querySelector('#te-file-picker-root').classList.contains('te-fp-hidden'));
});

test('worker validates bounds and returns only matching name indices', () => {
  assert.deepEqual(Array.from(filter({ pattern: '^src$', names: ['SRC', 'src/child', 'other'] }).indices), [0]);
  assert.match(filter({ pattern: '[', names: [] }).error, /Invalid/);
  assert.match(filter({ pattern: 'a'.repeat(257), names: [] }).error, /limits/);
});

test('slow matching is terminated and obsolete worker replies cannot overwrite cleared results', async () => {
  const env = setup(undefined, 'hang'); env.open({}); await tick();
  const input = env.document.querySelector('#te-fp-filter');
  input.value = '(a+)+$'; input.dispatchEvent(new env.window.Event('input')); await tick(660);
  assert.match(env.document.querySelector('.te-fp-filter-error').textContent, /time limit/);
  assert.equal(env.workers[0].dead, true);
  input.value = 'src'; input.dispatchEvent(new env.window.Event('input')); await tick(140);
  const worker = env.workers[1];
  input.value = ''; input.dispatchEvent(new env.window.Event('input'));
  worker.onmessage({ data: { indices: [0] } });
  assert.equal(env.document.querySelectorAll('.te-fp-item').length, 3);
  assert.equal(worker.dead, true);
});

test('empty directory and keyboard list focus preserve current selection affordance', async () => {
  const env = setup(); env.open({}); await tick();
  env.row('src').focus(); env.key(env.row('src'), 'Home');
  assert.equal(env.document.activeElement, env.row('src'));
  env.key(env.row('src'), 'End');
  assert.equal(env.document.activeElement, env.row('readme.md'));
  const empty = setup(async location => ({ entries: [], path: location }));
  const picked = empty.open({ mode: 'directory' }); await tick();
  assert.match(empty.document.querySelector('.te-fp-list').textContent, /empty/);
  empty.click(empty.document.querySelector('.te-fp-btn-current'));
  assert.equal((await picked).path, '/project');
});

test('picker shares Explorer filename mapping and renders monochrome hybrid icons', async () => {
  const files = ['app.py', 'build.mjs', 'index.html', 'notes.md', 'script.sh', 'report.pdf', 'data.csv', 'style.css', 'app.rb', 'Dockerfile', 'package.json', 'README.md'];
  const env = setup(async location => ({ path: location, entries: files.map(name => ({ name, path: '/project/' + name, type: 'file' })) }));
  env.open({}); await tick();
  const expected = ['python', 'file-code', 'file-code', 'markdown', 'terminal-bash', 'file-pdf', 'table', 'symbol-color', 'ruby', 'package', 'json', 'info'];
  files.forEach((name, index) => {
    const icon = env.row(name).querySelector('.te-fp-icon');
    assert.ok(icon.classList.contains('codicon-' + expected[index]) || icon.classList.contains('te-file-language-icon'), name);
    assert.equal(icon.querySelector('svg'), null);
  });
  assert.equal(iconFetches.filter(url => url.endsWith('definitions.json')).length, 1);
  assert.equal(iconFetches.some(url => url.endsWith('icons.json')), false);
  const css = await readFile(path.join(root, 'app/static/vendor/codicons/codicon.css'), 'utf8');
  for (const glyph of Object.values(provider.FILE_TYPE_CODICONS)) assert.ok(css.includes('.codicon-' + glyph + ':before'), glyph);
});

test('shared name lookup survives failed SVG loading and preserves exact filename rules', async () => {
  const api = vm.runInNewContext(iconSource + '\n({ getIconName, getIcon });', {
    fetch: async url => {
      if (url.endsWith('icons.json')) throw new Error('SVG unavailable');
      return { ok: true, json: async () => definitions };
    }, console: { warn() {} },
  });
  assert.equal(await api.getIconName('build.mjs'), 'javascript');
  assert.equal(await api.getIconName('README.md'), 'info');
  await assert.rejects(api.getIcon('app.py'), /SVG unavailable/);
  assert.equal(await api.getIconName('app.py'), 'python');
});

test('shared provider normalizes JavaScript and Python families, preserves layout classes', async () => {
  for (const name of ['main.js', 'main.mjs', 'main.cjs', 'MAIN.JSX']) {
    const icon = await provider.getIcon(name);
    assert.equal(icon.iconName, 'javascript'); assert.equal(icon.svg.trim(), LANGUAGE_ICONS.javascript);
  }
  for (const name of ['main.py', 'main.pyc', 'notebook.ipynb', 'main.pyi', 'module.pyx', 'header.pxd', 'include.pxi']) {
    const icon = await provider.getIcon(name);
    assert.equal(icon.iconName, 'python'); assert.equal(icon.svg.trim(), LANGUAGE_ICONS.python);
  }
  const win = new Window(); const icon = win.document.createElement('span');
  icon.className = 'history-file-icon codicon codicon-file';
  provider.renderIcon(icon, await provider.getIcon('main.py'));
  assert.equal(icon.className, 'history-file-icon te-file-language-icon');
  provider.renderIcon(icon, await provider.getIcon('main.mjs'));
  assert.equal(icon.className, 'history-file-icon te-file-language-icon');
  assert.match(icon.firstElementChild.style.mask, /data:image\/svg\+xml/);
  provider.renderIcon(icon, { codicon: 'folder' });
  assert.equal(icon.className, 'history-file-icon codicon codicon-folder');
  assert.equal(icon.querySelector('svg'), null);
});

test('Codicon translation covers every classifier family, including Rust and directory scopes', async () => {
  const families = new Set([definitions.default, ...Object.values(definitions.files),
    ...Object.values(definitions.extensions), ...definitions.partials.map(row => row[1])].map(row => row[0]));
  for (const family of families) assert.ok(Object.hasOwn(provider.FILE_TYPE_CODICONS, family), family);
  assert.equal((await provider.getIcon('main.rs')).iconName, 'rust');
  assert.equal((await provider.getIcon('main.rs')).svg.trim(), LANGUAGE_ICONS.rust);
  assert.equal((await provider.getIcon('main.ts')).svg.trim(), LANGUAGE_ICONS.typescript);
  for (const [name, family] of [['main.c', 'c'], ['main.cpp', 'cpp'], ['main.html', 'html']]) {
    assert.equal((await provider.getIcon(name)).svg.trim(), setiSvgs[family].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  }
  for (const file of ['tree/renderer.ts', 'chrome/sticky-scopes.ts']) {
    const source = await readFile(path.join(root, 'app/apps/code_te2/src/explorer', file), 'utf8');
    assert.match(source, /fe-entry-icon-dir codicon codicon-folder/);
  }
  const css = await readFile(path.join(root, 'app/apps/code_te2/main_page/frontend/explorer.css'), 'utf8');
  assert.doesNotMatch(css, /fe-entry-icon-dir::before/);
});

test('lazy provider preserves every exact, extension and partial filename rule', async () => {
  const names = [...Object.keys(definitions.files), ...Object.keys(definitions.extensions).map(ext => 'file' + ext),
    ...definitions.partials.map(([partial]) => 'prefix-' + partial + '-suffix'), 'unrecognized.bin'];
  for (const name of names) assert.equal(await provider.classifyFileName(name), await getIconName(name), name);
});

test('lazy icon loads coalesce by family, never fetch inventories, and fail to Codicons', async () => {
  const calls = [];
  const api = createProvider(async url => {
    calls.push(url);
    if (url.endsWith('definitions.json')) return new Response(JSON.stringify(definitions));
    if (url.endsWith('/cpp.svg')) return new Response('not found', { status: 404 });
    if (url.endsWith('/c.svg')) return new Response('x'.repeat(65537));
    return new Response(LANGUAGE_ICONS.javascript);
  });
  await api.ensureLoaded?.();
  const icons = await Promise.all(['a.js', 'b.mjs', 'c.cjs'].map(name => api.getIcon(name)));
  assert.ok(icons.every(icon => icon.svg));
  assert.equal(calls.filter(url => url.endsWith('/javascript.svg')).length, 1);
  assert.equal((await api.getIcon('main.cpp')).codicon, 'file-code');
  assert.equal((await api.getIcon('main.c')).codicon, 'file-code');
  await api.getIcon('again.cpp');
  assert.equal(calls.filter(url => url.endsWith('/cpp.svg')).length, 1);
  assert.equal(calls.some(url => /icons\.json|language-icons\.js|seti-icons\.js/.test(url)), false);
  assert.doesNotMatch(providerSource, /^import /m);
});

test('mask icon containers have explicit height instead of depending on font or SVG content', async () => {
  assert.match(source, /\.te-fp-icon\s*\{[^}]*height:\s*16px/);
  const historyCss = await readFile(path.join(root, 'app/apps/code_te2/src/explorer/history/vscode_scm/history-tree-host.css'), 'utf8');
  assert.match(historyCss, /\.history-file-icon\s*\{[^}]*width:\s*16px;\s*height:\s*16px/);
  const template = await readFile(path.join(root, 'app/apps/code_te2/template.html'), 'utf8');
  for (const cls of ['fe-file-tab-icon', 'te2-bc-icon']) {
    assert.match(template, new RegExp('\\.' + cls + '\\s*\\{[^}]*height:\\s*16px'));
  }
});
