
/**
 * Handles the file saving logic, including debouncing and conflict resolution.
 * @param {number} retry - The number of times this save has been retried.
 */

let nativePressPoint = null;
let ignoreOwnEcho = null;
async function handleSave(retry = 0) {
    if (!currentFile || !cmState.view || inflightOp) return;

    const opId = `op_${Date.now()}`;
    const content = cmState.view.state.doc.toString();
    inflightOp = { opId, clientId: getClientId() };

    try {
        const response = await fetch('/api/app/code_oss/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: currentFile,
                content: content,
                client_id: getClientId(),
                op_id: opId,
                base: lastSha256 ? { sha256: lastSha256 } : null,
            }),
        });

        const body = await response.json();

        if (response.ok) {
            lastSha256 = body.data.sha256;
            ignoreOwnEcho = { clientId: getClientId(), opId };
            setTimeout(() => { ignoreOwnEcho = null; }, 300);
            inflightOp = null;
            // UI update for "Saved"
        } else if (response.status === 409 && body.error === 'BASE_MISMATCH') {
            if (retry < 1) {
                // Conflict detected, fetch latest, rebase, and retry
                const latestContent = await fetch(`/api/app/code_oss/file?path=${encodeURIComponent(currentFile)}`).then(r => r.json()).then(b => b.data.content);
                // This is a naive rebase, just overwriting.
                // A real implementation would need diff-match-patch.
                setEditorDocument(currentDocId, latestContent, cmState.language);
                lastSha256 = body.data.current.sha256;
                inflightOp = null; // clear before retry
                handleSave(retry + 1); // Retry once
            } else {
                inflightOp = null;
                window.alert('Save conflict: The file was modified by another process. Your changes have not been saved.');
            }
        } else {
            throw new Error(body.error || `HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('[ide_fullpage] Failed to save file', error);
        inflightOp = null;
        // UI update for error
    }
}

/**
 * Gets a unique client ID for the current session.
 * @returns {string} The client ID.
 */
function getClientId() {
    if (!clientId) {
        clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    return clientId;
}

/**
 * Connects to the WebSocket for real-time file updates.
 * @param {string} path - The path of the file to watch.
 */
function connectReadSocket(path) {
    lastSha256 = null;
    inflightOp = null;
    if (readWs) {
        readWs.close();
        readWs = null;
    }
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/app/code_oss/ws/read?path=${encodeURIComponent(path)}&client_id=${getClientId()}`;

    readWs = new WebSocket(wsUrl);

    readWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (inflightOp && msg.op_id === inflightOp.opId && msg.client_id === getClientId()) {
             if (msg.type === 'save_ack') {
                console.log('Ignoring own save_ack echo');
                return;
            }
        }

        switch (msg.type) {
            case 'replace_full':
                if (ignoreOwnEcho && msg.op_id === ignoreOwnEcho.opId && msg.client_id === ignoreOwnEcho.clientId) {
                    ignoreOwnEcho = null;
                    return;
                }
                if (msg.path === currentFile) {
                    if (!inflightOp) {
                        setEditorDocument(currentDocId, msg.content, msg.language);
                        lastSha256 = msg.sha256; // Assuming sha is sent with replace_full
                    }
                }
                break;
            case 'save_ack':
                if (inflightOp && msg.op_id === inflightOp.opId) {
                    lastSha256 = msg.meta.sha256;
                    inflightOp = null;
                }
                break;
            case 'git_status':
                // Update git status UI
                break;
        }
    };

    readWs.onerror = (err) => {
        console.error('Read WebSocket error:', err);
    };

    readWs.onclose = () => {
        console.log('Read WebSocket closed');
        readWs = null;
    };
}
