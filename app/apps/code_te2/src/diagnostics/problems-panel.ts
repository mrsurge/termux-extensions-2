/**
 * Problems projection — VS Code-style diagnostic list grouped by file.
 * The DOM controller powers the Explorer's Diagnostics tab. The host uses the
 * nonvisual state controller for summaries and boot projection; there is no
 * duplicate bottom-drawer Problems surface.
 *
 * Diff-aware: updates are additive/subtractive — new markers append to bottom,
 * stale markers are removed. No full DOM wipe on update. Collapse state of
 * file groups persists across data updates.
 *
 * Usage:
 *   const panel = createProblemsPanel({ containerId: 'problems-container', onNavigate });
 *   panel.update(detailMap);       // { absPath: [ {severity, message, ...} ] }
 *   panel.setActiveFile(absPath);  // sorts active file to top, expands it
 *   panel.show(); panel.hide();
 */

// Monaco MarkerSeverity values (mirrored here to avoid runtime dep)
const SEV_HINT    = 1;
const SEV_INFO    = 2;
const SEV_WARNING = 4;
const SEV_ERROR   = 8;

export interface DiagnosticMarker {
  severity?: number;
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  message?: string;
  source?: string;
  code?: string | number | { value?: string | number };
  [key: string]: unknown;
}

export type ProblemsDetail = Record<string, DiagnosticMarker[]>;

export interface ProblemsMentionPayload {
  path: string;
  lineNo: number;
  col: number;
  endLineNo: number;
  endCol: number;
  content: string;
}

export interface ProblemsPanelOptions {
  containerId?: string;
  onNavigate?: (absPath: string, line: number, col: number) => void;
  onMention?: ((payload: ProblemsMentionPayload) => void) | null;
}

export interface ProblemsPanelController {
  show(): void;
  hide(): void;
  update(detail: unknown): void;
  setActiveFile(absPath: string): void;
  destroy(): void;
  getDetail(): ProblemsDetail;
  getSummary(projectRoot?: string): Record<string, { errors: number; warnings: number }>;
  readonly isVisible: boolean;
}

interface FileGroupElements {
  group: HTMLDivElement;
  header: HTMLDivElement;
  items: HTMLDivElement;
  badgeErr: HTMLSpanElement;
  badgeWarn: HTMLSpanElement;
  chevron: HTMLSpanElement;
}

function codeValue(code: DiagnosticMarker['code']): string | number | undefined {
  if (code && typeof code === 'object') return code.value;
  return code;
}

function coerceProblemsDetail(value: unknown): ProblemsDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const detail: ProblemsDetail = {};
  for (const [path, markers] of Object.entries(value)) {
    if (!Array.isArray(markers)) continue;
    detail[path] = markers.filter((marker): marker is DiagnosticMarker => (
      !!marker && typeof marker === 'object' && !Array.isArray(marker)
    ));
  }
  return detail;
}

function summarizeProblems(
  detail: ProblemsDetail,
  projectRoot?: string,
): Record<string, { errors: number; warnings: number }> {
  const proj = (projectRoot || '').replace(/\/+$/, '');
  const summary: Record<string, { errors: number; warnings: number }> = {};
  for (const [absPath, markers] of Object.entries(detail)) {
    if (!Array.isArray(markers) || markers.length === 0) continue;
    const rel = proj && absPath.startsWith(`${proj}/`)
      ? absPath.slice(proj.length + 1)
      : absPath;
    if (!summary[rel]) summary[rel] = { errors: 0, warnings: 0 };
    for (const marker of markers) {
      if (marker.severity === SEV_ERROR) summary[rel].errors += 1;
      else if (marker.severity === SEV_WARNING) summary[rel].warnings += 1;
    }
  }
  return summary;
}

export function createProblemsState(): ProblemsPanelController {
  let currentDetail: ProblemsDetail = {};
  return {
    show() {},
    hide() {},
    update(detail) {
      currentDetail = coerceProblemsDetail(detail);
    },
    setActiveFile() {},
    destroy() {
      currentDetail = {};
    },
    getDetail() {
      return currentDetail;
    },
    getSummary(projectRoot) {
      return summarizeProblems(currentDetail, projectRoot);
    },
    get isVisible() {
      return false;
    },
  };
}

function sevClass(s: number | undefined): string {
  if (s === SEV_ERROR) return 'error';
  if (s === SEV_WARNING) return 'warning';
  return 'info';
}
function sevIcon(s: number | undefined): string {
  if (s === SEV_ERROR) return '⊘';
  if (s === SEV_WARNING) return '⚠';
  return 'ℹ';
}
function sevOrder(s: number | undefined): number {
  if (s === SEV_ERROR) return 0;
  if (s === SEV_WARNING) return 1;
  return 2;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Stable identity key for a single marker. */
function markerKey(m: DiagnosticMarker): string {
  return `${m.severity || 0}|${m.startLineNumber || 0}|${m.startColumn || 0}|${m.message || ''}`;
}

/**
 * @param {Object} options
 * @param {string} [options.containerId='problems-container']
 * @param {function(string, number, number):void} [options.onNavigate] - (absPath, line, col)
 * @param {function(Object):void} [options.onMention] - mention a diagnostic in conversation
 * @returns {{ show, hide, update, setActiveFile, destroy, getDetail, getSummary, get isVisible() }}
 */
export function createProblemsPanel(options: ProblemsPanelOptions = {}): ProblemsPanelController {
  const {
    containerId = 'problems-container',
    onNavigate = () => {},
    onMention = null,
  } = options;

  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Problems] container not found:', containerId);
    return {
      show() {}, hide() {}, update() {}, setActiveFile() {}, destroy() {},
      getDetail() { return {}; }, getSummary() { return {}; },
      get isVisible() { return false; },
    };
  }
  const containerEl = container;

  // ── State ──
  let currentDetail: ProblemsDetail = {}; // { absPath: markers[] } — authoritative data
  let activeFilePath = '';               // absPath of the currently open file
  let visible = false;
  const collapseState = new Map<string, boolean>(); // absPath → boolean (true = collapsed)
  const groupElements = new Map<string, FileGroupElements>();
  let emptyEl: HTMLDivElement | null = null; // reference to the "No problems" placeholder

  // ── Marker item DOM creation ──
  function _createMarkerItem(absPath: string, m: DiagnosticMarker): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'problems-item';
    item.dataset.markerKey = markerKey(m);

    const icon = document.createElement('span');
    icon.className = 'problems-icon ' + sevClass(m.severity);
    icon.textContent = sevIcon(m.severity);

    const msg = document.createElement('span');
    msg.className = 'problems-msg';
    msg.textContent = m.message || '(no message)';
    if (m.source) {
      const src = document.createElement('span');
      src.className = 'problems-source';
      const codeStr = codeValue(m.code);
      src.textContent = '[' + m.source + (codeStr ? '(' + codeStr + ')' : '') + ']';
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
        const code = codeValue(m.code);
        if (code) content += code + ': ';
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

    return item;
  }

  // ── File group DOM creation ──
  function _createFileGroup(absPath: string, markers: DiagnosticMarker[]): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'problems-file-group';
    group.dataset.absPath = absPath;

    const header = document.createElement('div');
    header.className = 'problems-file-header';

    const chevron = document.createElement('span');
    chevron.className = 'problems-chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = basename(absPath);
    nameSpan.title = absPath;
    header.appendChild(nameSpan);

    const badgeErr = document.createElement('span');
    badgeErr.className = 'problems-badge error';
    badgeErr.style.display = 'none';
    header.appendChild(badgeErr);

    const badgeWarn = document.createElement('span');
    badgeWarn.className = 'problems-badge warning';
    badgeWarn.style.display = 'none';
    header.appendChild(badgeWarn);

    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'problems-items';

    // Sort markers for initial render
    const sorted = [...markers].sort((a, b) => {
      const so = sevOrder(a.severity) - sevOrder(b.severity);
      if (so !== 0) return so;
      return (a.startLineNumber || 0) - (b.startLineNumber || 0);
    });

    for (const m of sorted) {
      itemsDiv.appendChild(_createMarkerItem(absPath, m));
    }

    // Collapse state: active file is expanded, others default collapsed
    const isActive = absPath === activeFilePath;
    const collapsed = collapseState.has(absPath)
      ? collapseState.get(absPath) === true
      : !isActive;
    collapseState.set(absPath, collapsed);
    itemsDiv.style.display = collapsed ? 'none' : '';
    chevron.textContent = collapsed ? '▸' : '▾';

    header.addEventListener('click', () => {
      const nowCollapsed = itemsDiv.style.display !== 'none';
      itemsDiv.style.display = nowCollapsed ? 'none' : '';
      chevron.textContent = nowCollapsed ? '▸' : '▾';
      collapseState.set(absPath, nowCollapsed);
    });

    // Update badge counts
    _updateBadges(badgeErr, badgeWarn, markers);

    group.appendChild(header);
    group.appendChild(itemsDiv);

    const ref: FileGroupElements = { group, header, items: itemsDiv, badgeErr, badgeWarn, chevron };
    groupElements.set(absPath, ref);

    return group;
  }

  function _updateBadges(
    badgeErr: HTMLSpanElement,
    badgeWarn: HTMLSpanElement,
    markers: DiagnosticMarker[],
  ): void {
    const errors = markers.filter(m => m.severity === SEV_ERROR).length;
    const warnings = markers.filter(m => m.severity === SEV_WARNING).length;
    badgeErr.textContent = String(errors);
    badgeErr.style.display = errors > 0 ? '' : 'none';
    badgeWarn.textContent = String(warnings);
    badgeWarn.style.display = warnings > 0 ? '' : 'none';
  }

  function _removeEmptyPlaceholder(): void {
    if (emptyEl && emptyEl.parentNode) {
      emptyEl.parentNode.removeChild(emptyEl);
      emptyEl = null;
    }
  }

  function _showEmptyPlaceholder(): void {
    if (emptyEl) return;
    _removeEmptyPlaceholder();
    emptyEl = document.createElement('div');
    emptyEl.className = 'problems-empty';
    emptyEl.textContent = 'No problems detected.';
    containerEl.appendChild(emptyEl);
  }

  // ── Diff-based update ──
  function _diffUpdate(nextDetail: ProblemsDetail): void {
    const prev = currentDetail;
    const nextPaths = new Set(Object.keys(nextDetail).filter(p =>
      nextDetail[p] && nextDetail[p].length > 0
    ));
    const prevPaths = new Set(Object.keys(prev).filter(p =>
      prev[p] && prev[p].length > 0
    ));

    // 1. Remove file groups no longer in the data
    for (const absPath of prevPaths) {
      if (!nextPaths.has(absPath)) {
        const ref = groupElements.get(absPath);
        if (ref && ref.group.parentNode) {
          ref.group.parentNode.removeChild(ref.group);
        }
        groupElements.delete(absPath);
        // Don't clear collapseState — user preference persists
      }
    }

    // 2. Update existing file groups (additive/subtractive within group)
    for (const absPath of nextPaths) {
      if (!prevPaths.has(absPath)) continue; // new files handled in step 3

      const ref = groupElements.get(absPath);
      if (!ref) continue; // shouldn't happen, but safety

      const prevMarkers = prev[absPath] || [];
      const nextMarkers = nextDetail[absPath] || [];
      const prevKeys = new Set(prevMarkers.map(markerKey));
      const nextKeys = new Set(nextMarkers.map(markerKey));

      // Remove stale markers
      const itemNodes = ref.items.querySelectorAll<HTMLElement>('.problems-item');
      for (const node of itemNodes) {
        if (!nextKeys.has(node.dataset.markerKey || '')) {
          ref.items.removeChild(node);
        }
      }

      // Add new markers to bottom
      for (const m of nextMarkers) {
        const key = markerKey(m);
        if (!prevKeys.has(key)) {
          ref.items.appendChild(_createMarkerItem(absPath, m));
        }
      }

      // Update badge counts
      _updateBadges(ref.badgeErr, ref.badgeWarn, nextMarkers);
    }

    // 3. Add new file groups
    for (const absPath of nextPaths) {
      if (prevPaths.has(absPath)) continue; // already handled
      _removeEmptyPlaceholder();
      const group = _createFileGroup(absPath, nextDetail[absPath]);
      containerEl.appendChild(group);
    }

    // 4. Sort: active file first, then files with errors, then alphabetical
    _sortGroups();

    // 5. Show/hide empty placeholder
    if (nextPaths.size === 0) {
      _showEmptyPlaceholder();
    } else {
      _removeEmptyPlaceholder();
    }

    currentDetail = nextDetail;
  }

  // ── Sort file groups in the container ──
  function _sortGroups(): void {
    const entries = [...groupElements.entries()];
    if (entries.length === 0) return;

    entries.sort(([aPath], [bPath]) => {
      // Active file always first
      if (aPath === activeFilePath && bPath !== activeFilePath) return -1;
      if (bPath === activeFilePath && aPath !== activeFilePath) return 1;

      // Then files with errors before files with only warnings
      const aMarkers = currentDetail[aPath] || [];
      const bMarkers = currentDetail[bPath] || [];
      const aHasErr = aMarkers.some(m => m.severity === SEV_ERROR);
      const bHasErr = bMarkers.some(m => m.severity === SEV_ERROR);
      if (aHasErr !== bHasErr) return aHasErr ? -1 : 1;

      return aPath.localeCompare(bPath);
    });

    // Re-order DOM nodes (no re-creation)
    for (const [, ref] of entries) {
      containerEl.appendChild(ref.group);
    }
  }

  // ── Full render (only used for initial mount) ──
  function _fullRender(): void {
    containerEl.innerHTML = '';
    groupElements.clear();
    emptyEl = null;

    const paths = Object.keys(currentDetail).filter(p =>
      currentDetail[p] && currentDetail[p].length > 0
    );

    if (paths.length === 0) {
      _showEmptyPlaceholder();
      return;
    }

    // Sort: active first, errors next, then alphabetical
    paths.sort((a, b) => {
      if (a === activeFilePath && b !== activeFilePath) return -1;
      if (b === activeFilePath && a !== activeFilePath) return 1;
      const aHasErr = currentDetail[a].some(m => m.severity === SEV_ERROR);
      const bHasErr = currentDetail[b].some(m => m.severity === SEV_ERROR);
      if (aHasErr !== bHasErr) return aHasErr ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const absPath of paths) {
      containerEl.appendChild(_createFileGroup(absPath, currentDetail[absPath]));
    }
  }

  // ── Public API ──
  return {
    show() {
      visible = true;
      containerEl.style.display = '';
      const hdr = document.getElementById('problems-header');
      if (hdr) hdr.style.display = '';
    },
    hide() {
      visible = false;
      containerEl.style.display = 'none';
      const hdr = document.getElementById('problems-header');
      if (hdr) hdr.style.display = 'none';
    },

    /**
     * Diff-aware update. Adds new markers, removes stale ones, preserves collapse state.
     * @param {Object} detail - { absPath: [{severity, message, source, code, startLineNumber, startColumn, ...}] }
     */
    update(detail: unknown) {
      const next = coerceProblemsDetail(detail);

      // If panel has never rendered (no groups), do a full initial render.
      if (groupElements.size === 0 && Object.keys(currentDetail).length === 0) {
        currentDetail = next;
        _fullRender();
      } else {
        _diffUpdate(next);
      }
    },

    /**
     * Set the currently active (open) file. Expands its group, collapses
     * others that the user hasn't manually expanded, and sorts it to the top.
     * @param {string} absPath - absolute path of the active file
     */
    setActiveFile(absPath: string) {
      const prev = activeFilePath;
      activeFilePath = absPath || '';
      if (prev === activeFilePath) return;

      // Expand the active file group, collapse the previous one (if user hasn't toggled it)
      if (prev && groupElements.has(prev)) {
        const ref = groupElements.get(prev);
        // Only collapse if user hasn't explicitly expanded it
        if (ref && (!collapseState.has(prev) || collapseState.get(prev) === false)) {
          ref.items.style.display = 'none';
          ref.chevron.textContent = '▸';
          collapseState.set(prev, true);
        }
      }
      if (activeFilePath && groupElements.has(activeFilePath)) {
        const ref = groupElements.get(activeFilePath);
        if (ref) {
          ref.items.style.display = '';
          ref.chevron.textContent = '▾';
          collapseState.set(activeFilePath, false);
        }
      }

      _sortGroups();
    },

    destroy() {
      containerEl.innerHTML = '';
      currentDetail = {};
      groupElements.clear();
      collapseState.clear();
      emptyEl = null;
    },

    /** Return the current authoritative detail map. */
    getDetail() { return currentDetail; },

    /**
     * Compute a summary from the current detail data.
     * @returns {{ [relPath: string]: { errors: number, warnings: number } }}
     * @param {string} [projectRoot] - if provided, paths are made relative
     */
    getSummary(projectRoot?: string) {
      return summarizeProblems(currentDetail, projectRoot);
    },

    get isVisible() { return visible; },
  };
}
