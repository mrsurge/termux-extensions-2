type JsonObject = Record<string, unknown>;

export interface SaveFileChoice {
  path?: string;
  existed?: boolean;
}

export interface SaveFileOptions {
  title: string;
  startPath: string;
  filename: string;
  selectLabel: string;
}

export interface DiagnosticMarker {
  severity?: number;
  startLineNumber?: number;
  startColumn?: number;
  code?: unknown;
  source?: string;
  message?: string;
}

export interface HostChromeRuntimeDeps {
  issuesToggleBtn: HTMLButtonElement;
  issuesBadgesEl: HTMLElement;
  basename: (path: string) => string;
  toAbsolute: (path: string, baseDir: string | null, homeDir: string) => string;
  homeDir: string;
  getCurrentPath: () => string;
  getCachedProjectRoot: () => string | null | undefined;
  getProblemsDetail: () => Record<string, unknown>;
  pickerAvailable: () => boolean;
  saveFileWithPicker: (options: SaveFileOptions) => Promise<SaveFileChoice | null | undefined>;
  apiPost: (path: string, body?: JsonObject) => Promise<unknown>;
  getClientId: () => string;
  requestBackendEditorIssuesCommand: (payload: JsonObject) => Promise<unknown>;
  toast: (message: string, kind?: string) => void;
  confirm: (message: string) => Promise<boolean>;
}

export interface HostChromeRuntime {
  formatFileNameDisplay: (name: string) => string;
  setIssuesButtonsEnabled: (enabled: boolean) => void;
  exportDiagnosticsToFile: () => Promise<void>;
  install: () => void;
}

const MAX_FILENAME_DISPLAY = 34;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  if (isRecord(value) && typeof value.message === 'string' && value.message) return value.message;
  return fallback;
}

function isFailureResponse(value: unknown): value is { ok: false; error?: unknown } {
  return isRecord(value) && value.ok === false;
}

function normalizeMarker(value: unknown): DiagnosticMarker | null {
  if (!isRecord(value)) return null;
  return {
    severity: typeof value.severity === 'number' ? value.severity : undefined,
    startLineNumber: typeof value.startLineNumber === 'number' ? value.startLineNumber : undefined,
    startColumn: typeof value.startColumn === 'number' ? value.startColumn : undefined,
    code: value.code,
    source: typeof value.source === 'string' ? value.source : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}

function normalizeMarkers(value: unknown): DiagnosticMarker[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMarker).filter((marker): marker is DiagnosticMarker => marker !== null);
}

function safeFilePart(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

export function createHostChromeRuntime(deps: HostChromeRuntimeDeps): HostChromeRuntime {
  let installed = false;

  function formatFileNameDisplay(name: string): string {
    if (!name) return '';
    if (name.length <= MAX_FILENAME_DISPLAY) return name;
    const keepStart = Math.max(6, Math.floor((MAX_FILENAME_DISPLAY - 1) * 0.6));
    const keepEnd = Math.max(4, MAX_FILENAME_DISPLAY - keepStart - 1);
    return `${name.slice(0, keepStart)}…${name.slice(-keepEnd)}`;
  }

  function setIssuesButtonsEnabled(enabled: boolean): void {
    deps.issuesToggleBtn.disabled = !enabled;
    if (!enabled) {
      deps.issuesBadgesEl.textContent = '';
    }
  }

  async function sendIssuesCmd(action: string): Promise<void> {
    try {
      await deps.requestBackendEditorIssuesCommand({ action: String(action || '') });
    } catch (err) {
      console.warn('[Issues] Failed to send via backend:', err);
    }
  }

  function buildDefaultDiagnosticsFilename(absPath: string, projectRoot: string, ext = '.json'): string {
    const file = String(absPath || '').trim();
    const pr = String(projectRoot || '').trim().replace(/\/+$/, '');

    let rel = '';
    if (pr && file && file.startsWith(`${pr}/`)) {
      rel = file.slice(pr.length + 1);
    }

    const dotted = (rel || deps.basename(file) || 'untitled')
      .split('/')
      .filter(Boolean)
      .map(safeFilePart)
      .filter(Boolean)
      .join('.');

    return `${dotted || 'untitled'}${ext}`;
  }

  async function ensureDiagnosticsDir(projectRootAbs: string): Promise<{ ok: boolean; dir: string }> {
    const projectRoot = String(projectRootAbs || '').replace(/\/+$/, '');
    if (!projectRoot) return { ok: false, dir: '' };
    const codeRoot = `${projectRoot}/.code_cm6`;
    const target = `${codeRoot}/diagnostics`;

    const exists = async (): Promise<boolean> => {
      try {
        const params = new URLSearchParams({ path: target, hidden: '1', root: 'system' });
        const resp = await fetch(`/api/browse?${params.toString()}`, { cache: 'no-store' });
        if (!resp.ok) return false;
        const json = await resp.json().catch(() => ({}));
        return Boolean(isRecord(json) && json.ok);
      } catch {
        return false;
      }
    };

    if (await exists()) return { ok: true, dir: target };

    const yes = await deps.confirm('This will create a new directory called .code_cm6/diagnostics in your project root. Is this ok?');
    if (!yes) return { ok: false, dir: projectRoot };

    try {
      const rootResp = await deps.apiPost('explorer/mkdir', { parent_rel: '.', name: '.code_cm6' });
      if (isFailureResponse(rootResp)) throw new Error(String(rootResp.error || 'mkdir failed'));
      const resp = await deps.apiPost('explorer/mkdir', { parent_rel: '.code_cm6', name: 'diagnostics' });
      if (isFailureResponse(resp)) throw new Error(String(resp.error || 'mkdir failed'));
    } catch (err) {
      deps.toast(errorMessage(err, 'Failed to create .code_cm6/diagnostics'));
      return { ok: false, dir: projectRoot };
    }

    return { ok: true, dir: target };
  }

  async function writeTextFileInProject(absPath: string, content: string): Promise<unknown> {
    const opId = `op_diag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const payload: JsonObject = {
      path: absPath,
      content: String(content ?? ''),
      client_id: deps.getClientId(),
      op_id: opId,
    };
    const res = await deps.apiPost('write', payload);
    if (isFailureResponse(res)) {
      throw new Error(String(res.error || 'Write failed'));
    }
    return res;
  }

  async function showExportDiagModal(): Promise<'human' | 'json' | null> {
    const result = await window.teUI.dialog.open({
      kind: 'surface',
      title: 'Export Diagnostics',
      message: 'Choose export format:',
      surface: { id: 'code-te2.export-diagnostics' },
      actions: [
        { id: 'cancel', label: 'Cancel', role: 'cancel' },
        { id: 'json', label: 'JSON', role: 'accept' },
        { id: 'human', label: 'Human Readable', role: 'accept', primary: true },
      ],
      defaultAction: 'human',
      cancelAction: 'cancel',
    });
    return result.status === 'accepted' && (result.action === 'human' || result.action === 'json')
      ? result.action
      : null;
  }

  function formatDiagnosticsMarkdown(absPath: string, markers: DiagnosticMarker[], projectRoot: string): string {
    const pr = String(projectRoot || '').replace(/\/+$/, '');
    const rel = pr && absPath.startsWith(`${pr}/`) ? absPath.slice(pr.length + 1) : absPath;
    const errors = markers.filter((m) => m.severity === 8).length;
    const warnings = markers.filter((m) => m.severity === 4).length;
    const infos = markers.filter((m) => m.severity === 2 || m.severity === 1).length;

    const lines: string[] = [];
    lines.push(`# Diagnostics: ${rel}`);
    lines.push('');
    lines.push(`**Exported:** ${new Date().toISOString()}`);
    const counts: string[] = [];
    if (errors) counts.push(`${errors} error${errors > 1 ? 's' : ''}`);
    if (warnings) counts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
    if (infos) counts.push(`${infos} info`);
    lines.push(`**Summary:** ${counts.length ? counts.join(', ') : 'No problems'}`);
    lines.push('');

    if (markers.length === 0) {
      lines.push('No problems detected.');
    } else {
      const sorted = [...markers].sort((a, b) => {
        const sevOrder = (severity?: number) => severity === 8 ? 0 : (severity === 4 ? 1 : 2);
        const severityOrder = sevOrder(a.severity) - sevOrder(b.severity);
        if (severityOrder !== 0) return severityOrder;
        return (a.startLineNumber || 0) - (b.startLineNumber || 0);
      });
      for (const marker of sorted) {
        const severity = marker.severity === 8 ? '🔴 Error' : (marker.severity === 4 ? '🟡 Warning' : 'ℹ️ Info');
        const loc = `${marker.startLineNumber || 1}:${marker.startColumn || 1}`;
        const code = isRecord(marker.code) ? marker.code.value : marker.code;
        const codeText = code == null || code === '' ? '' : String(code);
        const sourceText = marker.source ? ` [${marker.source}${codeText ? `(${codeText})` : ''}]` : '';
        lines.push(`- **${severity}** at line ${loc} — ${marker.message || '(no message)'}${sourceText}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  async function exportDiagnosticsToFile(): Promise<void> {
    const currentPath = deps.getCurrentPath();
    if (!currentPath) {
      deps.toast('Open a file first');
      return;
    }
    const cachedProjectRoot = deps.getCachedProjectRoot();
    if (!cachedProjectRoot) {
      deps.toast('No active project root');
      return;
    }

    const detail = deps.getProblemsDetail();
    const markers = normalizeMarkers(detail[currentPath]);

    const format = await showExportDiagModal();
    if (!format) return;

    const projectRoot = String(cachedProjectRoot || '').replace(/\/+$/, '');
    const isHuman = format === 'human';
    const fileExt = isHuman ? '.md' : '.json';
    const defaultDirRes = await ensureDiagnosticsDir(projectRoot);
    const startDir = defaultDirRes.dir || projectRoot;
    const defaultName = buildDefaultDiagnosticsFilename(currentPath, projectRoot, fileExt);

    if (!deps.pickerAvailable()) {
      deps.toast('File picker unavailable');
      return;
    }

    let choice: SaveFileChoice | null | undefined = null;
    try {
      choice = await deps.saveFileWithPicker({
        title: 'Export Diagnostics',
        startPath: startDir,
        filename: defaultName,
        selectLabel: 'Save',
      });
    } catch (err) {
      if (errorMessage(err, '') === 'cancelled') return;
      deps.toast(errorMessage(err, 'Export cancelled'));
      return;
    }
    if (!choice?.path) return;

    const targetAbs = deps.toAbsolute(choice.path, null, deps.homeDir);
    if (!(targetAbs === projectRoot || targetAbs.startsWith(`${projectRoot}/`))) {
      deps.toast('Export path must be inside the project root');
      return;
    }
    if (choice.existed && !(await deps.confirm('File exists. Overwrite?'))) return;

    const text = isHuman
      ? formatDiagnosticsMarkdown(currentPath, markers, projectRoot)
      : `${JSON.stringify({
        exported_at: new Date().toISOString(),
        project_root: projectRoot,
        file_path: currentPath,
        markers,
      }, null, 2)}\n`;

    try {
      await writeTextFileInProject(targetAbs, text);
      deps.toast(`Diagnostics exported: ${deps.basename(targetAbs)}`);
    } catch (err) {
      console.error('[Diagnostics Export] Write failed:', err);
      deps.toast(errorMessage(err, 'Failed to write diagnostics file'));
    }
  }

  function install(): void {
    if (installed) return;
    installed = true;
    deps.issuesToggleBtn.addEventListener('click', () => { void sendIssuesCmd('next'); });
  }

  return {
    formatFileNameDisplay,
    setIssuesButtonsEnabled,
    exportDiagnosticsToFile,
    install,
  };
}
