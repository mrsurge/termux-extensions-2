import {
  applyTranscriptCardMetadata,
  type TranscriptCardMetadata,
} from './transcript_card_metadata.ts';
import { createPathScrollLabel } from './path_label.ts';

type ToolPayload = Record<string, unknown>;
type ToolStructuredValue = ToolPayload | unknown[];
type ToolRenderTarget = 'request' | 'response';
type ToolRenderSourceKey = 'request' | 'args' | 'arguments' | 'response' | 'result';
type ToolRenderFieldKey = 'requestFields' | 'argsFields' | 'argumentsFields' | 'responseFields' | 'resultFields';

type ToolRenderSpec =
  | { kind: 'plain' }
  | { kind: 'markdown' }
  | { kind: 'hljs'; language?: string };

interface ToolRenderRule {
  server?: string;
  tool?: string;
  serverPrefix?: string;
  toolPrefix?: string;
  servers?: string[];
  tools?: string[];
  request?: unknown;
  args?: unknown;
  arguments?: unknown;
  response?: unknown;
  result?: unknown;
  requestFields?: Record<string, unknown>;
  argsFields?: Record<string, unknown>;
  argumentsFields?: Record<string, unknown>;
  responseFields?: Record<string, unknown>;
  resultFields?: Record<string, unknown>;
}

interface ToolRenderPolicy {
  default?: ToolRenderRule | null;
  rules?: ToolRenderRule[] | null;
}

interface ToolEvent extends ToolPayload {
  id?: string;
  item_id?: string;
  card_id?: string;
  order_id?: number;
  nid?: string;
  tool?: string;
  server?: string;
  request?: ToolPayload | null;
  arguments?: ToolPayload | null;
  payload?: ToolPayload | null;
  response?: unknown;
  result?: unknown;
  output?: string;
  delta?: string;
  duration_ms?: number;
  is_error?: boolean;
  new_file?: boolean;
  newFile?: boolean;
}

interface ToolRowEntry {
  row: HTMLDivElement;
  body: HTMLDivElement;
  header: HTMLDivElement;
  argsEls: HTMLElement[];
  resultHeaderEl: HTMLElement | null;
  resultEls: HTMLElement[];
  footerEl: HTMLElement | null;
  streamEl: HTMLPreElement | null;
  interactionEl: HTMLPreElement | null;
  diffLabelEl: HTMLDivElement | null;
  diffBlock: HTMLDivElement | null;
  truncationNoteEl: HTMLDivElement | null;
}

interface ToolRenderContext {
  toolRows: Map<string, ToolRowEntry>;
  clearPlaceholder: () => void;
  insertRow: (row: HTMLElement) => void;
  makeCollapsible: (
    row: HTMLElement | null,
    cardId: string,
    startExpanded: boolean,
    options?: Record<string, unknown>,
  ) => void;
  getLiveEventParent: (evt: ToolEvent | null | undefined) => HTMLElement | null;
  renderEventMarkdownInto?: (container: HTMLElement, text: string) => void;
  formatDiff: (text: string, filePath: string) => string;
  renderDiffBlock?: (block: HTMLElement, text: string, filePath: string) => void;
  toRelativePath: (path: string) => string;
  escapeHtml?: (text: string) => string;
  renderShellCmdRibbon: (el: HTMLElement | null, cmd: string) => unknown;
  maybeAutoScroll: () => void;
  setLastEventType: (value: string) => void;
  setStatusDot: (value: string) => void;
  getToolRenderPolicy?: () => unknown;
  highlightCodeAlways?: (text: string, language: string) => string;
}

function isToolPayload(value: unknown): value is ToolPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asToolPayload(value: unknown): ToolPayload | null {
  return isToolPayload(value) ? value : null;
}

function isToolStructuredValue(value: unknown): value is ToolStructuredValue {
  return Array.isArray(value) || isToolPayload(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDefaultToolRenderPolicy(): ToolRenderPolicy {
  return {
    default: {
      request: { kind: 'plain' },
      response: { kind: 'plain' },
    },
    rules: [],
  };
}

export function bindToolRender(ctx: ToolRenderContext) {
  const {
    toolRows,
    clearPlaceholder,
    insertRow,
    makeCollapsible,
    getLiveEventParent,
    renderEventMarkdownInto,
    formatDiff,
    renderDiffBlock,
    toRelativePath,
    renderShellCmdRibbon,
    maybeAutoScroll,
    setLastEventType,
    setStatusDot,
    getToolRenderPolicy,
    highlightCodeAlways,
  } = ctx;

  function getActiveToolRenderPolicy(): ToolRenderPolicy {
    if (typeof getToolRenderPolicy === 'function') {
      const policy = getToolRenderPolicy();
      if (policy && typeof policy === 'object') return policy as ToolRenderPolicy;
    }
    return getDefaultToolRenderPolicy();
  }

  function normalizeRenderSpec(spec: unknown): ToolRenderSpec {
    if (!spec || typeof spec !== 'object') return { kind: 'plain' };
    const specRecord = spec as ToolPayload;
    const kind = typeof specRecord.kind === 'string' ? specRecord.kind.trim().toLowerCase() : 'plain';
    if (kind === 'markdown') return { kind: 'markdown' };
    if (kind === 'hljs') {
      const language = typeof specRecord.language === 'string' && specRecord.language.trim()
        ? specRecord.language.trim()
        : '';
      return language ? { kind: 'hljs', language } : { kind: 'hljs' };
    }
    return { kind: 'plain' };
  }

  function ruleMatches(rule: ToolRenderRule | null | undefined, serverName: string, toolName: string): boolean {
    if (!rule || typeof rule !== 'object') return false;
    const server = typeof serverName === 'string' ? serverName : '';
    const tool = typeof toolName === 'string' ? toolName : '';
    const exactServer = typeof rule.server === 'string' && rule.server ? rule.server : '';
    const exactTool = typeof rule.tool === 'string' && rule.tool ? rule.tool : '';
    const serverPrefix = typeof rule.serverPrefix === 'string' && rule.serverPrefix ? rule.serverPrefix : '';
    const toolPrefix = typeof rule.toolPrefix === 'string' && rule.toolPrefix ? rule.toolPrefix : '';
    const servers = Array.isArray(rule.servers)
      ? rule.servers.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const tools = Array.isArray(rule.tools)
      ? rule.tools.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    if (exactServer && server !== exactServer) return false;
    if (exactTool && tool !== exactTool) return false;
    if (serverPrefix && !server.startsWith(serverPrefix)) return false;
    if (toolPrefix && !tool.startsWith(toolPrefix)) return false;
    if (servers.length && !servers.includes(server)) return false;
    if (tools.length && !tools.includes(tool)) return false;
    return Boolean(exactServer || exactTool || serverPrefix || toolPrefix || servers.length || tools.length);
  }

  function resolveRenderSpec(
    serverName: string,
    toolName: string,
    target: ToolRenderTarget,
    fieldName = '',
  ): ToolRenderSpec {
    const policy = getActiveToolRenderPolicy();
    const defaults = policy.default && typeof policy.default === 'object' ? policy.default : {};
    const rules = Array.isArray(policy.rules) ? policy.rules : [];
    const matchedRule = rules.find((rule) => ruleMatches(rule, serverName, toolName)) || null;
    const targetConfig: {
      primary: ToolRenderSourceKey;
      legacy: ToolRenderSourceKey[];
      fieldPrimary: ToolRenderFieldKey;
      fieldLegacy: ToolRenderFieldKey[];
    } = target === 'request'
      ? {
          primary: 'request',
          legacy: ['args', 'arguments'],
          fieldPrimary: 'requestFields',
          fieldLegacy: ['argsFields', 'argumentsFields'],
        }
      : {
          primary: 'response',
          legacy: ['result'],
          fieldPrimary: 'responseFields',
          fieldLegacy: ['resultFields'],
        };
    if (fieldName) {
      const ruleFieldSources = [targetConfig.fieldPrimary, ...targetConfig.fieldLegacy];
      for (const fieldKey of ruleFieldSources) {
        const fieldMap = matchedRule?.[fieldKey];
        const matchedField = fieldMap && typeof fieldMap === 'object'
          ? (fieldMap as Record<string, unknown>)[fieldName]
          : null;
        if (matchedField) return normalizeRenderSpec(matchedField);
      }
      for (const fieldKey of ruleFieldSources) {
        const fieldMap = defaults?.[fieldKey];
        const defaultField = fieldMap && typeof fieldMap === 'object'
          ? (fieldMap as Record<string, unknown>)[fieldName]
          : null;
        if (defaultField) return normalizeRenderSpec(defaultField);
      }
    }
    const sourceKeys = [targetConfig.primary, ...targetConfig.legacy];
    for (const key of sourceKeys) {
      if (matchedRule?.[key]) return normalizeRenderSpec(matchedRule[key]);
    }
    for (const key of sourceKeys) {
      if (defaults?.[key]) return normalizeRenderSpec(defaults[key]);
    }
    return normalizeRenderSpec(null);
  }

  function buildRenderedTextElement(text: unknown, spec: unknown, className: string): HTMLElement {
    const normalizedText = text == null ? '' : String(text);
    const normalizedSpec = normalizeRenderSpec(spec);
    if (normalizedSpec.kind === 'markdown' && typeof renderEventMarkdownInto === 'function') {
      const container = document.createElement('div');
      container.className = `markdown-body ${className}`.trim();
      renderEventMarkdownInto(container, normalizedText);
      return container;
    }
    const pre = document.createElement('pre');
    pre.className = className;
    if (normalizedSpec.kind === 'hljs') {
      const code = document.createElement('code');
      const language = normalizedSpec.language || '';
      code.className = language ? `hljs language-${language}` : 'hljs';
      if (typeof highlightCodeAlways === 'function') {
        code.innerHTML = highlightCodeAlways(normalizedText, language);
      } else {
        code.textContent = normalizedText;
      }
      pre.appendChild(code);
      return pre;
    }
    pre.textContent = normalizedText;
    return pre;
  }

  function buildObjectText(result: ToolStructuredValue): string {
    const lines: string[] = [];
    Object.entries(result).forEach(([key, value]) => {
      if (isToolPayload(value)) {
        lines.push(`  ${key}:`);
        Object.entries(value).forEach(([innerKey, innerValue]) => {
          lines.push(`    ${innerKey}: ${JSON.stringify(innerValue)}`);
        });
      } else {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    });
    return lines.join('\n');
  }

  function removeNode(node: Node | null | undefined): void {
    if (node && node.parentElement) {
      node.parentElement.removeChild(node);
    }
  }

  function removeNodes(nodes: Array<Node | null | undefined> | null | undefined): void {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => removeNode(node));
  }

  function getServerTruncationNote(payload: ToolPayload | null | undefined): string {
    if (!payload || payload.truncated !== true) return '';
    const rawNote = payload.truncation_note ?? payload.truncationNote;
    return typeof rawNote === 'string' ? rawNote : '';
  }

  function setToolTruncationNote(entry: Pick<ToolRowEntry, 'body' | 'truncationNoteEl'>, note: string): void {
    removeNode(entry.truncationNoteEl);
    entry.truncationNoteEl = null;
    if (!note) return;
    const noteEl = document.createElement('div');
    noteEl.className = 'truncation-note';
    noteEl.textContent = note;
    entry.body.appendChild(noteEl);
    entry.truncationNoteEl = noteEl;
  }

  function getToolRow(
    id: string | undefined,
    label: string | undefined,
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ): ToolRowEntry {
    const key = id || `tool:${label || 'tool'}`;
    let entry = toolRows.get(key);
    if (!entry) {
      const row = document.createElement('div');
      row.className = 'timeline-row command-result mcp-tool-card';
      applyTranscriptCardMetadata(row, metadata);
      const body = document.createElement('div');
      body.className = 'body';
      const header = document.createElement('div');
      header.className = 'command-ribbon';
      header.textContent = label || 'tool';
      body.appendChild(header);
      row.appendChild(body);
      if (parentEl) {
        clearPlaceholder();
        parentEl.appendChild(row);
      } else {
        insertRow(row);
      }
      makeCollapsible(row, `tool:${key}`, false);
      entry = {
        row,
        body,
        header,
        argsEls: [],
        resultHeaderEl: null,
        resultEls: [],
        footerEl: null,
        streamEl: null,
        interactionEl: null,
        diffLabelEl: null,
        diffBlock: null,
        truncationNoteEl: null,
      };
      toolRows.set(key, entry);
    } else if (parentEl && entry.row.parentElement !== parentEl) {
      clearPlaceholder();
      parentEl.appendChild(entry.row);
      maybeAutoScroll();
    }
    applyTranscriptCardMetadata(entry.row, metadata);
    return entry;
  }

  function resolveToolCardPath(_toolName: string, payload: ToolPayload = {}): string {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.path === 'string' && payload.path.trim()) {
      return payload.path.trim();
    }
    const argumentsPayload = asToolPayload(payload.arguments) ?? {};
    if (typeof argumentsPayload.path === 'string' && argumentsPayload.path.trim()) {
      return argumentsPayload.path.trim();
    }
    const candidateLists = [argumentsPayload.paths, payload.paths];
    for (const list of candidateLists) {
      if (!Array.isArray(list)) continue;
      const firstPath = list.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (typeof firstPath === 'string' && firstPath.trim()) {
        return firstPath.trim();
      }
    }
    return '';
  }

  function resolveToolCardDiff(toolName: string, payload: ToolPayload = {}): string {
    if (toolName !== 'apply_patch' || !payload || typeof payload !== 'object') return '';
    // apply_patch diffs render as standalone diff cards; the embedded payload is
    // provider-oriented and can collapse multi-file patches under one path.
    return '';
  }

  function resolveToolCardOutcome(toolName: string, payload: ToolPayload = {}): string {
    if (toolName !== 'apply_patch' || !payload || typeof payload !== 'object') return '';
    const result = asToolPayload(payload.result);
    const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
    const resultStatus = typeof result?.status === 'string' ? result.status.trim().toLowerCase() : '';
    const isError = payload.is_error === true || result?.isError === true || result?.success === false;
    if (isError || status === 'error' || status === 'failed' || resultStatus === 'error' || resultStatus === 'failed') {
      return 'error';
    }
    const isCompleted = (
      payload.duration_ms !== undefined
      || payload.output !== undefined
      || payload.result !== undefined
      || status === 'completed'
      || status === 'success'
      || resultStatus === 'completed'
      || resultStatus === 'success'
    );
    return isCompleted ? 'success' : '';
  }

  function applyPatchOutcomeEmoji(outcome: string): string {
    if (outcome === 'success') return '🟢';
    if (outcome === 'error') return '🔴';
    return '';
  }

  function isApplyPatchNewFile(payload: ToolPayload = {}): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const args = asToolPayload(payload.arguments) ?? {};
    const request = asToolPayload(payload.request) ?? {};
    const response = asToolPayload(payload.response) ?? {};
    const result = asToolPayload(payload.result) ?? {};
    return payload.new_file === true
      || payload.newFile === true
      || args.new_file === true
      || args.newFile === true
      || request.new_file === true
      || request.newFile === true
      || response.new_file === true
      || response.newFile === true
      || result.new_file === true
      || result.newFile === true;
  }

  function toolCardLabel(toolName: string, serverName = '', filePath = '', payload: ToolPayload = {}): string {
    if (!serverName && toolName === 'read_shell') return 'Reading shell';
    if (!serverName && toolName === 'write_shell') return 'Writing to shell';
    if (toolName === 'apply_patch') {
      const resolvedPath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : '';
      const relPath = resolvedPath ? (toRelativePath(resolvedPath) || resolvedPath.split('/').pop() || resolvedPath) : '';
      const baseLabel = isApplyPatchNewFile(payload)
        ? (relPath ? `new file ${relPath}` : 'new file')
        : (relPath ? `apply_patch ${relPath}` : 'apply_patch');
      return serverName ? `${serverName}:${baseLabel}` : baseLabel;
    }
    return serverName ? `${serverName}:${toolName}` : `tool:${toolName}`;
  }

  function renderToolCardHeader(
    headerEl: HTMLElement | null,
    toolName: string,
    serverName = '',
    filePath = '',
    payload: ToolPayload = {},
  ): string {
    if (!headerEl) return '';
    const label = toolCardLabel(toolName, serverName, filePath, payload);
    if (toolName === 'apply_patch') {
      const outcomeEmoji = applyPatchOutcomeEmoji(resolveToolCardOutcome(toolName, payload));
      const ribbonCommand = outcomeEmoji ? `${label} ${outcomeEmoji}` : label;
      renderShellCmdRibbon(headerEl, ribbonCommand);
      headerEl.classList.add('patch-command-ribbon');
      const compact = document.createElement('span');
      compact.className = 'patch-collapsed-summary';
      const command = document.createElement('span');
      command.className = 'tool-command-prefix';
      command.textContent = isApplyPatchNewFile(payload) ? 'new file ' : 'apply_patch ';
      const path = toRelativePath(filePath) || filePath;
      const slash = path.lastIndexOf('/') + 1;
      const name = document.createElement('span');
      name.className = 'patch-filename';
      name.textContent = path.slice(slash);
      compact.append(command, path.slice(0, slash), name, outcomeEmoji ? ` ${outcomeEmoji}` : '');
      headerEl.prepend(compact);
      return ribbonCommand;
    }
    const savedTwisty = headerEl.querySelector(':scope > .twisty') || headerEl.querySelector('.twisty');
    const savedToggle = headerEl.querySelector(':scope > .ribbon-toggle-zone') || headerEl.querySelector('.ribbon-toggle-zone');
    headerEl.textContent = '';
    const colon = label.indexOf(':');
    const prefix = document.createElement('span');
    prefix.className = 'tool-command-prefix';
    prefix.textContent = colon >= 0 ? label.slice(0, colon) : label;
    headerEl.append(prefix, colon >= 0 ? label.slice(colon) : '');
    if (savedTwisty) headerEl.appendChild(savedTwisty);
    if (savedToggle) headerEl.appendChild(savedToggle);
    return label;
  }

  function buildToolDiffPreview(diffText: string, filePath = ''): { label: HTMLDivElement; block: HTMLDivElement } | null {
    if (typeof diffText !== 'string' || !diffText.trim()) return null;
    const label = document.createElement('div');
    label.className = 'mcp-tool-arg-label mcp-tool-diff-label';
    const resolvedPath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : '';
    if (resolvedPath) {
      const prefix = document.createElement('span');
      prefix.textContent = 'Changes: ';
      label.append(prefix, createPathScrollLabel(document, toRelativePath(resolvedPath) || resolvedPath, {
        title: resolvedPath,
      }));
    } else {
      label.textContent = 'Changes';
    }
    const block = document.createElement('div');
    block.className = 'diff-block mcp-tool-diff';
    if (typeof renderDiffBlock === 'function') {
      renderDiffBlock(block, diffText, resolvedPath || '');
    } else {
      block.innerHTML = formatDiff(diffText, resolvedPath || '');
    }
    return { label, block };
  }

  function ensureToolDiffPreview(entry: ToolRowEntry, diffText: string, filePath = ''): void {
    if (typeof diffText !== 'string' || !diffText.trim()) return;
    const preview = buildToolDiffPreview(diffText, filePath);
    if (!preview) return;
    if (!entry.diffLabelEl) {
      entry.diffLabelEl = preview.label;
      const anchor = entry.body.firstElementChild?.nextSibling ?? null;
      entry.body.insertBefore(entry.diffLabelEl, anchor);
    } else {
      entry.diffLabelEl.textContent = preview.label.textContent;
    }
    if (!entry.diffBlock) {
      entry.diffBlock = preview.block;
      const anchor = entry.diffLabelEl.nextSibling;
      entry.body.insertBefore(entry.diffBlock, anchor);
    } else {
      entry.diffBlock.innerHTML = preview.block.innerHTML;
    }
  }

  function appendStructuredToolFields(
    body: HTMLElement,
    values: ToolPayload,
    serverName: string,
    toolName: string,
    target: ToolRenderTarget,
    isError = false,
  ): HTMLElement[] | null {
    const entries = Object.entries(values);
    if (!entries.length) return null;
    const hasDeclaredFieldPolicy = entries.some(([key]) => resolveRenderSpec(serverName, toolName, target, key).kind !== 'plain');
    if (!hasDeclaredFieldPolicy) return null;
    const inserted: HTMLElement[] = [];
    const valueClass = target === 'request' ? 'mcp-tool-arg-value-plain' : 'mcp-tool-content';
    entries.forEach(([key, value]) => {
      const label = document.createElement('div');
      label.className = 'mcp-tool-arg-label';
      label.textContent = `${key}:`;
      body.appendChild(label);
      inserted.push(label);
      const renderSpec = resolveRenderSpec(serverName, toolName, target, key);
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      let rendered: HTMLElement;
      if (typeof value === 'string' || renderSpec.kind === 'hljs') {
        rendered = buildRenderedTextElement(serializedValue, renderSpec, valueClass);
      } else {
        rendered = document.createElement('pre');
        rendered.className = valueClass;
        rendered.textContent = serializedValue;
      }
      if (isError) rendered.classList.add('error-text');
      body.appendChild(rendered);
      inserted.push(rendered);
    });
    return inserted;
  }

  function appendToolArguments(body: HTMLElement, args: ToolPayload | null | undefined, serverName = '', toolName = ''): HTMLElement[] {
    if (!isToolPayload(args) || Object.keys(args).length === 0) return [];
    const structured = appendStructuredToolFields(body, args, serverName, toolName, 'request');
    if (structured) return structured;
    const argsPre = document.createElement('pre');
    argsPre.className = 'mcp-tool-args';
    const lines: string[] = [];
    Object.entries(args).forEach(([key, value]) => {
      const renderedValue = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`  ${key}: ${renderedValue}`);
    });
    argsPre.textContent = lines.join('\n');
    body.appendChild(argsPre);
    return [argsPre];
  }

  function appendToolResult(
    body: HTMLElement,
    result: unknown,
    isError: boolean,
    serverName = '',
    toolName = '',
  ): { headerEl: HTMLElement | null; nodes: HTMLElement[] } {
    if (result === undefined || result === null) {
      return { headerEl: null, nodes: [] };
    }
    const resultHeader = document.createElement('div');
    resultHeader.className = 'mcp-tool-result-header';
    resultHeader.textContent = '→';
    body.appendChild(resultHeader);

    if (isToolPayload(result)) {
      const structured = appendStructuredToolFields(body, result, serverName, toolName, 'response', isError);
      if (structured) {
        return { headerEl: resultHeader, nodes: structured };
      }
      const resultPre = document.createElement('pre');
      resultPre.className = 'mcp-tool-content';
      resultPre.textContent = buildObjectText(result);
      if (isError) resultPre.classList.add('error-text');
      body.appendChild(resultPre);
      return { headerEl: resultHeader, nodes: [resultPre] };
    }

    if (Array.isArray(result)) {
      const resultPre = document.createElement('pre');
      resultPre.className = 'mcp-tool-content';
      resultPre.textContent = buildObjectText(result);
      if (isError) resultPre.classList.add('error-text');
      body.appendChild(resultPre);
      return { headerEl: resultHeader, nodes: [resultPre] };
    }

    const rendered = buildRenderedTextElement(String(result), resolveRenderSpec(serverName, toolName, 'response'), 'mcp-tool-content');
    if (isError) rendered.classList.add('error-text');
    body.appendChild(rendered);
    return { headerEl: resultHeader, nodes: [rendered] };
  }

  function setToolArguments(entry: ToolRowEntry, args: ToolPayload | null | undefined, serverName: string, toolName: string): void {
    removeNodes(entry.argsEls);
    entry.argsEls = appendToolArguments(entry.body, args, serverName, toolName);
  }

  function setToolResult(entry: ToolRowEntry, result: unknown, isError: boolean, serverName: string, toolName: string): void {
    removeNode(entry.resultHeaderEl);
    removeNodes(entry.resultEls);
    entry.resultHeaderEl = null;
    entry.resultEls = [];
    const rendered = appendToolResult(entry.body, result, isError, serverName, toolName);
    entry.resultHeaderEl = rendered.headerEl;
    entry.resultEls = rendered.nodes;
  }

  function setToolFooter(entry: Pick<ToolRowEntry, 'body' | 'footerEl'>, durationMs: number | null | undefined): void {
    removeNode(entry.footerEl);
    entry.footerEl = null;
    if (durationMs === undefined || durationMs === null) return;
    const footer = document.createElement('div');
    footer.className = 'command-footer';
    footer.textContent = `${durationMs}ms`;
    entry.body.appendChild(footer);
    entry.footerEl = footer;
  }

  function buildReplayToolRow(entry: ToolEvent): HTMLElement {
    const row = document.createElement('div');
    row.className = 'timeline-row command-result mcp-tool-card';
    applyTranscriptCardMetadata(row, entry);
    const body = document.createElement('div');
    body.className = 'body';

    const header = document.createElement('div');
    header.className = 'command-ribbon';
    const toolName = entry.tool || 'tool';
    const serverName = entry.server || '';
    const filePath = resolveToolCardPath(toolName, entry);
    renderToolCardHeader(header, toolName, serverName, filePath, entry);
    body.appendChild(header);

    const request = asToolPayload(entry.request) ?? asToolPayload(entry.arguments);
    appendToolArguments(body, request, serverName, toolName);

    const diffText = resolveToolCardDiff(toolName, entry);
    if (diffText) {
      const preview = buildToolDiffPreview(diffText, filePath);
      if (preview) body.append(preview.label, preview.block);
    }

    if (typeof entry.output === 'string' && entry.output) {
      const outputPre = document.createElement('pre');
      outputPre.className = 'mcp-tool-content';
      outputPre.textContent = entry.output;
      if (entry.is_error === true && ((entry.response ?? entry.result) === undefined || (entry.response ?? entry.result) === null)) {
        outputPre.classList.add('error-text');
      }
      body.appendChild(outputPre);
    }

    appendToolResult(body, entry.response ?? entry.result, entry.is_error === true, serverName, toolName);
    setToolFooter({ body, footerEl: null }, readNumber(entry.duration_ms));
    const replayNote = getServerTruncationNote(entry);
    if (replayNote) {
      const noteEl = document.createElement('div');
      noteEl.className = 'truncation-note';
      noteEl.textContent = replayNote;
      body.appendChild(noteEl);
    }

    row.appendChild(body);
    makeCollapsible(row, `tool:${entry.id || entry.item_id || `${entry.server || ''}:${entry.tool || ''}`}`, false);
    return row;
  }

  function renderToolBegin(evt: ToolEvent): void {
    const toolName = evt.tool || 'tool';
    if (toolName === 'command' || toolName === 'shell') return;
    const serverName = evt.server || '';
    const filePath = resolveToolCardPath(toolName, evt);
    const label = toolCardLabel(toolName, serverName, filePath, evt);
    const entry = getToolRow(evt.id, label, getLiveEventParent(evt), evt);
    renderToolCardHeader(entry.header, toolName, serverName, filePath, evt);
    const request = asToolPayload(evt.request) ?? asToolPayload(evt.arguments) ?? asToolPayload(evt.payload) ?? {};
    setToolArguments(entry, request, serverName, toolName);
    ensureToolDiffPreview(entry, resolveToolCardDiff(toolName, evt), filePath);
    setLastEventType('tool');
  }

  function renderToolDelta(evt: ToolEvent): void {
    const toolName = evt.tool || 'tool';
    if (toolName === 'command' || toolName === 'shell') return;
    const entry = getToolRow(
      evt.id,
      toolCardLabel(toolName, evt.server || '', resolveToolCardPath(toolName, evt), evt),
      getLiveEventParent(evt),
      evt,
    );
    const delta = evt.delta || '';
    if (delta) {
      if (!entry.streamEl) {
        const streamPre = document.createElement('pre');
        streamPre.className = 'mcp-tool-content';
        entry.body.appendChild(streamPre);
        entry.streamEl = streamPre;
      }
      entry.streamEl.textContent = `${entry.streamEl.textContent || ''}${delta}`;
    }
    setLastEventType('tool');
    maybeAutoScroll();
  }

  function renderToolEnd(evt: ToolEvent): void {
    const toolName = evt.tool || 'tool';
    if (toolName === 'command' || toolName === 'shell') return;
    const serverName = evt.server || '';
    const filePath = resolveToolCardPath(toolName, evt);
    const label = toolCardLabel(toolName, serverName, filePath, evt);
    const entry = getToolRow(evt.id, label, getLiveEventParent(evt), evt);
    renderToolCardHeader(entry.header, toolName, serverName, filePath, evt);

    const request = asToolPayload(evt.request) ?? asToolPayload(evt.arguments) ?? asToolPayload(evt.payload) ?? {};
    if (!entry.argsEls.length && Object.keys(request).length > 0) {
      setToolArguments(entry, request, serverName, toolName);
    }
    const result = evt.response ?? evt.result ?? evt.payload ?? null;
    const resultRecord = asToolPayload(result);
    const durationMs = readNumber(evt.duration_ms)
      ?? readNumber(resultRecord?.duration_ms)
      ?? readNumber(resultRecord?.durationMs);
    const isError = evt.is_error === true || resultRecord?.isError === true || false;
    ensureToolDiffPreview(entry, resolveToolCardDiff(toolName, evt), filePath);
    setToolResult(entry, result, isError, serverName, toolName);
    setToolFooter(entry, durationMs);
    setToolTruncationNote(entry, getServerTruncationNote(evt));

    setLastEventType('tool');
    const exitCode = resultRecord?.exit_code ?? resultRecord?.exitCode;
    if (!isError && (exitCode === 0 || exitCode === undefined || exitCode === null)) {
      setStatusDot('success');
    } else {
      setStatusDot('error');
    }
  }

  function renderToolInteraction(evt: ToolEvent): void {
    const toolName = evt.tool || 'tool';
    const serverName = evt.server || '';
    const filePath = resolveToolCardPath(toolName, evt);
    const entry = getToolRow(evt.id, toolCardLabel(toolName, serverName, filePath, evt), getLiveEventParent(evt), evt);
    renderToolCardHeader(entry.header, toolName, serverName, filePath, evt);
    const payload = asToolPayload(evt.payload) ?? {};
    const stdin = payload.stdin ? `stdin: ${payload.stdin}` : '';
    const stdout = payload.stdout ? `stdout: ${payload.stdout}` : '';
    const pid = payload.pid ? `pid=${payload.pid}` : '';
    const parts = [pid, stdin, stdout].filter((value): value is string => Boolean(value));
    if (parts.length) {
      if (!entry.interactionEl) {
        const interactionPre = document.createElement('pre');
        interactionPre.className = 'mcp-tool-content';
        entry.body.appendChild(interactionPre);
        entry.interactionEl = interactionPre;
      }
      entry.interactionEl.textContent = `${entry.interactionEl.textContent || ''}[io] ${parts.join(' ')}\n`;
    }
    setLastEventType('tool');
  }

  return {
    buildReplayToolRow,
    renderToolBegin,
    renderToolDelta,
    renderToolEnd,
    renderToolInteraction,
  };
}
