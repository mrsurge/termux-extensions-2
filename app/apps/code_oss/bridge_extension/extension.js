"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const vscode = __importStar(require("vscode"));
const BRIDGE_MESSAGE_FLAG = '_mobileBridge';
const SHELL_MESSAGE_FLAG = '_mobileShell';

const chatProviders = [
    { id: 'mobile.chatPlaceholder', label: 'Chat Placeholder' },
    { id: 'workbench.panel.output', label: 'Output' },
    { id: 'workbench.panel.markers.view', label: 'Problems' },
];

const bridgeOptions = {
    endpoint: null,
    token: null,
};

async function httpPost(body) {
    if (!bridgeOptions.endpoint) {
        console.warn('[Mobile Bridge] Endpoint not configured, cannot send event.', body.type);
        return;
    }
    try {
        const res = await fetch(bridgeOptions.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(bridgeOptions.token ? { 'Authorization': `Bearer ${bridgeOptions.token}` } : {})
            },
            body: JSON.stringify({ events: [body] }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json().catch(() => ({}));
    } catch (error) {
        console.error('[Mobile Bridge] Failed to POST event:', error);
    }
}

function configureBridgeFromSettings() {
    const config = vscode.workspace.getConfiguration('mobile-bridge');
    const endpoint = config.get('endpoint');
    const token = config.get('token');

    if (endpoint) {
        bridgeOptions.endpoint = endpoint;
        console.log('[Mobile Bridge] Endpoint configured from settings:', bridgeOptions.endpoint);
    }
    if (token) {
        bridgeOptions.token = token;
    }
}

function mapEol(eol) {
    if (eol === vscode.EndOfLine.CRLF) {
        return '\r\n';
    }
    return '\n';
}

async function emitDocState(editor) {
    if (!editor) return;
    const doc = editor.document;
    if (!doc) return;

    await httpPost({
        [BRIDGE_MESSAGE_FLAG]: true,
        type: 'doc_state',
        doc_id: doc.uri.toString(),
        rev: doc.version,
        text: doc.getText(),
        languageId: doc.languageId,
        eol: mapEol(doc.eol),
        dirty: doc.isDirty,
        timestamp: Date.now(),
    });
}

async function emitDocChanges(event) {
    if (!event || !event.document) return;
    const doc = event.document;
    const docId = doc.uri.toString();
    const nextRev = doc.version;
    const baseRev = Math.max(0, nextRev - 1);

    const changes = (event.contentChanges || []).map((change) => ({
        start: { l: change.range.start.line, c: change.range.start.character },
        end: { l: change.range.end.line, c: change.range.end.character },
        text: change.text,
    }));

    await httpPost({
        [BRIDGE_MESSAGE_FLAG]: true,
        type: 'doc_changes',
        doc_id: docId,
        base_rev: baseRev,
        next_rev: nextRev,
        changes,
        timestamp: Date.now(),
    });
}

function safeFsPath(uri) {
    if (uri.scheme === 'vscode-remote') return uri.path;
    return uri.fsPath || uri.path;
}

function dirname(path) {
    if (!path) return null;
    const normalized = path.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    if (idx <= 0) return null;
    return normalized.slice(0, idx);
}

async function readDirectory(uri, depth) {
    let entries = [];
    try {
        const children = await vscode.workspace.fs.readDirectory(uri);
        entries = await Promise.all(children.map(async ([name, fileType]) => {
            const childUri = vscode.Uri.joinPath(uri, name);
            const isDirectory = (fileType & vscode.FileType.Directory) === vscode.FileType.Directory;
            const entry = {
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
        console.error('[Mobile Bridge] readDirectory failed', error);
    }
    const directories = entries.filter((entry) => entry.entryType === 'directory').sort((a, b) => a.label.localeCompare(b.label));
    const files = entries.filter((entry) => entry.entryType === 'file').sort((a, b) => a.label.localeCompare(b.label));
    return [...directories, ...files];
}

async function postExplorerRoot(depth = 1) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'explorerTree', root: true, entries: [] });
        return;
    }
    const entries = [];
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
    console.log('[Mobile Bridge] Posting explorerTree data:', { root: true, entries });
    await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'explorerTree', root: true, entries });
}

async function openPath(path, opts = {}) {
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
        await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'error', error: String(error) });
    }
}

async function runActivationLogic(ctx) {
    // 1. Configure from settings first
    configureBridgeFromSettings();

    vscode.window.showInformationMessage('Mobile Bridge is activating!');
    console.log('[Mobile Bridge] Manual activation triggered.');

    await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'bridgeActivated', timestamp: Date.now() });

    const folders = (vscode.workspace.workspaceFolders || []).map((folder) => ({
        path: safeFsPath(folder.uri),
        label: folder.name,
    }));
    await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'workspaceFolders', folders });

    await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'chatProviders', providers: chatProviders });

    const sidebarVisible = !!(vscode.window?.visibleViewColumn);
    const panelVisible = vscode.window?.terminals?.length > 0;
    await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'state', sidebarVisible, panelVisible });

    await emitDocState(vscode.window.activeTextEditor);
    await postExplorerRoot(1);

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'activeEditor', path: safeFsPath(activeEditor.document.uri) });
    }

    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        await httpPost({ [BRIDGE_MESSAGE_FLAG]: true, type: 'activeEditor', path: editor ? safeFsPath(editor.document.uri) : null });
        await emitDocState(editor);
    }), vscode.workspace.onDidChangeTextDocument((event) => {
        emitDocChanges(event);
    }));
}

function activate(ctx) {
    console.log('[Mobile Bridge] Extension loaded. Registering manual activation command.');

    ctx.subscriptions.push(vscode.commands.registerCommand('mobile-bridge.manualActivate', () => {
        runActivationLogic(ctx);
    }));

    // Also listen for configuration changes
    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mobile-bridge')) {
            console.log('[Mobile Bridge] Configuration changed, re-configuring.');
            configureBridgeFromSettings();
        }
    }));
}

function deactivate() {
    console.log('[Mobile Bridge] Deactivated');
}

exports.activate = activate;
exports.deactivate = deactivate;
