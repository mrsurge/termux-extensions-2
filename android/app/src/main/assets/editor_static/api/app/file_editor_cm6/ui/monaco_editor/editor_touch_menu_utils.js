/**
 * Touch selection menu management & mention request.
 *
 * Extracted from m_editor_app.js — owns:
 *  • ensureTouchSelection (re-installs touch UI when Monaco rebuilds DOM)
 *  • mention request (gathers selection context, emits to host)
 *  • te2:mention-request CustomEvent listener (fired by touch menu Mention tool)
 */

/**
 * Build a mention-request payload from the current editor state.
 *
 * @param {object} editorInstance  Monaco editor (or modified side of diff)
 * @param {string} currentPath    Absolute file path
 * @returns {object|null}  Payload or null if nothing to mention
 */
function _buildMentionPayload(editorInstance, currentPath) {
  if (!editorInstance || !currentPath) return null;

  var sel = editorInstance.getSelection();
  var payload = { path: currentPath };

  if (sel && !sel.isEmpty()) {
    payload.lineNo = sel.startLineNumber;
    payload.col = sel.startColumn;
    payload.endLineNo = sel.endLineNumber;
    payload.endCol = sel.endColumn;
    var model = editorInstance.getModel ? editorInstance.getModel() : null;
    var content = model ? model.getValueInRange(sel) : '';
    if (content) {
      var lines = content.split('\n');
      if (lines.length > 20) {
        content = lines.slice(0, 20).join('\n') +
          '\n... (truncated, ' + lines.length + ' total lines)';
      }
      payload.content = content;
    }
  } else {
    var pos = editorInstance.getPosition();
    if (pos) {
      payload.lineNo = pos.lineNumber;
      payload.col = pos.column;
    }
  }
  return payload;
}

/**
 * Send a code mention request to the host page via UI IPC.
 *
 * @param {object} deps
 * @param {function} deps.getEditor         () => editor|null
 * @param {function} deps.getDiffEditor     () => diffEditor|null
 * @param {function} deps.getCurrentPath    () => string|null
 * @param {function} deps.getUiIpcSocket    () => socket|null
 */
export function sendMentionRequest(deps) {
  var ed = deps.getEditor();
  var diff = deps.getDiffEditor();
  if (diff && diff.getModifiedEditor) ed = diff.getModifiedEditor();
  var path = deps.getCurrentPath();
  var payload = _buildMentionPayload(ed, path);
  if (!payload) return;
  var sock = deps.getUiIpcSocket ? deps.getUiIpcSocket() : null;
  if (sock && sock.connected) {
    sock.emit('ui_event', { type: 'mention_request', path: payload.path,
      lineNo: payload.lineNo, col: payload.col, endLineNo: payload.endLineNo,
      endCol: payload.endCol, content: payload.content });
  } else {
    console.warn('[mention] UI IPC socket not connected');
  }
}

// WeakSet to track DOM nodes that already have the mention listener bound.
var _mentionBoundDoms = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

/**
 * (Re-)install the touch selection UI if Monaco rebuilt the editor DOM.
 * Also binds the te2:mention-request listener on the new DOM node.
 *
 * @param {string} reason        Debug tag for why we're checking
 * @param {object} deps
 * @param {function} deps.getEditor       () => editor|null
 * @param {function} deps.getDiffEditor   () => diffEditor|null
 * @param {function} deps.getCurrentPath  () => string|null
 * @param {function} deps.getUiIpcSocket  () => socket|null
 * @param {function} deps.updateDebug     (msg) => void
 */
export function ensureTouchSelection(reason, deps) {
  try {
    var lib = window['monaco-touch-selection'];
    if (!lib || !lib.editorTouchSelectionHelp) return;

    // Resolve the active editor — prefer diff modified side when diff is active.
    var ed = deps.getEditor();
    var diff = deps.getDiffEditor ? deps.getDiffEditor() : null;
    var target = (diff && diff.getModifiedEditor) ? diff.getModifiedEditor() : ed;
    if (!target) return;

    var dom = target.getDomNode && target.getDomNode();
    if (!dom) return;

    var hasUI = !!dom.querySelector('.monaco-editor-touch-selections');
    if (!hasUI) {
      lib.editorTouchSelectionHelp(target);
      deps.updateDebug('touch=reinit' + (reason ? ':' + reason : ''));
    }
    // Bind mention listener on this DOM node if not already bound.
    if (_mentionBoundDoms && !_mentionBoundDoms.has(dom)) {
      _mentionBoundDoms.add(dom);
      dom.addEventListener('te2:mention-request', function () {
        sendMentionRequest(deps);
      });
    }
  } catch (e) {
    console.warn('[MonacoTouchSelection] ensure failed', e);
  }
}
