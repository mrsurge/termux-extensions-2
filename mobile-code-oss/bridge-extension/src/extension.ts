import * as vscode from 'vscode';

export function activate(ctx: vscode.ExtensionContext) {
  // Broadcast initial providers (example: built-in panel views + placeholder)
  const chatProviders = [
    { id: 'mobile.chatPlaceholder', label: 'Chat Placeholder' },
    { id: 'workbench.panel.output', label: 'Output' },
    { id: 'workbench.panel.markers.view', label: 'Problems' }
  ];

  function postToParent(payload: any) {
    // VS Code Web runs in an iframe; parent is window.top
    try {
      (window.top as any)?.postMessage(Object.assign({_mobileBridge: true}, payload), window.location.origin);
    } catch {}
  }

  // Send initial state once restored
  setTimeout(() => {
    postToParent({ type: 'chatProviders', providers: chatProviders });
    postState();
  }, 800);

  function postState() {
    const layout = (vscode.window as any);
    const sidebarVisible = (layout as any).visibleViewColumn !== undefined; // heuristic
    // VS Code doesn't expose visibility directly in web; this is a lightweight ping
    postToParent({ type: 'state', sidebarVisible, panelVisible: (vscode.window as any).terminals.length > 0 });
  }

  // Listen for messages from parent shell
  window.addEventListener('message', async (ev: MessageEvent) => {
    const data = ev.data || {};
    if (!data || !data._mobileShell) return;

    const { type, cmd, args } = data;
    if (type === 'hello') {
      postToParent({ type: 'chatProviders', providers: chatProviders });
      postState();
      return;
    }

    if (type === 'command') {
      try {
        await handleCommand(cmd, args || {});
        postState();
      } catch (e:any) {
        postToParent({ type:'error', error: String(e?.message || e) });
      }
    }
  });

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
        await vscode.commands.executeCommand('workbench.view.explorer');
        return;
      case 'focusTerminalPanel':
        await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal'); // ensures visible
        await vscode.commands.executeCommand('workbench.action.terminal.focus');
        return;
      case 'focusProblems':
        return vscode.commands.executeCommand('workbench.actions.view.problems');
      case 'focusOutput':
        return vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      case 'showView':
        // args: { viewId, inPanel }
        if (args?.inPanel) {
          await vscode.commands.executeCommand('workbench.action.togglePanel'); // ensure open
        }
        return vscode.commands.executeCommand(args?.viewId);
      default:
        throw new Error('Unknown command: ' + cmd);
    }
  }
}

export function deactivate() {}
