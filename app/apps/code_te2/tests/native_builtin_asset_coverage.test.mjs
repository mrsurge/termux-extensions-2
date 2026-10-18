import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../../../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const bundle = JSON.parse(read('app/android_editor_assets_bundle.json'));
const desktop = JSON.parse(read('desktop_client/desktop_asset_inventory.json'));
const geckoSource = read('android/app/src/gecko/assets/asset_intercept/background.js');
const gecko = vm.runInNewContext(geckoSource.slice(geckoSource.indexOf('const LOCAL_PREFIXES'), geckoSource.indexOf('browser.webRequest.onBeforeRequest')) + '\nlocalPathFor;');
const cefSource = read('android/cefrium/src/main/java/com/termux/extensions/CefriumAssetRoutes.kt');
const cefEntries = new Map([...cefSource.matchAll(/"([^"\n]+)" to "([^"\n]+)"/g)].map(m => [m[1], m[2]]));
const apps = ['als_rs', 'archive_manager', 'aria_downloader', 'code_te2', 'file_editor', 'file_explorer', 'settings', 'terminal'];
const assets = apps.flatMap(dir => {
  const manifest = JSON.parse(read(`app/apps/${dir}/manifest.json`));
  return ['frontend_template', 'frontend_script'].map(key => {
    const path = manifest.entrypoints[key].split('?')[0];
    return { source: `app/apps/${dir}/${path}`, canonical: `/apps/${dir}/${path}`, alias: `/apps/by-id/${manifest.id}/${path}` };
  });
});
function packagedSource(url) {
  const path = url.slice(1);
  const entry = bundle.entries.find(e => e.dest === path || e.kind === 'tree' && path.startsWith(e.dest + '/'));
  assert.ok(entry, `not packaged: ${url}`);
  const source = entry.kind === 'tree' ? entry.src + path.slice(entry.dest.length) : entry.src;
  assert.ok(fs.statSync(new URL(source, root)).isFile(), `missing source: ${source}`);
  return source;
}
function desktopPath(url) {
  if (!desktop.localFiles.includes(url) && !desktop.localPrefixes.some(prefix => url.startsWith(prefix))) return null;
  const mapping = desktop.localMappings.find(m => m.kind === 'exact' ? m.source === url : url.startsWith(m.source));
  return mapping ? mapping.destination + (mapping.kind === 'prefix' ? url.slice(mapping.source.length) : '') : url;
}

test('all built-in entry resources are inventoried and route locally under canonical/by-ID URLs', () => {
  for (const asset of assets) {
    assert.equal(packagedSource(asset.canonical), asset.source);
    for (const url of [asset.canonical, asset.alias]) {
      assert.equal(desktopPath(url), asset.canonical, `Electron ${url}`);
      assert.equal(gecko(url), asset.canonical, `Gecko ${url}`);
      if (!url.includes('/code_te2/')) assert.equal(cefEntries.get(url), asset.canonical, `Cefrium/Termux ${url}`);
    }
  }
});

test('new entry resources are required before OTA activation', () => {
  const android = read('android/app/src/main/java/com/termux/extensions/EditorAssetManager.kt');
  for (const asset of assets.filter(a => !a.canonical.includes('/code_te2/'))) {
    assert.ok(desktop.requiredFiles.includes(asset.canonical.slice(1)));
    assert.ok(android.includes(`"${asset.canonical.slice(1)}"`));
  }
});

test('terminal helper assets and generated File Explorer dependencies are packaged and routed', () => {
  const helpers = ['touch_to_mouse_handler.js', 'ctrl_key_handler.js', 'enable_ctrl_key.js', 'disable_ctrl_key.js'];
  for (const file of helpers) {
    const canonical = `/apps/terminal/vendor/android-terminalapp-assets-js/${file}`;
    for (const url of [canonical, `/apps/by-id/terminal/vendor/android-terminalapp-assets-js/${file}`]) {
      assert.equal(desktopPath(url), canonical); assert.equal(gecko(url), canonical);
      assert.ok(cefSource.includes('"/apps/terminal/vendor/android-terminalapp-assets-js/"'));
    }
    packagedSource(canonical);
  }
  for (const name of ['file_explorer_main.js', 'file_explorer_terminal.js', 'file_explorer_codec.js', 'file_explorer_tabs.mjs', 'file_explorer_filter.mjs', 'file_explorer_selection.mjs', 'file_picker_filter_worker.js', 'file_icons.js', 'te_file_explorer_intents.mjs']) {
    const url = `/static/js/${name}`;
    packagedSource(url); assert.equal(desktopPath(url), url); assert.equal(gecko(url), url);
    assert.ok(cefSource.includes('"/static/js/"'));
  }
});

test('dynamic/private/custom-app routes remain outside local interception', () => {
  for (const url of ['/api/apps/catalog', '/api/app/file_explorer/socket.io', '/apps/by-id/file_explorer/file_explorer.py', '/apps/file_explorer/src/main.ts', '/apps/by-id/custom/main.js', '/apps/custom/template.html']) {
    assert.equal(desktopPath(url), null); assert.equal(gecko(url), null);
    assert.equal(cefEntries.has(url), false);
  }
  const retired = '/apps/code_te2/static/dist/explorer-highlight-github.css';
  assert.equal(desktopPath(retired), null); assert.equal(gecko(retired), null); assert.ok(!cefSource.includes(retired));
});

test('Terminal manifest cache query matches its declared version', () => {
  const manifest = JSON.parse(read('app/apps/terminal/manifest.json'));
  assert.equal(new URL(manifest.entrypoints.frontend_script, 'http://localhost/').searchParams.get('v'), manifest.version);
});

test('Sidebar metadata and the font relative to either Monaco CSS URL stay local', () => {
  const sidebar = '/apps/code_te2/extensions/sidebar_extension/manifest.json';
  assert.equal(packagedSource(sidebar), 'app' + sidebar);
  assert.equal(desktopPath(sidebar), sidebar);
  assert.equal(gecko(sidebar), sidebar);
  assert.equal(cefEntries.get(sidebar), sidebar);
  const canonicalCss = '/static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.css';
  const aliasCss = '/api/app/code_te2/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css';
  const css = read(packagedSource(canonicalCss));
  const font = css.match(/url\(["']?(\.\/codicon-[^"')]+\.ttf)["']?\)/)?.[1];
  assert.ok(font, 'derive the font URL from shipped CSS rather than assume its hash');
  for (const cssUrl of [canonicalCss, aliasCss]) {
    const url = new URL(font, 'http://localhost' + cssUrl).pathname;
    const mapped = desktopPath(url);
    assert.equal(gecko(url), mapped);
    assert.ok(mapped, `font not intercepted: ${url}`);
    packagedSource(mapped);
    assert.ok(cefSource.includes(`"${url}"`), `Cefrium/Termux font admission: ${url}`);
  }
  for (const url of ['/apps/code_te2/extensions/sidebar_extension/private.json',
    '/api/app/code_te2/ui/monaco_vscode/lang/bootstrap/private.js']) {
    assert.equal(desktopPath(url), null);
    assert.equal(gecko(url), null);
  }
});

test('built-in literal static dependency graph is packaged after URL mapping', () => {
  // This scans literal URLs/imports/CSS references, not arbitrary JS execution.
  // Computed icon-family paths and ALS's full inventory have separate tests.
  const queue = [...assets.map(asset => asset.canonical),
    '/static/js/te_ui.js', '/static/js/file_picker.js',
    '/static/js/ws_port.js', '/static/js/te_state.js'];
  const visited = new Set();
  while (queue.length) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const mapped = desktopPath(url);
    assert.ok(mapped, `Electron dependency not intercepted: ${url}`);
    assert.equal(gecko(url), mapped, `Gecko dependency: ${url}`);
    const source = packagedSource(mapped);
    if (!/\.(?:m?js|html|css)$/.test(source)) continue;
    const text = read(source).replace(/^\s*\/\/.*$/gm, '');
    const references = [...text.matchAll(/["'`]((?:\/static\/|\/apps\/|\/api\/app\/code_te2\/ui\/)[^"'`\s<>${}]+)["'`]/g)].map(m => m[1]);
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\()["'](\.[^"']+)["']/g)) {
      references.push(new URL(match[1], 'http://localhost' + url).pathname);
    }
    for (const match of text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g)) {
      if (!match[1].startsWith('data:')) references.push(new URL(match[1], 'http://localhost' + url).pathname);
    }
    for (const ref of references) {
      const path = ref.split('?')[0].split('#')[0];
      if (/\.(?:m?js|html|css|woff2?|ttf|svg|png|wasm|json)$/.test(path)) queue.push(path);
    }
  }
  for (const dependency of ['/static/js/file_explorer_main.js', '/static/js/te_dialog.mjs',
    '/static/vendor/codemirror.1/codemirror.bundle.js', '/static/vendor/xterm/xterm.js',
    '/apps/code_te2/extensions/sidebar_extension/manifest.json']) assert.ok(visited.has(dependency));
});
