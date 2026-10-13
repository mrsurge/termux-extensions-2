import type { StructuredViewLine } from './render/utils.ts';
import {
  applyTranscriptCardMetadata,
  type TranscriptCardMetadata,
} from './transcript_card_metadata.ts';
import { renderShellSummary } from './shell_render.ts';
import { mountShellOutputWindow } from './shell_output_window.ts';
import { ansiToHtml, hasAnsiSgr } from './terminal_ansi.ts';
import { applyPathScrollLabel } from './path_label.ts';

type TranscriptRecord = Record<string, unknown>;

type TranscriptEvent = TranscriptRecord & {
  id?: string;
  command?: string;
  prompt?: string;
  agent_block_id?: string;
  agentBlockId?: string;
  output?: string;
  exit_code?: number;
  exitCode?: number;
  duration_ms?: number;
  durationMs?: number;
  source?: string;
  path?: string;
  line?: number;
  content?: unknown;
  view_range?: unknown;
  viewRange?: unknown;
  lines?: unknown;
  title?: string;
  mode?: string;
  tool?: string;
  pattern?: string;
  arguments?: TranscriptRecord | null;
  result?: unknown;
  response?: unknown;
  action?: unknown;
  message?: string;
  envelope_json?: string;
  envelopeJson?: string;
  command_count?: number;
  commandCount?: number;
  truncated?: boolean;
  truncation_note?: string;
  truncationNote?: string;
};

type TranscriptWarningAction = {
  id?: string;
  label?: string;
  [key: string]: unknown;
};

type RenderCommandOptions = {
  linkPathFromRibbon?: boolean;
  updateLiveState?: boolean;
  autoScroll?: boolean;
};

type SearchEntry = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

type NormalizedErrorPayload = {
  message: string;
  errorType: string;
  statusCode: number | null;
  providerCallId: string;
  stack: string;
  details: string;
  source: string;
  code: unknown;
};

type TranscriptCardsContext = {
  getConversationSettings?: () => { commandOutputLines?: number | string; [key: string]: unknown } | null | undefined;
  clearPlaceholder: () => void;
  createRow: (
    rowType: string,
    metaLabel: string,
    rowId?: ChildNode | null,
    parentEl?: HTMLElement | null,
  ) => { row: HTMLElement; body: HTMLElement };
  makeCollapsible: (
    row: HTMLElement | null,
    cardId: string,
    startExpanded: boolean,
    options?: TranscriptRecord,
  ) => void;
  getLiveEventParent: (evt: TranscriptEvent | null | undefined) => HTMLElement | null;
  getBottomSpacerEl?: () => HTMLElement | null;
  timelineEl?: HTMLElement | null;
  maybeAutoScroll: () => void;
  setLastEventType: (value: string) => void;
  setStatusDot: (value: string) => void;
  renderShellCmdRibbon: (el: HTMLElement | null, cmd: string, options?: { promptPrefix?: string }) => unknown;
  detectLangFromCommand: (command: string) => string | null;
  highlightCodeAlways: (text: string, language: string) => string;
  highlightShellOutput: (text: string, explicitLanguage: string | null) => string | null;
  detectLangFromPath: (path: string) => string | null;
  toRelativePath: (path: string) => string;
  postTe2OpenRequest: (target: { path: string; line: number; column: number }) => unknown;
  buildViewCardTitle: (path: string, viewRange: number[] | null, fallback: string) => string;
  normalizeStructuredViewLines: (lines: unknown) => StructuredViewLine[] | null;
  synthesizeStructuredViewLines: (content: string, viewRange: number[] | null) => StructuredViewLine[] | null;
  renderStructuredViewLineTable: (lines: StructuredViewLine[], path: string) => HTMLDivElement;
  openSplashSettingsModal?: () => unknown;
  addMessage?: (role: string, message: string) => unknown;
  escapeHtml: (text: string) => string;
};

function isRecord(value: unknown): value is TranscriptRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeViewRange(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return values.length ? values : null;
}

export function bindTranscriptCards(ctx: TranscriptCardsContext) {
  const {
    getConversationSettings,
    clearPlaceholder,
    createRow,
    makeCollapsible,
    getLiveEventParent,
    getBottomSpacerEl,
    timelineEl,
    maybeAutoScroll,
    setLastEventType,
    setStatusDot,
    renderShellCmdRibbon,
    detectLangFromCommand,
    highlightCodeAlways,
    highlightShellOutput,
    detectLangFromPath,
    toRelativePath,
    postTe2OpenRequest,
    buildViewCardTitle,
    normalizeStructuredViewLines,
    synthesizeStructuredViewLines,
    renderStructuredViewLineTable,
    openSplashSettingsModal,
    addMessage,
    escapeHtml,
  } = ctx;

  function getCommandOutputLineLimit(): number {
    const settings = typeof getConversationSettings === 'function' ? getConversationSettings() : null;
    const raw = settings?.commandOutputLines;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
  }

  function mountRow(row: HTMLElement, parentEl: HTMLElement | null = null, evt: TranscriptEvent | null = null): void {
    const targetEl = parentEl || (evt ? getLiveEventParent(evt) : null);
    clearPlaceholder();
    if (evt) {
      applyTranscriptCardMetadata(row, evt as TranscriptCardMetadata);
    }
    if (targetEl) {
      targetEl.appendChild(row);
      return;
    }
    const bottomSpacerEl = typeof getBottomSpacerEl === 'function' ? getBottomSpacerEl() : null;
    if (timelineEl && bottomSpacerEl && bottomSpacerEl.parentElement === timelineEl) {
      timelineEl.insertBefore(row, bottomSpacerEl);
    } else {
      timelineEl?.appendChild(row);
    }
  }

  function appendTruncationNote(container: HTMLElement | null | undefined, text: string, asSpan = false): void {
    if (!container || !text) return;
    const note = document.createElement(asSpan ? 'span' : 'div');
    note.className = 'truncation-note';
    note.textContent = text;
    container.appendChild(note);
  }

  function serverTruncationNote(evt: TranscriptEvent): string {
    const note = typeof evt.truncation_note === 'string' && evt.truncation_note
      ? evt.truncation_note
      : (typeof evt.truncationNote === 'string' ? evt.truncationNote : '');
    return evt.truncated === true && note ? note : '';
  }

  function renderCommandResult(evt: TranscriptEvent, parentEl: HTMLElement | null = null, options: RenderCommandOptions = {}): void {
    const {
      linkPathFromRibbon = false,
      updateLiveState = true,
      autoScroll = updateLiveState,
    } = options;
    const command = typeof evt.command === 'string' ? evt.command : '';
    const prompt = typeof evt.prompt === 'string' ? evt.prompt : '';
    const agentBlockId = typeof evt.agent_block_id === 'string'
      ? evt.agent_block_id
      : (typeof evt.agentBlockId === 'string' ? evt.agentBlockId : '');
    const output = typeof evt.output === 'string' ? evt.output : '';
    const exitCode = evt.exit_code ?? evt.exitCode;
    const durationMs = evt.duration_ms ?? evt.durationMs;
    const truncateLines = getCommandOutputLineLimit();

    let displayOutput = output;
    let truncated = false;
    let totalLines = 0;
    if (output) {
      const lines = output.split('\n');
      totalLines = lines.length;
      if (lines.length > truncateLines) {
        displayOutput = lines.slice(0, truncateLines).join('\n');
        truncated = true;
      }
    }

    if (agentBlockId) {
      try {
        const dup = timelineEl?.querySelector(`.timeline-row.terminal-card[data-agent-block-id="${CSS.escape(agentBlockId)}"]`);
        if (dup && dup.parentElement) dup.parentElement.removeChild(dup);
      } catch {}
    }

    const row = document.createElement('div');
    row.className = 'timeline-row command-result terminal-card shell-card';
    if (agentBlockId) {
      row.dataset.agentBlockId = agentBlockId;
    }

    const body = document.createElement('div');
    body.className = 'body';
    const isUserTerminal = evt.source === 'user_terminal' || evt.source === 'user-terminal';
    const ribbonText = prompt ? `${prompt}${command}` : command;

    const summaryRibbon = document.createElement('div');
    summaryRibbon.className = 'command-ribbon shell-card-summary';
    const summaryTextEl = document.createElement('span');
    summaryTextEl.className = 'shell-card-summary-text';
    renderShellSummary(
      summaryTextEl,
      ribbonText,
      isUserTerminal ? '' : '$ ',
    );
    summaryRibbon.appendChild(summaryTextEl);
    body.appendChild(summaryRibbon);

    const detailEl = document.createElement('div');
    detailEl.className = 'shell-card-detail';

    const cmdRibbon = document.createElement('div');
    cmdRibbon.className = 'command-ribbon shell-card-command';
    if (isUserTerminal && hasAnsiSgr(ribbonText)) {
      cmdRibbon.innerHTML = ansiToHtml(ribbonText);
    } else if (!isUserTerminal) {
      renderShellCmdRibbon(cmdRibbon, command, { promptPrefix: '' });
    } else {
      cmdRibbon.textContent = ribbonText;
    }
    if (linkPathFromRibbon && typeof evt.path === 'string' && evt.path) {
      cmdRibbon.style.cursor = 'pointer';
      cmdRibbon.title = evt.path;
      cmdRibbon.dataset.hasClickHandler = 'true';
      const path = evt.path;
      const line = Number.isFinite(Number(evt.line)) ? Number(evt.line) : 1;
      cmdRibbon.addEventListener('click', (e: MouseEvent) => {
        const target = e.target;
        if (target instanceof Element && (target.closest('.twisty') || target.closest('.ribbon-toggle-zone'))) return;
        postTe2OpenRequest({ path, line, column: 1 });
      });
    }
    detailEl.appendChild(cmdRibbon);

    if (evt.shell_output) {
      const pre = document.createElement('pre');
      pre.className = 'command-output';
      detailEl.appendChild(pre);
      mountShellOutputWindow(pre, evt.shell_output, command);
    } else if (displayOutput) {
      const outputPre = document.createElement('pre');
      outputPre.className = 'command-output';
      const hasAnsi = hasAnsiSgr(displayOutput);
      if (hasAnsi) {
        outputPre.innerHTML = ansiToHtml(displayOutput);
        if (truncated) {
          appendTruncationNote(outputPre, `\n... (truncated, showing ${truncateLines} of ${totalLines} lines)`, true);
        }
      } else {
        const highlighted = highlightShellOutput(displayOutput, detectLangFromCommand(command));
        if (highlighted !== null) {
          outputPre.innerHTML = highlighted;
        } else {
          outputPre.textContent = displayOutput;
        }
        if (truncated) {
          if (highlighted !== null) {
            appendTruncationNote(outputPre, `\n... (truncated, showing ${truncateLines} of ${totalLines} lines)`, true);
          } else {
            outputPre.textContent += `\n... (truncated, showing ${truncateLines} of ${totalLines} lines)`;
          }
        }
      }
      detailEl.appendChild(outputPre);
    }

    const footer = document.createElement('div');
    footer.className = 'command-footer';
    const parts: string[] = [];
    if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
      parts.push(`Exit: ${exitCode}`);
    }
    if (durationMs !== undefined && durationMs !== null) {
      parts.push(`Duration: ${durationMs}ms`);
    }
    if (parts.length) {
      footer.textContent = parts.join(' | ');
      detailEl.appendChild(footer);
    }

    body.appendChild(detailEl);
    row.appendChild(body);
    makeCollapsible(row, `cmd:${evt.id || agentBlockId || command.slice(0, 40)}`, false, { headerEl: summaryRibbon });
    mountRow(row, parentEl, evt);

    if (updateLiveState) {
      setLastEventType('command');
      if (autoScroll) maybeAutoScroll();
      if (exitCode === 0 || exitCode === undefined || exitCode === null) {
        setStatusDot('success');
      } else {
        setStatusDot('error');
      }
    }
  }

  function renderViewCard(evt: TranscriptEvent, parentEl: HTMLElement | null = null): void {
    const content = evt.content ?? evt.output ?? '';
    const path = typeof evt.path === 'string' ? evt.path : '';
    const viewRange = normalizeViewRange(evt.view_range) ?? normalizeViewRange(evt.viewRange);
    const structuredLines = normalizeStructuredViewLines(evt.lines) ?? synthesizeStructuredViewLines(String(content ?? ''), viewRange);
    const title = typeof evt.title === 'string' && evt.title ? evt.title : buildViewCardTitle(path, viewRange, 'view');
    const truncateLines = getCommandOutputLineLimit();

    let displayContent = typeof content === 'string' ? content : String(content ?? '');
    let displayLines = structuredLines;
    let truncated = false;
    let totalLineCount = 0;
    if (displayLines) {
      totalLineCount = displayLines.length;
      if (displayLines.length > truncateLines) {
        displayLines = displayLines.slice(0, truncateLines);
        truncated = true;
      }
    } else if (displayContent) {
      const lines = displayContent.split('\n');
      totalLineCount = lines.length;
      if (lines.length > truncateLines) {
        displayContent = lines.slice(0, truncateLines).join('\n');
        truncated = true;
      }
    }

    const row = document.createElement('div');
    row.className = 'timeline-row command-result view-card';

    const body = document.createElement('div');
    body.className = 'body';

    const ribbon = document.createElement('div');
    ribbon.className = 'command-ribbon';
    ribbon.textContent = title;
    body.appendChild(ribbon);

    if (path) {
      const pathLine = document.createElement('div');
      pathLine.className = 'view-card-path';
      applyPathScrollLabel(pathLine, toRelativePath(path), { title: path });
      pathLine.style.cursor = 'pointer';
      pathLine.dataset.hasClickHandler = 'true';
      pathLine.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        const eventLine = Number(evt.line);
        const displayLine = Number(displayLines?.[0]?.line_no);
        const rangeLine = Array.isArray(viewRange) ? Number(viewRange[0]) : NaN;
        const preferredLine = Number.isFinite(eventLine) && eventLine > 0
          ? eventLine
          : (Number.isFinite(displayLine) && displayLine > 0
              ? displayLine
              : (Number.isFinite(rangeLine) && rangeLine > 0 ? rangeLine : 1));
        postTe2OpenRequest({ path, line: preferredLine, column: 1 });
      });
      body.appendChild(pathLine);
    }

    if (displayLines) {
      body.appendChild(renderStructuredViewLineTable(displayLines, path));
    } else {
      const outputPre = document.createElement('pre');
      outputPre.className = 'command-output';
      const lang = detectLangFromPath(path);
      if (lang) {
        outputPre.innerHTML = highlightCodeAlways(displayContent, lang);
      } else {
        outputPre.textContent = displayContent;
      }
      body.appendChild(outputPre);
    }

    if (truncated) {
      appendTruncationNote(body, `... (truncated, showing ${truncateLines} of ${totalLineCount} lines)`);
    }
    const backendNote = serverTruncationNote(evt);
    if (backendNote && displayLines) {
      appendTruncationNote(body, backendNote);
    }

    row.appendChild(body);
    makeCollapsible(row, `view:${evt.id || path || title}`, false);
    mountRow(row, parentEl, evt);

    setLastEventType('view');
    maybeAutoScroll();
    setStatusDot('success');
  }

  function resolveSearchEntryPath(rawPath: unknown, rootPath: string): string {
    if (typeof rawPath !== 'string' || !rawPath) return '';
    if (rawPath.startsWith('/')) return rawPath;
    if (!rootPath) return rawPath;
    return `${rootPath.replace(/\/+$/, '')}/${rawPath.replace(/^\.?\//, '')}`;
  }

  function shortenSearchTarget(path: string): string {
    const relativePath = toRelativePath(path || '');
    if (!relativePath) return '';
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length <= 3) return relativePath;
    return `.../${parts.slice(-3).join('/')}`;
  }

  function formatSearchArgumentValue(key: string, value: unknown): string {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value) && value.length === 0) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    if ((key === 'path' || key === 'root' || key === 'cwd') && typeof value === 'string') {
      return toRelativePath(value);
    }
    return String(value);
  }

  function buildSearchDetailText(mode: string, rootPath: string, pattern: string, args: TranscriptRecord | null): string {
    const merged: Record<string, unknown> = {};
    if (args && typeof args === 'object') {
      Object.entries(args).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value) && value.length === 0) return;
        merged[key] = value;
      });
    }
    if (!merged.path && rootPath) merged.path = rootPath;
    if (!merged.pattern && pattern) merged.pattern = pattern;

    const preferredKeys = ['pattern', 'path', 'glob', 'type', 'output_mode', 'n', 'i', 'A', 'B', 'C', 'head_limit', 'multiline'];
    const detailLines = [`mode: ${mode}`];

    preferredKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) return;
      const formatted = formatSearchArgumentValue(key, merged[key]);
      if (formatted) detailLines.push(`${key}: ${formatted}`);
      delete merged[key];
    });

    Object.entries(merged).forEach(([key, value]) => {
      const formatted = formatSearchArgumentValue(key, value);
      if (formatted) detailLines.push(`${key}: ${formatted}`);
    });

    return detailLines.join('\n');
  }

  function parseSearchCardEntries(mode: string, content: unknown, rootPath = ''): { entries: SearchEntry[]; plainText: string } {
    const text = typeof content === 'string' ? content : String(content ?? '');
    const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
    if (mode === 'glob') {
      return { entries: [], plainText: text };
    }

    const entries: SearchEntry[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const match = line.match(/^(.+?):(\d+)(?::(\d+))?:(.*)$/);
      if (!match) continue;
      const resolvedPath = resolveSearchEntryPath(match[1], rootPath);
      entries.push({
        path: resolvedPath,
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : 1,
        preview: match[4] || '',
      });
    }
    return {
      entries,
      plainText: entries.length ? '' : text,
    };
  }

  function renderSearchCard(evt: TranscriptEvent, parentEl: HTMLElement | null = null): void {
    const mode = typeof evt.mode === 'string' && evt.mode ? evt.mode : (typeof evt.tool === 'string' ? evt.tool : 'search');
    const pattern = typeof evt.pattern === 'string' ? evt.pattern : '';
    const rootPath = typeof evt.path === 'string' ? evt.path : '';
    const searchArgs = isRecord(evt.arguments) ? evt.arguments : {};
    const { entries, plainText } = parseSearchCardEntries(mode, evt.content ?? evt.result ?? '', rootPath);

    const row = document.createElement('div');
    row.className = 'timeline-row command-result search-card';

    const body = document.createElement('div');
    body.className = 'body';

    const ribbon = document.createElement('div');
    ribbon.className = 'command-ribbon';
    const shortTarget = shortenSearchTarget(rootPath);
    const ribbonBase = mode === 'web_search' ? 'web_search' : 'search';
    ribbon.textContent = shortTarget ? `${ribbonBase} ${shortTarget}` : ribbonBase;
    if (rootPath) ribbon.title = rootPath;
    body.appendChild(ribbon);

    const detailLine = document.createElement('pre');
    detailLine.className = 'search-card-detail';
    detailLine.textContent = buildSearchDetailText(mode, rootPath, pattern, searchArgs);
    body.appendChild(detailLine);

    if (entries.length) {
      const list = document.createElement('div');
      list.className = 'search-card-list';
      entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'search-card-entry';

        const pathLine = document.createElement('div');
        pathLine.className = 'search-card-path';
        applyPathScrollLabel(
          pathLine,
          entry.line ? `${toRelativePath(entry.path)}:${entry.line}` : toRelativePath(entry.path),
          { title: entry.path },
        );
        pathLine.style.cursor = 'pointer';
        pathLine.dataset.hasClickHandler = 'true';
        pathLine.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          postTe2OpenRequest({ path: entry.path, line: entry.line || 1, column: entry.column || 1 });
        });
        item.appendChild(pathLine);

        if (entry.preview) {
          const preview = document.createElement('pre');
          preview.className = 'search-card-preview';
          const lang = detectLangFromPath(entry.path);
          if (lang) {
            preview.innerHTML = highlightCodeAlways(entry.preview, lang);
          } else {
            preview.textContent = entry.preview;
          }
          item.appendChild(preview);
        }

        list.appendChild(item);
      });
      body.appendChild(list);
    } else {
      const plain = document.createElement('pre');
      plain.className = 'search-card-plain';
      const lang = detectLangFromPath(rootPath);
      if (lang && plainText) {
        plain.innerHTML = highlightCodeAlways(plainText, lang);
      } else {
        plain.textContent = plainText;
      }
      body.appendChild(plain);
    }

    appendTruncationNote(body, serverTruncationNote(evt));

    row.appendChild(body);
    makeCollapsible(row, `search:${evt.id || pattern || mode}`, false);
    mountRow(row, parentEl, evt);

    setLastEventType('search');
    maybeAutoScroll();
    setStatusDot('success');
  }

  function normalizeErrorPayload(raw: unknown): NormalizedErrorPayload {
    if (typeof raw === 'string') {
      return {
        message: raw,
        errorType: '',
        statusCode: null,
        providerCallId: '',
        stack: '',
        details: '',
        source: '',
        code: null,
      };
    }
    const payload = isRecord(raw) ? raw : {};
    const message = typeof payload.message === 'string' && payload.message
      ? payload.message
      : (typeof payload.text === 'string' ? payload.text : '');
    const errorType = typeof payload.error_type === 'string' && payload.error_type
      ? payload.error_type
      : (typeof payload.errorType === 'string' ? payload.errorType : '');
    const statusRaw = payload.status_code ?? payload.statusCode;
    const statusCode = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
    const providerCallId = typeof payload.provider_call_id === 'string' && payload.provider_call_id
      ? payload.provider_call_id
      : (typeof payload.providerCallId === 'string' ? payload.providerCallId : '');
    const stack = typeof payload.stack === 'string' ? payload.stack : '';
    const details = typeof payload.details === 'string' && payload.details
      ? payload.details
      : (typeof payload.additional_details === 'string' ? payload.additional_details : '');
    const source = typeof payload.source === 'string' && payload.source
      ? payload.source
      : (typeof payload.event === 'string' ? payload.event : '');
    const code = payload.code ?? null;
    return {
      message,
      errorType,
      statusCode,
      providerCallId,
      stack,
      details,
      source,
      code,
    };
  }

  function appendErrorContent(body: HTMLElement | null | undefined, raw: unknown): void {
    if (!body) return;
    const payload = normalizeErrorPayload(raw);
    if (payload.message) {
      const pre = document.createElement('pre');
      pre.className = 'error-text';
      pre.textContent = payload.message;
      body.appendChild(pre);
    }

    const metaParts: string[] = [];
    if (payload.errorType) metaParts.push(`type: ${payload.errorType}`);
    if (payload.statusCode !== null) metaParts.push(`status: ${payload.statusCode}`);
    if (payload.code !== null && payload.code !== '') metaParts.push(`code: ${payload.code}`);
    if (payload.providerCallId) metaParts.push(`provider_call_id: ${payload.providerCallId}`);
    if (payload.source) metaParts.push(`source: ${payload.source}`);
    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'command-footer';
      meta.textContent = metaParts.join(' | ');
      body.appendChild(meta);
    }

    if (payload.details && payload.details !== payload.message) {
      const detailPre = document.createElement('pre');
      detailPre.className = 'error-text';
      detailPre.textContent = payload.details;
      body.appendChild(detailPre);
    }

    if (payload.stack && payload.stack !== payload.message && payload.stack !== payload.details) {
      const stackPre = document.createElement('pre');
      stackPre.className = 'error-text';
      stackPre.textContent = payload.stack;
      body.appendChild(stackPre);
    }
  }

  function renderErrorCard(raw: unknown): void {
    const payload = normalizeErrorPayload(raw);
    if (!payload.message && !payload.details && !payload.stack) return;
    clearPlaceholder();
    const { row, body } = createRow('error', 'error');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      applyTranscriptCardMetadata(row, raw as TranscriptCardMetadata);
    }
    appendErrorContent(body, payload);
    setLastEventType('error');
    maybeAutoScroll();
  }

  function handleWarningAction(action: TranscriptWarningAction | null | undefined): void {
    if (!action || typeof action !== 'object') return;
    const actionId = typeof action.id === 'string' ? action.id.trim() : '';
    if (actionId === 'open_splash_settings') {
      openSplashSettingsModal?.();
    }
  }

  function renderWarningCard(
    message: string | null | undefined,
    action: unknown = null,
    metadata: TranscriptCardMetadata | null = null,
  ): void {
    if (!message) return;
    clearPlaceholder();
    const { row, body } = createRow('warning', 'warning');
    applyTranscriptCardMetadata(row, metadata);
    const pre = document.createElement('pre');
    pre.className = 'warning-text';
    pre.textContent = message;
    body.appendChild(pre);
    if (action && typeof action === 'object') {
      const warningAction = action as TranscriptWarningAction;
      const label = typeof warningAction.label === 'string' ? warningAction.label.trim() : '';
      if (label) {
        const actions = document.createElement('div');
        actions.className = 'warning-actions';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn tiny';
        button.textContent = label;
        button.addEventListener('click', () => handleWarningAction(warningAction));
        actions.appendChild(button);
        body.appendChild(actions);
      }
    }
    setLastEventType('warning');
    maybeAutoScroll();
  }

  function renderContextCompactedCard(evt: TranscriptEvent | null = null): void {
    clearPlaceholder();
    const { row, body } = createRow('system', 'context compacted');
    if (evt) {
      applyTranscriptCardMetadata(row, evt as TranscriptCardMetadata);
    }
    const msg = document.createElement('div');
    msg.className = 'system-message';
    msg.textContent = 'Context was compacted to fit within the model\'s context window. Some earlier conversation history may have been summarized or dropped.';
    body.appendChild(msg);
    setLastEventType('system');
    maybeAutoScroll();
  }

  function renderMetaEnvelopeInjected(evt: TranscriptEvent): void {
    const commandCount = evt.command_count ?? evt.commandCount ?? 0;
    const envelopeJson = typeof evt.envelope_json === 'string'
      ? evt.envelope_json
      : (typeof evt.envelopeJson === 'string' ? evt.envelopeJson : '');
    const pretty = (() => {
      try {
        return JSON.stringify(JSON.parse(envelopeJson), null, 2);
      } catch {
        return String(envelopeJson || '');
      }
    })();
    const text = [
      'CODEX_META injected (debug):',
      `commands: ${commandCount}`,
      '',
      '\u001eCODEX_META ' + pretty + '\u001f',
    ].join('\n');
    if (typeof addMessage === 'function') {
      addMessage('meta', text);
    }
  }

  return {
    appendErrorContent,
    renderCommandResult,
    renderViewCard,
    renderSearchCard,
    renderErrorCard,
    renderWarningCard,
    renderContextCompactedCard,
    renderMetaEnvelopeInjected,
  };
}
