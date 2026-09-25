import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const template = fs.readFileSync(path.join(appRoot, 'template.html'), 'utf8');
const shortcuts = fs.readFileSync(
  path.join(appRoot, 'main_page/frontend/ui/drawer-shortcuts.ts'),
  'utf8',
);
const terminal = fs.readFileSync(
  path.join(appRoot, 'main_page/frontend/host-terminal-drawer.ts'),
  'utf8',
);

test('status bar exposes an accessible bottom-panel toggle', () => {
  assert.match(
    template,
    /id="drawer-status-toggle"[^>]+aria-controls="terminal-drawer"[^>]+aria-expanded="false"/,
  );
  assert.match(template, /\.drawer-status-toggle\[aria-expanded="true"\]/);
});

test('bottom-panel toggle restores the selected available tab without forcing terminal', () => {
  assert.match(shortcuts, /const selectedTab = \(\) =>/);
  assert.match(shortcuts, /isAvailableTab\(active\) \? active : availableTerminalTab\(\)/);
  assert.match(shortcuts, /if \(deps\.isDrawerOpen\(\)\) \{\s*deps\.closeDrawer\(\)/);
  assert.match(shortcuts, /if \(tab\) activateTab\(tab, true\)/);
  assert.match(shortcuts, /target === 'console'[\s\S]*?if \(openDrawer\) deps\.openDrawer\(\)/);
});

test('drawer lifecycle publishes local visibility for status synchronization', () => {
  assert.match(terminal, /DRAWER_VISIBILITY_EVENT = 'te2:drawer-visibility-changed'/);
  assert.match(terminal, /detail: \{ open: true \}/);
  assert.match(terminal, /detail: \{ open: false \}/);
  assert.match(shortcuts, /syncStatusToggle\(detail\?\.open === true\)/);
});
