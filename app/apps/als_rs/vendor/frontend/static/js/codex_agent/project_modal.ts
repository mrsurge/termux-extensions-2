import type { JsonObject } from './rpc/ui/contract.ts';
import { applyPathScrollLabel } from './path_label.ts';
import { diffFileIcon } from './diff/summary.ts';
import { projectGitButton, type RemoteGitAction } from './project_git_icons.ts';
import { showToast } from './toast.ts';

interface UiRpcProjectClient {
  remoteProject(options: { path: string; action: RemoteGitAction }): Promise<JsonObject>;
  getProjectSummary(options?: { conversationId?: string | null; path?: string | null; maxDiffBytes?: number }): Promise<JsonObject & { transport: string }>;
  acceptAgentDiff(options: { conversationId: string; diffId: string }): Promise<JsonObject & { transport: string }>;
  rejectAgentDiff(options: { conversationId: string; diffId: string; force?: boolean }): Promise<JsonObject & { transport: string }>;
  rejectAllAgentDiffs(options: { conversationId: string; path?: string | null }): Promise<JsonObject & { transport: string }>;
  stageProjectPaths(options?: { path?: string | null; paths?: string[] }): Promise<JsonObject & { transport: string }>;
  unstageProjectPaths(options?: { path?: string | null; paths?: string[] }): Promise<JsonObject & { transport: string }>;
  restoreProjectPaths(options?: { path?: string | null; paths?: string[] }): Promise<JsonObject & { transport: string }>;
  commitProject(options: { path?: string | null; message: string }): Promise<JsonObject & { transport: string }>;
  getTe2ProjectStatus(options?: { path?: string | null }): Promise<JsonObject & { transport: string }>;
  openTe2Project(options?: { path?: string | null }): Promise<JsonObject & { transport: string }>;
  createTe2Project(options?: { path?: string | null; adoptExisting?: boolean; open?: boolean }): Promise<JsonObject & { transport: string }>;
  openFile(payload: JsonObject): Promise<JsonObject & { transport: string }>;
  subscribeLiveNotifications?(options: {
    onNotification: (method: string, params: JsonObject) => void;
    onError?: (error: unknown) => void;
  }): () => void;
}

interface ProjectModalContext {
  uiRpc: UiRpcProjectClient;
  getConversationId(): string | null | undefined;
  getConversationCwd(): string | null | undefined;
  getProjectRoot(): string | null | undefined;
  toRelativePath(path: string | null | undefined): string;
  detectLangFromPath(path: string): string | null;
  renderDiffBlock(block: HTMLElement, text: string, filePath: string): void;
  makeCollapsible(row: HTMLElement | null, cardId: string, startExpanded: boolean, options?: Record<string, unknown>): void;
  confirmProjectAction(options: { title: string; body: string; confirmText: string }): Promise<boolean>;
  showProjectModal(): void;
  closeConversationModal(): void;
  isProjectTabActive(): boolean;
  documentRef?: Document;
}

interface ProjectModalBinding {
  openProjectModal(path?: string | null): Promise<void>;
  activateProjectTab(): Promise<void>;
  closeProjectModal(): void;
}

interface ProjectFile {
  path: string;
  oldPath: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
  bytes: number | null;
  diffBytes: number | null;
  diffTruncated: boolean;
  diffText: string;
}

interface AgentDiff {
  id: string;
  conversationId: string;
  path: string;
  abs: string;
  rel: string;
  line: number;
  column: number;
  source: string;
  createdAt: string;
  repoRoot: string;
  diffText: string;
  diffBytes: number;
  additions: number;
  deletions: number;
}

interface ProjectSummary {
  ok: boolean;
  root: string;
  branch: string | null;
  headShort: string | null;
  dirty: boolean;
  changedFiles: number;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  additions: number;
  deletions: number;
  maxDiffBytes: number;
  files: ProjectFile[];
  agentDiffs: AgentDiff[];
  truncatedFiles: boolean;
  error: string;
}

interface ProjectCollapsedState {
  categories?: Record<string, Record<string, boolean>>;
  files?: Record<string, boolean>;
}

type Te2ProjectAction = 'current' | 'switch' | 'create' | 'disabled';

interface Te2ProjectState {
  ok: boolean;
  connected: boolean;
  targetPath: string;
  currentCwd: string;
  matchesCurrent: boolean;
  known: boolean;
  reason: string;
  action: Te2ProjectAction;
}

const PROJECT_MODAL_COLLAPSED_STATE_KEY = 'projectModalCollapsedState';
const PROJECT_STATUS_CATEGORY_ORDER = [
  'modified',
  'renamed',
  'added',
  'deleted',
  'typechange',
  'conflicted',
  'unreadable',
  'clean',
  'unknown',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Project action failed.';
}

function errorData(error: unknown): JsonObject | null {
  if (!isRecord(error)) return null;
  const data = error.data;
  return isRecord(data) ? data : null;
}

function isAgentDiffMetadataMismatch(error: unknown): boolean {
  const data = errorData(error);
  if (data?.kind === 'agent_diff_metadata_mismatch') return true;
  if (!isRecord(error)) return false;
  return Number(error.code) === -32062;
}

function te2ActionValue(value: unknown): Te2ProjectAction {
  if (value === 'current' || value === 'switch' || value === 'create' || value === 'disabled') return value;
  return 'disabled';
}

function normalizeProjectFile(value: unknown): ProjectFile | null {
  if (!isRecord(value)) return null;
  const path = stringValue(value.path);
  if (!path) return null;
  return {
    path,
    oldPath: stringValue(value.old_path),
    status: stringValue(value.status) || 'modified',
    staged: value.staged === true,
    unstaged: value.unstaged === true,
    untracked: value.untracked === true,
    additions: numberValue(value.additions),
    deletions: numberValue(value.deletions),
    bytes: value.bytes != null && Number.isFinite(Number(value.bytes)) ? Number(value.bytes) : null,
    diffBytes: value.diff_bytes != null && Number.isFinite(Number(value.diff_bytes)) ? Number(value.diff_bytes) : null,
    diffTruncated: value.diff_truncated === true,
    diffText: stringValue(value.diff_text),
  };
}

function normalizeAgentDiff(value: unknown): AgentDiff | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const conversationId = stringValue(value.conversation_id);
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    path: stringValue(value.path),
    abs: stringValue(value.abs),
    rel: stringValue(value.rel),
    line: numberValue(value.line) || 1,
    column: numberValue(value.column) || 1,
    source: stringValue(value.source),
    createdAt: stringValue(value.created_at),
    repoRoot: stringValue(value.repo_root),
    diffText: stringValue(value.diff_text),
    diffBytes: numberValue(value.diff_bytes),
    additions: numberValue(value.additions),
    deletions: numberValue(value.deletions),
  };
}

function normalizeProjectSummary(value: unknown): ProjectSummary {
  const payload = isRecord(value) ? value : {};
  const rawFiles = Array.isArray(payload.files) ? payload.files : [];
  const rawAgentDiffs = Array.isArray(payload.agent_diffs) ? payload.agent_diffs : [];
  return {
    ok: payload.ok !== false,
    root: stringValue(payload.root),
    branch: stringValue(payload.branch) || null,
    headShort: stringValue(payload.head_short) || null,
    dirty: payload.dirty === true,
    changedFiles: numberValue(payload.changed_files),
    stagedFiles: numberValue(payload.staged_files),
    unstagedFiles: numberValue(payload.unstaged_files),
    untrackedFiles: numberValue(payload.untracked_files),
    additions: numberValue(payload.additions),
    deletions: numberValue(payload.deletions),
    maxDiffBytes: numberValue(payload.max_diff_bytes) || 15 * 1024,
    files: rawFiles.map(normalizeProjectFile).filter((file): file is ProjectFile => Boolean(file)),
    agentDiffs: rawAgentDiffs.map(normalizeAgentDiff).filter((diff): diff is AgentDiff => Boolean(diff)),
    truncatedFiles: payload.truncated_files === true,
    error: stringValue(payload.error),
  };
}

function normalizeTe2ProjectState(value: unknown): Te2ProjectState {
  const payload = isRecord(value) ? value : {};
  return {
    ok: payload.ok !== false,
    connected: boolValue(payload.connected),
    targetPath: stringValue(payload.target_path),
    currentCwd: stringValue(payload.current_cwd),
    matchesCurrent: boolValue(payload.matches_current),
    known: boolValue(payload.known),
    reason: stringValue(payload.reason),
    action: te2ActionValue(payload.action),
  };
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function absoluteProjectPath(root: string, path: string): string {
  if (!path || path.startsWith('/')) return path;
  return `${root.replace(/\/+$/, '')}/${path.replace(/^\.?\//, '')}`;
}

function absoluteAgentDiffPath(summary: ProjectSummary, diff: AgentDiff): string {
  return diff.abs || absoluteProjectPath(summary.root, diff.rel || diff.path);
}

function setMenuOpen(toggle: HTMLElement | null, panel: HTMLElement | null, open: boolean): void {
  if (!toggle || !panel) return;
  panel.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function statusCategory(status: string): string {
  const labels = status
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  for (const category of PROJECT_STATUS_CATEGORY_ORDER) {
    if (labels.includes(category)) return category;
  }
  return labels[0] || 'unknown';
}

function categoryLabel(category: string): string {
  if (category === 'agent-edits') return 'Agent edits';
  if (category === 'overview') return 'Overview';
  return category.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => {
    return `${prefix ? ' ' : ''}${letter.toUpperCase()}`;
  });
}

export function bindProjectModal(ctx: ProjectModalContext): ProjectModalBinding {
  const doc = ctx.documentRef || document;
  const projectDismissBtn = doc.getElementById('project-dismiss');
  const projectRefreshBtn = doc.getElementById('project-refresh');
  const projectTe2Control = doc.getElementById('project-te2-control') as HTMLButtonElement | null;
  const projectBodyEl = doc.getElementById('project-body');
  const conversationMenuToggle = doc.getElementById('conversation-menu-toggle');
  const conversationMenu = doc.getElementById('conversation-menu');
  const conversationProjectBtn = doc.getElementById('conversation-project');
  const conversationSettingsBtn = doc.getElementById('conversation-settings');
  let selectedProjectPath: string | null = null;
  let currentSummary: ProjectSummary | null = null;
  let remoteBusy = false;
  const remoteHeaderButtons = (['fetch', 'pull'] as const).map((action) => {
    const button = createRemoteButton(action);
    projectTe2Control?.before(button);
    return button;
  });

  function createRemoteButton(action: RemoteGitAction): HTMLButtonElement {
    const button = projectGitButton(doc, action);
    button.disabled = remoteBusy || !currentSummary?.ok;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (remoteBusy || !currentSummary?.root) return;
      const root = currentSummary.root;
      remoteBusy = true;
      syncRemoteButtons();
      clearProjectActionError();
      try {
        const result = await ctx.uiRpc.remoteProject({ path: root, action });
        if (result.ok !== true) throw new Error(String(result.error || 'Git operation failed'));
        const output = [result.stdout, result.stderr].filter((text) => typeof text === 'string' && text.trim()).join('\n');
        showToast(output || `Git ${action} completed`, doc);
        await refreshProjectSummary({ showLoading: false });
      } catch (error) {
        showProjectActionError(errorMessage(error));
      } finally {
        remoteBusy = false;
        syncRemoteButtons();
      }
    });
    return button;
  }

  function syncRemoteButtons(): void {
    const buttons = [...remoteHeaderButtons, ...Array.from(projectBodyEl?.querySelectorAll<HTMLButtonElement>('[data-remote-action]') || [])];
    for (const button of buttons) {
      button.disabled = remoteBusy || !currentSummary?.ok;
      button.setAttribute('aria-busy', String(remoteBusy));
    }
  }

  function appendFileIcon(meta: HTMLElement, path: string): void {
    const language = ctx.detectLangFromPath(path);
    const icon = diffFileIcon(language);
    const element = doc.createElement('span');
    element.className = icon.startsWith('language-') ? `diff-language-icon ${icon}` : `codicon codicon-${icon}`;
    element.title = language || 'File';
    element.setAttribute('aria-label', element.title);
    meta.append(element);
  }
  let currentTe2State: Te2ProjectState | null = null;
  let refreshTimer: number | null = null;
  let projectAgentRejectOverlayEl: HTMLElement | null = null;
  const projectStorage = (() => {
    try {
      return doc.defaultView?.localStorage || null;
    } catch {
      return null;
    }
  })();
  let collapsedState = loadProjectCollapsedState();

  function loadProjectCollapsedState(): ProjectCollapsedState {
    if (!projectStorage) return {};
    try {
      const raw = projectStorage.getItem(PROJECT_MODAL_COLLAPSED_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return isRecord(parsed) ? parsed as ProjectCollapsedState : {};
    } catch {
      return {};
    }
  }

  function saveProjectCollapsedState(): void {
    if (!projectStorage) return;
    try {
      projectStorage.setItem(PROJECT_MODAL_COLLAPSED_STATE_KEY, JSON.stringify(collapsedState));
    } catch {
      // Ignore private-mode or quota storage failures.
    }
  }

  function projectCategoryCollapsed(projectRoot: string, category: string): boolean {
    return collapsedState.categories?.[projectRoot]?.[category] === true;
  }

  function setProjectCategoryCollapsed(projectRoot: string, category: string, collapsed: boolean): void {
    if (!collapsedState.categories) collapsedState.categories = {};
    if (!collapsedState.categories[projectRoot]) collapsedState.categories[projectRoot] = {};
    collapsedState.categories[projectRoot][category] = collapsed;
    saveProjectCollapsedState();
  }

  function projectFileCollapsed(path: string): boolean {
    const stored = collapsedState.files?.[path];
    return typeof stored === 'boolean' ? stored : true;
  }

  function setProjectFileCollapsed(path: string, collapsed: boolean): void {
    if (!path) return;
    if (!collapsedState.files) collapsedState.files = {};
    collapsedState.files[path] = collapsed;
    saveProjectCollapsedState();
  }

  function closeMenus(): void {
    setMenuOpen(conversationMenuToggle, conversationMenu, false);
    doc.querySelectorAll<HTMLElement>('.app-menu-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });
    doc.querySelectorAll<HTMLElement>('.app-menu [aria-expanded="true"]').forEach((toggle) => {
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(toggle: HTMLElement | null, panel: HTMLElement | null): void {
    if (!toggle || !panel) return;
    const willOpen = panel.classList.contains('hidden');
    closeMenus();
    setMenuOpen(toggle, panel, willOpen);
  }

  function ensureProjectAgentRejectOverlay(): HTMLElement {
    if (projectAgentRejectOverlayEl) {
      return projectAgentRejectOverlayEl;
    }
    const overlay = doc.createElement('div');
    overlay.id = 'project-agent-reject-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0, 0, 0, 0.45)';
    overlay.style.backdropFilter = 'blur(2px)';
    overlay.innerHTML = `
      <div style="max-width: min(420px, calc(100vw - 32px)); padding: 22px 24px; border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; background: rgba(18, 22, 30, 0.96); color: var(--text, #f4f6fb); box-shadow: 0 18px 60px rgba(0,0,0,0.45); text-align: center;">
        <div style="width: 34px; height: 34px; margin: 0 auto 14px; border: 3px solid rgba(255,255,255,0.22); border-top-color: var(--accent, #6ea8fe); border-radius: 999px; animation: project-agent-reject-spin 900ms linear infinite;"></div>
        <div style="font-weight: 700; margin-bottom: 8px;">Rejecting tracked edits</div>
        <div data-agent-reject-message style="color: var(--muted, #aab2c0); font-size: 13px; line-height: 1.45;">Applying reverse patches.</div>
      </div>
    `;
    const style = doc.createElement('style');
    style.textContent = '@keyframes project-agent-reject-spin { to { transform: rotate(360deg); } }';
    overlay.appendChild(style);
    doc.body.appendChild(overlay);
    projectAgentRejectOverlayEl = overlay;
    return overlay;
  }

  function showProjectAgentRejectOverlay(count: number): void {
    const overlay = ensureProjectAgentRejectOverlay();
    const messageEl = overlay.querySelector('[data-agent-reject-message]');
    if (messageEl) {
      messageEl.textContent = `Applying reverse patches for ${count} tracked edit${count === 1 ? '' : 's'}.`;
    }
    overlay.style.display = 'flex';
  }

  function hideProjectAgentRejectOverlay(): void {
    if (projectAgentRejectOverlayEl) {
      projectAgentRejectOverlayEl.style.display = 'none';
    }
  }

  async function rejectAgentDiffWithFallbackPrompt(conversationId: string, diffId: string): Promise<boolean> {
    try {
      await ctx.uiRpc.rejectAgentDiff({ conversationId, diffId });
      return true;
    } catch (error) {
      if (!isAgentDiffMetadataMismatch(error)) throw error;
      const confirmed = await ctx.confirmProjectAction({
        title: 'Diff metadata mismatch',
        body: 'The diff metadata does not match the file metadata on disk, probably because of a recent change to the file. Do you wish to continue with a content-based fallback?',
        confirmText: 'Continue',
      });
      if (!confirmed) return false;
      await ctx.uiRpc.rejectAgentDiff({ conversationId, diffId, force: true });
      return true;
    }
  }

  function renderMessage(message: string): void {
    if (!projectBodyEl) return;
    projectBodyEl.innerHTML = '';
    const empty = doc.createElement('div');
    empty.className = 'muted project-empty';
    empty.textContent = message;
    projectBodyEl.appendChild(empty);
  }

  function appendStat(parent: HTMLElement, label: string, value: string): void {
    const stat = doc.createElement('div');
    stat.className = 'project-stat';
    const labelEl = doc.createElement('span');
    labelEl.className = 'project-stat-label';
    labelEl.textContent = label;
    const valueEl = doc.createElement('strong');
    valueEl.textContent = value;
    stat.append(labelEl, valueEl);
    parent.appendChild(stat);
  }

  function appendProjectRoot(parent: HTMLElement, value: string): void {
    const row = doc.createElement('div');
    row.className = 'project-root-row';
    const labelEl = doc.createElement('span');
    labelEl.className = 'project-stat-label';
    labelEl.textContent = 'Project Root';
    const valueEl = doc.createElement('strong');
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    parent.appendChild(row);
  }

  function appendProjectFilePill(parent: HTMLElement, className: string, value: string): void {
    if (!value) return;
    const pill = doc.createElement('span');
    pill.className = className;
    pill.textContent = value;
    parent.appendChild(pill);
  }

  function createProjectActionButton(label: string, action: string, className = ''): HTMLButtonElement {
    const button = doc.createElement('button');
    button.className = `btn ghost project-action-btn ${className}`.trim();
    button.type = 'button';
    button.textContent = label;
    button.dataset.projectAction = action;
    return button;
  }

  function clearProjectActionError(): void {
    projectBodyEl?.querySelectorAll('.project-action-error').forEach((node) => node.remove());
  }

  function showProjectActionError(message: string): void {
    if (!projectBodyEl) return;
    clearProjectActionError();
    const note = doc.createElement('div');
    note.className = 'project-action-error';
    note.textContent = message;
    projectBodyEl.prepend(note);
  }

  function setTe2ControlState(state: Te2ProjectState | null, loading = false): void {
    if (!projectTe2Control) return;
    projectTe2Control.classList.remove('success', 'warning');
    if (loading) {
      projectTe2Control.disabled = true;
      projectTe2Control.textContent = 'Checking TE2...';
      projectTe2Control.title = '';
      return;
    }
    if (!state || !state.connected || state.action === 'disabled') {
      projectTe2Control.disabled = true;
      projectTe2Control.textContent = 'TE2 unavailable';
      projectTe2Control.title = state?.reason || 'TE2 sidebar IPC is unavailable.';
      return;
    }
    if (state.action === 'current') {
      projectTe2Control.disabled = true;
      projectTe2Control.classList.add('success');
      projectTe2Control.textContent = 'TE2 current';
      projectTe2Control.title = state.currentCwd
        ? `TE2 is open on ${state.currentCwd}`
        : 'TE2 is open on this project.';
      return;
    }
    if (state.action === 'switch') {
      projectTe2Control.disabled = false;
      projectTe2Control.classList.add('warning');
      projectTe2Control.textContent = 'Switch TE2';
      projectTe2Control.title = state.currentCwd
        ? `Switch TE2 from ${state.currentCwd} to ${state.targetPath}`
        : `Switch TE2 to ${state.targetPath}`;
      return;
    }
    projectTe2Control.disabled = false;
    projectTe2Control.classList.add('warning');
    projectTe2Control.textContent = 'Create TE2 Project';
    projectTe2Control.title = `Create or adopt ${state.targetPath} in TE2`;
  }

  async function refreshTe2ProjectState(projectRoot: string | null | undefined): Promise<Te2ProjectState | null> {
    const root = typeof projectRoot === 'string' && projectRoot.trim() ? projectRoot.trim() : '';
    if (!root) {
      currentTe2State = null;
      setTe2ControlState(null);
      return null;
    }
    setTe2ControlState(currentTe2State, true);
    try {
      currentTe2State = normalizeTe2ProjectState(await ctx.uiRpc.getTe2ProjectStatus({ path: root }));
    } catch {
      currentTe2State = {
        ok: true,
        connected: false,
        targetPath: root,
        currentCwd: '',
        matchesCurrent: false,
        known: false,
        reason: 'request_failed',
        action: 'disabled',
      };
    }
    setTe2ControlState(currentTe2State);
    return currentTe2State;
  }

  async function ensureTe2ProjectReady(projectRoot: string | null | undefined): Promise<boolean> {
    const root = typeof projectRoot === 'string' && projectRoot.trim() ? projectRoot.trim() : '';
    if (!root) return false;
    let state = currentTe2State && currentTe2State.targetPath === root
      ? currentTe2State
      : await refreshTe2ProjectState(root);
    if (!state || !state.connected || state.action === 'disabled') {
      setTe2ControlState(state);
      return false;
    }
    if (state.action === 'current') {
      return true;
    }
    if (state.action === 'switch') {
      const confirmed = await ctx.confirmProjectAction({
        title: 'Switch TE2 project?',
        body: state.currentCwd
          ? `TE2 is currently open on ${state.currentCwd}. Switch it to ${root}?`
          : `Switch TE2 to ${root}?`,
        confirmText: 'Switch',
      });
      if (!confirmed) return false;
      const result = await ctx.uiRpc.openTe2Project({ path: root });
      if (result.ok === false) return false;
      state = await refreshTe2ProjectState(root);
      return state?.action === 'current';
    }
    const confirmed = await ctx.confirmProjectAction({
      title: 'Create TE2 project?',
      body: `TE2 does not have ${root} in its project database. Create or adopt it and open it now?`,
      confirmText: 'Create',
    });
    if (!confirmed) return false;
    const result = await ctx.uiRpc.createTe2Project({ path: root, adoptExisting: true, open: true });
    if (result.ok === false) return false;
    state = await refreshTe2ProjectState(root);
    return state?.action === 'current';
  }

  function renderAgentDiffCard(summary: ProjectSummary, diff: AgentDiff): HTMLElement {
    const absolutePath = absoluteAgentDiffPath(summary, diff);
    const card = doc.createElement('div');
    card.className = 'timeline-row command-result terminal-card diff project-file-card project-agent-diff-card';
    const body = doc.createElement('div');
    body.className = 'body';

    const header = doc.createElement('div');
    header.className = 'diff-path-label command-ribbon project-file-header project-agent-diff-header';
    const pathRow = doc.createElement('div');
    pathRow.className = 'project-file-path-row';
    const pathLabel = doc.createElement('span');
    pathLabel.className = 'project-file-path';
    applyPathScrollLabel(pathLabel, ctx.toRelativePath(absolutePath) || diff.rel || diff.path || diff.id, {
      title: absolutePath || diff.path || diff.id,
    });
    pathRow.appendChild(pathLabel);

    const detailRow = doc.createElement('div');
    detailRow.className = 'project-file-detail-row';

    const meta = doc.createElement('span');
    meta.className = 'project-file-meta';
    appendProjectFilePill(meta, 'project-status-pill', 'tracked');
    appendFileIcon(meta, absolutePath);
    appendProjectFilePill(meta, 'project-file-stats added', `+${diff.additions}`);
    appendProjectFilePill(meta, 'project-file-stats deleted', `-${diff.deletions}`);
    if (diff.diffBytes > 0) {
      appendProjectFilePill(meta, 'project-file-bytes', formatBytes(diff.diffBytes));
    }

    const actions = doc.createElement('span');
    actions.className = 'project-agent-diff-actions';
    const acceptBtn = doc.createElement('button');
    acceptBtn.className = 'btn ghost project-agent-diff-action accept';
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Accept';
    acceptBtn.dataset.agentDiffAction = 'accept';
    acceptBtn.dataset.conversationId = diff.conversationId;
    acceptBtn.dataset.diffId = diff.id;
    const rejectBtn = doc.createElement('button');
    rejectBtn.className = 'btn ghost project-agent-diff-action reject';
    rejectBtn.type = 'button';
    rejectBtn.textContent = 'Reject';
    rejectBtn.dataset.agentDiffAction = 'reject';
    rejectBtn.dataset.conversationId = diff.conversationId;
    rejectBtn.dataset.diffId = diff.id;
    actions.append(acceptBtn, rejectBtn);

    detailRow.append(meta, actions);
    header.append(pathRow, detailRow);
    body.appendChild(header);

    if (diff.diffText) {
      const block = doc.createElement('div');
      block.className = 'diff-block';
      body.appendChild(block);
      ctx.renderDiffBlock(block, diff.diffText, absolutePath);
      ctx.makeCollapsible(card, `project-file:${absolutePath}`, !projectFileCollapsed(absolutePath), {
        headerEl: header,
        persist: false,
        fullHeaderToggle: true,
        onToggle: (expanded: boolean) => setProjectFileCollapsed(absolutePath, !expanded),
      });
    } else {
      const note = doc.createElement('div');
      note.className = 'muted project-file-disabled-note';
      note.textContent = 'No text diff available.';
      body.appendChild(note);
    }

    card.appendChild(body);
    return card;
  }

  function appendAgentDiffs(summary: ProjectSummary, parent: HTMLElement): void {
    if (!summary.agentDiffs.length) return;
    const list = doc.createElement('div');
    list.className = 'project-file-list project-agent-diff-list';
    summary.agentDiffs.forEach((diff) => {
      list.appendChild(renderAgentDiffCard(summary, diff));
    });
    parent.appendChild(list);
  }

  function renderProjectFileCard(summary: ProjectSummary, file: ProjectFile): HTMLElement {
    const absolutePath = absoluteProjectPath(summary.root, file.path);
    const card = doc.createElement('div');
    card.className = `timeline-row command-result terminal-card diff project-file-card${file.diffTruncated ? ' disabled' : ''}`;
    const body = doc.createElement('div');
    body.className = 'body';

    const header = doc.createElement('div');
    header.className = 'diff-path-label command-ribbon project-file-header';
    const pathRow = doc.createElement('div');
    pathRow.className = 'project-file-path-row';
    const pathLabel = doc.createElement('span');
    pathLabel.className = 'project-file-path';
    applyPathScrollLabel(pathLabel, ctx.toRelativePath(absolutePath) || file.path, { title: absolutePath });
    pathRow.appendChild(pathLabel);

    const detailRow = doc.createElement('div');
    detailRow.className = 'project-file-detail-row';

    const meta = doc.createElement('span');
    meta.className = 'project-file-meta';
    appendProjectFilePill(meta, 'project-status-pill', file.status);
    appendFileIcon(meta, absolutePath);
    if (file.staged) appendProjectFilePill(meta, 'project-file-state staged', 'staged');
    if (file.unstaged) appendProjectFilePill(meta, 'project-file-state unstaged', file.untracked ? 'untracked' : 'unstaged');
    appendProjectFilePill(meta, 'project-file-stats added', `+${file.additions}`);
    appendProjectFilePill(meta, 'project-file-stats deleted', `-${file.deletions}`);
    if (file.bytes !== null) {
      appendProjectFilePill(meta, 'project-file-bytes', formatBytes(file.bytes));
    }
    if (file.diffTruncated) {
      appendProjectFilePill(meta, 'project-file-truncated', `>${formatBytes(summary.maxDiffBytes)}`);
    }

    const actions = doc.createElement('span');
    actions.className = 'project-file-actions';
    const actionPaths = projectFileActionPaths(file);
    const stageBtn = file.staged
      ? createProjectActionButton('Unstage', 'unstage-file', 'unstage')
      : createProjectActionButton('Stage', 'stage-file');
    stageBtn.dataset.paths = JSON.stringify(actionPaths);
    stageBtn.disabled = file.staged ? false : !file.unstaged;
    const restoreBtn = createProjectActionButton('Restore', 'restore-file', 'danger');
    restoreBtn.dataset.paths = JSON.stringify(actionPaths);
    restoreBtn.dataset.path = file.path;
    actions.append(stageBtn, restoreBtn);

    detailRow.append(meta, actions);
    header.append(pathRow, detailRow);
    body.appendChild(header);

    if (file.diffTruncated) {
      const note = doc.createElement('div');
      note.className = 'muted project-file-disabled-note';
      note.textContent = `Diff exceeds ${formatBytes(summary.maxDiffBytes)}; rendering and links disabled.`;
      body.appendChild(note);
    } else if (file.diffText) {
      const block = doc.createElement('div');
      block.className = 'diff-block';
      body.appendChild(block);
      ctx.renderDiffBlock(block, file.diffText, absolutePath);
      ctx.makeCollapsible(card, `project-file:${absolutePath}`, !projectFileCollapsed(absolutePath), {
        headerEl: header,
        persist: false,
        fullHeaderToggle: true,
        onToggle: (expanded: boolean) => setProjectFileCollapsed(absolutePath, !expanded),
      });
    } else {
      header.classList.add('project-file-open-placeholder');
      header.setAttribute('role', 'link');
      header.tabIndex = 0;
      header.dataset.path = absolutePath;
      header.title = `Open ${absolutePath}`;
    }

    card.appendChild(body);
    return card;
  }

  function createProjectCategorySection(
    summary: ProjectSummary,
    category: string,
    detail: string,
  ): { section: HTMLElement; body: HTMLElement; actions: HTMLElement } {
    const section = doc.createElement('section');
    section.className = 'project-category-section';
    section.dataset.projectCategory = category;

    const header = doc.createElement('div');
    header.className = 'project-category-header';
    const toggle = doc.createElement('button');
    toggle.className = 'project-category-toggle';
    toggle.type = 'button';
    const title = doc.createElement('span');
    title.className = 'project-category-title';
    title.textContent = categoryLabel(category);
    const count = doc.createElement('span');
    count.className = 'project-category-count';
    count.textContent = detail;
    const twisty = doc.createElement('span');
    twisty.className = 'twisty';
    twisty.textContent = '▶';
    toggle.append(title, count, twisty);
    const actions = doc.createElement('span');
    actions.className = 'project-category-actions';
    header.append(toggle, actions);

    const body = doc.createElement('div');
    body.className = 'project-category-body';
    section.append(header, body);

    function sync(collapsed: boolean): void {
      section.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      twisty.dataset.expanded = collapsed ? 'false' : 'true';
    }

    sync(projectCategoryCollapsed(summary.root || '-', category));
    toggle.addEventListener('click', () => {
      const collapsed = !section.classList.contains('collapsed');
      setProjectCategoryCollapsed(summary.root || '-', category, collapsed);
      sync(collapsed);
    });

    return { section, body, actions };
  }

  function appendOverview(summary: ProjectSummary): void {
    if (!projectBodyEl) return;
    const { section, body, actions } = createProjectCategorySection(summary, 'overview', summary.dirty ? 'dirty' : 'clean');
    const commitBtn = createProjectActionButton(summary.stagedFiles > 0 ? 'Commit' : 'Stage & Commit', 'commit-project', 'primary');
    commitBtn.disabled = summary.changedFiles === 0;
    actions.appendChild(commitBtn);
    actions.appendChild(createRemoteButton('push'));
    appendProjectRoot(body, summary.root || '-');

    const header = doc.createElement('div');
    header.className = 'project-summary-grid';
    appendStat(header, 'Branch', summary.branch || 'detached');
    appendStat(header, 'Commit', summary.headShort || '-');
    appendStat(header, 'Files', String(summary.changedFiles));
    appendStat(header, 'Staged', String(summary.stagedFiles));
    appendStat(header, 'Unstaged', String(summary.unstagedFiles));
    appendStat(header, 'Added', `+${summary.additions}`);
    appendStat(header, 'Deleted', `-${summary.deletions}`);
    body.appendChild(header);
    projectBodyEl.appendChild(section);
  }

  function appendFileCategories(summary: ProjectSummary): void {
    if (!projectBodyEl) return;
    const groups = new Map<string, ProjectFile[]>();
    summary.files.forEach((file) => {
      const category = statusCategory(file.status);
      const items = groups.get(category) || [];
      items.push(file);
      groups.set(category, items);
    });

    const categories = [...groups.keys()].sort((left, right) => {
      const leftRank = PROJECT_STATUS_CATEGORY_ORDER.indexOf(left);
      const rightRank = PROJECT_STATUS_CATEGORY_ORDER.indexOf(right);
      return (leftRank === -1 ? 999 : leftRank) - (rightRank === -1 ? 999 : rightRank)
        || left.localeCompare(right);
    });

    categories.forEach((category) => {
      const files = groups.get(category) || [];
      const { section, body, actions } = createProjectCategorySection(summary, category, String(files.length));
      const stageBtn = createProjectActionButton('Stage all', 'stage-category');
      stageBtn.dataset.category = category;
      stageBtn.disabled = !files.some((file) => file.unstaged);
      const restoreBtn = createProjectActionButton('Restore all', 'restore-category', 'danger');
      restoreBtn.dataset.category = category;
      actions.append(stageBtn, restoreBtn);
      const list = doc.createElement('div');
      list.className = 'project-file-list';
      files.forEach((file) => {
        list.appendChild(renderProjectFileCard(summary, file));
      });
      body.appendChild(list);
      projectBodyEl.appendChild(section);
    });
  }

  function renderProjectSummary(summary: ProjectSummary): void {
    if (!projectBodyEl) return;
    currentSummary = summary;
    projectBodyEl.innerHTML = '';
    if (!summary.ok) {
      renderMessage(summary.error || 'Project summary unavailable.');
      return;
    }

    appendOverview(summary);

    if (summary.agentDiffs.length) {
      const { section, body, actions } = createProjectCategorySection(summary, 'agent-edits', String(summary.agentDiffs.length));
      actions.append(
        createProjectActionButton('Accept all', 'accept-agent-all', 'accept'),
        createProjectActionButton('Reject all', 'reject-agent-all', 'reject'),
      );
      appendAgentDiffs(summary, body);
      projectBodyEl.appendChild(section);
    }

    if (!summary.files.length) {
      if (summary.agentDiffs.length) return;
      const { section, body } = createProjectCategorySection(summary, 'clean', '0');
      const empty = doc.createElement('div');
      empty.className = 'muted project-empty';
      empty.textContent = 'Working tree clean.';
      body.appendChild(empty);
      projectBodyEl.appendChild(section);
      return;
    }

    appendFileCategories(summary);

    if (summary.truncatedFiles) {
      const note = doc.createElement('div');
      note.className = 'muted project-truncated-note';
      note.textContent = 'Changed file list truncated.';
      projectBodyEl.appendChild(note);
    }
  }

  function filesForCategory(summary: ProjectSummary, category: string): ProjectFile[] {
    return summary.files.filter((file) => statusCategory(file.status) === category);
  }

  function projectFileActionPaths(file: ProjectFile): string[] {
    return [file.path, file.oldPath].filter((path, index, paths): path is string => {
      return Boolean(path) && paths.indexOf(path) === index;
    });
  }

  function pathsForFiles(files: ProjectFile[]): string[] {
    const paths: string[] = [];
    files.forEach((file) => {
      projectFileActionPaths(file).forEach((path) => {
        if (!paths.includes(path)) paths.push(path);
      });
    });
    return paths;
  }

  function pathsFromActionTarget(target: HTMLElement): string[] {
    const raw = target.dataset.paths || '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
      } catch {
        // Fall through to the single-path dataset.
      }
    }
    const path = target.dataset.path || '';
    return path ? [path] : [];
  }

  function commitSummaryText(summary: ProjectSummary): string {
    return [
      `${summary.stagedFiles} staged file${summary.stagedFiles === 1 ? '' : 's'}`,
      `${summary.unstagedFiles} unstaged file${summary.unstagedFiles === 1 ? '' : 's'}`,
      `${summary.untrackedFiles} untracked file${summary.untrackedFiles === 1 ? '' : 's'}`,
      `+${summary.additions} -${summary.deletions}`,
    ].join(' · ');
  }

  function openCommitDialog(summary: ProjectSummary): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = doc.createElement('div');
      overlay.className = 'settings-overlay project-commit-overlay';
      const dialog = doc.createElement('div');
      dialog.className = 'settings-dialog project-commit-dialog';
      const header = doc.createElement('div');
      header.className = 'settings-header';
      const title = doc.createElement('h3');
      title.textContent = 'Commit staged changes';
      const closeBtn = doc.createElement('button');
      closeBtn.className = 'btn ghost';
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      header.append(title, closeBtn);

      const body = doc.createElement('div');
      body.className = 'settings-body project-commit-body';
      const summaryEl = doc.createElement('div');
      summaryEl.className = 'project-commit-summary';
      summaryEl.textContent = commitSummaryText(summary);
      const textarea = doc.createElement('textarea');
      textarea.className = 'project-commit-message';
      textarea.placeholder = 'Commit message';
      textarea.rows = 4;
      const errorEl = doc.createElement('div');
      errorEl.className = 'project-commit-error hidden';
      body.append(summaryEl, textarea, errorEl);

      const footer = doc.createElement('div');
      footer.className = 'settings-footer';
      const cancelBtn = doc.createElement('button');
      cancelBtn.className = 'btn ghost';
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      const commitBtn = doc.createElement('button');
      commitBtn.className = 'btn primary';
      commitBtn.type = 'button';
      commitBtn.textContent = 'Commit';
      footer.append(cancelBtn, commitBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      doc.body.appendChild(overlay);

      function close(value: string | null): void {
        overlay.remove();
        resolve(value);
      }

      function submit(): void {
        const message = textarea.value.trim();
        if (!message) {
          errorEl.textContent = 'Commit message is required.';
          errorEl.classList.remove('hidden');
          textarea.focus();
          return;
        }
        close(message);
      }

      closeBtn.addEventListener('click', () => close(null));
      cancelBtn.addEventListener('click', () => close(null));
      commitBtn.addEventListener('click', submit);
      overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) close(null);
      });
      textarea.addEventListener('keydown', (evt) => {
        if ((evt.ctrlKey || evt.metaKey) && evt.key === 'Enter') {
          evt.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => textarea.focus(), 0);
    });
  }

  function bindProjectDiffClickHandler(): void {
    function clearAgentDiffActionError(target: HTMLElement): void {
      const card = target.closest('.project-agent-diff-card');
      if (!(card instanceof HTMLElement)) return;
      card.querySelectorAll('.project-agent-diff-error').forEach((node) => node.remove());
    }

    function showAgentDiffActionError(target: HTMLElement, message: string): void {
      const card = target.closest('.project-agent-diff-card');
      if (!(card instanceof HTMLElement)) return;
      clearAgentDiffActionError(target);
      const body = card.querySelector('.body');
      if (!(body instanceof HTMLElement)) return;
      const note = doc.createElement('div');
      note.className = 'project-agent-diff-error';
      note.textContent = message;
      const header = body.querySelector('.project-agent-diff-header');
      if (header instanceof HTMLElement) {
        header.insertAdjacentElement('afterend', note);
      } else {
        body.prepend(note);
      }
    }

    async function stageProjectPaths(paths: string[]): Promise<void> {
      if (!currentSummary) return;
      await ctx.uiRpc.stageProjectPaths({ path: currentSummary.root, paths });
      await refreshProjectSummary({ showLoading: false });
    }

    async function unstageProjectPaths(paths: string[]): Promise<void> {
      if (!currentSummary) return;
      await ctx.uiRpc.unstageProjectPaths({ path: currentSummary.root, paths });
      await refreshProjectSummary({ showLoading: false });
    }

    async function restoreProjectPaths(paths: string[], label: string): Promise<void> {
      if (!currentSummary || !paths.length) return;
      const confirmed = await ctx.confirmProjectAction({
        title: 'Restore changes?',
        body: `This will discard local changes for ${label}. This cannot be undone.`,
        confirmText: 'Restore',
      });
      if (!confirmed) return;
      await ctx.uiRpc.restoreProjectPaths({ path: currentSummary.root, paths });
      await refreshProjectSummary({ showLoading: false });
    }

    async function handleCommitAction(): Promise<void> {
      let summary = currentSummary;
      if (!summary || !summary.ok) return;
      if (summary.stagedFiles <= 0) {
        if (summary.changedFiles <= 0) return;
        const confirmed = await ctx.confirmProjectAction({
          title: 'Stage all changes?',
          body: 'Nothing is staged. Stage every changed file before opening the commit dialog?',
          confirmText: 'Stage all',
        });
        if (!confirmed) return;
        await ctx.uiRpc.stageProjectPaths({ path: summary.root });
        await refreshProjectSummary({ showLoading: false });
        summary = currentSummary;
        if (!summary || summary.stagedFiles <= 0) {
          throw new Error('Nothing is staged.');
        }
      }
      const message = await openCommitDialog(summary);
      if (!message) return;
      await ctx.uiRpc.commitProject({ path: summary.root, message });
      await refreshProjectSummary();
    }

    async function handleBulkAgentAction(action: string): Promise<void> {
      const summary = currentSummary;
      if (!summary?.agentDiffs.length) return;
      if (action === 'reject-agent-all') {
        const confirmed = await ctx.confirmProjectAction({
          title: 'Reject all tracked edits?',
          body: `This will apply reverse patches for ${summary.agentDiffs.length} tracked edit${summary.agentDiffs.length === 1 ? '' : 's'}.`,
          confirmText: 'Reject all',
        });
        if (!confirmed) return;
        const conversationId = summary.agentDiffs[0]?.conversationId || ctx.getConversationId() || '';
        if (!conversationId) {
          throw new Error('Reject all requires a conversation id.');
        }
        let actionError: unknown = null;
        showProjectAgentRejectOverlay(summary.agentDiffs.length);
        try {
          await ctx.uiRpc.rejectAllAgentDiffs({ conversationId, path: summary.root });
        } catch (error) {
          actionError = error;
        } finally {
          hideProjectAgentRejectOverlay();
          try {
            await refreshProjectSummary({ showLoading: false });
          } catch (refreshError) {
            console.warn('[project-modal] project summary refresh failed after reject all', refreshError);
          }
        }
        if (actionError) {
          throw actionError;
        }
        return;
      }
      for (const diff of summary.agentDiffs) {
        if (action === 'accept-agent-all') {
          await ctx.uiRpc.acceptAgentDiff({ conversationId: diff.conversationId, diffId: diff.id });
        }
      }
      await refreshProjectSummary({ showLoading: false });
    }

    async function handleProjectAction(target: HTMLElement, evt: Event): Promise<void> {
      const action = target.dataset.projectAction || '';
      if (!action) return;
      evt.preventDefault();
      evt.stopPropagation();
      clearProjectActionError();
      target.setAttribute('disabled', 'true');
      try {
        if (action === 'commit-project') {
          await handleCommitAction();
          return;
        }
        if (action === 'accept-agent-all' || action === 'reject-agent-all') {
          await handleBulkAgentAction(action);
          return;
        }
        const summary = currentSummary;
        if (!summary) return;
        if (action === 'stage-file') {
          const paths = pathsFromActionTarget(target);
          if (paths.length) await stageProjectPaths(paths);
          return;
        }
        if (action === 'unstage-file') {
          const paths = pathsFromActionTarget(target);
          if (paths.length) await unstageProjectPaths(paths);
          return;
        }
        if (action === 'restore-file') {
          const paths = pathsFromActionTarget(target);
          const path = target.dataset.path || paths[0] || '';
          if (paths.length) await restoreProjectPaths(paths, path);
          return;
        }
        if (action === 'stage-category' || action === 'restore-category') {
          const category = target.dataset.category || '';
          const files = filesForCategory(summary, category);
          const paths = pathsForFiles(files);
          if (action === 'stage-category') {
            await stageProjectPaths(paths);
          } else {
            await restoreProjectPaths(paths, `${categoryLabel(category)} files`);
          }
        }
      } catch (error) {
        console.warn('[project-modal] project action failed', { action, error });
        showProjectActionError(errorMessage(error));
      } finally {
        target.removeAttribute('disabled');
      }
    }

    async function handleAgentDiffAction(target: HTMLElement, evt: Event): Promise<void> {
      const action = target.dataset.agentDiffAction || '';
      const conversationId = target.dataset.conversationId || '';
      const diffId = target.dataset.diffId || '';
      if (!conversationId || !diffId) return;
      evt.preventDefault();
      evt.stopPropagation();
      clearAgentDiffActionError(target);
      target.setAttribute('disabled', 'true');
      try {
        if (action === 'accept') {
          await ctx.uiRpc.acceptAgentDiff({ conversationId, diffId });
          await refreshProjectSummary();
          return;
        }
        if (action === 'reject') {
          const confirmed = await ctx.confirmProjectAction({
            title: 'Reject tracked edit?',
            body: 'This will apply the reverse patch to the working tree.',
            confirmText: 'Reject',
          });
          if (!confirmed) return;
          const rejected = await rejectAgentDiffWithFallbackPrompt(conversationId, diffId);
          if (rejected) await refreshProjectSummary();
        }
      } catch (error) {
        console.warn('[project-modal] agent diff action failed', {
          action,
          conversationId,
          diffId,
          error,
        });
        showAgentDiffActionError(target, errorMessage(error));
      } finally {
        target.removeAttribute('disabled');
      }
    }

    async function openProjectFile(target: HTMLElement, evt: Event): Promise<void> {
      if (target.closest('.project-file-card.disabled')) return;
      const path = target.getAttribute('data-path') || '';
      if (!path) return;
      evt.preventDefault();
      evt.stopPropagation();
      const ready = await ensureTe2ProjectReady(currentSummary?.root);
      if (!ready) return;
      void ctx.uiRpc.openFile({ path, line: 1, column: 1 });
    }

    projectBodyEl?.addEventListener('click', (evt) => {
      const target = evt.target;
      if (!(target instanceof Element)) return;
      const projectActionEl = target.closest('[data-project-action]');
      if (projectActionEl instanceof HTMLElement) {
        void handleProjectAction(projectActionEl, evt);
        return;
      }
      const actionEl = target.closest('.project-agent-diff-action');
      if (actionEl instanceof HTMLElement) {
        void handleAgentDiffAction(actionEl, evt);
        return;
      }
      const fileOpenEl = target.closest('.project-file-open-placeholder');
      if (fileOpenEl instanceof HTMLElement) {
        void openProjectFile(fileOpenEl, evt);
        return;
      }
      const lineEl = target.closest('.diff-line');
      if (!(lineEl instanceof HTMLElement)) return;
      if (lineEl.closest('.project-file-card.disabled')) return;
      const path = lineEl.getAttribute('data-path') || '';
      const newLine = lineEl.getAttribute('data-new-line') || '';
      const oldLine = lineEl.getAttribute('data-old-line') || '';
      const line = parseInt(newLine || oldLine, 10);
      if (!path || !Number.isFinite(line) || line <= 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      try {
        lineEl.classList.add('tap-flash');
        setTimeout(() => lineEl.classList.remove('tap-flash'), 180);
      } catch {}
      void (async () => {
        const ready = await ensureTe2ProjectReady(currentSummary?.root);
        if (!ready) return;
        await ctx.uiRpc.openFile({ path, line, column: 1 });
      })();
    });
    projectBodyEl?.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      const target = evt.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('project-file-open-placeholder')) return;
      void openProjectFile(target, evt);
    });
  }

  async function refreshProjectSummary(options: { showLoading?: boolean } = {}): Promise<void> {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (options.showLoading !== false) {
      renderMessage('Loading project summary...');
    }
    try {
      const result = await ctx.uiRpc.getProjectSummary({
        conversationId: ctx.getConversationId() || undefined,
        path: selectedProjectPath || ctx.getConversationCwd() || ctx.getProjectRoot() || undefined,
        maxDiffBytes: 15 * 1024,
      });
      const summary = normalizeProjectSummary(result);
      renderProjectSummary(summary);
      if (summary.ok) {
        void refreshTe2ProjectState(summary.root);
      } else {
        setTe2ControlState(null);
      }
    } catch (error) {
      currentSummary = null;
      setTe2ControlState(null);
      renderMessage(error instanceof Error ? error.message : 'Project summary unavailable.');
    } finally {
      syncRemoteButtons();
    }
  }

  function scheduleProjectSummaryRefresh(): void {
    if (!ctx.isProjectTabActive()) return;
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refreshProjectSummary({ showLoading: false });
    }, 80);
  }

  function handleProjectNotification(method: string, params: JsonObject): void {
    if (method === 'hostUi.updated') {
      if (currentSummary?.root) {
        void refreshTe2ProjectState(currentSummary.root);
      }
      return;
    }
    if (method !== 'project.agentDiff.added' && method !== 'project.agentDiff.removed') return;
    const conversationId = stringValue(params.conversation_id);
    const activeConversationId = ctx.getConversationId();
    if (conversationId && activeConversationId && conversationId !== activeConversationId) return;
    scheduleProjectSummaryRefresh();
  }

  async function openProjectModal(path?: string | null): Promise<void> {
    closeMenus();
    selectedProjectPath = typeof path === 'string' && path.trim() ? path.trim() : null;
    ctx.showProjectModal();
    await refreshProjectSummary();
  }

  async function activateProjectTab(): Promise<void> {
    closeMenus();
    ctx.showProjectModal();
    await refreshProjectSummary();
  }

  function closeProjectModal(): void {
    ctx.closeConversationModal();
  }

  conversationMenuToggle?.addEventListener('click', (evt) => {
    evt.stopPropagation();
    toggleMenu(conversationMenuToggle, conversationMenu);
  });
  conversationProjectBtn?.addEventListener('click', () => {
    void openProjectModal();
  });
  conversationSettingsBtn?.addEventListener('click', closeMenus);
  projectDismissBtn?.addEventListener('click', closeProjectModal);
  projectRefreshBtn?.addEventListener('click', () => {
    void refreshProjectSummary();
  });
  projectTe2Control?.addEventListener('click', () => {
    void ensureTe2ProjectReady(currentSummary?.root);
  });
  ctx.uiRpc.subscribeLiveNotifications?.({
    onNotification: handleProjectNotification,
    onError: (error) => {
      console.warn('[project-modal] UI RPC notification handling failed', error);
    },
  });
  bindProjectDiffClickHandler();
  doc.addEventListener('click', (evt) => {
    const target = evt.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.app-menu')) return;
    closeMenus();
  });
  doc.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      closeMenus();
    }
  });

  return {
    openProjectModal,
    activateProjectTab,
    closeProjectModal,
  };
}
