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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
vscode.window.showInformationMessage('Mobile Bridge SCRIPT LOADED!');
const BRIDGE_MESSAGE_FLAG = '_mobileBridge';
const SHELL_MESSAGE_FLAG = '_mobileShell';
const chatProviders = [
    { id: 'mobile.chatPlaceholder', label: 'Chat Placeholder' },
    { id: 'workbench.panel.output', label: 'Output' },
    { id: 'workbench.panel.markers.view', label: 'Problems' },
];
// Web extensions run in a worker, not in the main window
const IS_WEB = typeof acquireVsCodeApi === 'function';
const POSTABLE = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : undefined);
const DEFAULT_BRIDGE_HOST = (typeof POSTABLE !== 'undefined' && POSTABLE.location && POSTABLE.location.hostname)
    ? POSTABLE.location.hostname
    : '127.0.0.1';
const DEFAULT_BRIDGE_ENDPOINT = `http://${DEFAULT_BRIDGE_HOST}:8080/api/app/code_oss/state`;
const MAX_BUFFERED_EVENTS = 200;
const bridgeOptions = {
    endpoint: null,
    flushInterval: 300,
    retryDelay: 1500,
};
const pendingEvents = [];
let flushHandle = null;
let flushInFlight = false;
const docRevisionMap = new Map();
const commandPoll = {
    timer: null,
    pending: false,
    since: 0,
    interval: 1200,
    retryDelay: 4000,
};
const COMMAND_TYPES = new Set(['apply_edits', 'replace_full']);

function scheduleFlush(delay) {
    if (!bridgeOptions.endpoint) {
        return;
    }
    if (flushHandle) {
        return;
    }
    const wait = typeof delay === 'number' && !Number.isNaN(delay)
        ? Math.max(0, delay)
        : bridgeOptions.flushInterval;
    flushHandle = setTimeout(() => {
        flushHandle = null;
        flushPending().catch((error) => {
            console.error('[Mobile Bridge] Flush failed', error);
        });
    }, wait);
}

async function flushPending() {
    if (flushInFlight) {
        return;
    }
    if (!bridgeOptions.endpoint || pendingEvents.length === 0) {
        return;
    }
    flushInFlight = true;
    const batch = pendingEvents.splice(0, pendingEvents.length);
    let retryDelay = null;
    try {
        const response = await fetch(bridgeOptions.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: batch }),
            cache: 'no-store',
        });
        if (!response.ok) {
            retryDelay = bridgeOptions.retryDelay;
            throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json().catch(() => null);
        const sequence = Number(body?.data?.sequence);
        if (!Number.isNaN(sequence)) {
            commandPoll.since = Math.max(commandPoll.since, sequence);
        }
    }
    catch (error) {
        console.error('[Mobile Bridge] Failed to push bridge events', error);
        pendingEvents.splice(0, 0, ...batch);
        retryDelay = retryDelay !== null ? retryDelay : bridgeOptions.retryDelay;
    }
    finally {
        flushInFlight = false;
    }
    if (pendingEvents.length > 0) {
        scheduleFlush(retryDelay !== null ? retryDelay : bridgeOptions.flushInterval);
    }
}

function queueBridgeEvent(payload) {
    if (!payload || typeof payload !== 'object') {
        return;
    }
    const event = Object.assign({ [BRIDGE_MESSAGE_FLAG]: true }, payload);
    if (!('timestamp' in event)) {
        event.timestamp = Date.now();
    }
    // Use postMessage to send the event directly to the parent window
    if (POSTABLE && typeof POSTABLE.postMessage === 'function') {
        POSTABLE.postMessage(event);
    } else {
        console.error('[Mobile Bridge] postMessage is not available.');
    }
}

function configureBridgeEndpoint(endpoint, options = {}) {
    let nextEndpoint = endpoint;
    if (typeof nextEndpoint === 'string') {
        nextEndpoint = nextEndpoint.trim();
        if (nextEndpoint && !/^https?:\/\//i.test(nextEndpoint)) {
            nextEndpoint = `http://${nextEndpoint}`;
        }
        if (nextEndpoint.endsWith('/')) {
            nextEndpoint = nextEndpoint.slice(0, -1);
        }
    }
    if (nextEndpoint) {
        bridgeOptions.endpoint = nextEndpoint;
    }
    else if (!bridgeOptions.endpoint) {
        bridgeOptions.endpoint = DEFAULT_BRIDGE_ENDPOINT;
    }
    if (options && typeof options === 'object') {
        if (options.flushInterval !== undefined) {
            const interval = Number(options.flushInterval);
            if (!Number.isNaN(interval) && interval >= 50) {
                bridgeOptions.flushInterval = interval;
            }
        }
        if (options.retryDelay !== undefined) {
            const retry = Number(options.retryDelay);
            if (!Number.isNaN(retry) && retry >= 100) {
                bridgeOptions.retryDelay = retry;
            }
        }
    }
    if (bridgeOptions.endpoint) {
        queueBridgeEvent({
            type: 'bridgeState',
            configured: true,
            endpoint: bridgeOptions.endpoint,
            flushInterval: bridgeOptions.flushInterval,
            retryDelay: bridgeOptions.retryDelay,
        });
        scheduleFlush(0);
        scheduleCommandPoll(200);
    }
}
function scheduleCommandPoll(delay) {
    if (commandPoll.timer) {
        clearTimeout(commandPoll.timer);
        commandPoll.timer = null;
    }
    if (!bridgeOptions.endpoint) {
        return;
    }
    const wait = typeof delay === 'number' && !Number.isNaN(delay)
        ? Math.max(100, delay)
        : commandPoll.interval;
    commandPoll.timer = setTimeout(() => {
        pollCommands().catch((error) => {
            console.error('[Mobile Bridge] Command poll failed', error);
            scheduleCommandPoll(commandPoll.retryDelay);
        });
    }, wait);
}
async function pollCommands() {
    if (commandPoll.pending || !bridgeOptions.endpoint) {
        return;
    }
    commandPoll.pending = true;
    let nextDelay = commandPoll.interval;
    try {
        const pollUrl = new URL(bridgeOptions.endpoint);
        pollUrl.searchParams.set('since', String(commandPoll.since));
        pollUrl.searchParams.set('types', 'apply_edits,replace_full');
        const response = await fetch(pollUrl.toString(), { method: 'GET', cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json().catch(() => null);
        const data = body?.data || {};
        const events = Array.isArray(data.events) ? data.events : [];
        let highestSeq = commandPoll.since;
        for (const command of events) {
            if (!command || typeof command !== 'object') {
                continue;
            }
            if (!COMMAND_TYPES.has(command.type)) {
                continue;
            }
            try {
                await processBridgeCommand(command);
            }
            catch (error) {
                console.error('[Mobile Bridge] Failed to process command', error);
                queueBridgeEvent({ type: 'error', error: String(error?.message || error) });
            }
            if (typeof command.seq === 'number' && !Number.isNaN(command.seq)) {
                highestSeq = Math.max(highestSeq, command.seq);
            }
        }
        const sequence = Number(data.sequence);
        if (!Number.isNaN(sequence)) {
            highestSeq = Math.max(highestSeq, sequence);
        }
        commandPoll.since = highestSeq;
    }
    catch (error) {
        console.error('[Mobile Bridge] Command poll error', error);
        nextDelay = commandPoll.retryDelay;
    }
    finally {
        commandPoll.pending = false;
        scheduleCommandPoll(nextDelay);
    }
}
async function processBridgeCommand(command) {
    const docId = command?.doc_id;
    const opId = command?.op_id;
    if (!docId) {
        return;
    }
    const uri = vscode.Uri.parse(docId);
    let document;
    try {
        document = await vscode.workspace.openTextDocument(uri);
    }
    catch (error) {
        queueBridgeEvent({
            type: 'error',
            error: `Failed to open document ${docId}: ${String(error?.message || error)}`,
        });
        return;
    }
    await vscode.window.showTextDocument(document, { preview: false });
    if (command.type === 'replace_full') {
        const workspaceEdit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        workspaceEdit.replace(uri, fullRange, command.text ?? '');
        await vscode.workspace.applyEdit(workspaceEdit);
    }
    else if (command.type === 'apply_edits') {
        const edits = Array.isArray(command.edits) ? command.edits : [];
        if (edits.length > 0) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            for (const edit of edits) {
                const start = edit?.start || {};
                const end = edit?.end || {};
                const range = new vscode.Range(new vscode.Position(start.l ?? 0, start.c ?? 0), new vscode.Position(end.l ?? 0, end.c ?? 0));
                workspaceEdit.replace(uri, range, edit?.text ?? '');
            }
            await vscode.workspace.applyEdit(workspaceEdit);
        }
    }
    ackCommand(opId, docId, document.version);
    emitDocState(vscode.window.activeTextEditor);
}
function ackCommand(opId, docId, appliedRev) {
    if (!opId) {
        return;
    }
    queueBridgeEvent({
        type: 'ack',
        op_id: opId,
        doc_id: docId,
        applied_rev: appliedRev,
    });
    scheduleFlush(0);
}
function mapEol(eol) {
    if (eol === vscode.EndOfLine.CRLF) {
        return '\r\n';
    }
    return '\n';
}
function emitDocState(editor) {
    if (!editor) {
        return;
    }
    const doc = editor.document;
    if (!doc) {
        return;
    }
    const docId = doc.uri.toString();
    const rev = doc.version;
    docRevisionMap.set(docId, rev);
    queueBridgeEvent({
        type: 'doc_state',
        doc_id: docId,
        rev,
        text: doc.getText(),
        languageId: doc.languageId,
        eol: mapEol(doc.eol),
        dirty: doc.isDirty,
    });
    scheduleFlush(200);
}
function emitDocChanges(event) {
    if (!event || !event.document) {
        return;
    }
    const doc = event.document;
    const docId = doc.uri.toString();
    const nextRev = doc.version;
    const baseRev = Math.max(0, nextRev - 1);
    docRevisionMap.set(docId, nextRev);
    const changes = (event.contentChanges || []).map((change) => ({
        start: {
            l: change.range.start.line,
            c: change.range.start.character,
        },
        end: {
            l: change.range.end.line,
            c: change.range.end.character,
        },
        text: change.text,
    }));
    queueBridgeEvent({
        type: 'doc_changes',
        doc_id: docId,
        base_rev: baseRev,
        next_rev: nextRev,
        changes,
    });
    scheduleFlush(bridgeOptions.flushInterval);
}
function safeFsPath(uri) {
    if (uri.scheme === 'vscode-remote') {
        return uri.path;
    }
    return uri.fsPath || uri.path;
}
function dirname(path) {
    if (!path)
        return null;
    const normalized = path.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    if (idx <= 0)
        return null;
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
    }
    catch (error) {
        console.error('[Mobile Bridge] readDirectory failed', error);
    }
    const directories = entries.filter((entry) => entry.entryType === 'directory').sort((a, b) => a.label.localeCompare(b.label));
    const files = entries.filter((entry) => entry.entryType === 'file').sort((a, b) => a.label.localeCompare(b.label));
    return [...directories, ...files];
}
function postToParent(payload) {
    queueBridgeEvent(payload);
}
function postState() {
    const sidebarVisible = !!(vscode.window?.visibleViewColumn);
    const panelVisible = vscode.window?.terminals?.length > 0;
    postToParent({ type: 'state', sidebarVisible, panelVisible });
}
function postActiveEditor(editor) {
    if (!editor || !editor.document)
        return;
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
    vscode.window.showInformationMessage('[Mobile Bridge] Reading explorer root!');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        postToParent({ type: 'explorerTree', root: true, entries: [] });
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
    postToParent({ type: 'explorerTree', root: true, entries });
}
async function postExplorerChildren(path, depth = 1) {
    if (!path)
        return;
    const uri = vscode.Uri.file(path);
    const entries = await readDirectory(uri, depth);
    postToParent({ type: 'explorerTree', parent: path, entries });
}
function scheduleExplorerRefresh(handler, delay = 350) {
    let timer;
    return () => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(handler, delay);
    };
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
    }
    catch (error) {
        postToParent({ type: 'error', error: String(error) });
    }
}
function runActivationLogic(ctx) {
    vscode.window.showInformationMessage('Mobile Bridge is activating!');
    console.log('[Mobile Bridge] Manual activation triggered.');

    configureBridgeEndpoint(bridgeOptions.endpoint || DEFAULT_BRIDGE_ENDPOINT);

    postToParent({ type: 'bridgeActivated', timestamp: Date.now() });
    postToParent({ type: 'test', message: 'Bridge is working!' });

    postWorkspaceFolders();
    postToParent({ type: 'chatProviders', providers: chatProviders });
    postState();
    emitDocState(vscode.window.activeTextEditor);
    postExplorerRoot(1).then(() => {
        console.log('[Mobile Bridge] Explorer root posted');
        if (vscode.window.activeTextEditor) {
            postActiveEditor(vscode.window.activeTextEditor);
        }
    });

    const refreshExplorerSoon = scheduleExplorerRefresh(() => postExplorerRoot(1));
    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        postActiveEditor(editor);
        emitDocState(editor);
    }), vscode.workspace.onDidChangeTextDocument((event) => {
        emitDocChanges(event);
    }), vscode.workspace.onDidChangeWorkspaceFolders(() => {
        postWorkspaceFolders();
        refreshExplorerSoon();
    }), vscode.workspace.onDidCreateFiles(() => refreshExplorerSoon()), vscode.workspace.onDidDeleteFiles(() => refreshExplorerSoon()), vscode.workspace.onDidRenameFiles(() => refreshExplorerSoon()));
}

function activate(ctx) {
    console.log('[Mobile Bridge] Extension loaded. Registering manual activation command.');

    ctx.subscriptions.push(vscode.commands.registerCommand('mobile-bridge.manualActivate', () => {
        runActivationLogic(ctx);
    }));

    if (POSTABLE && typeof POSTABLE.addEventListener === 'function') {
        POSTABLE.addEventListener('message', async (event) => {
            const data = event.data || {};
            console.log('[Mobile Bridge] Message received:', data);
            if (!data || !data[SHELL_MESSAGE_FLAG])
                return;
            console.log('[Mobile Bridge] Processing message type:', data.type);
            const { type, cmd, args } = data;
            if (type === 'hello') {
                if (args?.endpoint) {
                    configureBridgeEndpoint(args.endpoint, args);
                }
                // Do not auto-run logic on hello, wait for manual activation
                return;
            }
            if (type === 'command') {
                try {
                    await handleCommand(cmd, args || {});
                    postState();
                }
                catch (error) {
                    postToParent({ type: 'error', error: String(error?.message || error) });
                }
            }
        });
    }

    async function handleCommand(cmd, args) {
        switch (cmd) {
            case 'toggleSidebar':
                return vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
            case 'openSearch':
                return vscode.commands.executeCommand('workbench.view.search');
            case 'showCommands':
                return vscode.commands.executeCommand('workbench.action.showCommands');
            case 'openSettingsJSON':
                return vscode.commands.executeCommand('workbench.action.openSettingsJson');
            case 'configureBridge':
                configureBridgeEndpoint(args?.endpoint, args || {});
                return;
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
            case 'setDocumentMode':
                // Enter zen mode to hide all UI except editor
                console.log('[Mobile Bridge] Entering document mode');
                await vscode.commands.executeCommand('workbench.action.toggleZenMode');
                // Make sure zen mode is on
                const zenModeOn = vscode.workspace.getConfiguration('zenMode').get('restore');
                if (!zenModeOn) {
                    await vscode.commands.executeCommand('workbench.action.toggleZenMode');
                }
                return;
            case 'setFullMode':
                // Exit zen mode to show full UI
                console.log('[Mobile Bridge] Entering full mode');
                // Exit zen mode if it's on
                await vscode.commands.executeCommand('workbench.action.exitZenMode');
                return;
            default:
                throw new Error(`Unknown command: ${cmd}`);
        }
    }
    ctx.subscriptions.push({
        dispose() {
            if (pendingEvents.length) {
                void flushPending();
            }
        },
    });
}
async function deactivate() {
    if (commandPoll.timer) {
        clearTimeout(commandPoll.timer);
        commandPoll.timer = null;
    }
    if (pendingEvents.length) {
        try {
            await flushPending();
        }
        catch (error) {
            console.error('[Mobile Bridge] Failed to flush on deactivate', error);
        }
    }
}
