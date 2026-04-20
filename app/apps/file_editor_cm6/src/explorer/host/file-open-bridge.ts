import { getErrorMessage } from '../utils/errors.ts';
import { requestExplorerRpc } from '../rpc/client.ts';
import { EXPLORER_RPC_METHODS } from '../rpc/contract.ts';

export interface ExplorerJumpOptions {
  column?: number;
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
}

interface ExplorerFileOpenOptions {
  line?: number;
  column?: number;
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
}

interface ExplorerFileOpenBridgeDeps {
  getProjectPath(): string | null;
  expandToFile(rel: string): Promise<unknown>;
  closeDrawerIfMobile(): void;
  toast(message: string): void;
}

function toOpenOptions(
  lineNumber: number | null,
  jumpOptions: ExplorerJumpOptions,
): ExplorerFileOpenOptions {
  const openOptions: ExplorerFileOpenOptions = {};
  if (typeof lineNumber === 'number' && lineNumber >= 1) {
    openOptions.line = lineNumber;
  }
  if (typeof jumpOptions.column === 'number' && jumpOptions.column >= 1) {
    openOptions.column = jumpOptions.column;
  }
  if (Object.prototype.hasOwnProperty.call(jumpOptions, 'focus')) {
    openOptions.focus = Boolean(jumpOptions.focus);
  }
  if (Object.prototype.hasOwnProperty.call(jumpOptions, 'scrollToTop')) {
    openOptions.scrollToTop = Boolean(jumpOptions.scrollToTop);
  }
  if (typeof jumpOptions.scrollY === 'string') {
    openOptions.scrollY = jumpOptions.scrollY;
  }
  return openOptions;
}

export function createExplorerFileOpenBridge(
  deps: ExplorerFileOpenBridgeDeps,
) {
  async function openFileAndMaybeJump(
    rel: string,
    lineNumber: number | null = null,
    jumpOptions: ExplorerJumpOptions = {},
  ): Promise<void> {
    try {
      const openOptions = toOpenOptions(lineNumber, jumpOptions);

      try {
        await deps.expandToFile(rel);
      } catch (error) {
        console.warn('[Explorer] Failed to expand tree before open:', error);
      }
      await requestExplorerRpc(EXPLORER_RPC_METHODS.editorOpen, {
        rel,
        projectRoot: deps.getProjectPath(),
        ...openOptions,
      });

      deps.closeDrawerIfMobile();
    } catch (error) {
      deps.toast(`Failed to open file: ${getErrorMessage(error, 'unknown error')}`);
    }
  }

  return { openFileAndMaybeJump };
}
