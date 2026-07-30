import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

async function importHostChromeRuntime() {
  const result = await build({
    entryPoints: [path.join(appRoot, 'main_page/frontend/host-chrome-runtime.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('toolbar issue counter owns the next-issue action', async () => {
  const { createHostChromeRuntime } = await importHostChromeRuntime();
  const issuesButton = new EventTarget();
  issuesButton.disabled = true;
  issuesButton.textContent = '';
  const requests = [];
  const runtime = createHostChromeRuntime({
    issuesBadgesEl: issuesButton,
    basename: (value) => value,
    toAbsolute: (value) => value,
    homeDir: '',
    getCurrentPath: () => '',
    getCachedProjectRoot: () => '',
    getProblemsDetail: () => ({}),
    pickerAvailable: () => false,
    saveFileWithPicker: async () => null,
    apiPost: async () => ({}),
    getClientId: () => 'test',
    requestBackendEditorIssuesCommand: async (payload) => {
      requests.push(payload);
    },
    toast: () => {},
    confirm: async () => false,
  });

  runtime.install();
  runtime.setIssuesButtonsEnabled(true);
  issuesButton.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(issuesButton.disabled, false);
  assert.deepEqual(requests, [{ action: 'next' }]);
});

test('toolbar and Drafts overlay keep the intended source structure', async () => {
  const [template, overlay, reviewRenderer] = await Promise.all([
    readFile(path.join(appRoot, 'template.html'), 'utf8'),
    readFile(path.join(appRoot, 'src/explorer/search/overlay-controller.ts'), 'utf8'),
    readFile(path.join(appRoot, 'src/explorer/search/review-results-renderer.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(template, /id="fe-issues-toggle"/);
  assert.match(template, /<button id="fe-issues-badges"[^>]+disabled>/);
  assert.match(
    template,
    /id="fe-drawer-open" class="fe-menu-btn fe-agent-toggle"/,
  );
  assert.match(template, /#menu-branch-dd\s*\{[^}]*right:\s*-45px/);
  const desktopToolbarZ = Number(
    template.match(
      /\.layout-desktop \.fe-toolbar\s*\{[\s\S]*?z-index:\s*(\d+)/,
    )?.[1],
  );
  const desktopSidebarZ = Number(
    template.match(
      /\.layout-desktop \.agent-drawer\s*\{[\s\S]*?z-index:\s*(\d+)/,
    )?.[1],
  );
  assert.equal(desktopToolbarZ, 40);
  assert.equal(desktopSidebarZ, 50);
  assert.ok(desktopToolbarZ < desktopSidebarZ);
  assert.match(overlay, /\{ id: "review", label: "Drafts" \}/);
  assert.doesNotMatch(reviewRenderer, /badge\.textContent = 'Draft'/);
});
