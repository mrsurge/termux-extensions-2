import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('only mouse activation tracks another title, until dismissal', async () => {
  const window = new Window();
  try {
    const doc = window.document;
    doc.body.innerHTML = await readFile(new URL('../template.html', import.meta.url), 'utf8');
    const bundle = await build({
      stdin: { contents: `export {createMenuCoreController} from './main_page/frontend/ui/menu-core.ts';
        export {initBranchMenu} from './main_page/frontend/host-git-branch-menu.ts';`,
        resolveDir: process.cwd() },
      bundle: true, format: 'iife', globalName: 'Menus', write: false,
    });
    const api = window.eval(bundle.outputFiles[0].text + ';Menus');
    const btn = name => doc.querySelector('#menu-' + name + '-btn');
    const panel = name => doc.querySelector('#menu-' + name + '-dd');
    let finishBranches;
    const branch = api.initBranchMenu({ requestUiIpc: () => new Promise(r => { finishBranches = r; }) });
    const deps = {
      getBranchMenuHandle: () => branch, getAgentShortcutLoadBtn: () => null,
      getAgentShortcutLoadDD: () => null, runActiveBtn: doc.querySelector('#run-active-file-btn'),
      stopRunProfilesBtn: doc.querySelector('#stop-run-profiles-btn'),
    };
    for (const name of ['file', 'edit', 'editor', 'view']) {
      const key = 'menu' + name[0].toUpperCase() + name.slice(1);
      deps[key + 'Btn'] = btn(name);
      deps[key + 'DD'] = panel(name);
    }
    api.createMenuCoreController(deps).installPrimaryMenuButtons();
    const send = (name, type, pointerType) => btn(name).dispatchEvent(
      new window.PointerEvent(type, { pointerType, detail: 1, bubbles: type === 'click' }));
    const open = () => ['file', 'edit', 'editor', 'view', 'branch'].filter(n => panel(n).classList.contains('show'));
    send('edit', 'pointerenter', 'mouse');
    assert.deepEqual(open(), []);
    send('file', 'click', 'touch');
    send('view', 'pointerenter', 'mouse');
    assert.deepEqual(open(), ['file']);
    send('file', 'click', 'touch');
    send('edit', 'click', 'mouse');
    send('file', 'pointerenter', 'touch');
    assert.deepEqual(open(), ['edit']);
    send('branch', 'pointerenter', 'mouse');
    assert.deepEqual(open(), ['branch']);
    send('editor', 'pointerenter', 'mouse');
    finishBranches({ current: 'main', branches: ['main'] });
    await Promise.resolve();
    assert.deepEqual(open(), ['editor']);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
    send('file', 'pointerenter', 'mouse');
    assert.deepEqual(open(), []);
    btn('file').click();
    send('edit', 'pointerenter', 'mouse');
    assert.deepEqual(open(), ['file']);
    doc.body.click();
    send('view', 'pointerenter', 'mouse');
    assert.deepEqual(open(), []);
  } finally {
    await window.happyDOM.abort();
    window.close();
  }
});
