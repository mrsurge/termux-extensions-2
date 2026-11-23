import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

test('offline probes settle and explicit launcher refresh still checks once', async () => {
  const source = file => readFile(new URL('../desktop_client/android_shell/' + file, import.meta.url), 'utf8');
  class Element extends EventTarget {
    children = [];
    dataset = {};
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren() { this.children = []; }
  }
  const root = new Element();
  const refreshButton = new Element();
  let publish, reads = 0, appsRefreshes = 0;
  const desktopShellHost = {
    onLocalFrameworkState(callback) { publish = callback; return () => {}; },
    async getLocalFrameworkState() {
      assert.ok(++reads <= 2, 'state notification started another local probe');
      const state = {supported: true, commandDetected: true, ownership: 'none', selected: false};
      publish({...state, phase: 'probing'});
      await Promise.resolve();
      const idle = {...state, phase: 'idle'};
      publish(idle);
      return idle;
    },
    async reloadApps() {},
    toast(message) { assert.fail(message); },
  };
  const context = vm.createContext({
    document: {querySelector: id => id === '#launcher-root' ? root : refreshButton,
      createElement: () => new Element()},
    window: new EventTarget(), CustomEvent: Event, desktopShellHost,
    appsExtension: {id: 'apps', mount: () => ({async refresh() { appsRefreshes++; }})},
  });
  vm.runInContext((await source('extensions/local-framework.js')).replace('export const', 'const'), context);
  vm.runInContext('const launcherExtensions = [localFrameworkExtension, appsExtension]', context);
  vm.runInContext((await source('launcher.js')).replace(/^import .*;$/gm, ''), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  assert.equal(reads, 1);
  assert.ok(appsRefreshes >= 1);
  refreshButton.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(reads, 2);
  const card = root.children[0].children[0];
  assert.equal(card.dataset.phase, 'idle');
  const button = card.children[1].children[0];
  assert.equal(button.textContent, 'Start Local');
  assert.equal(button.disabled, false);
});
