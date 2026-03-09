/**
 * Problems panel — VS Code-style diagnostic list grouped by file.
 * Lives inside the bottom drawer as a tab alongside Terminal and Console.
 *
 * Usage:
 *   const panel = createProblemsPanel({ containerId: 'problems-container', onNavigate });
 *   panel.update(detailMap);   // { absPath: [ {severity, message, ...} ] }
 *   panel.show(); panel.hide();
 */

// Monaco MarkerSeverity values (mirrored here to avoid runtime dep)
const SEV_HINT    = 1;
const SEV_INFO    = 2;
const SEV_WARNING = 4;
const SEV_ERROR   = 8;

function sevClass(s) {
  if (s === SEV_ERROR) return 'error';
  if (s === SEV_WARNING) return 'warning';
  return 'info';
}
function sevIcon(s) {
  if (s === SEV_ERROR) return '⊘';
  if (s === SEV_WARNING) return '⚠';
  return 'ℹ';
}
function sevOrder(s) {
  if (s === SEV_ERROR) return 0;
  if (s === SEV_WARNING) return 1;
  return 2;
}

function basename(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * @param {Object} options
 * @param {string} [options.containerId='problems-container']
 * @param {function(string, number, number):void} [options.onNavigate] - (absPath, line, col)
 * @param {function(Object):void} [options.onMention] - mention a diagnostic in conversation
 * @returns {{ show, hide, update, destroy, get isVisible() }}
 */
export function createProblemsPanel(options = {}) {
  const {
    containerId = 'problems-container',
    onNavigate = () => {},
    onMention = null,
  } = options;

  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Problems] container not found:', containerId);
    return { show() {}, hide() {}, update() {}, destroy() {}, get isVisible() { return false; } };
  }

  let currentDetail = {};  // { absPath: markers[] }
  let visible = false;

  function _render() {
    container.innerHTML = '';

    const paths = Object.keys(currentDetail).filter(p => currentDetail[p] && currentDetail[p].length > 0);
    if (paths.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'problems-empty';
      empty.textContent = 'No problems detected.';
      container.appendChild(empty);
      return;
    }

    // Sort: files with errors first, then by path.
    paths.sort((a, b) => {
      const aHasErr = currentDetail[a].some(m => m.severity === SEV_ERROR);
      const bHasErr = currentDetail[b].some(m => m.severity === SEV_ERROR);
      if (aHasErr !== bHasErr) return aHasErr ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const absPath of paths) {
      const markers = currentDetail[absPath];
      // Sort markers: errors first, then warnings, then by line.
      markers.sort((a, b) => {
        const so = sevOrder(a.severity) - sevOrder(b.severity);
        if (so !== 0) return so;
        return (a.startLineNumber || 0) - (b.startLineNumber || 0);
      });

      const errors = markers.filter(m => m.severity === SEV_ERROR).length;
      const warnings = markers.filter(m => m.severity === SEV_WARNING).length;

      const group = document.createElement('div');
      group.className = 'problems-file-group';

      // File header
      const header = document.createElement('div');
      header.className = 'problems-file-header';
      header.innerHTML = '';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = basename(absPath);
      nameSpan.title = absPath;
      header.appendChild(nameSpan);

      if (errors > 0) {
        const badge = document.createElement('span');
        badge.className = 'problems-badge error';
        badge.textContent = String(errors);
        header.appendChild(badge);
      }
      if (warnings > 0) {
        const badge = document.createElement('span');
        badge.className = 'problems-badge warning';
        badge.textContent = String(warnings);
        header.appendChild(badge);
      }

      const itemsDiv = document.createElement('div');
      itemsDiv.className = 'problems-items';

      header.addEventListener('click', () => {
        const collapsed = itemsDiv.style.display === 'none';
        itemsDiv.style.display = collapsed ? '' : 'none';
      });

      // Marker items
      for (const m of markers) {
        const item = document.createElement('div');
        item.className = 'problems-item';

        const icon = document.createElement('span');
        icon.className = 'problems-icon ' + sevClass(m.severity);
        icon.textContent = sevIcon(m.severity);

        const msg = document.createElement('span');
        msg.className = 'problems-msg';
        msg.textContent = m.message || '(no message)';
        if (m.source) {
          const src = document.createElement('span');
          src.className = 'problems-source';
          src.textContent = '[' + m.source + (m.code ? '(' + m.code + ')' : '') + ']';
          msg.appendChild(src);
        }

        const loc = document.createElement('span');
        loc.className = 'problems-location';
        loc.textContent = (m.startLineNumber || 1) + ':' + (m.startColumn || 1);

        item.appendChild(icon);
        item.appendChild(msg);
        item.appendChild(loc);

        if (onMention) {
          const mentionBtn = document.createElement('span');
          mentionBtn.className = 'problems-mention-btn';
          mentionBtn.textContent = '💬';
          mentionBtn.title = 'Mention in conversation';
          mentionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sevLabel = m.severity === SEV_ERROR ? 'error'
              : m.severity === SEV_WARNING ? 'warning' : 'info';
            let content = '[' + sevLabel + '] ';
            if (m.code) content += m.code + ': ';
            content += m.message || '(no message)';
            if (m.source) content += ' (' + m.source + ')';
            onMention({
              path: absPath,
              lineNo: m.startLineNumber || 1,
              col: m.startColumn || 1,
              endLineNo: m.endLineNumber || m.startLineNumber || 1,
              endCol: m.endColumn || m.startColumn || 1,
              content: content,
            });
          });
          item.appendChild(mentionBtn);
        }

        item.addEventListener('click', () => {
          onNavigate(absPath, m.startLineNumber || 1, m.startColumn || 1);
        });

        itemsDiv.appendChild(item);
      }

      group.appendChild(header);
      group.appendChild(itemsDiv);
      container.appendChild(group);
    }
  }

  return {
    show() {
      visible = true;
      container.style.display = '';
      const hdr = document.getElementById('problems-header');
      if (hdr) hdr.style.display = '';
    },
    hide() {
      visible = false;
      container.style.display = 'none';
      const hdr = document.getElementById('problems-header');
      if (hdr) hdr.style.display = 'none';
    },
    /** @param {Object} detail - { absPath: [{severity, message, source, code, startLineNumber, startColumn, ...}] } */
    update(detail) {
      console.log('[Problems] update() called, paths:', detail ? Object.keys(detail).length : 'null');
      currentDetail = detail && typeof detail === 'object' ? detail : {};
      _render();
    },
    destroy() {
      container.innerHTML = '';
      currentDetail = {};
    },
    get isVisible() { return visible; },
    getDetail() { return currentDetail; },
  };
}
