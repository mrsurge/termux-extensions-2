import { buildDiffBaseOptions } from '../../../src/explorer/git/diff-base-controller.ts';

type Data = Record<string, unknown>;
function record(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

export function installComparisonStatus(deps: {
  getState(): unknown;
  getPath(): string;
  request(payload: Data): Promise<unknown>;
}): void {
  const root = document.getElementById('comparison-status');
  if (!root) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'comparison-status-button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  root.append(button);
  let base: Data = {};
  let mode = 'plain';
  let project = '';
  let menu: HTMLDivElement | null = null;
  let generation = 0;

  function close(): void {
    generation++;
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
  }

  function render(): void {
    const filename = deps.getPath().split('/').pop() || 'No file';
    const commit = record(base.commit);
    const short = String(commit.short || String(commit.hash || '').slice(0, 8));
    const ref = String(base.ref || 'HEAD');
    const label = ref === 'HEAD' ? `HEAD${short ? ' · ' + short : ''}` : short || ref.slice(0, 10);
    button.textContent = `${filename}${mode === 'commit' ? ' @ ' + label : mode === 'disk' ? ' @ disk' : ''} ▴`;
    button.title = mode === 'commit' ? `Compare against ${ref}${commit.subject ? ': ' + commit.subject : ''}` : 'Editor comparison mode';
    button.classList.toggle('comparison-historical', mode === 'commit' && ref !== 'HEAD');
    button.disabled = !project;
  }

  function apply(value: unknown): void {
    const data = record(value);
    if (data.projectPath !== project) return;
    base = record(data.diffBase);
    if (typeof data.mode === 'string') mode = data.mode;
    render();
  }

  function hydrate(): void {
    const state = record(deps.getState());
    const nextProject = String(state.activeProject || '');
    if (nextProject !== project) { close(); project = nextProject; base = {}; }
    if (state.gitDiffBase) base = record(state.gitDiffBase);
    const prefs = record(record(state.preferences).editor);
    mode = prefs.showDraftDiffs && !prefs.autoSave ? 'disk' : prefs.showInlineDiffs ? 'commit' : 'plain';
    render();
  }

  async function open(): Promise<void> {
    if (menu) { close(); return; }
    menu = document.createElement('div');
    const currentMenu = menu;
    menu.className = 'comparison-status-menu fe-dropdown show';
    menu.setAttribute('role', 'menu');
    menu.textContent = 'Loading comparisons…';
    document.body.append(menu);
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 326)) + 'px';
    menu.style.bottom = Math.max(6, window.innerHeight - rect.top + 4) + 'px';
    menu.style.maxHeight = Math.max(80, rect.top - 12) + 'px';
    const token = ++generation;
    const requestedProject = project;
    try {
      const data = record(await deps.request({ projectPath: project, commits: true }));
      if (generation !== token || project !== requestedProject || menu !== currentMenu) return;
      apply(data);
      currentMenu.replaceChildren();
      const add = (label: string, checked: boolean, change: Data): void => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'fe-dd-item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(checked));
        item.textContent = `${checked ? '✓ ' : ''}${label}`;
        item.addEventListener('click', () => {
          close();
          void deps.request({ projectPath: requestedProject, ...change }).then(apply).catch(showError);
        });
        currentMenu.append(item);
      };
      add('Plain editor', mode === 'plain', { mode: 'plain' });
      add('Versus selected commit', mode === 'commit', { mode: 'commit' });
      add('Draft versus disk (autosave off)', mode === 'disk', { mode: 'disk' });
      const divider = document.createElement('hr');
      currentMenu.append(divider);
      const commits = Array.isArray(data.commits) ? data.commits.map(value => {
        const c = record(value);
        return { hash: String(c.hash || ''), short_hash: String(c.short_hash || ''), summary: String(c.summary || '') };
      }) : [];
      const choices = buildDiffBaseOptions(commits);
      const selected = record(base.commit);
      if (typeof base.ref === 'string' && base.ref !== 'HEAD' && !choices.some(c => c.ref === base.ref)) {
        choices.unshift({ ref: base.ref, short: String(selected.short || base.ref.slice(0, 8)), summary: String(selected.subject || '') });
      }
      if (base.mode !== 'none') for (const choice of choices) {
        add(`${choice.short || choice.ref} · ${choice.summary || ''}`, base.ref === choice.ref, { ref: choice.ref, mode: 'commit' });
      }
    } catch (error) {
      if (menu === currentMenu) currentMenu.textContent = String(error);
    }
  }

  function showError(error: unknown): void {
    console.warn('[Comparison] change failed', error);
    button.title = String(error);
  }

  button.addEventListener('click', () => { void open(); });
  document.addEventListener('pointerdown', event => {
    const target = event.target;
    if (target instanceof Node && !root.contains(target) && !menu?.contains(target)) close();
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.addEventListener('resize', close);
  window.addEventListener('code-te2:comparison-host-state', hydrate);
  window.addEventListener('code-te2:comparison-changed', event => {
    if (event instanceof CustomEvent) { close(); apply(event.detail); }
  });
  window.addEventListener('code-te2:preferences-changed', event => {
    if (!(event instanceof CustomEvent)) return;
    const data = record(event.detail);
    if (data.project_path !== project) return;
    const prefs = record(record(data.preferences).editor);
    mode = prefs.showDraftDiffs && !prefs.autoSave ? 'disk' : prefs.showInlineDiffs ? 'commit' : 'plain';
    close(); render();
  });
  for (const name of ['code-te2:active-file-changed', 'code-te2:open-state-changed']) {
    window.addEventListener(name, () => { queueMicrotask(render); });
  }
  hydrate();
}
