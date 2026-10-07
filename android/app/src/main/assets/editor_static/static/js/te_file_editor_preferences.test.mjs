import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditorPreferences } from './te_file_editor_preferences.mjs';
import { createGuardedNavigation } from './te_guarded_navigation.mjs';

test('all five preferences persist without document data', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const create = () => createEditorPreferences({ storage: () => storage, themes: { 'cm6-dark': {}, termux: {} } });
  const settings = { showLineNumbers: false, showLineShading: true, showSyntaxHighlight: false, wordWrap: true, theme: 'termux' };
  create().save({ ...settings, draft: 'secret', lastPath: '/file', token: 'credential' });
  assert.deepEqual(create().load(), settings);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), Object.keys(settings).sort());
});

test('malformed storage, unavailable themes and storage failures use safe defaults', () => {
  for (const getItem of [() => '{', () => { throw Error('blocked'); }, () => '{"theme":"unknown","wordWrap":"yes"}']) {
    const prefs = createEditorPreferences({ storage: () => ({ getItem, setItem: () => { throw Error('full'); } }), themes: { 'cm6-dark': {} } });
    assert.equal(prefs.load().theme, 'cm6-dark');
    assert.equal(prefs.load().wordWrap, false);
    assert.doesNotThrow(() => prefs.save({}));
  }
});

test('pending confirmation retains only the first navigation and resumes exactly once', async () => {
  let resolve;
  let calls = 0;
  const request = createGuardedNavigation({ needsConsent: () => true, confirm: () => new Promise(done => { resolve = done; }) });
  const first = request(() => { calls++; });
  assert.equal(await request(() => { calls += 100; }), false);
  resolve(true);
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test('cancel and failed consent do not navigate; later attempts still work', async () => {
  let allowed = false;
  let calls = 0;
  const request = createGuardedNavigation({ needsConsent: () => true, confirm: async () => allowed });
  assert.equal(await request(() => { calls++; }), false);
  allowed = true;
  assert.equal(await request(() => { calls++; }), true);
  assert.equal(calls, 1);
  const failed = createGuardedNavigation({ needsConsent: () => true, confirm: async () => { throw Error('save failed'); } });
  await assert.rejects(failed(() => { calls++; }), /save failed/);
  assert.equal(calls, 1);
});

test('actual CM6 confirmation handlers discard then resume, or retain failed-save guard', async () => {
  const source = readFileSync(new URL('../../apps/file_editor/main.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('let confirmResolve = null;'), source.indexOf('// ---------- State load/init'));
  const buttons = Array.from({ length: 4 }, () => ({ addEventListener(_, handler) { this.click = handler; } }));
  let text = 'draft', dirty = true, shown = false, saves = false, navigations = 0;
  const request = new Function('createGuardedNavigation', 'confirmClose', 'btnCancel', 'btnDiscard', 'btnSaveConfirm',
    'setText', 'markUnsaved', 'showConfirm', 'hideConfirm', 'saveFile', 'isDirty',
    `const lastSavedContent = 'disk'; ${code.replace('() => unsaved', '() => isDirty()')} return guardedNavigation;`)(
    createGuardedNavigation, ...buttons, value => { text = value; }, flag => { dirty = flag; },
    () => { shown = true; }, () => { shown = false; }, async () => saves, () => dirty);
  const discard = request(() => { navigations++; });
  buttons[2].click();
  assert.equal(await discard, true);
  assert.equal(text, 'disk'); assert.equal(dirty, false); assert.equal(navigations, 1);
  dirty = true;
  const failedSave = request(() => { navigations++; });
  await buttons[3].click();
  assert.equal(shown, true); assert.equal(navigations, 1);
  buttons[1].click();
  assert.equal(await failedSave, false);
  const saved = request(() => { navigations++; });
  saves = true;
  await buttons[3].click();
  assert.equal(await saved, true); assert.equal(navigations, 2);
});

test('actual app-shell exit awaits consent and keeps the original navigation only', async () => {
  const source = readFileSync(new URL('../../templates/app_shell.html', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const guardedExit ='), source.indexOf("window.addEventListener('beforeunload'"));
  let resolve, calls = 0, states = 0;
  const window = { __appBeforeExitHandler: () => new Promise(done => { resolve = done; }) };
  const request = new Function('createGuardedNavigation', 'window', 'host', `${code} return attemptExit;`)(
    createGuardedNavigation, window, { saveState() { states++; } });
  const original = request(() => { calls++; });
  await request(() => { calls += 100; });
  assert.equal(calls, 0);
  resolve({ lastPath: '/file' });
  await original;
  assert.equal(calls, 1); assert.equal(states, 1);
});

test('both File Explorer hidden controls update and persist the effective value immediately', () => {
  const source = readFileSync(new URL('../../apps/file_explorer/main.js', import.meta.url), 'utf8');
  const menu = source.slice(source.indexOf('"view:toggle-hidden": () => {') + '"view:toggle-hidden": () => {'.length,
    source.indexOf('"view:sort-name":')).replace(/},\s*$/, '');
  const marker = 'ui.toggleHidden.addEventListener("change", () => {';
  const checkbox = source.slice(source.indexOf(marker) + marker.length, source.indexOf('});', source.indexOf(marker)));
  for (const code of [menu, checkbox]) {
    const ui = { toggleHidden: { checked: true } };
    let stored, loads = 0;
    new Function('ui', 'persist', 'load', `let showHidden = false;
      const state = { currentPath: '/project' };
      const persistState = () => persist(showHidden);
      const updateViewMenuState = () => {};
      const loadDirectory = load;
      ${code}`)(ui, value => { stored = value; }, () => { loads++; });
    assert.equal(stored, true); assert.equal(loads, 1);
  }
  assert.match(source, /showHidden,\s*view: state.view/);
});
