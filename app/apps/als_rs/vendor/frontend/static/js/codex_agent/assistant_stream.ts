// Assistant streaming row helpers extracted from static/codex_agent.js

import {
  applyTranscriptCardMetadata,
  type TranscriptCardMetadata,
} from './transcript_card_metadata.ts';

interface AssistantRowEntry {
  row: HTMLElement;
  container: HTMLElement;
  parser?: unknown;
  pre?: HTMLPreElement;
  useMarkdown: boolean;
  counted: boolean;
  rawText: string;
}

interface AssistantStreamContext {
  assistantRows: Map<string, AssistantRowEntry>;
  buildMessageCard(role: string, initialText: string): { row: HTMLElement; body: HTMLElement };
  updateMessageCardHeader(row: HTMLElement, role: string, text: string): void;
  insertRow(row: HTMLElement): void;
  isMarkdownEnabled(): boolean;
  createStreamingParser(target: HTMLElement): unknown;
  renderEventMarkdownInto(target: HTMLElement, markdown: string): void;
  streamWrite(parser: unknown, chunk: string): void;
  streamEnd(parser: unknown): void;
  highlightCode(target: HTMLElement): void;
  incrementMessages(): void;
  stripCitations(text: string): string;
  maybeAutoScroll(): void;
  onMessageStreaming?(row: HTMLElement): void;
  onMessageFinalized?(row: HTMLElement, text: string): void;
}

interface AssistantStreamBinding {
  getAssistantRow(
    id?: string | null,
    parentEl?: HTMLElement | null,
    metadata?: TranscriptCardMetadata | null,
  ): AssistantRowEntry;
  appendAssistantDelta(
    id: string | null | undefined,
    delta: string,
    parentEl?: HTMLElement | null,
    metadata?: TranscriptCardMetadata | null,
  ): void;
  finalizeAssistant(
    id: string | null | undefined,
    text: string,
    parentEl?: HTMLElement | null,
    metadata?: TranscriptCardMetadata | null,
  ): void;
}

export function bindAssistantStream(ctx: AssistantStreamContext): AssistantStreamBinding {
  const {
    assistantRows,
    buildMessageCard,
    updateMessageCardHeader,
    insertRow,
    isMarkdownEnabled,
    createStreamingParser,
    renderEventMarkdownInto,
    streamWrite,
    streamEnd,
    highlightCode,
    incrementMessages,
    stripCitations,
    maybeAutoScroll,
    onMessageStreaming,
    onMessageFinalized,
  } = ctx;

  function getAssistantRow(
    id?: string | null,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ): AssistantRowEntry {
    const key = id || 'assistant';
    let entry = assistantRows.get(key);
    if (!entry) {
      const { row, body } = buildMessageCard('assistant', '');
      applyTranscriptCardMetadata(row, metadata);
      // If parentEl provided (subagent body), insert there instead of main timeline
      if (parentEl) {
        parentEl.appendChild(row);
      } else {
        insertRow(row);
      }
      const container = document.createElement('div');
      container.className = 'markdown-body';
      body.append(container);
      if (isMarkdownEnabled()) {
        // Create streaming markdown parser with default renderer
        const parser = createStreamingParser(container);
        entry = { row, container, parser, useMarkdown: true, counted: false, rawText: '' };
      } else {
        // Plain text mode - use pre element
        const pre = document.createElement('pre');
        container.append(pre);
        entry = { row, container, pre, useMarkdown: false, counted: false, rawText: '' };
      }
      assistantRows.set(key, entry);
      onMessageStreaming?.(row);
    } else {
      applyTranscriptCardMetadata(entry.row, metadata);
    }
    return entry;
  }

  function appendAssistantDelta(
    id: string | null | undefined,
    delta: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ): void {
    if (!delta) return;
    const entry = getAssistantRow(id, parentEl, metadata);
    const cleanDelta = stripCitations(delta);
    entry.rawText = `${entry.rawText || ''}${cleanDelta}`;
    updateMessageCardHeader(entry.row, 'assistant', entry.rawText);
    if (entry.useMarkdown && entry.parser) {
      streamWrite(entry.parser, cleanDelta);
    } else if (entry.pre) {
      entry.pre.textContent += cleanDelta;
    }
    maybeAutoScroll();
  }

  function finalizeAssistant(
    id: string | null | undefined,
    text: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ): void {
    const key = id || 'assistant';
    let entry = assistantRows.get(key);
    if (!entry) {
      // No prior delta created this row (e.g. SDK sends ASSISTANT_MESSAGE complete, not deltas)
      // Create the row now and feed the full text through the streaming parser
      entry = getAssistantRow(id, parentEl, metadata);
      if (text) appendAssistantDelta(id, text, parentEl, metadata);
    } else {
      applyTranscriptCardMetadata(entry.row, metadata);
    }
    const finalText = stripCitations(text || entry.rawText || '');
    entry.rawText = finalText;
    updateMessageCardHeader(entry.row, 'assistant', finalText);
    if (entry.useMarkdown && entry.parser) {
      // End the streaming parser
      streamEnd(entry.parser);
      renderEventMarkdownInto(entry.container, finalText);
    } else if (entry.pre && finalText) {
      entry.pre.textContent = finalText;
    }
    if (!entry.counted) {
      incrementMessages();
      entry.counted = true;
    }
    onMessageFinalized?.(entry.row, finalText);
  }

  return { getAssistantRow, appendAssistantDelta, finalizeAssistant };
}
