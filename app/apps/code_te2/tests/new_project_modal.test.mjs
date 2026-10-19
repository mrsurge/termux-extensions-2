import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {Window} from 'happy-dom';

const output = await build({entryPoints:[resolve(import.meta.dirname,'../src/explorer/chrome/new-project-modal.ts')],
  bundle:true, format:'esm', platform:'neutral', target:'es2022', write:false});
const {showNewProjectModal} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('New Project uses the shared frame and preserves local creation intent', async () => {
  const window = new Window();
  const result = showNewProjectModal(undefined,window.document);
  const root = window.document.querySelector('[data-te-dialog-surface="code-te2.new-project"]');
  assert.ok(root.querySelector('.fe-modal-card.declarative-modal-card'));
  assert.equal(window.document.getElementById('fe-new-project-style'), null);
  assert.equal(root.querySelector('input').getAttribute('autocapitalize'),'off');
  root.querySelector('.fe-btn-primary').click();
  assert.deepEqual(await result,{type:'local',url:''});
  assert.equal(root.isConnected,false);
  window.close();
});

test('Clone dropdown follows a portaled document and validates without closing', async () => {
  const source = new Window({url:'http://127.0.0.1/app/test'});
  const popup = new Window({url:'http://127.0.0.1/app/test'});
  const messages = [];
  const result = showNewProjectModal(message => messages.push(message),source.document);
  const root = source.document.querySelector('#fe-new-project-modal');
  popup.document.body.append(root);
  root.querySelector('.declarative-select-button').click();
  assert.equal(source.document.querySelector('.declarative-select-menu'),null);
  const menu = popup.document.querySelector('.declarative-select-menu');
  assert.ok(menu);
  menu.querySelectorAll('button')[1].click();
  const input = root.querySelector('input');
  assert.notEqual(input.closest('.declarative-field-row').style.display,'none');
  root.querySelector('.fe-btn-primary').click();
  assert.deepEqual(messages,['Please enter a valid Git URL']);
  assert.equal(root.isConnected,true);
  input.value = ' https://example.test/repository.git ';
  input.dispatchEvent(new popup.Event('input',{bubbles:true}));
  input.dispatchEvent(new popup.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.deepEqual(await result,{type:'clone',url:'https://example.test/repository.git'});
  assert.equal(popup.document.querySelector('.declarative-select-menu'),null);
  source.close();popup.close();
});

for (const action of ['button','escape','backdrop','header']) test(`New Project cancels exactly once via ${action}`, async () => {
  const window = new Window();
  const result = showNewProjectModal(undefined,window.document);
  const cancelled = assert.rejects(result, error => error === 'cancelled');
  const root = window.document.querySelector('#fe-new-project-modal');
  if(action === 'button') root.querySelector('.declarative-modal-footer button').click();
  if(action === 'header') root.querySelector('button[aria-label="Close"]').click();
  if(action === 'escape') root.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  if(action === 'backdrop') root.click();
  await cancelled;
  assert.equal(root.isConnected,false);
  window.close();
});
