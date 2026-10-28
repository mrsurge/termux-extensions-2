import type { TranscriptCardMetadata } from '../transcript_card_metadata.ts';

export interface CompactSubagentSnapshot extends TranscriptCardMetadata {
  compact?: unknown;
  name?: unknown;
  text?: unknown;
  status?: unknown;
  agent_path?: unknown;
  activity?: unknown;
}

/** Active child turns stay after ordinary transcript rows, without sticky chrome. */
export function keepRunningSubagentsAtTail(timeline: HTMLElement, bottomSpacer?: HTMLElement | null): void {
  const rows = Array.from(timeline.children).filter((row): row is HTMLElement =>
    row instanceof HTMLElement && row.dataset.subagentActive === 'true');
  let before: ChildNode | null = bottomSpacer?.parentElement === timeline ? bottomSpacer : null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.nextSibling !== before) timeline.insertBefore(row, before);
    before = row;
  }
}

/** Same snapshot renderer for live upserts and persisted transcript recipes. */
export function applyCompactSubagent(row: HTMLElement, snapshot: CompactSubagentSnapshot): void {
  row.classList.add('subagent-compact');
  const document = row.ownerDocument;
  const header = row.querySelector(':scope > .subagent-header');
  const body = row.querySelector(':scope > .subagent-body');
  if (!header || !body) return;
  const name = typeof snapshot.name === 'string' ? snapshot.name : 'subagent';
  const text = typeof snapshot.text === 'string' ? snapshot.text : '';
  const status = typeof snapshot.status === 'string' ? snapshot.status : 'running';
  const activity = typeof snapshot.activity === 'string' ? snapshot.activity : 'Agent running';
  row.dataset.subagentActive = String(status === 'running');
  let label = header.querySelector('.subagent-name');
  if (!label) {
    label = header.querySelector('span:first-child') || document.createElement('span');
    label.classList.add('subagent-name');
    if (!label.parentNode) header.prepend(label);
  }
  label.textContent = name;
  if (typeof snapshot.agent_path === 'string') label.setAttribute('title', snapshot.agent_path);
  let preview = header.querySelector('.subagent-preview');
  if (!preview) {
    preview = document.createElement('span');
    preview.className = 'subagent-preview';
    label.after(preview);
  }
  preview.textContent = (text || activity).replace(/\s+/g, ' ').trim().slice(0, 160);
  const statusEl = header.querySelector('.subagent-status');
  if (statusEl) statusEl.textContent = status;
  row.dataset.subagentStatus = status;
  let content = body.querySelector('.subagent-latest-message');
  if (!content) {
    content = document.createElement('div');
    content.className = 'subagent-latest-message';
    content.setAttribute('tabindex', '0');
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', 'Latest sub-agent message');
    body.replaceChildren(content);
  }
  const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 24;
  content.textContent = text || (status === 'running' ? activity : 'No activity content reported.');
  if (atBottom) content.scrollTop = content.scrollHeight;
  const parent = row.parentElement;
  if (parent) {
    const spacer = parent.querySelector<HTMLElement>(':scope > .timeline-spacer:last-child');
    keepRunningSubagentsAtTail(parent, spacer);
  }
}
