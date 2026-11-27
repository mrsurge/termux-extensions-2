import { EXPLORER_RPC_METHODS } from '../../../src/explorer/rpc/contract.ts';
import { requestExplorerRpc } from '../../../src/explorer/rpc/client.ts';
import { recordValue } from '../../../src/rpc/value-types.ts';

export async function editWatcherExclusions(anchor: HTMLElement, toast: (message: string) => void): Promise<void> {
  const state = await requestExplorerRpc(EXPLORER_RPC_METHODS.watcherExclusionsGet);
  if (typeof state.projectPath !== 'string' || typeof state.generation !== 'number' || !anchor.isConnected)
    throw new Error('Could not load active project watcher settings');
  const doc = anchor.ownerDocument;
  const dialog = doc.createElement('dialog');
  dialog.className = 'fe-modal-card';
  dialog.style.padding = '0';
  dialog.setAttribute('aria-label', 'Watcher exclusions');
  dialog.innerHTML = `<div class="fe-modal-header"><strong>Watcher exclusions</strong></div>
    <div class="fe-modal-body"><p data-project></p><p>Enabled patterns are added to this project’s VS Code file watcher.</p>
    <div class="ext-cfg-array-rows" data-rows></div><button class="fe-btn" data-add>Add pattern</button>
    <details><summary>Workspace rules (.vscode/settings.json)</summary><pre data-inherited></pre></details>
    <p data-error role="status"></p></div>
    <div class="fe-modal-actions"><button class="fe-btn" data-cancel>Cancel</button>
    <button class="fe-btn fe-btn-primary" data-save>Save exclusions</button></div>`;
  const el = (name: string) => dialog.querySelector<HTMLElement>(`[data-${name}]`)!;
  const previous = recordValue(state.exclusions);
  const rows = new Map<HTMLElement, {pattern: HTMLInputElement; enabled: HTMLInputElement}>();
  function add(value: string, enabled: boolean) {
    const row = doc.createElement('div'); row.className = 'ext-cfg-array-row';
    const check = doc.createElement('input'); check.type = 'checkbox'; check.checked = enabled;
    check.setAttribute('aria-label', 'Enable pattern');
    const input = doc.createElement('input'); input.className = 'lsp-rootrel-input ext-cfg-arr-input';
    input.placeholder = '**/build/**'; input.value = value; input.setAttribute('aria-label', 'Exclusion glob');
    const remove = doc.createElement('button'); remove.className = 'fe-btn'; remove.textContent = 'Remove';
    remove.onclick = () => { row.remove(); rows.delete(row); };
    row.append(check,input,remove); el('rows').append(row); rows.set(row,{pattern:input,enabled:check});
    return input;
  }
  el('project').textContent = state.projectPath;
  el('inherited').textContent = Object.entries(recordValue(state.workspace))
    .map(([key,value]) => `${value === true ? 'On' : 'Off'}   ${key}`).join('\n') || 'No workspace rules.';
  if (typeof state.warning === 'string') el('error').textContent = state.warning;
  for (const [pattern,enabled] of Object.entries(previous)) add(pattern,enabled === true);
  el('add').onclick = () => add('',true).focus();
  const save = dialog.querySelector<HTMLButtonElement>('[data-save]')!;
  el('cancel').onclick = () => dialog.close();
  save.onclick = async () => {
    const entries = new Map<string,boolean>();
    for (const {pattern,enabled} of rows.values()) {
      const key = pattern.value.trim();
      if (!key || entries.has(key)) { el('error').textContent = 'Enter a unique glob for each row.'; pattern.focus(); return; }
      entries.set(key,enabled.checked);
    }
    save.disabled = true;
    try {
      const result = await requestExplorerRpc(EXPLORER_RPC_METHODS.watcherExclusionsSet, {
        projectPath:state.projectPath, generation:state.generation, previous, exclusions:Object.fromEntries(entries),
      });
      dialog.close();
      if (result.changed === true) toast('Watcher exclusions saved. Refreshing intelligence settings…');
    } catch (error) { el('error').textContent = String(error); save.disabled = false; }
  };
  doc.body.append(dialog);
  try {
    dialog.showModal();
    await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), {once:true}));
  } finally { dialog.remove(); }
}
