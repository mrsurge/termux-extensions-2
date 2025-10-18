import * as CM from '/static/vendor/codemirror.1/codemirror.bundle.js';

const root = document.getElementById('ide-root');
if (!root) {
  console.error('[ide_fullpage] Missing ide root');
  throw new Error('ide root missing');
}

let seed = {};
try {
  seed = JSON.parse(root.dataset.seed || '{}');
} catch (_error) {
  seed = {};
}

const frameShell = document.getElementById('ide-frame-shell');
let frame = document.getElementById('ide-frame');
const statusCard = document.getElementById('ide-status');
const statusHeadline = statusCard?.querySelector('h1');
const statusDetail = statusCard?.querySelector('p');
const subtitleEl = document.getElementById('ide-subtitle');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const explorerContent = document.getElementById('explorer-content');
const btnMenu = document.getElementById('btn-menu');
const btnBack = document.getElementById('btn-back');
const btnSearch = document.getElementById('btn-search');
const btnCommand = document.getElementById('btn-command');
const btnSettings = document.getElementById('btn-settings');
const btnDocTestEdit = document.getElementById('btn-doc-test-edit');
const btnChatRefresh = document.getElementById('btn-chat-refresh');
const btnDrawerClose = document.querySelector('.drawer-close');
const btnOpenProject = document.getElementById('btn-open-project');
const btnToggleAssistant = document.getElementById('btn-toggle-assistant');
const ideFooter = document.getElementById('ide-footer');
const chatSubtitle = document.getElementById('chat-subtitle');
const bridgeStatusLabel = document.getElementById('bridge-status');
const documentView = document.getElementById('document-view');
const cmHost = document.getElementById('cm6-host');
const docFileLabel = document.getElementById('doc-current-path');
const recentTabToggle = document.getElementById('recent-tab-toggle');
const recentTabMenu = document.getElementById('recent-tab-menu');
const gitToggleInput = document.getElementById('drawer-git-toggle');

const menuFileBtn = document.getElementById('menu-file-btn');
const menuFileDD = document.getElementById('menu-file-dd');
const menuEditBtn = document.getElementById('menu-edit-btn');
const menuEditDD = document.getElementById('menu-edit-dd');
const menuViewBtn = document.getElementById('menu-view-btn');
const menuViewDD = document.getElementById('menu-view-dd');
const menuThemeBtn = document.getElementById('menu-theme-btn');
const menuThemeDD = document.getElementById('menu-theme-dd');

const miToggleLines = document.getElementById('mi-toggle-lines');
const miToggleShading = document.getElementById('mi-toggle-shading');
const miToggleSyntax = document.getElementById('mi-toggle-syntax');
const miToggleWrap = document.getElementById('mi-toggle-wrap');
const miFind = document.getElementById('mi-find');
const miGoto = document.getElementById('mi-goto');

const themeMenuItems = menuThemeDD ? Array.from(menuThemeDD.querySelectorAll('[data-theme]')) : [];

const menuRegistry = [];
if (menuFileBtn && menuFileDD) menuRegistry.push({ button: menuFileBtn, dropdown: menuFileDD });
if (menuEditBtn && menuEditDD) menuRegistry.push({ button: menuEditBtn, dropdown: menuEditDD });
if (menuViewBtn && menuViewDD) menuRegistry.push({ button: menuViewBtn, dropdown: menuViewDD });
if (menuThemeBtn && menuThemeDD) menuRegistry.push({ button: menuThemeBtn, dropdown: menuThemeDD });

const EditorState = CM.EditorState;
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers } = CM;
const defaultKeymap = CM.defaultKeymap || [];
const history = CM.history || (() => []);
const historyKeymap = CM.historyKeymap || [];
const searchKeymap = CM.searchKeymap || [];
const indentWithTab = CM.indentWithTab || (() => {});
const syntaxHighlighting = CM.syntaxHighlighting || (() => {});
const defaultHighlightStyle = CM.defaultHighlightStyle || null;
const StreamLanguage = CM.StreamLanguage;
const search = CM.search || (() => []);
const openSearchPanel = CM.openSearchPanel || null;
const oneDark = CM.oneDark || null;
const termuxTheme = CM.termuxTheme || null;

const javascript = CM.javascript || (() => []);
const jsonLang = CM.json || (() => []);
const python = CM.python || (() => []);
const htmlLang = CM.html || (() => []);
const cssLang = CM.css || (() => []);
const markdown = CM.markdown || (() => []);
const xmlLang = CM.xml || (() => []);

const shellLang = () => {
  const mode = CM.shell || CM.shellMode || CM.modeShell;
  return (mode && StreamLanguage) ? StreamLanguage.define(mode) : null;
};

const THEMES = {
  'cm6-dark': EditorView ? EditorView.theme({}, { dark: true }) : null,
  'one-dark': typeof oneDark === 'function' ? oneDark() : oneDark,
  'termux': typeof termuxTheme === 'function' ? termuxTheme() : termuxTheme,
};

const zebraStripes = EditorView ? EditorView.theme({
  '& .cm-line:nth-child(even)': { backgroundColor: 'rgba(128, 128, 128, 0.08)' },
  '.cm-dark & .cm-line:nth-child(even)': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
}) : null;

const LONG_PRESS_MS = 320;

const bridgeStateEndpoint = `${window.location.origin}/api/app/code_oss/state`;
const statePoll = {
  timer: null,
  pending: false,
  lastSeq: 0,
  interval: 1500,
  retryDelay: 4000,
  jitter: 400,
};

const BRIDGE_HANDSHAKE_INTERVAL = 900;
const BRIDGE_HANDSHAKE_MAX_ATTEMPTS = 0;

let summaryBootstrapped = false;
let iframeOrigin = null;
let frameReady = false;

let currentProject = seed.project_id || null;
let currentFile = seed.file_path || null;
let currentDocId = null;
let connectionLabel = null;

const bridgeState = {
  installed: false,
  version: null,
  error: null,
  known: false,
};

const explorerState = {
  rootPaths: [],
  nodes: new Map(),
  expanded: new Set(),
  activePath: null,
  git: {
    enabled: false,
    repository: false,
    entries: new Map(),
    directories: new Map(),
    summary: {},
    generatedAt: 0,
  },
  indicatorsEnabled: true,
};

const docRevisions = new Map();

const bridgeHandshake = {
  timer: null,
  attempts: 0,
  active: false,
};

const PROJECT_STATE_KEY = 'codeOss.currentProjectPath';
const MAX_RECENT_PROJECTS = 12;
const MAX_RECENT_FILES = 12;
const GIT_INDICATOR_STATE_KEY = 'codeOss.gitIndicatorsEnabled';
const GIT_LABEL_MAP = {
  modified: 'M',
  staged: 'S',
  untracked: 'U',
  deleted: 'D',
  renamed: 'R',
  conflict: '!',
  ignored: 'I',
};
const GIT_CLASS_MAP = {
  modified: 'git-modified',
  staged: 'git-staged',
  untracked: 'git-untracked',
  deleted: 'git-deleted',
  renamed: 'git-renamed',
  conflict: 'git-conflict',
  ignored: 'git-ignored',
};

const historyState = {
  recentProjects: [],
  projectFiles: new Map(),
  loadingProjects: new Set(),
};

let recentMenuOpen = false;

const cmState = {
  view: null,
  docId: null,
  text: '',
  language: 'plaintext',
  showLineNumbers: true,
  showShading: false,
  showSyntax: true,
  wordWrap: false,
  theme: 'cm6-dark',
};

let cmContentNode = null;
let nativeSelectionTimer = null;
let nativeSelectionActive = false;
let nativePressPoint = null;

function resolveHost(host) {
  if (!host || host === '0.0.0.0' || host === '127.0.0.1') {
    return window.location.hostname || '127.0.0.1';
  }
  return host;
}

function encodeFolderPath(path) {
  if (!path) return '';
  return encodeURIComponent(path).replace(/%2F/g, '/');
}

function buildWorkspaceUrl(projectPath) {
  const encoded = encodeFolderPath(projectPath);
  let baseUrl = null;
  if (frame?.src) {
    try {
      baseUrl = new URL(frame.src);
    } catch (_error) {
      baseUrl = null;
    }
  }
  if (!baseUrl && iframeOrigin) {
    try {
      baseUrl = new URL('/', iframeOrigin);
    } catch (_error) {
      baseUrl = null;
    }
  }
  if (!baseUrl) return null;

  baseUrl.hash = '';
  baseUrl.pathname = '/';
  if (encoded) {
    baseUrl.search = `?folder=${encoded}`;
  } else {
    baseUrl.search = '';
  }
  return baseUrl.toString();
}

function navigateFrameToProject(projectPath) {
  if (!frame) return null;
  const targetUrl = buildWorkspaceUrl(projectPath);
  if (!targetUrl) return null;
  try {
    const parsed = new URL(targetUrl);
    iframeOrigin = parsed.origin;
  } catch (_error) {
    // Keep previous origin if parsing fails.
  }
  frameReady = false;
  frame.setAttribute('aria-hidden', 'true');
  frame.src = targetUrl;
  return targetUrl;
}

function normalizeProjectPath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeFilePath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeFsPath(path) {
  if (typeof path !== 'string') return null;
  return path.replace(/\\/g, '/');
}

function resetGitSnapshot() {
  explorerState.git.entries.clear();
  explorerState.git.directories.clear();
  explorerState.git.summary = {};
  explorerState.git.repository = false;
  explorerState.git.generatedAt = 0;
  syncGitToggle();
}

function shouldShowGitIndicators() {
  return (
    explorerState.indicatorsEnabled &&
    explorerState.git.enabled &&
    explorerState.git.repository
  );
}

function getGitEntry(path) {
  if (!path) return null;
  const entries = explorerState.git.entries;
  if (entries.has(path)) return entries.get(path);
  const normalized = normalizeFsPath(path);
  if (normalized && entries.has(normalized)) return entries.get(normalized);
  return null;
}

function getDirectoryGitStats(path) {
  if (!path) return null;
  const directories = explorerState.git.directories;
  if (directories.has(path)) return directories.get(path);
  const normalized = normalizeFsPath(path);
  if (normalized && directories.has(normalized)) return directories.get(normalized);
  return null;
}

function buildFileGitBadge(meta) {
  if (!meta) return null;
  const badge = document.createElement('span');
  badge.className = 'explorer-git-badge git-file';
  const label = GIT_LABEL_MAP[meta.label] || (meta.code ? meta.code.trim() : '') || '•';
  badge.textContent = label;
  badge.title = `Git: ${meta.label || 'changed'}`;
  const className = GIT_CLASS_MAP[meta.label];
  if (className) badge.classList.add(className);
  if (meta.staged && meta.unstaged) {
    badge.dataset.state = 'mixed';
  } else if (meta.staged) {
    badge.dataset.state = 'staged';
  } else if (meta.unstaged) {
    badge.dataset.state = 'unstaged';
  }
  return badge;
}

function buildDirectoryGitBadge(stats) {
  if (!stats || !stats.total) return null;
  const badge = document.createElement('span');
  badge.className = 'explorer-git-badge git-dir';
  badge.textContent = String(stats.total);
  const statuses = stats.statuses || {};
  const detail = Object.entries(statuses)
    .filter(([, count]) => count)
    .map(([key, count]) => `${count} ${key}`)
    .join(', ');
  badge.title = detail || `${stats.total} changes`;
  return badge;
}

function syncGitToggle() {
  if (!gitToggleInput) return;
  const repoActive = explorerState.git.enabled && explorerState.git.repository;
  gitToggleInput.disabled = !repoActive;
  gitToggleInput.checked = repoActive ? explorerState.indicatorsEnabled : false;
  const label = gitToggleInput.closest('.drawer-toggle');
  if (label) {
    label.classList.toggle('is-disabled', gitToggleInput.disabled);
  }
}

function persistGitPreference(enabled) {
  const st = getStateAPI();
  if (!st || typeof st.set !== 'function') return;
  try {
    st.set(GIT_INDICATOR_STATE_KEY, enabled);
  } catch (error) {
    console.warn('[ide_fullpage] Failed to persist git indicator preference', error);
  }
}

function restoreGitPreference() {
  const st = getStateAPI();
  if (st && typeof st.get === 'function') {
    try {
      const stored = st.get(GIT_INDICATOR_STATE_KEY);
      if (typeof stored === 'boolean') {
        explorerState.indicatorsEnabled = stored;
      }
    } catch (error) {
      console.warn('[ide_fullpage] Failed to restore git indicator preference', error);
    }
  }
  if (gitToggleInput) {
    gitToggleInput.checked = explorerState.indicatorsEnabled;
  }
  syncGitToggle();
}

function updateGitSnapshot(payload) {
  const gitState = explorerState.git;
  gitState.entries.clear();
  gitState.directories.clear();
  if (payload && typeof payload.enabled === 'boolean') {
    gitState.enabled = payload.enabled;
  }
  if (payload && typeof payload.git_available === 'boolean' && !payload.git_available) {
    gitState.enabled = false;
  }
  if (payload) {
    gitState.repository = Boolean(payload.repository);
  } else {
    gitState.repository = false;
  }
  gitState.summary = payload && payload.summary ? { ...payload.summary } : {};
  gitState.generatedAt = (payload && payload.generated_at) || 0;

  if (payload && payload.entries && typeof payload.entries === 'object') {
    Object.values(payload.entries).forEach((entry) => {
      if (!entry) return;
      const key = normalizeFilePath(entry.path) || entry.path;
      if (!key) return;
      const normalized = normalizeFsPath(key);
      const meta = { ...entry, path: key };
      gitState.entries.set(key, meta);
      if (normalized && normalized !== key) {
        gitState.entries.set(normalized, meta);
      }
    });
  }

  if (payload && payload.directories && typeof payload.directories === 'object') {
    Object.entries(payload.directories).forEach(([directory, stats]) => {
      if (!directory || !stats) return;
      const key = normalizeFilePath(directory) || directory;
      if (!key) return;
      const normalized = normalizeFsPath(key);
      const meta = {
        path: key,
        total: Number(stats.total) || 0,
        statuses: { ...(stats.statuses || {}) },
      };
      gitState.directories.set(key, meta);
      if (normalized && normalized !== key) {
        gitState.directories.set(normalized, meta);
      }
    });
  }

  syncGitToggle();
}

function wireGitToggle() {
  if (!gitToggleInput) return;
  gitToggleInput.checked = explorerState.indicatorsEnabled;
  gitToggleInput.addEventListener('change', () => {
    explorerState.indicatorsEnabled = gitToggleInput.checked;
    persistGitPreference(explorerState.indicatorsEnabled);
    syncGitToggle();
    renderExplorerTree();
  });
  syncGitToggle();
}

function projectLabel(path) {
  if (!path) return '';
  const segments = path.split('/');
  return segments.pop() || path;
}

function fileLabel(path) {
  if (!path) return '';
  const segments = path.split('/');
  return segments.pop() || path;
}

function updateRecentProjectsLocal(path, openedAt = new Date().toISOString()) {
  if (!path) return;
  const entry = {
    path,
    label: projectLabel(path),
    opened_at: openedAt,
  };
  historyState.recentProjects = [
    entry,
    ...historyState.recentProjects.filter((item) => item.path !== path),
  ].slice(0, MAX_RECENT_PROJECTS);
}

function updateProjectFilesLocal(projectPath, files) {
  if (!projectPath) return;
  const normalized = normalizeProjectPath(projectPath);
  if (!normalized) return;
  historyState.projectFiles.set(normalized, Array.isArray(files) ? files.slice(0, MAX_RECENT_FILES) : []);
}

async function ensureProjectHistory(projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  if (!normalized || historyState.projectFiles.has(normalized)) {
    renderRecentTabs();
    return;
  }
  if (historyState.loadingProjects.has(normalized)) return;
  historyState.loadingProjects.add(normalized);
  try {
    const response = await fetch(`/api/app/code_oss/history?project=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (body?.ok) {
        const files = Array.isArray(body.data?.files) ? body.data.files : [];
        updateProjectFilesLocal(normalized, files);
      }
    }
  } catch (error) {
    console.warn('[ide_fullpage] Failed to load project history', error);
  } finally {
    historyState.loadingProjects.delete(normalized);
    renderRecentTabs();
  }
}

function recordProjectHistory(projectPath, { persist = true } = {}) {
  const normalized = normalizeProjectPath(projectPath);
  if (!normalized) return;
  updateRecentProjectsLocal(normalized);
  if (persist) {
    fetch('/api/app/code_oss/history/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: normalized }),
    })
      .then((response) => response.json().catch(() => null))
      .then((body) => {
        if (body?.ok && body.data) {
          updateRecentProjectsLocal(body.data.path, body.data.opened_at);
          renderRecentTabs();
        }
      })
      .catch((error) => {
        console.warn('[ide_fullpage] Failed to persist project history', error);
      });
  }
}

function recordFileHistory(projectPath, filePath, { persist = true } = {}) {
  const project = normalizeProjectPath(projectPath);
  const file = normalizeFilePath(filePath);
  if (!project || !file) return;
  const files = historyState.projectFiles.get(project) || [];
  const openedAt = new Date().toISOString();
  const entry = { path: file, label: fileLabel(file), opened_at: openedAt };
  const next = [entry, ...files.filter((item) => item.path !== file)].slice(0, MAX_RECENT_FILES);
  historyState.projectFiles.set(project, next);
  renderRecentTabs();
  if (persist) {
    fetch('/api/app/code_oss/history/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_path: project, file_path: file }),
    })
      .then((response) => response.json().catch(() => null))
      .then((body) => {
        if (body?.ok && body.data) {
          const currentEntries = historyState.projectFiles.get(project) || [];
          const updated = [body.data, ...currentEntries.filter((item) => item.path !== body.data.path)].slice(0, MAX_RECENT_FILES);
          historyState.projectFiles.set(project, updated);
          renderRecentTabs();
        }
      })
      .catch((error) => {
        console.warn('[ide_fullpage] Failed to persist file history', error);
      });
  }
}

function removeFileHistory(projectPath, filePath, { persist = true } = {}) {
  const project = normalizeProjectPath(projectPath);
  const file = normalizeFilePath(filePath);
  if (!project || !file) return;
  const files = historyState.projectFiles.get(project);
  if (!files || !files.length) return;
  const filtered = files.filter((item) => item.path !== file);
  historyState.projectFiles.set(project, filtered);
  renderRecentTabs();
  if (persist) {
    fetch('/api/app/code_oss/history/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_path: project, file_path: file }),
    }).catch((error) => {
      console.warn('[ide_fullpage] Failed to remove file from history', error);
    });
  }
}

function openRecentMenu() {
  if (!recentTabMenu || !recentTabToggle) return;
  if (!recentTabMenu.innerHTML.trim()) return;
  recentMenuOpen = true;
  recentTabMenu.classList.add('is-open');
  recentTabToggle.setAttribute('aria-expanded', 'true');
}

function closeRecentMenu() {
  if (!recentTabMenu || !recentTabToggle) return;
  if (!recentMenuOpen) {
    recentTabMenu.classList.remove('is-open');
    recentTabToggle.setAttribute('aria-expanded', 'false');
    return;
  }
  recentMenuOpen = false;
  recentTabMenu.classList.remove('is-open');
  recentTabToggle.setAttribute('aria-expanded', 'false');
}

function renderRecentTabs() {
  if (!recentTabToggle || !recentTabMenu) return;
  const project = normalizeProjectPath(currentProject);
  const files = project ? historyState.projectFiles.get(project) || [] : [];
  const count = files.length;
  const label = count ? `Recent Files (${count}) ▾` : 'Recent Files ▾';
  recentTabToggle.textContent = label;
  if (!count) {
    recentTabToggle.disabled = true;
    recentTabMenu.innerHTML = '';
    closeRecentMenu();
    return;
  }
  recentTabToggle.disabled = false;
  const activeFile = normalizeFilePath(currentFile);
  const itemsHtml = files
    .map((entry) => {
      const isActive = entry.path === activeFile;
      const classes = ['recent-menu-item'];
      if (isActive) classes.push('is-active');
      return `
        <div class="${classes.join(' ')}" data-path="${entry.path}">
          <span class="recent-menu-label" title="${entry.path}">${entry.label || entry.path}</span>
          <button type="button" class="recent-menu-close" data-action="close" aria-label="Remove ${entry.label || entry.path}">×</button>
        </div>
      `;
    })
    .join('');
  recentTabMenu.innerHTML = itemsHtml;
  if (recentMenuOpen) {
    recentTabMenu.classList.add('is-open');
    recentTabToggle.setAttribute('aria-expanded', 'true');
  }
}

function initializeHistory() {
  fetch('/api/app/code_oss/history', { cache: 'no-store' })
    .then((response) => response.json().catch(() => null))
    .then((body) => {
      if (body?.ok && Array.isArray(body.data?.recent_projects)) {
        historyState.recentProjects = body.data.recent_projects.slice(0, MAX_RECENT_PROJECTS);
      }
      if (currentProject) {
        ensureProjectHistory(currentProject);
      }
    })
    .catch((error) => {
      console.warn('[ide_fullpage] Failed to load history overview', error);
    })
    .finally(() => {
      renderRecentTabs();
    });
}

function setCurrentProject(path, { updateUI = true, persist = true } = {}) {
  const normalized = normalizeProjectPath(path);
  if (currentProject === normalized) {
    if (updateUI) {
      updateSubtitle();
      updateDocPlaceholder();
      renderRecentTabs();
    }
    return;
  }
  currentProject = normalized;
  resetGitSnapshot();
  renderRecentTabs();
  if (normalized) {
    if (persist) {
      const st = getStateAPI();
      if (st && typeof st.set === 'function') {
        try {
          st.set(PROJECT_STATE_KEY, normalized);
        } catch (error) {
          console.warn('[ide_fullpage] Failed to persist project path', error);
        }
      }
      recordProjectHistory(normalized, { persist: true });
    } else {
      recordProjectHistory(normalized, { persist: false });
    }
    ensureProjectHistory(normalized);
  } else {
    renderRecentTabs();
  }
  if (updateUI) {
    updateSubtitle();
    updateDocPlaceholder();
  }
}

function extractFolderPath(folder) {
  if (!folder) return null;
  if (typeof folder === 'string') return normalizeProjectPath(folder);
  if (typeof folder.path === 'string') return normalizeProjectPath(folder.path);
  const uri = folder.uri || folder.url;
  if (typeof uri === 'string') {
    if (uri.startsWith('file://')) {
      try {
        return normalizeProjectPath(decodeURIComponent(uri.replace(/^file:\/\//, '')));
      } catch (_error) {
        return normalizeProjectPath(uri.replace(/^file:\/\//, ''));
      }
    }
    return normalizeProjectPath(uri);
  }
  return null;
}

function normalizeServerUrl({ url, host, port, projectPath } = {}) {
  if (typeof url === 'string' && url.length) {
    try {
      const parsed = new URL(url);
      const resolvedHost = resolveHost(parsed.hostname);
      if (resolvedHost !== parsed.hostname) {
        parsed.hostname = resolvedHost;
      }
      return parsed.toString();
    } catch (_error) {
      // fall through to manual construction
    }
  }
  if (!port) return null;
  const resolvedHost = resolveHost(host);
  const base = `http://${resolvedHost}:${port}`;
  if (projectPath) {
    const encoded = encodeFolderPath(projectPath);
    return `${base}/?folder=${encoded}`;
  }
  return base;
}

function updateSubtitle() {
  if (!subtitleEl) return;
  const project = currentProject ? (currentProject.split('/').pop() || currentProject) : 'Code IDE';
  subtitleEl.textContent = project;
}

function updateDocPlaceholder() {
  const file = currentFile ? (currentFile.split('/').pop() || currentFile) : 'No file selected';
  if (docFileLabel) docFileLabel.textContent = file;
  setDocumentHasContent(Boolean(currentFile));
}

function setDocumentHasContent(hasContent) {
  const enabled = !!hasContent;
  if (documentView) {
    documentView.classList.toggle('has-doc', enabled);
  }
  root.classList.toggle('doc-ready', enabled);
  if (btnDocTestEdit) {
    btnDocTestEdit.disabled = !enabled;
  }
}

function closeMenus(exceptDropdown = null) {
  menuRegistry.forEach(({ button, dropdown }) => {
    const open = dropdown === exceptDropdown;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    dropdown.classList.toggle('is-open', open);
  });
}

function setMenuChecked(element, checked) {
  if (!element) return;
  element.classList.toggle('is-checked', !!checked);
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

function syncMenuState() {
  setMenuChecked(miToggleLines, cmState.showLineNumbers);
  setMenuChecked(miToggleShading, cmState.showShading);
  setMenuChecked(miToggleSyntax, cmState.showSyntax);
  setMenuChecked(miToggleWrap, cmState.wordWrap);
  themeMenuItems.forEach((item) => {
    const active = item.dataset.theme === cmState.theme;
    item.classList.toggle('is-checked', active);
    item.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'javascript',
    tsx: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'css',
    less: 'css',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ksh: 'shell',
    csh: 'shell',
    xml: 'xml',
    svg: 'xml',
  };
  return map[ext] || null;
}

function normalizeLanguageId(languageId, path) {
  if (typeof languageId === 'string' && languageId.trim()) {
    const value = languageId.trim().toLowerCase();
    const map = {
      javascript: 'javascript',
      typescript: 'javascript',
      jsx: 'javascript',
      tsx: 'javascript',
      json: 'json',
      python: 'python',
      py: 'python',
      html: 'html',
      xml: 'xml',
      css: 'css',
      scss: 'css',
      markdown: 'markdown',
      md: 'markdown',
      shell: 'shell',
      bash: 'shell',
      sh: 'shell',
      plaintext: 'plaintext',
      text: 'plaintext',
    };
    if (map[value]) return map[value];
  }
  return detectLanguageFromFilename(path) || detectLanguageFromFilename(currentFile) || 'plaintext';
}

function resolveLanguageExtension(language) {
  switch (language) {
    case 'javascript':
      return typeof javascript === 'function' ? javascript() : javascript;
    case 'json':
      return typeof jsonLang === 'function' ? jsonLang() : jsonLang;
    case 'python':
      return typeof python === 'function' ? python() : python;
    case 'html':
      return typeof htmlLang === 'function' ? htmlLang() : htmlLang;
    case 'css':
      return typeof cssLang === 'function' ? cssLang() : cssLang;
    case 'markdown':
      return typeof markdown === 'function' ? markdown() : markdown;
    case 'xml':
      return typeof xmlLang === 'function' ? xmlLang() : xmlLang;
    case 'shell': {
      const shell = shellLang();
      return shell || null;
    }
    default:
      return null;
  }
}

function makeExtensions() {
  if (!EditorState || !EditorView) return [];
  const exts = [];
  if (typeof history === 'function') exts.push(history());
  if (typeof search === 'function') exts.push(search());
  if (keymap) exts.push(keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]));
  if (typeof highlightActiveLine === 'function') exts.push(highlightActiveLine());
  if (cmState.showLineNumbers && typeof highlightActiveLineGutter === 'function' && typeof lineNumbers === 'function') {
    exts.push(lineNumbers(), highlightActiveLineGutter());
  }
  if (cmState.showSyntax && defaultHighlightStyle && typeof syntaxHighlighting === 'function') {
    exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));
  }
  if (cmState.wordWrap && EditorView.lineWrapping) {
    exts.push(EditorView.lineWrapping);
  }
  if (cmState.showShading && zebraStripes) {
    exts.push(zebraStripes);
  }
  const theme = THEMES[cmState.theme] || THEMES['cm6-dark'];
  if (theme) exts.push(theme);
  const langExt = resolveLanguageExtension(cmState.language);
  if (langExt) exts.push(langExt);
  return exts.filter(Boolean);
}

function detachNativeSelection() {
  cancelNativeSelectionTimer();
  if (!cmContentNode) return;
  cmContentNode.removeEventListener('pointerdown', handleNativePointerDown, true);
  cmContentNode.removeEventListener('pointerup', handleNativePointerUp, true);
  cmContentNode.removeEventListener('pointercancel', handleNativePointerCancel, true);
  cmContentNode.removeEventListener('pointermove', handleNativePointerMove, true);
  cmContentNode.removeEventListener('beforeinput', handleNativeBeforeInput, true);
  cmContentNode.removeEventListener('blur', handleNativeBlur, true);
  cmContentNode.removeAttribute('contenteditable');
  cmContentNode.style.webkitUserModify = '';
  cmContentNode.style.userSelect = '';
  cmContentNode = null;
  nativeSelectionActive = false;
}

function attachNativeSelection() {
  detachNativeSelection();
  if (!cmState.view) return;
  cmContentNode = cmState.view.contentDOM;
  if (!cmContentNode) return;
  cmContentNode.addEventListener('pointerdown', handleNativePointerDown, true);
  cmContentNode.addEventListener('pointerup', handleNativePointerUp, true);
  cmContentNode.addEventListener('pointercancel', handleNativePointerCancel, true);
  cmContentNode.addEventListener('pointermove', handleNativePointerMove, true);
  cmContentNode.addEventListener('beforeinput', handleNativeBeforeInput, true);
  cmContentNode.addEventListener('blur', handleNativeBlur, true);
}

function cancelNativeSelectionTimer() {
  if (nativeSelectionTimer) {
    clearTimeout(nativeSelectionTimer);
    nativeSelectionTimer = null;
  }
  nativePressPoint = null;
}

function enableNativeSelection(originEvent) {
  cancelNativeSelectionTimer();
  if (!cmContentNode || nativeSelectionActive) return;
  nativeSelectionActive = true;
  cmContentNode.setAttribute('contenteditable', 'true');
  cmContentNode.style.webkitUserModify = 'read-write-plaintext-only';
  cmContentNode.style.userSelect = 'text';
  cmContentNode.focus({ preventScroll: true });
  if (originEvent) {
    try {
      const x = originEvent.clientX;
      const y = originEvent.clientY;
      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (_error) {
      // ignore caret placement failures
    }
  }
}

function disableNativeSelection() {
  cancelNativeSelectionTimer();
  if (!nativeSelectionActive || !cmContentNode) return;
  nativeSelectionActive = false;
  cmContentNode.removeAttribute('contenteditable');
  cmContentNode.style.webkitUserModify = '';
  cmContentNode.style.userSelect = '';
  if (cmState.view) {
    cmState.view.focus();
  }
}

function handleNativePointerDown(ev) {
  if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
    cancelNativeSelectionTimer();
    nativePressPoint = { x: ev.clientX, y: ev.clientY };
    nativeSelectionTimer = window.setTimeout(() => {
      enableNativeSelection(ev);
    }, LONG_PRESS_MS);
  } else {
    disableNativeSelection();
  }
}

function handleNativePointerUp() {
  cancelNativeSelectionTimer();
}

function handleNativePointerCancel() {
  cancelNativeSelectionTimer();
}

function handleNativePointerMove(ev) {
  if (!nativeSelectionTimer || !nativePressPoint) return;
  const dx = Math.abs(ev.clientX - nativePressPoint.x);
  const dy = Math.abs(ev.clientY - nativePressPoint.y);
  if (dx > 12 || dy > 12) {
    cancelNativeSelectionTimer();
  }
}

function handleNativeBeforeInput() {
  disableNativeSelection();
}

function handleNativeBlur() {
  disableNativeSelection();
}

function recreateEditor(text, { preserveSelection = false } = {}) {
  if (!cmHost || !EditorState || !EditorView) return;
  let selection = null;
  if (cmState.view && preserveSelection) {
    const main = cmState.view.state.selection.main;
    selection = { anchor: main.anchor, head: main.head };
  }
  detachNativeSelection();
  if (cmState.view) {
    cmState.view.destroy();
  }
  cmHost.innerHTML = '';
  const state = EditorState.create({
    doc: text,
    extensions: makeExtensions(),
  });
  cmState.view = new EditorView({ state, parent: cmHost });
  cmState.text = text;
  attachNativeSelection();
  if (selection) {
    const docLength = cmState.view.state.doc.length;
    cmState.view.dispatch({
      selection: {
        anchor: Math.min(selection.anchor, docLength),
        head: Math.min(selection.head, docLength),
      },
      scrollIntoView: true,
    });
  }
}

function ensureEditor() {
  if (!cmState.view) {
    recreateEditor(cmState.text || '');
  }
  return cmState.view;
}

function updateStatusBar() {
  if (!recentTabToggle) return;
  if (cmState.language && cmState.language !== 'plaintext') {
    recentTabToggle.title = `Language: ${cmState.language}`;
  } else {
    recentTabToggle.removeAttribute('title');
  }
}

function setEditorDocument(docId, text, languageId) {
  ensureEditor();
  cmState.docId = docId;
  currentDocId = docId;
  cmState.text = typeof text === 'string' ? text : '';
  cmState.language = normalizeLanguageId(languageId, currentFile);
  recreateEditor(cmState.text);
  syncMenuState();
  setDocumentHasContent(true);
  updateStatusBar();
}

function posFromLocation(location) {
  if (!cmState.view) return 0;
  const doc = cmState.view.state.doc;
  if (!location || typeof location !== 'object') return 0;
  const line = Math.max(1, Number.isInteger(location.l) ? location.l + 1 : 1);
  const targetLine = Math.min(line, doc.lines);
  const lineInfo = doc.line(targetLine);
  const col = Math.max(0, Number.isInteger(location.c) ? location.c : 0);
  return Math.min(lineInfo.from + col, lineInfo.to);
}

function applyEditorChanges(docId, changes) {
  if (!cmState.view || docId !== cmState.docId) return;
  if (!Array.isArray(changes) || !changes.length) return;
  const edits = [];
  changes.forEach((change) => {
    const from = posFromLocation(change?.start);
    const to = posFromLocation(change?.end);
    const insert = typeof change?.text === 'string' ? change.text : '';
    edits.push({ from, to, insert });
  });
  if (edits.length) {
    cmState.view.dispatch({ changes: edits });
    cmState.text = cmState.view.state.doc.toString();
  }
}

function explorerPlaceholder(message) {
  if (!explorerContent) return;
  explorerContent.classList.add('explorer-empty');
  explorerContent.innerHTML = `<p>${message}</p>`;
}

explorerPlaceholder('Loading workspace…');

function toggleDrawer(open) {
  if (open === undefined) {
    root.classList.toggle('drawer-open');
  } else if (open) {
    root.classList.add('drawer-open');
  } else {
    root.classList.remove('drawer-open');
  }
}

function sendCommand(cmd, args = {}) {
  if (!frameReady || !frame?.contentWindow) return;
  if (cmd === 'openPath' && args?.path) {
    currentFile = args.path;
    updateDocPlaceholder();
  }
  const payload = { _mobileShell: true, type: 'command', cmd, args };
  frame.contentWindow.postMessage(payload, '*');
}

async function openFileInEditor(path) {
  currentFile = path;
  updateDocPlaceholder();

  sendCommand('openPath', { path });

  try {
    const response = await fetch(`/api/app/code_oss/file?path=${encodeURIComponent(path)}`);
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const fileData = body.data || {};
    const docId = buildDocIdFromPath(path);
    const language = normalizeLanguageId(fileData.language || null, path);
    closeRecentMenu();
    setEditorDocument(docId, fileData.content || '', language);
    recordFileHistory(currentProject, path, { persist: true });
  } catch (error) {
    console.error(`[ide_fullpage] Failed to fetch file content for ${path}:`, error);
    const docId = buildDocIdFromPath(path);
    const fallback = `// Failed to load file: ${path}\n// Reason: ${error.message}`.trim();
    setEditorDocument(docId, fallback, 'plaintext');
  }
}

function buildDocIdFromPath(path) {
  if (!path) return null;
  if (path.startsWith('file://') || path.startsWith('vscode-')) {
    return path;
  }
  if (path.startsWith('/')) {
    return `file://${encodeURI(path)}`;
  }
  return `file://${encodeURI(path)}`;
}

function applyBridgeState(data = {}) {
  if (typeof data.bridge_installed === 'boolean') {
    bridgeState.installed = data.bridge_installed;
  }
  if (typeof data.bridge_version === 'string') {
    bridgeState.version = data.bridge_version;
  }
  bridgeState.error = data.error || null;
  bridgeState.known = true;
  if (typeof data.git_enabled === 'boolean') {
    explorerState.git.enabled = data.git_enabled;
    syncGitToggle();
  }
  if (bridgeStatusLabel) {
    if (bridgeState.installed) {
      bridgeStatusLabel.dataset.state = 'installed';
      bridgeStatusLabel.textContent = bridgeState.version
        ? `Bridge: installed (v${bridgeState.version})`
        : 'Bridge: installed';
    } else if (bridgeState.error) {
      bridgeStatusLabel.dataset.state = 'error';
      bridgeStatusLabel.textContent = `Bridge error: ${bridgeState.error}`;
    } else {
      bridgeStatusLabel.dataset.state = 'missing';
      bridgeStatusLabel.textContent = 'Bridge: not installed';
    }
  }
  updateStatusBar();
}

function scheduleStatePoll(delay) {
  if (statePoll.timer) {
    clearTimeout(statePoll.timer);
    statePoll.timer = null;
  }
  const base = typeof delay === 'number' && !Number.isNaN(delay)
    ? delay
    : statePoll.interval;
  const jitterSpan = statePoll.jitter > 0
    ? Math.floor(Math.random() * statePoll.jitter)
    : 0;
  const jitter = jitterSpan > 0 && Math.random() < 0.5 ? -jitterSpan : jitterSpan;
  const wait = Math.max(300, Math.round(base + jitter));
  statePoll.timer = setTimeout(runStatePoll, wait);
}

function startBridgePolling(initialDelay = 600) {
  if (statePoll.timer) return;
  scheduleStatePoll(initialDelay);
}

function getBridgeArgs() {
  return {
    endpoint: bridgeStateEndpoint,
    flushInterval: statePoll.interval,
    retryDelay: statePoll.retryDelay,
  };
}

function clearBridgeHandshakeTimer() {
  if (bridgeHandshake.timer) {
    clearTimeout(bridgeHandshake.timer);
    bridgeHandshake.timer = null;
  }
}

function finishBridgeHandshake(reason) {
  if (!bridgeHandshake.active) return;
  clearBridgeHandshakeTimer();
  bridgeHandshake.active = false;
  bridgeHandshake.attempts = 0;
  if (reason) {
    console.debug('[ide_fullpage] Bridge handshake finished:', reason);
  }
}

function scheduleBridgeHandshake(delay = BRIDGE_HANDSHAKE_INTERVAL) {
  clearBridgeHandshakeTimer();
  bridgeHandshake.timer = setTimeout(runBridgeHandshake, Math.max(100, delay));
}

function attachFrame(newFrame) {
  if (!newFrame) return;
  if (frame && frame !== newFrame) {
    frame.removeEventListener('load', handleFrameLoad);
  }
  frame = newFrame;
  frame.addEventListener('load', handleFrameLoad);
}

function startBridgeHandshake(initialDelay = 0) {
  finishBridgeHandshake();
  bridgeHandshake.active = true;
  bridgeHandshake.attempts = 0;
  scheduleBridgeHandshake(initialDelay);
}

function runBridgeHandshake() {
  if (!bridgeHandshake.active) return;
  if (!frameReady || !frame?.contentWindow) {
    scheduleBridgeHandshake(200);
    return;
  }

  const args = getBridgeArgs();
  bridgeHandshake.attempts += 1;
  console.debug('[ide_fullpage] Running bridge handshake attempt', bridgeHandshake.attempts);
  sendCommand('configureBridge', args);
  sendCommand('requestExplorerTree', { depth: 2 });

  if (BRIDGE_HANDSHAKE_MAX_ATTEMPTS > 0 && bridgeHandshake.attempts >= BRIDGE_HANDSHAKE_MAX_ATTEMPTS) {
    console.warn('[ide_fullpage] Bridge handshake attempts exhausted');
    finishBridgeHandshake('max_attempts');
  } else {
    scheduleBridgeHandshake(BRIDGE_HANDSHAKE_INTERVAL);
  }
}

async function runStatePoll() {
  if (statePoll.pending) {
    scheduleStatePoll(statePoll.interval);
    return;
  }
  statePoll.pending = true;
  let nextDelay = statePoll.interval;
  try {
    const params = statePoll.lastSeq ? `?since=${statePoll.lastSeq}` : '';
    const response = await fetch(`${bridgeStateEndpoint}${params}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body?.ok) {
      const data = body.data || {};
      if (!summaryBootstrapped && data.summary) {
        applyBridgeSummary(data.summary);
      }
      if (typeof data.sequence === 'number') {
        statePoll.lastSeq = data.sequence;
      }
      const events = Array.isArray(data.events) ? data.events : [];
      if (events.length) {
        events.forEach((evt) => handleBridgeEvent(evt));
        const lastEvent = events[events.length - 1];
        if (lastEvent && typeof lastEvent.seq === 'number') {
          statePoll.lastSeq = lastEvent.seq;
        }
      }
    } else if (body && body.error) {
      throw new Error(body.error);
    }
  } catch (error) {
    console.error('[ide_fullpage] Failed to poll bridge state', error);
    nextDelay = statePoll.retryDelay;
  } finally {
    statePoll.pending = false;
    scheduleStatePoll(nextDelay);
  }
}

function applyBridgeSummary(summary) {
  if (!summary || summaryBootstrapped) return;
  const bootstrapEvents = [];
  if (summary.state) {
    bootstrapEvents.push({ type: 'state', ...summary.state });
  }
  if (summary.workspace_folders && summary.workspace_folders.length) {
    bootstrapEvents.push({ type: 'workspaceFolders', folders: summary.workspace_folders });
  }
  if (summary.explorer_tree && summary.explorer_tree.type) {
    bootstrapEvents.push(summary.explorer_tree);
  }
  if (summary.chat_providers && summary.chat_providers.length) {
    bootstrapEvents.push({ type: 'chatProviders', providers: summary.chat_providers });
  }
  if (summary.active_editor) {
    bootstrapEvents.push({ type: 'activeEditor', path: summary.active_editor });
  }
  if (summary.bridge) {
    bootstrapEvents.push({ type: 'bridgeState', ...summary.bridge });
  }
  if (Array.isArray(summary.errors) && summary.errors.length) {
    const lastError = summary.errors[summary.errors.length - 1];
    if (lastError?.message) {
      console.warn('[ide_fullpage] Bridge reported previous error:', lastError.message);
    }
  }
  bootstrapEvents.forEach((evt) => handleBridgeEvent(evt));
  summaryBootstrapped = true;
}

function normalizeEntry(raw) {
  if (!raw) return null;
  const type = raw.entryType || raw.type || 'file';
  const label = raw.label || raw.name || raw.path?.split('/').pop() || 'item';
  const sourcePath = raw.path || raw.uri || raw.url;
  const normalizedPath = normalizeFsPath(normalizeFilePath(sourcePath)) || sourcePath;
  return {
    path: normalizedPath,
    sourcePath,
    label,
    entryType: type,
    hasChildren: !!raw.hasChildren || type === 'directory',
    children: raw.children || [],
  };
}

function applyExplorerEntries(entries, parentPath = null) {
  if (!Array.isArray(entries)) return;
  const normalized = entries
    .map(normalizeEntry)
    .filter((entry) => entry && entry.path);

  let previousExpanded;
  if (!parentPath) {
    previousExpanded = new Set(explorerState.expanded);
    explorerState.rootPaths = normalized.map((entry) => entry.path);
    explorerState.nodes.clear();
    explorerState.expanded.clear();
  }

  normalized.forEach((entry) => {
    const node = explorerState.nodes.get(entry.path) || { children: [] };
    node.path = entry.path;
    node.label = entry.label;
    node.entryType = entry.entryType;
    node.hasChildren = entry.hasChildren;
    node.children = Array.isArray(entry.children)
      ? entry.children
          .map((child) => (
            normalizeFsPath(
              normalizeFilePath(child?.path || child?.uri || child?.url)
            ) || child?.path || child?.uri || child?.url
          ))
          .filter(Boolean)
      : [];
    node.childrenLoaded = Array.isArray(entry.children) && entry.children.length > 0;
    explorerState.nodes.set(entry.path, node);
    if (!parentPath && entry.entryType === 'directory') {
      if (previousExpanded && previousExpanded.has(entry.path)) {
        explorerState.expanded.add(entry.path);
      } else if (!previousExpanded || previousExpanded.size === 0) {
        explorerState.expanded.add(entry.path);
      }
    }
    if (entry.children && entry.children.length) {
      applyExplorerEntries(entry.children, entry.path);
    }
  });

  if (parentPath) {
    const parentNode = explorerState.nodes.get(parentPath) || { children: [] };
    parentNode.children = normalized.map((entry) => entry.path);
    parentNode.childrenLoaded = true;
    parentNode.hasChildren = normalized.length > 0;
    explorerState.nodes.set(parentPath, parentNode);
  }
}

function renderExplorerTree() {
  if (!explorerContent) return;
  if (!explorerState.rootPaths.length) {
    explorerPlaceholder('Workspace is empty.');
    return;
  }
  explorerContent.classList.remove('explorer-empty');
  explorerContent.innerHTML = '';
  const showGit = shouldShowGitIndicators();
  const rootList = document.createElement('ul');
  rootList.className = 'explorer-tree';
  explorerState.rootPaths.forEach((path) => {
    const node = explorerState.nodes.get(path);
    if (node) {
      rootList.appendChild(renderExplorerNode(node, 0, showGit));
    }
  });
  explorerContent.appendChild(rootList);
}

function renderExplorerNode(node, depth, showGit) {
  const item = document.createElement('li');
  item.className = 'explorer-node';
  item.dataset.path = node.path;
  if (node.entryType === 'directory') item.classList.add('is-directory');
  if (node.entryType === 'file') item.classList.add('is-file');
  if (explorerState.activePath === node.path) item.classList.add('is-active');

  const row = document.createElement('div');
  const indent = depth * 16 + 8;
  row.className = 'explorer-row';
  row.style.paddingLeft = `${indent}px`;

  if (node.entryType === 'directory') {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'explorer-toggle';
    toggle.setAttribute('aria-label', 'Toggle folder');
    toggle.textContent = explorerState.expanded.has(node.path) ? '▼' : '▶';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleDirectory(node);
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'explorer-toggle-spacer';
    row.appendChild(spacer);
  }

  const name = document.createElement('span');
  name.className = 'explorer-name';
  name.textContent = node.label || node.path.split('/').pop() || node.path;
  row.appendChild(name);

  const gitMeta = getGitEntry(node.path);
  const gitStats = node.entryType === 'directory'
    ? getDirectoryGitStats(node.path)
    : null;

  if (node.entryType === 'file' && gitMeta?.executable) {
    item.classList.add('is-executable');
  }

  let badge = null;
  if (showGit) {
    if (node.entryType === 'file') {
      badge = buildFileGitBadge(gitMeta);
    } else if (node.entryType === 'directory') {
      badge = buildDirectoryGitBadge(gitStats);
    }
  }
  if (badge) {
    row.appendChild(badge);
    item.classList.add('has-git');
  }

  row.addEventListener('click', () => {
    if (node.entryType === 'directory') {
      toggleDirectory(node);
    } else {
      explorerState.activePath = node.path;
      renderExplorerTree();
      openFileInEditor(node.path);
    }
  });

  item.appendChild(row);

  if (node.entryType === 'directory' && explorerState.expanded.has(node.path)) {
    const childList = document.createElement('ul');
    childList.className = 'explorer-children';
    const separatorTop = document.createElement('div');
    separatorTop.className = 'explorer-separator';
    separatorTop.style.marginLeft = `${indent + 22}px`;
    const separatorBottom = document.createElement('div');
    separatorBottom.className = 'explorer-separator';
    separatorBottom.style.marginLeft = `${indent + 22}px`;
    if (node.children && node.children.length) {
      node.children.forEach((childPath) => {
        const childNode = explorerState.nodes.get(childPath);
        if (childNode) {
          childList.appendChild(renderExplorerNode(childNode, depth + 1, showGit));
        }
      });
    } else if (!node.childrenLoaded) {
      const loadingItem = document.createElement('li');
      loadingItem.className = 'explorer-node is-loading';
      loadingItem.innerHTML = '<div class="explorer-row">Loading…</div>';
      childList.appendChild(loadingItem);
    }
    if (childList.children.length) {
      item.appendChild(separatorTop);
      item.appendChild(childList);
      item.appendChild(separatorBottom);
    } else {
      item.appendChild(childList);
    }
  }

  return item;
}

function toggleDirectory(node) {
  if (explorerState.expanded.has(node.path)) {
    explorerState.expanded.delete(node.path);
    renderExplorerTree();
    return;
  }
  explorerState.expanded.add(node.path);
  if (!node.childrenLoaded) {
    sendCommand('requestExplorerChildren', { path: node.path, depth: 1 });
  }
  renderExplorerTree();
}

function ensurePathVisible(path) {
  if (!path) return;
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  let current = normalized.startsWith('/') ? '' : '';
  segments.forEach((segment, index) => {
    current = current ? `${current}/${segment}` : (normalized.startsWith('/') ? `/${segment}` : segment);
    const node = explorerState.nodes.get(current);
    if (node && node.entryType === 'directory') {
      explorerState.expanded.add(node.path);
      if (!node.childrenLoaded) {
        sendCommand('requestExplorerChildren', { path: node.path, depth: 1 });
      }
    }
    if (index === segments.length - 1) {
      explorerState.activePath = path;
    }
  });
  renderExplorerTree();
}

function updateStatus(headline, detail, { working = true } = {}) {
  if (!frameShell) return;
  frameShell.classList.remove('is-hidden');
  if (statusCard) {
    statusCard.style.display = '';
    if (headline && statusHeadline) statusHeadline.textContent = headline;
    if (detail && statusDetail) statusDetail.textContent = detail;
    statusCard.classList.toggle('ide-status--working', working);
  }
}

function hideOverlay() {
  if (frameShell) frameShell.classList.add('is-hidden');
  if (statusCard) statusCard.style.display = 'none';
}

function markReady(url) {
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    console.error('[ide_fullpage] Invalid server URL', url, error);
    return;
  }

  iframeOrigin = parsed.origin;
  connectionLabel = `Connected to ${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`.trim();

  const folderParam = parsed.searchParams.get('folder');
  let projectUpdated = false;
  if (folderParam) {
    try {
      const decoded = decodeURIComponent(folderParam);
      setCurrentProject(decoded);
      projectUpdated = true;
    } catch (_error) {
      // Ignore decoding issues; fall back to existing project state.
    }
  }
  if (!projectUpdated) {
    updateSubtitle();
    updateDocPlaceholder();
  }
  updateStatusBar();
  if (frame) {
    frameReady = false;
    frame.src = parsed.toString();
  }
}

function showError(message) {
  updateStatus('Unable to launch Code OSS', message || 'Unknown error', { working: false });
}

async function startServer({ headline, detail } = {}) {
  frameReady = false;
  summaryBootstrapped = false;
  statePoll.lastSeq = 0;
  scheduleStatePoll(500);
  updateStatus(
    headline || 'Starting Code OSS…',
    detail || 'Booting the bundled code-server binary. This can take a moment.'
  );
  try {
    const response = await fetch('/api/app/code_oss/start', { method: 'POST' });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    const data = body.data || {};
    if (data.project_path) {
      currentFile = null;
      setCurrentProject(data.project_path);
    }
    applyBridgeState(data);
    const serverUrl = normalizeServerUrl({
      url: data.url,
      host: data.host,
      port: data.port,
      projectPath: currentProject,
    });
    if (!serverUrl) throw new Error('No code-server URL returned from backend');
    markReady(serverUrl);
  } catch (error) {
    showError(error.message || 'Unknown error');
  }
}

function handleBridgeEvent(data) {
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'state': {
      const dim = !!(data.sidebarVisible || data.panelVisible);
      document.body.classList.toggle('dim', dim);
      break;
    }
    case 'explorerTree': {
      const entries = data.entries || [];
      if ('git' in data) {
        updateGitSnapshot(data.git);
      }
      if (!entries.length && !data.parent) {
        explorerState.nodes.clear();
        explorerState.rootPaths = [];
        explorerState.expanded.clear();
        explorerPlaceholder('Workspace is empty.');
        break;
      }
      applyBridgeState({ bridge_installed: true });
      applyExplorerEntries(entries, data.parent || null);
      if (!data.parent) {
        finishBridgeHandshake('explorerTree');
      }
      if (!data.parent && explorerState.rootPaths.length) {
        setCurrentProject(explorerState.rootPaths[0]);
      }
      renderExplorerTree();
      if (!data.parent) {
        root.classList.add('drawer-open');
      }
      break;
    }
    case 'doc_state': {
      if (data.doc_id) {
        currentDocId = data.doc_id;
        if (typeof data.rev === 'number') {
          docRevisions.set(data.doc_id, data.rev);
        }
        setEditorDocument(data.doc_id, data.text, data.languageId);
        setDocumentHasContent(true);
      }
      break;
    }
    case 'doc_changes': {
      if (data.doc_id) {
        if (typeof data.next_rev === 'number') {
          docRevisions.set(data.doc_id, data.next_rev);
        }
        applyEditorChanges(data.doc_id, data.changes);
        setDocumentHasContent(true);
      }
      break;
    }
    case 'ack': {
      if (data.doc_id && typeof data.applied_rev === 'number') {
        docRevisions.set(data.doc_id, data.applied_rev);
      }
      break;
    }
    case 'chatProviders': {
      if (Array.isArray(data.providers) && data.providers.length) {
        const active = data.providers.find((provider) => provider.active);
        chatSubtitle.textContent = active
          ? `Showing ${active.label || active.id}`
          : 'No active provider selected';
      }
      break;
    }
    case 'chatAttachment': {
      const placeholder = document.getElementById('chat-placeholder');
      if (placeholder) {
        placeholder.innerHTML = '';
        placeholder.appendChild(data.element || document.createTextNode('Extension attached.'));
      }
      break;
    }
    case 'activeEditor': {
      if (data.path) {
        currentFile = data.path;
        updateDocPlaceholder();
        updateSubtitle();
        if (!explorerState.nodes.has(data.path)) {
          sendCommand('revealPath', { path: data.path });
        }
        ensurePathVisible(data.path);
        applyBridgeState({ bridge_installed: true });
        setDocumentHasContent(true);
        recordFileHistory(currentProject, data.path, { persist: true });
      } else {
        currentFile = null;
        currentDocId = null;
        updateDocPlaceholder();
        updateSubtitle();
        setDocumentHasContent(false);
      }
      break;
    }
    case 'workspaceFolders': {
      const folders = Array.isArray(data.folders) ? data.folders : [];
      if (!folders.length) {
        setCurrentProject(null);
        explorerPlaceholder('Workspace is empty.');
      } else {
        const firstPath = extractFolderPath(folders[0]);
        if (firstPath) {
          setCurrentProject(firstPath);
        }
      }
      break;
    }
    case 'bridgeState': {
      applyBridgeState(data);
      break;
    }
    case 'bridgeActivated': {
      console.log('[ide_fullpage] Bridge activated!', data);
      applyBridgeState({ bridge_installed: true });
      finishBridgeHandshake('bridgeActivated');
      setTimeout(() => {
        sendCommand('requestExplorerTree', { depth: 2 });
      }, 100);
      break;
    }
    case 'doc_error': {
      if (typeof data.message === 'string') {
        console.error('[ide_fullpage] Document error:', data.message);
      }
      break;
    }
    default:
      console.log('[ide_fullpage] Unknown message type:', data.type);
      break;
  }
}

function handleFrameLoad() {
  frameReady = true;
  frame?.setAttribute('aria-hidden', 'false');
  hideOverlay();
  const bridgeArgs = getBridgeArgs();
  frame.contentWindow?.postMessage({ _mobileShell: true, type: 'hello', args: bridgeArgs }, '*');
  startBridgePolling(300);
  setTimeout(() => {
    sendCommand('configureBridge', bridgeArgs);
    sendCommand('requestExplorerTree');
    if (seed.file_path) {
      sendCommand('openPath', {
        path: seed.file_path,
        line: seed.line,
        column: seed.column,
      });
      seed.file_path = null;
    }
    if (seed.view) {
      sendCommand('showView', { viewId: seed.view, inPanel: true });
      seed.view = null;
    }
  }, 600);
}

attachFrame(frame);

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data._mobileBridge) {
    handleBridgeEvent(data);
  }
});

window.addEventListener('beforeunload', () => {
  if (statePoll.timer) {
    clearTimeout(statePoll.timer);
    statePoll.timer = null;
  }
});

btnMenu?.addEventListener('click', () => toggleDrawer(true));
btnDrawerClose?.addEventListener('click', () => toggleDrawer(false));
drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

menuRegistry.forEach(({ button, dropdown }) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = dropdown.classList.contains('is-open');
    closeMenus(isOpen ? null : dropdown);
  });
});

recentTabToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (recentTabToggle.disabled) return;
  if (recentMenuOpen) {
    closeRecentMenu();
  } else {
    openRecentMenu();
  }
});

recentTabMenu?.addEventListener('click', (event) => {
  const closeButton = event.target.closest('[data-action="close"]');
  const item = event.target.closest('.recent-menu-item');
  if (!item) return;
  const { path } = item.dataset;
  if (!path) return;
  if (closeButton) {
    event.stopPropagation();
    removeFileHistory(currentProject, path, { persist: true });
    return;
  }
  closeRecentMenu();
  openFileInEditor(path);
});

document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  const insideMenu = menuRegistry.some(({ button, dropdown }) => {
    return button.contains(target) || dropdown.contains(target);
  });
  if (!insideMenu) closeMenus();
  const insideRecent = target.closest('#recent-tab-menu') || target.closest('#recent-tab-toggle');
  if (!insideRecent) closeRecentMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenus();
    disableNativeSelection();
    closeRecentMenu();
  }
});

btnBack?.addEventListener('click', () => {
  if (document.referrer && document.referrer.includes('/app/')) {
    window.location.href = document.referrer;
  } else {
    window.location.href = '/app/code_oss';
  }
});

btnSearch?.addEventListener('click', () => sendCommand('openSearch'));
btnCommand?.addEventListener('click', () => sendCommand('showCommands'));
btnSettings?.addEventListener('click', () => sendCommand('openSettingsJSON'));
btnChatRefresh?.addEventListener('click', () => sendCommand('refreshChat'));

btnDocTestEdit?.addEventListener('click', async () => {
  if (btnDocTestEdit.disabled) return;
  const docId = currentDocId || buildDocIdFromPath(currentFile);
  if (!docId) {
    window.alert('No focused document available for edits yet.');
    return;
  }
  const baseRev = docRevisions.get(docId);
  const timestamp = new Date().toISOString();
  const payload = {
    doc_id: docId,
    base_rev: baseRev,
    edits: [
      {
        start: { l: 0, c: 0 },
        end: { l: 0, c: 0 },
        text: `// inserted via mobile wrapper ${timestamp}\n`,
      },
    ],
  };
  btnDocTestEdit.disabled = true;
  try {
    const response = await fetch('/api/app/code_oss/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    console.log('[ide_fullpage] Queued sample edit', body?.data);
  } catch (error) {
    console.error('[ide_fullpage] Failed to queue sample edit', error);
    window.alert(`Failed to queue edit: ${error?.message || error}`);
  } finally {
    btnDocTestEdit.disabled = false;
  }
});

miToggleLines?.addEventListener('click', () => {
  cmState.showLineNumbers = !cmState.showLineNumbers;
  syncMenuState();
  recreateEditor(cmState.text, { preserveSelection: true });
  closeMenus();
});

miToggleShading?.addEventListener('click', () => {
  cmState.showShading = !cmState.showShading;
  syncMenuState();
  recreateEditor(cmState.text, { preserveSelection: true });
  closeMenus();
});

miToggleSyntax?.addEventListener('click', () => {
  cmState.showSyntax = !cmState.showSyntax;
  syncMenuState();
  recreateEditor(cmState.text, { preserveSelection: true });
  closeMenus();
});

miToggleWrap?.addEventListener('click', () => {
  cmState.wordWrap = !cmState.wordWrap;
  syncMenuState();
  recreateEditor(cmState.text, { preserveSelection: true });
  closeMenus();
});

miFind?.addEventListener('click', () => {
  closeMenus();
  if (cmState.view && typeof openSearchPanel === 'function') {
    openSearchPanel(cmState.view);
  }
});

miGoto?.addEventListener('click', () => {
  closeMenus();
  if (!cmState.view) return;
  const input = window.prompt('Go to line');
  const line = Number.parseInt(input || '', 10);
  if (Number.isNaN(line)) return;
  const ln = Math.max(1, line);
  const lineInfo = cmState.view.state.doc.line(Math.min(ln, cmState.view.state.doc.lines));
  cmState.view.dispatch({
    selection: { anchor: lineInfo.from, head: lineInfo.from },
    scrollIntoView: true,
  });
  cmState.view.focus();
});

themeMenuItems.forEach((item) => {
  item.addEventListener('click', () => {
    const theme = item.dataset.theme || 'cm6-dark';
    cmState.theme = theme;
    syncMenuState();
    recreateEditor(cmState.text, { preserveSelection: true });
    closeMenus();
  });
});

btnOpenProject?.addEventListener('click', async () => {
  if (!(window.teFilePicker && typeof window.teFilePicker.openDirectory === 'function')) {
    window.alert('Directory picker is unavailable in this environment.');
    return;
  }
  const previousProject = currentProject;
  const previousFile = currentFile;
  try {
    const choice = await window.teFilePicker.openDirectory({
      title: 'Open Project Folder',
      selectLabel: 'Open',
      startPath: currentProject || '~',
    });
    if (!choice || !choice.path) return;

    btnOpenProject.disabled = true;
    updateStatus('Switching workspace…', 'Loading the selected folder in code-server.');

    explorerState.nodes.clear();
    explorerState.rootPaths = [];
    explorerState.expanded.clear();
    explorerState.activePath = null;
    explorerPlaceholder('Loading workspace…');
    const targetUrl = navigateFrameToProject(choice.path);
    if (!targetUrl) {
      setCurrentProject(previousProject, { updateUI: true });
      currentFile = previousFile;
      updateDocPlaceholder();
      setDocumentHasContent(Boolean(previousFile));
      throw new Error('Unable to determine code-server URL for selected folder.');
    }
    currentFile = null;
    setCurrentProject(choice.path);
    setDocumentHasContent(false);
    summaryBootstrapped = false;
    statePoll.lastSeq = 0;
    scheduleStatePoll(500);
  } catch (error) {
    console.error('[ide_fullpage] Failed to switch project', error);
    setCurrentProject(previousProject, { updateUI: true });
    currentFile = previousFile;
    updateDocPlaceholder();
    setDocumentHasContent(Boolean(previousFile));
    updateStatus('Unable to switch project', error?.message || 'Unknown error', { working: false });
  } finally {
    btnOpenProject.disabled = false;
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    toggleDrawer(false);
  }
});

function getStateAPI() {
  try {
    return window.teState || null;
  } catch (_error) {
    return null;
  }
}

function restoreProjectState() {
  const st = getStateAPI();
  if (st && typeof st.get === 'function') {
    try {
      const stored = st.get(PROJECT_STATE_KEY);
      if (stored) {
        setCurrentProject(stored, { updateUI: false, persist: false });
        return;
      }
    } catch (error) {
      console.warn('[ide_fullpage] Failed to restore project path from state', error);
    }
  }
  if (currentProject) {
    setCurrentProject(currentProject, { updateUI: false, persist: false });
  }
}

function restoreAssistantState() {
  const btn = btnToggleAssistant;
  if (!root || !btn) return;
  const collapsed = true;
  root.classList.toggle('assistant-collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
}

function wireAssistantToggle() {
  const st = getStateAPI();
  const btn = btnToggleAssistant;
  if (!root || !btn) return;
  btn.addEventListener('click', () => {
    const collapsed = root.classList.toggle('assistant-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    if (st && st.set) st.set('assistantCollapsed', collapsed);
  });
}

restoreAssistantState();
wireAssistantToggle();
initializeHistory();
restoreProjectState();
restoreGitPreference();
wireGitToggle();
updateSubtitle();
updateDocPlaceholder();
ensureEditor();
syncMenuState();
startServer();
