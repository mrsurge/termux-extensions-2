import { createProblemsPanel } from '../../../static/js/problems.js';

const CONTAINER_ID = 'explorer-diagnostics-container';

interface ExplorerMentionPayload {
  path: string;
  lineNo?: number;
  col?: number;
  endLineNo?: number;
  endCol?: number;
  content?: string;
}

interface ExplorerDiagnosticsCallbacks {
  openFileAndMaybeJump(
    rel: string,
    line?: number,
    jumpOptions?: Record<string, unknown>,
  ): Promise<void>;
  toast(message: string): void;
  getProjectPath(): string | null;
  mentionAgent?(payload: ExplorerMentionPayload): Promise<void> | void;
  activeFileAbs?: string | null;
}

type ExplorerDiagnosticsDetail = Record<string, unknown>;

interface ProblemsPanelApi {
  update(detail: ExplorerDiagnosticsDetail): void;
  setActiveFile(absPath: string): void;
  getSummary(projectPath: string): Record<
    string,
    { errors?: number; warnings?: number }
  >;
  destroy(): void;
}

let panel: ProblemsPanelApi | null = null;
let panelContainer: HTMLElement | null = null;

function ensurePanel(
  resultsContainer: HTMLElement,
  callbacks: ExplorerDiagnosticsCallbacks,
): ProblemsPanelApi {
  if (panel && panelContainer === resultsContainer) {
    const existingInner = resultsContainer.querySelector(`#${CONTAINER_ID}`);
    if (existingInner) {
      return panel;
    }
    panel.destroy();
    panel = null;
    panelContainer = null;
  }

  resultsContainer.innerHTML = '';
  resultsContainer.classList.add('fe-search-diagnostics-container');

  const inner = document.createElement('div');
  inner.id = CONTAINER_ID;
  resultsContainer.appendChild(inner);

  const projectPath = callbacks.getProjectPath() || '';
  panel = createProblemsPanel({
    containerId: CONTAINER_ID,
    onNavigate: (absPath: string, line: number, col: number) => {
      const rel =
        projectPath && absPath.startsWith(`${projectPath}/`)
          ? absPath.slice(projectPath.length + 1)
          : absPath;
      void callbacks.openFileAndMaybeJump(rel, line || 1, {
        column: col || 1,
      });
    },
    onMention: async (payload: ExplorerMentionPayload) => {
      try {
        if (typeof callbacks.mentionAgent !== 'function') {
          callbacks.toast('Explorer bus unavailable');
          return;
        }
        await callbacks.mentionAgent(payload);
        callbacks.toast('Mentioned in conversation');
      } catch (error) {
        console.warn('[ExplorerDiagnostics] mention failed:', error);
        callbacks.toast('Failed to mention in conversation');
      }
    },
  }) as ProblemsPanelApi;

  panelContainer = resultsContainer;
  return panel;
}

export function renderExplorerDiagnostics(
  resultsContainer: HTMLElement,
  detail: ExplorerDiagnosticsDetail,
  callbacks: ExplorerDiagnosticsCallbacks,
): void {
  const livePanel = ensurePanel(resultsContainer, callbacks);
  if (callbacks.activeFileAbs) {
    livePanel.setActiveFile(callbacks.activeFileAbs);
  }
  livePanel.update(detail || {});
}

export function getExplorerDiagnosticsPanel(): ProblemsPanelApi | null {
  return panel;
}
