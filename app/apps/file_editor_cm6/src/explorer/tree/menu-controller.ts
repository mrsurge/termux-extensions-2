import type { JsonObject } from '../../rpc/transport.ts';
import type { ExplorerJumpOptions } from '../host/file-open-bridge.ts';
import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from '../rpc/contract.ts';
import type {
  ExplorerTreeMenuActionItem,
  ExplorerTreeMenuActionType,
  ExplorerTreeMenuEntry,
  ExplorerTreeMenuItem,
} from './types.ts';

interface FileExplorerOpenResponse {
  ok?: boolean;
  data?: {
    url?: string;
  };
}

interface ExplorerTreeMenuControllerDeps {
  getTreeElement(): HTMLElement | null;
  getSelectedEntries(): Set<string>;
  getProjectPath(): string | null;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  buildSidebarMentionPayload(payload: JsonObject): JsonObject;
  toast(message: string): void;
  isInSelectMode(rel: string | null): boolean;
  enableSelectMode(rel: string): void;
  disableSelectMode(): void;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
  isCancelledError(error: unknown): boolean;
  getErrorMessage(error: unknown, fallback: string): string;
}

type ExplorerFilePicker = NonNullable<Window['teFilePicker']>;

function hasPathChoice(
  value: unknown,
): value is {
  path: string;
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { path?: unknown }).path === 'string'
  );
}

function hasSaveChoice(
  value: unknown,
): value is {
  path: string;
  directory: string;
  name: string;
  existed?: boolean;
} {
  return (
    hasPathChoice(value) &&
    typeof (value as { directory?: unknown }).directory === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function isFileExplorerOpenResponse(
  value: unknown,
): value is FileExplorerOpenResponse {
  return value !== null && typeof value === 'object';
}

function buildAbsolutePath(projectPath: string, relPath: string): string {
  if (!relPath || relPath === '.') {
    return projectPath;
  }
  return (
    projectPath.replace(/\/+$/, '') +
    '/' +
    relPath.replace(/^\/+/, '')
  );
}

function getFilePicker(): ExplorerFilePicker | null {
  return window.teFilePicker ?? null;
}

async function writeClipboardText(text: string): Promise<boolean> {
  const clipboard = navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return false;
  }
  await clipboard.writeText(text);
  return true;
}

export function createExplorerTreeMenuController(
  deps: ExplorerTreeMenuControllerDeps,
) {
  let cardMenu: HTMLElement | null =
    document.querySelector<HTMLElement>('.fe-card-menu');
  let currentMenuButton: HTMLElement | null = null;

  function ensureCardMenu(): HTMLElement {
    if (cardMenu) {
      return cardMenu;
    }
    const nextCardMenu = document.createElement('div');
    nextCardMenu.className = 'fe-card-menu';
    document.body.appendChild(nextCardMenu);
    cardMenu = nextCardMenu;
    return nextCardMenu;
  }

  function closeCardMenu(): void {
    if (!cardMenu) {
      return;
    }
    cardMenu.classList.remove('show');
    currentMenuButton = null;
  }

  function getSelectedPaths(): string[] {
    return Array.from(deps.getSelectedEntries());
  }

  function ensureExplorerRpc(): boolean {
    if (deps.hasExplorerRpc()) {
      return true;
    }
    deps.toast('Explorer connection unavailable.');
    return false;
  }

  async function sendAgentMention(relPath: string): Promise<void> {
    if (!relPath) {
      deps.toast('Missing path for mention');
      return;
    }
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.toast('No project open');
      return;
    }
    if (!deps.hasExplorerRpc()) {
      deps.toast('Explorer bus unavailable');
      return;
    }
    const absPath = buildAbsolutePath(projectPath, relPath);
    try {
      deps.notifyExplorer(
        EXPLORER_RPC_METHODS.mentionAgent,
        deps.buildSidebarMentionPayload({ path: absPath }),
      );
      deps.toast('Mentioned in conversation');
    } catch (error) {
      console.error('Failed to send mention:', error);
      deps.toast('Failed to mention in conversation');
    }
  }

  function getMenuItems(entry: ExplorerTreeMenuEntry): ExplorerTreeMenuItem[] {
    const items: ExplorerTreeMenuItem[] = [];
    const isDir = entry.kind === 'dir';
    const isFile = entry.kind === 'file';
    const gitStatus = entry.gitStatus || '';

    if (deps.isInSelectMode(entry.rel)) {
      const count = deps.getSelectedEntries().size;
      items.push({ label: 'Disable select mode', type: 'disableSelectMode' });
      items.push({ divider: true });
      items.push({
        label: `Copy selected (${count})`,
        type: 'batchCopy',
        disabled: count === 0,
      });
      items.push({
        label: `Move selected (${count})`,
        type: 'batchMove',
        disabled: count === 0,
      });
      items.push({ divider: true });
      items.push({
        label: `Stage selected (${count})`,
        type: 'batchStage',
        disabled: count === 0,
      });
      items.push({
        label: `Unstage selected (${count})`,
        type: 'batchUnstage',
        disabled: count === 0,
      });
      items.push({ divider: true });
      items.push({
        label: `Delete selected (${count})`,
        type: 'batchDelete',
        destructive: true,
        disabled: count === 0,
      });
      return items;
    }

    if (isDir) {
      items.push({ label: 'Enable select mode', type: 'enableSelectMode' });
      items.push({ divider: true });
      items.push({ label: 'New File…', type: 'createFile' });
      items.push({ label: 'New Folder…', type: 'createDir' });
      items.push({ divider: true });
      items.push({ label: 'Open in File Explorer', type: 'openExternal' });
      items.push({ divider: true });
    }

    items.push({ label: 'Copy Name', type: 'copyName' });
    items.push({ label: 'Copy Path', type: 'copyPath' });
    items.push({ label: 'Copy Relative Path', type: 'copyRelPath' });
    items.push({ label: 'Mention in conversation', type: 'mentionAgent' });
    items.push({ divider: true });
    items.push({ label: 'Copy to…', type: 'copyTo' });
    items.push({ label: 'Move to…', type: 'moveTo' });

    if (isDir) {
      items.push({ label: 'Copy from…', type: 'copyFrom' });
      items.push({ label: 'Move from…', type: 'moveFrom' });
    }

    if (
      isFile &&
      (gitStatus === 'modified' ||
        gitStatus === 'untracked' ||
        gitStatus === 'added')
    ) {
      items.push({ label: 'Stage', type: 'stage' });
    }
    if (
      isFile &&
      (gitStatus === 'staged' || gitStatus === 'staged_modified')
    ) {
      items.push({ label: 'Unstage', type: 'unstage' });
    }
    if (isFile && gitStatus && gitStatus !== 'clean') {
      items.push({ label: 'Restore…', type: 'restore' });
    }

    if (isDir) {
      const treeElement = deps.getTreeElement();
      const dirLi = treeElement?.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-kind="dir"][data-rel="${entry.rel}"]`,
      );
      const hasDirtyDescendants =
        Boolean(dirLi?.classList.contains('fe-dir-has-modified')) ||
        Boolean(dirLi?.classList.contains('fe-dir-has-untracked'));
      const hasStagedDescendants = Boolean(
        dirLi?.classList.contains('fe-dir-has-staged'),
      );
      if (hasDirtyDescendants) {
        items.push({ label: 'Stage All in Folder…', type: 'stageDir' });
      }
      if (hasStagedDescendants) {
        items.push({ label: 'Unstage All in Folder…', type: 'unstageDir' });
      }
    }

    items.push({ divider: true });
    items.push({ label: 'Rename…', type: 'rename' });
    items.push({ label: 'Delete', type: 'delete', destructive: true });

    return items;
  }

  async function batchCopyTo(): Promise<void> {
    const paths = getSelectedPaths();
    if (!paths.length) {
      deps.toast('No items selected');
      return;
    }
    const picker = getFilePicker();
    if (!picker) {
      deps.toast('File picker not available');
      return;
    }
    try {
      const dest = await picker.openDirectory({
        title: `Copy ${paths.length} items to…`,
        startPath: deps.getProjectPath() || '',
      });
      if (!hasPathChoice(dest)) {
        return;
      }
      if (!ensureExplorerRpc()) {
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.entriesCopy, {
        rels: paths,
        dest_path: dest.path,
      });
      deps.toast(`Copying ${paths.length} items…`);
      deps.disableSelectMode();
    } catch (error) {
      if (!deps.isCancelledError(error)) {
        deps.toast(deps.getErrorMessage(error, 'Batch copy failed'));
      }
    }
  }

  async function batchMoveTo(): Promise<void> {
    const paths = getSelectedPaths();
    if (!paths.length) {
      deps.toast('No items selected');
      return;
    }
    const picker = getFilePicker();
    if (!picker) {
      deps.toast('File picker not available');
      return;
    }
    try {
      const dest = await picker.openDirectory({
        title: `Move ${paths.length} items to…`,
        startPath: deps.getProjectPath() || '',
      });
      if (!hasPathChoice(dest)) {
        return;
      }
      if (!ensureExplorerRpc()) {
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.entriesMove, {
        rels: paths,
        dest_path: dest.path,
      });
      deps.toast(`Moving ${paths.length} items…`);
      deps.disableSelectMode();
    } catch (error) {
      if (!deps.isCancelledError(error)) {
        deps.toast(deps.getErrorMessage(error, 'Batch move failed'));
      }
    }
  }

  function batchStage(): void {
    const paths = getSelectedPaths();
    if (!paths.length) {
      deps.toast('No items selected');
      return;
    }
    if (!ensureExplorerRpc()) {
      return;
    }
    deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths });
    deps.toast(`Staged ${paths.length} items`);
    deps.disableSelectMode();
  }

  function batchUnstage(): void {
    const paths = getSelectedPaths();
    if (!paths.length) {
      deps.toast('No items selected');
      return;
    }
    if (!ensureExplorerRpc()) {
      return;
    }
    deps.notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, { paths });
    deps.toast(`Unstaged ${paths.length} items`);
    deps.disableSelectMode();
  }

  async function batchDelete(): Promise<void> {
    const paths = getSelectedPaths();
    if (!paths.length) {
      deps.toast('No items selected');
      return;
    }
    const confirmed = await window.teUI.dialog.confirm(
      `⚠️ WARNING: Delete ${paths.length} items?\n\nThis action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    if (!ensureExplorerRpc()) {
      return;
    }
    deps.notifyExplorer(EXPLORER_RPC_METHODS.entriesDelete, { rels: paths });
    deps.toast(`Deleting ${paths.length} items…`);
    deps.disableSelectMode();
  }

  async function handleAction(
    entry: ExplorerTreeMenuEntry,
    actionType: ExplorerTreeMenuActionType,
  ): Promise<void> {
    const rel = entry.rel;
    switch (actionType) {
      case 'enableSelectMode':
        deps.enableSelectMode(rel);
        return;
      case 'disableSelectMode':
        deps.disableSelectMode();
        return;
      case 'batchCopy':
        await batchCopyTo();
        return;
      case 'batchMove':
        await batchMoveTo();
        return;
      case 'batchStage':
        batchStage();
        return;
      case 'batchUnstage':
        batchUnstage();
        return;
      case 'batchDelete':
        await batchDelete();
        return;
      case 'createFile': {
        const name = await window.teUI.dialog.prompt('New file name:');
        if (!name) {
          return;
        }
        if (!ensureExplorerRpc()) {
          return;
        }
        deps.notifyExplorer(EXPLORER_RPC_METHODS.fileCreate, {
          parent_rel: rel,
          name,
        });
        const newRel =
          rel && rel !== '.'
            ? `${rel.replace(/\/+$/, '')}/${name}`
            : name;
        setTimeout(() => {
          void deps.openFileAndMaybeJump(newRel);
        }, 200);
        return;
      }
      case 'createDir': {
        const name = await window.teUI.dialog.prompt('New folder name:');
        if (!name) {
          return;
        }
        if (!ensureExplorerRpc()) {
          return;
        }
        deps.notifyExplorer(EXPLORER_RPC_METHODS.dirCreate, {
          parent_rel: rel,
          name,
        });
        return;
      }
      case 'openExternal': {
        const projectPath = deps.getProjectPath();
        if (!projectPath) {
          deps.toast('No project open');
          return;
        }
        const fullPath = buildAbsolutePath(projectPath, rel);
        try {
          const response = await fetch('/api/apps/file_explorer/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params: { path: fullPath } }),
          });
          const payload: unknown = await response.json();
          if (
            isFileExplorerOpenResponse(payload) &&
            payload.ok &&
            typeof payload.data?.url === 'string'
          ) {
            window.location.href = payload.data.url;
            return;
          }
          console.error('Launch failed', payload);
          deps.toast('Failed to open File Explorer');
        } catch (error) {
          console.error(error);
          deps.toast('Failed to open File Explorer');
        }
        return;
      }
      case 'copyName': {
        try {
          const wrote = await writeClipboardText(entry.name || '');
          if (!wrote) {
            deps.toast('Clipboard not available');
            return;
          }
          deps.toast(`Copied "${entry.name || ''}" to clipboard`);
        } catch {
          deps.toast('Failed to copy name');
        }
        return;
      }
      case 'copyPath': {
        const projectPath = deps.getProjectPath();
        if (!projectPath) {
          deps.toast('No project open');
          return;
        }
        try {
          const wrote = await writeClipboardText(
            buildAbsolutePath(projectPath, rel),
          );
          if (!wrote) {
            deps.toast('Clipboard not available');
            return;
          }
          deps.toast('Copied path to clipboard');
        } catch {
          deps.toast('Failed to copy path');
        }
        return;
      }
      case 'copyRelPath': {
        try {
          const wrote = await writeClipboardText(rel || '.');
          if (!wrote) {
            deps.toast('Clipboard not available');
            return;
          }
          deps.toast('Copied relative path to clipboard');
        } catch {
          deps.toast('Failed to copy relative path');
        }
        return;
      }
      case 'mentionAgent':
        await sendAgentMention(rel);
        return;
      case 'copyTo': {
        const picker = getFilePicker();
        if (!picker) {
          deps.toast('File picker not available');
          return;
        }
        try {
          const dest = await picker.openDirectory({
            title: `Copy "${entry.name}" to…`,
            startPath: deps.getProjectPath() || '',
          });
          if (!hasPathChoice(dest)) {
            return;
          }
          if (!ensureExplorerRpc()) {
            return;
          }
          deps.notifyExplorer(EXPLORER_RPC_METHODS.entryCopy, {
            rel,
            dest_path: dest.path,
          });
        } catch (error) {
          if (!deps.isCancelledError(error)) {
            deps.toast(deps.getErrorMessage(error, 'Copy failed'));
          }
        }
        return;
      }
      case 'moveTo': {
        const picker = getFilePicker();
        if (!picker) {
          deps.toast('File picker not available');
          return;
        }
        try {
          const dest = await picker.openDirectory({
            title: `Move "${entry.name}" to…`,
            startPath: deps.getProjectPath() || '',
          });
          if (!hasPathChoice(dest)) {
            return;
          }
          if (!ensureExplorerRpc()) {
            return;
          }
          deps.notifyExplorer(EXPLORER_RPC_METHODS.entryMove, {
            rel,
            dest_path: dest.path,
          });
        } catch (error) {
          if (!deps.isCancelledError(error)) {
            deps.toast(deps.getErrorMessage(error, 'Move failed'));
          }
        }
        return;
      }
      case 'copyFrom': {
        const picker = getFilePicker();
        if (!picker) {
          deps.toast('File picker not available');
          return;
        }
        if (typeof picker.open !== 'function') {
          deps.toast('File picker open dialog not available');
          return;
        }
        try {
          const source = await picker.open({
            title: `Copy into "${entry.name}"`,
            startPath: deps.getProjectPath() || '',
            mode: 'any',
            selectLabel: 'Copy Here',
          });
          if (!hasPathChoice(source)) {
            return;
          }
          if (!ensureExplorerRpc()) {
            return;
          }
          deps.notifyExplorer(EXPLORER_RPC_METHODS.entryCopyFrom, {
            source_path: source.path,
            dest_rel: rel,
          });
        } catch (error) {
          if (!deps.isCancelledError(error)) {
            deps.toast(deps.getErrorMessage(error, 'Copy failed'));
          }
        }
        return;
      }
      case 'moveFrom': {
        const picker = getFilePicker();
        if (!picker) {
          deps.toast('File picker not available');
          return;
        }
        if (typeof picker.open !== 'function') {
          deps.toast('File picker open dialog not available');
          return;
        }
        try {
          const source = await picker.open({
            title: `Move into "${entry.name}"`,
            startPath: deps.getProjectPath() || '',
            mode: 'any',
            selectLabel: 'Move Here',
          });
          if (!hasPathChoice(source)) {
            return;
          }
          if (!ensureExplorerRpc()) {
            return;
          }
          deps.notifyExplorer(EXPLORER_RPC_METHODS.entryMoveFrom, {
            source_path: source.path,
            dest_rel: rel,
          });
        } catch (error) {
          if (!deps.isCancelledError(error)) {
            deps.toast(deps.getErrorMessage(error, 'Move failed'));
          }
        }
        return;
      }
      case 'rename': {
        const newName = await window.teUI.dialog.prompt('New name:', entry.name || '');
        if (!newName || newName === entry.name) {
          return;
        }
        if (!ensureExplorerRpc()) {
          return;
        }
        deps.notifyExplorer(EXPLORER_RPC_METHODS.entryRename, {
          rel,
          new_name: newName,
        });
        return;
      }
      case 'delete': {
        const confirmed = await window.teUI.dialog.confirm(
          `Delete ${entry.kind === 'dir' ? 'folder' : 'file'} "${entry.name}"?`,
        );
        if (!confirmed) {
          return;
        }
        if (!ensureExplorerRpc()) {
          return;
        }
        deps.notifyExplorer(EXPLORER_RPC_METHODS.entryDelete, { rel });
        return;
      }
      case 'stage': {
        if (!ensureExplorerRpc()) {
          return;
        }
        try {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths: [rel] });
          deps.toast(`Staged ${entry.name}`);
        } catch (error) {
          deps.toast(deps.getErrorMessage(error, 'Stage failed'));
        }
        return;
      }
      case 'unstage': {
        if (!ensureExplorerRpc()) {
          return;
        }
        try {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, {
            paths: [rel],
          });
          deps.toast(`Unstaged ${entry.name}`);
        } catch (error) {
          deps.toast(deps.getErrorMessage(error, 'Unstage failed'));
        }
        return;
      }
      case 'stageDir': {
        if (!ensureExplorerRpc()) {
          return;
        }
        const confirmed = await window.teUI.dialog.confirm(
          `Stage all changes in "${entry.name}"?\n\nThis will stage all modified and untracked files in this directory.`,
        );
        if (!confirmed) {
          return;
        }
        try {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths: [rel] });
          deps.toast(`Staged all in ${entry.name}`);
        } catch (error) {
          deps.toast(deps.getErrorMessage(error, 'Stage failed'));
        }
        return;
      }
      case 'unstageDir': {
        if (!ensureExplorerRpc()) {
          return;
        }
        const confirmed = await window.teUI.dialog.confirm(
          `Unstage all changes in "${entry.name}"?\n\nThis will unstage all staged files in this directory.`,
        );
        if (!confirmed) {
          return;
        }
        try {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, {
            paths: [rel],
          });
          deps.toast(`Unstaged all in ${entry.name}`);
        } catch (error) {
          deps.toast(deps.getErrorMessage(error, 'Unstage failed'));
        }
        return;
      }
      case 'restore': {
        if (!ensureExplorerRpc()) {
          return;
        }
        const confirmed = await window.teUI.dialog.confirm(
          `⚠️ WARNING: This will discard changes to ${entry.name}\n\nRestore from HEAD?`,
        );
        if (!confirmed) {
          return;
        }
        try {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitRestore, {
            path: rel,
            commit: 'HEAD',
          });
        } catch (error) {
          deps.toast(deps.getErrorMessage(error, 'Restore failed'));
        }
        return;
      }
      default:
        return;
    }
  }

  function appendMenuItem(
    menu: HTMLElement,
    entry: ExplorerTreeMenuEntry,
    item: ExplorerTreeMenuItem,
  ): void {
    if ('divider' in item && item.divider) {
      const divider = document.createElement('div');
      divider.className = 'fe-dd-divider';
      menu.appendChild(divider);
      return;
    }

    const actionItem = item as ExplorerTreeMenuActionItem;
    const element = document.createElement('div');
    element.className = 'fe-dd-item';
    element.textContent = actionItem.label;
    if (actionItem.destructive) {
      element.dataset.destructive = 'true';
    }
    if (actionItem.disabled) {
      element.classList.add('fe-dd-item-disabled');
      menu.appendChild(element);
      return;
    }

    element.addEventListener('click', () => {
      closeCardMenu();
      void handleAction(entry, actionItem.type);
    });
    menu.appendChild(element);
  }

  function openCardMenuForEntry(
    entry: ExplorerTreeMenuEntry,
    anchorEl: HTMLElement,
  ): void {
    const menu = ensureCardMenu();
    if (
      currentMenuButton === anchorEl &&
      menu.classList.contains('show')
    ) {
      closeCardMenu();
      return;
    }

    currentMenuButton = anchorEl;
    menu.innerHTML = '';
    menu.classList.add('show');

    const items = getMenuItems(entry);
    items.forEach((item) => appendMenuItem(menu, entry, item));

    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 200;
    const menuHeight = menu.offsetHeight || 200;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = rect.right - menuWidth;
    if (left < 8) {
      left = 8;
    }
    if (left + menuWidth > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - menuWidth - 8);
    }

    let top = rect.bottom;
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, rect.top - menuHeight);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  return {
    closeCardMenu,
    openCardMenuForEntry,
  };
}
