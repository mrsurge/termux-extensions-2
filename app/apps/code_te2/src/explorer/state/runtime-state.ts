import type { ExplorerGitStatus } from '../git/footer-utils.ts';

export interface ExplorerRuntimeState {
  getProjectPath(): string | null;
  setProjectPath(next: string | null): void;
  getGitStatus(): ExplorerGitStatus | null;
  setGitStatus(next: ExplorerGitStatus | null): void;
  getRenderedProjectPath(): string | null;
  setRenderedProjectPath(next: string | null): void;
  getReconnectResyncPending(): boolean;
  setReconnectResyncPending(next: boolean): void;
}

export function createExplorerRuntimeState(): ExplorerRuntimeState {
  let projectPath: string | null = null;
  let gitStatus: ExplorerGitStatus | null = null;
  let renderedProjectPath: string | null = null;
  let reconnectResyncPending = false;

  return {
    getProjectPath: () => projectPath,
    setProjectPath: (next) => {
      projectPath = next;
    },
    getGitStatus: () => gitStatus,
    setGitStatus: (next) => {
      gitStatus = next;
    },
    getRenderedProjectPath: () => renderedProjectPath,
    setRenderedProjectPath: (next) => {
      renderedProjectPath = next;
    },
    getReconnectResyncPending: () => reconnectResyncPending,
    setReconnectResyncPending: (next) => {
      reconnectResyncPending = next;
    },
  };
}
