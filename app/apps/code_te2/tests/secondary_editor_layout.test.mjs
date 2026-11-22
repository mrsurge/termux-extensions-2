import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const template = readFileSync(new URL('../template.html', import.meta.url), 'utf8');

function declaration(selector, property) {
  const marker = `${selector} {`;
  const start = template.indexOf(marker);
  assert.notEqual(start, -1, `Missing layout rule: ${selector}`);
  assert.equal(template.indexOf(marker, start + marker.length), -1, `Duplicate layout rule: ${selector}`);
  const body = template.slice(start + marker.length, template.indexOf('}', start));
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+);`));
  assert.ok(match, `Missing ${property} in ${selector}`);
  return match[1].trim();
}

test('desktop secondary editor and vertical divider stop before the terminal row', () => {
  assert.equal(declaration('.layout-desktop .fe-editor-container', 'grid-row'), '3');
  for (const selector of [
    '.layout-desktop .te2-secondary-editor-host',
    '.layout-desktop.te2-secondary-editor-docked .resize-handle--secondary',
  ]) {
    assert.equal(declaration(selector, 'grid-column'), selector.endsWith('-host') ? '5' : '4');
    assert.equal(declaration(selector, 'grid-row'), '2 / 4');
  }
});

test('desktop terminal and its resize handle span both editor columns', () => {
  for (const selector of [
    '.layout-desktop .terminal-drawer',
    '.layout-desktop .resize-handle--terminal',
  ]) {
    assert.equal(declaration(selector, 'grid-column'), '3 / 6');
    assert.equal(declaration(selector, 'grid-row'), selector.endsWith('terminal-drawer') ? '5' : '4');
  }
  // The native secondary WebContentsView paints above DOM content. Keep the
  // sash centered in its own row, outside the native pane's bounds.
  assert.equal(declaration('.layout-desktop .resize-handle--terminal', 'margin-top'), '0');
});

test('side rails retain their full height and mobile resize geometry is unchanged', () => {
  for (const selector of ['.layout-desktop .fe-drawer', '.layout-desktop .agent-drawer']) {
    assert.equal(declaration(selector, 'grid-row'), '1 / 6');
  }
  assert.equal(declaration('.layout-mobile .resize-handle--terminal', 'grid-column'), '1');
  assert.equal(declaration('.layout-mobile .resize-handle--terminal', 'grid-row'), '4');
  const handle = '.layout-mobile .resize-handle--terminal';
  assert.equal(declaration(handle, 'margin-top'), 'calc(0px - var(--editor-overlay-bottom))');
  assert.equal(declaration(handle, 'height'), 'calc(var(--editor-overlay-bottom) + var(--split-rail-size) + var(--drawer-tab-pad))');
});
