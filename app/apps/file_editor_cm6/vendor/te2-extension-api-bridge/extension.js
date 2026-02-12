const vscode = require('vscode');

const DEBOUNCE_MS = 300;

// File watcher → adapter bridge
let batch = { created: [], changed: [], deleted: [] };
let timer = null;

function flush() {
  timer = null;
  if (!batch.created.length && !batch.changed.length && !batch.deleted.length) return;

  const payload = {
    created: batch.created,
    changed: batch.changed,
    deleted: batch.deleted,
  };
  batch = { created: [], changed: [], deleted: [] };

  // Not registered in ext host → falls through to MainThread $executeCommand → adapter
  vscode.commands.executeCommand('te2.onFilesChanged', payload).then(
    () => {},
    () => {} // swallow — adapter may not handle it yet
  );
}

function queueEvent(type, uri) {
  const fsPath = uri.fsPath || uri.path;
  if (!fsPath) return;
  batch[type].push(fsPath);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

function activate(context) {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  context.subscriptions.push(
    watcher.onDidCreate(uri => queueEvent('created', uri)),
    watcher.onDidChange(uri => queueEvent('changed', uri)),
    watcher.onDidDelete(uri => queueEvent('deleted', uri)),
    watcher,
    vscode.commands.registerCommand('te2.bridge.getStatus', () => {
      return { active: true, pending: batch };
    })
  );
}

function deactivate() {
  if (timer) clearTimeout(timer);
}

module.exports = { activate, deactivate };
