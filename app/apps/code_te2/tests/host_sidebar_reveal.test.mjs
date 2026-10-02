import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const bundled = await build({
  entryPoints: [new URL('../main_page/frontend/host-sidebar-runtime.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { createHostSidebarRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

for (const mobile of [true, false]) {
  for (const reveal of [true, false]) {
    test(`explicit sidebar reveal=${reveal}, mobile=${mobile}`, () => {
      const dom = new Window();
      Object.assign(globalThis, { window: dom, document: dom.document, HTMLElement: dom.HTMLElement });
      document.body.innerHTML = `<div class="fe-root drawer-open ${mobile ? 'layout-mobile' : ''}"></div><div id="sidebar"></div>`;
      const root = document.querySelector('.fe-root');
      const drawer = document.getElementById('sidebar');
      const published = [];
      createHostSidebarRuntime({ drawerEl: drawer, toggleButtonEl: null, closeButtonEl: null,
        emitSidebarRpcNotification: (method, payload) => published.push({ method, payload }),
      }).install();
      const activate = () => window.dispatchEvent(new dom.CustomEvent('code-te2:sidebar-event', {
        detail: { type: 'sidebar.window.activated', payload: { revealSidebar: reveal } },
      }));
      activate();
      assert.equal(drawer.classList.contains('open'), reveal);
      assert.equal(root.classList.contains('drawer-open'), !(mobile && reveal));
      if (reveal) {
        activate();
        assert.equal(drawer.classList.contains('open'), true, 'reveal is not a toggle');
        assert.equal(drawer.getAttribute('aria-hidden'), 'false');
        assert.equal(published[0].payload.open, true);
      } else {
        assert.equal(published.length, 0, 'restore activation does not alter layout');
      }
      dom.happyDOM.abort();
    });
  }
}
