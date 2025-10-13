import * as vscode from 'vscode';

type ExplorerEntry = {
  path: string;
  label: string;
  entryType: 'file' | 'directory';
  hasChildren: boolean;
  children?: ExplorerEntry[];
};

const BRIDGE_MESSAGE_FLAG = '_mobileBridge';

const chatProviders = [
  { id: 'mobile.chatPlaceholder', label: 'Chat Placeholder' },
  { id: 'workbench.panel.output', label: 'Output' },
  { id: 'workbench.panel.markers.view', label: 'Problems' },
];

const POSTABLE = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any) : undefined);

function safeFsPath(uri: vscode.Uri): string {
  if (uri.scheme === 'vscode-remote') {
    return uri.path;
  }
  return uri.fsPath || uri.path;
}

function dirname(path: string): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

async function readDirectory(uri: vscode.Uri, depth: number): Promise<ExplorerEntry[]> {
  let entries: ExplorerEntry[] = [];
  try {
    const children = await vscode.workspace.fs.readDirectory(uri);
    entries = await Promise.all(children.map(async ([name, fileType]) => {
      const childUri = vscode.Uri.joinPath(uri, name);
      const isDirectory = (fileType & vscode.FileType.Directory) === vscode.FileType.Directory;
      const entry: ExplorerEntry = {
        path: safeFsPath(childUri),
        label: name,
        entryType: isDirectory ? 'directory' : 'file',
        hasChildren: isDirectory,
      };
      if (isDirectory && depth > 0) {
        entry.children = await readDirectory(childUri, depth - 1);
      }
      return entry;
    }));
  } catch (error) {
    console.error('[mobile-bridge] readDirectory failed', error);
  }
  const directories = entries.filter((entry) => entry.entryType === 'directory').sort((a, b) => a.label.localeCompare(b.label));
  const files = entries.filter((entry) => entry.entryType === 'file').sort((a, b) => a.label.localeCompare(b.label));
  return [...directories, ...files];
}

function postToParent(payload: any) {
  try {
    if (typeof window !== 'undefined' && window.top && window.location) {
      window.top.postMessage(Object.assign({ [BRIDGE_MESSAGE_FLAG]: true }, payload), window.location.origin);
    }
  } catch (error) {
    console.error('[mobile-bridge] failed to post message', error);
  }
}

function postState() {
  const sidebarVisible = !!(vscode.window as any)?.visibleViewColumn;
  const panelVisible = (vscode.window as any)?.terminals?.length > 0;
  postToParent({ type: 'state', sidebarVisible, panelVisible });
}

function postActiveEditor(editor?: vscode.TextEditor | null) {
  if (!editor || !editor.document) return;
  const path = safeFsPath(editor.document.uri);
  postToParent({ type: 'activeEditor', path });
}

function postWorkspaceFolders() {
  const folders = (vscode.workspace.workspaceFolders || []).map((folder) => ({
    path: safeFsPath(folder.uri),
    label: folder.name,
  }));
  postToParent({ type: 'workspaceFolders', folders });
}

async function postExplorerRoot(depth = 1) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    postToParent({ type: 'explorerTree', root: true, entries: [] });
    return;
  }

  const entries: ExplorerEntry[] = [];
  for (const folder of folders) {
    const children = await readDirectory(folder.uri, depth);
    entries.push({
      path: safeFsPath(folder.uri),
      label: folder.name,
      entryType: 'directory',
      hasChildren: true,
      children,
    });
  }
  postToParent({ type: 'explorerTree', root: true, entries });
}

async function postExplorerChildren(path: string, depth = 1) {
  if (!path) return;
  const uri = vscode.Uri.file(path);
  const entries = await readDirectory(uri, depth);
  postToParent({ type: 'explorerTree', parent: path, entries });
}

function scheduleExplorerRefresh(handler: () => void, delay = 350) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(handler, delay);
  };
}

async function openPath(path: string, opts: { line?: number; column?: number } = {}) {
  try {
    const uri = vscode.Uri.file(path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    if (opts.line != null) {
      const position = new vscode.Position(Math.max(opts.line - 1, 0), Math.max((opts.column || 1) - 1, 0));
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      editor.selection = new vscode.Selection(position, position);
    }
  } catch (error) {
    postToParent({ type: 'error', error: String(error) });
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  postWorkspaceFolders();
  postToParent({ type: 'chatProviders', providers: chatProviders });
  postState();
  postExplorerRoot(1).then(() => {
    if (vscode.window.activeTextEditor) {
      postActiveEditor(vscode.window.activeTextEditor);
    }
  });

  const refreshExplorerSoon = scheduleExplorerRefresh(() => postExplorerRoot(1));

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      postActiveEditor(editor);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      postWorkspaceFolders();
      refreshExplorerSoon();
    }),
    vscode.workspace.onDidCreateFiles(() => refreshExplorerSoon()),
    vscode.workspace.onDidDeleteFiles(() => refreshExplorerSoon()),
    vscode.workspace.onDidRenameFiles(() => refreshExplorerSoon()),
  );

  if (POSTABLE && typeof POSTABLE.addEventListener === 'function') {
    POSTABLE.addEventListener('message', async (event: MessageEvent) => {
      const data = event.data || {};
      if (!data || !data._mobileShell) return;

      const { type, cmd, args } = data;

      if (type === 'hello') {
        postToParent({ type: 'chatProviders', providers: chatProviders });
        postState();
        await postExplorerRoot(1);
        if (vscode.window.activeTextEditor) {
          postActiveEditor(vscode.window.activeTextEditor);
        }
        return;
      }

      if (type === 'command') {
        try {
          await handleCommand(cmd, args || {});
          postState();
        } catch (error: any) {
          postToParent({ type: 'error', error: String(error?.message || error) });
        }
      }
    });
  }

  async function handleCommand(cmd: string, args: any) {
    switch (cmd) {
      case 'toggleSidebar':
        return vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
      case 'openSearch':
        return vscode.commands.executeCommand('workbench.view.search');
      case 'showCommands':
        return vscode.commands.executeCommand('workbench.action.showCommands');
      case 'openSettingsJSON':
        return vscode.commands.executeCommand('workbench.action.openSettingsJson');
      case 'focusExplorer':
        return vscode.commands.executeCommand('workbench.view.explorer');
      case 'focusTerminalPanel':
        await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
        return vscode.commands.executeCommand('workbench.action.terminal.focus');
      case 'focusProblems':
        return vscode.commands.executeCommand('workbench.actions.view.problems');
      case 'focusOutput':
        return vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      case 'showView':
        if (args?.inPanel) {
          await vscode.commands.executeCommand('workbench.action.togglePanel');
        }
        return vscode.commands.executeCommand(args?.viewId);
      case 'openPath':
        if (args?.path) {
          return openPath(args.path, { line: args.line, column: args.column });
        }
        return;
      case 'requestExplorerTree':
        return postExplorerRoot(args?.depth ?? 1);
      case 'requestExplorerChildren':
        if (args?.path) {
          return postExplorerChildren(args.path, args?.depth ?? 1);
        }
        return;
      case 'revealPath':
        if (args?.path) {
          await postExplorerChildren(dirname(args.path) || args.path, 1);
          postActiveEditor(vscode.window.activeTextEditor);
        }
        return;
      case 'refreshChat':
        return postToParent({ type: 'chatProviders', providers: chatProviders });
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }
}

export function deactivate() {}
