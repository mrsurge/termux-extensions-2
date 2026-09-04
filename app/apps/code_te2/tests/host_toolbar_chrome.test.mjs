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
  const [template, inlineHost, overlay, reviewRenderer, resizeManager, secondaryRuntime] = await Promise.all([
    readFile(path.join(appRoot, 'template.html'), 'utf8'),
    readFile(path.join(appRoot, 'monaco_editor/inline_host.ts'), 'utf8'),
    readFile(path.join(appRoot, 'src/explorer/search/overlay-controller.ts'), 'utf8'),
    readFile(path.join(appRoot, 'src/explorer/search/review-results-renderer.ts'), 'utf8'),
    readFile(path.join(appRoot, 'main_page/frontend/host-resize-manager.ts'), 'utf8'),
    readFile(path.join(appRoot, 'main_page/frontend/secondary-editor-runtime.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(template, /id="fe-issues-toggle"/);
  assert.match(template, /<button id="fe-issues-badges"[^>]+disabled>/);
  assert.match(
    template,
    /id="fe-drawer-open" class="fe-menu-btn fe-agent-toggle"/,
  );
  assert.match(template, /#menu-branch-dd\s*\{[^}]*right:\s*-45px/);
  assert.match(
    template,
    /#fe-extension-editor-actions\s*\{[^}]*overflow-x:\s*auto[^}]*touch-action:\s*pan-x/,
  );
  assert.match(
    template,
    /\.fe-extension-editor-action\s*\{[^}]*flex:\s*0 0 28px/,
  );
  assert.match(
    template,
    /\.layout-desktop \.fe-toolbar\s*\{[\s\S]*?grid-column:\s*2 \/ 4/,
  );
  assert.match(
    template,
    /\.layout-desktop \.te2-secondary-editor-host\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*2 \/ 5/,
  );
  assert.match(
    template,
    /\.layout-desktop \.agent-drawer\s*\{[\s\S]*?grid-column:\s*4/,
  );
  assert.match(
    template,
    /<div id="secondary-editor-host" class="te2-secondary-editor-host" aria-hidden="true"><\/div>/,
  );
  assert.match(
    template,
    /class="resize-handle resize-handle--secondary" data-panel="secondary"/,
  );
  assert.match(
    template,
    /\.layout-desktop\.te2-secondary-editor-docked \.resize-handle--secondary\s*\{[\s\S]*?grid-column:\s*3/,
  );
  assert.match(resizeManager, /code-te2:secondary-editor-resize-start/);
  assert.match(resizeManager, /code-te2:secondary-editor-resize-end/);
  assert.match(secondaryRuntime, /clearPrimaryTemplateSurfaces\(rootEl\)/);
  assert.match(secondaryRuntime, /\['LINK', 'META', 'STYLE', 'TITLE'\]/);
  assert.doesNotMatch(secondaryRuntime, /rootEl\.replaceChildren\(\)/);
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
  assert.match(
    template,
    /\.layout-desktop \.fe-editor-container\s*\{[\s\S]*?overflow:\s*visible/,
  );
  assert.match(
    template,
    /\.layout-mobile \.fe-editor-container\s*\{[\s\S]*?overflow:\s*visible/,
  );
  assert.match(template, /#editor-frame\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(
    template,
    /\.fe-root:has\(\.fe-dropdown\.show\) \.fe-editor-container,[\s\S]*?\.fe-root\.layout-mobile:has\(\.agent-drawer\.open\) \.fe-editor-container,[\s\S]*?body:has\(> \.fe-file-tab-context-menu\) \.fe-editor-container[\s\S]*?z-index:\s*0/,
  );
  assert.match(
    inlineHost,
    /\.monaco-resizable-hover,[\s\S]*?\.overflowingOverlayWidgets > \.monaco-hover[\s\S]*?z-index:\s*300 !important/,
  );
  assert.match(overlay, /\{ id: "review", label: "Drafts" \}/);
  assert.doesNotMatch(reviewRenderer, /badge\.textContent = 'Draft'/);
});
