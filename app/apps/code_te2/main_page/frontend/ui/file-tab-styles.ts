/** Shared tab chrome for main-page and reduced secondary editor shells. */
export const FILE_TAB_STYLES = `
  .fe-file-tabs {
    display: block;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--card, #0b0f1a);
    border-bottom: 1px solid var(--border, #333);
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;
    overscroll-behavior-x: contain;
    z-index: 30;
  }
  .fe-file-tabs::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  .fe-file-tabs.is-reordering {
    overflow-x: hidden;
    touch-action: none;
  }
  .fe-file-tabs-track {
    display: flex;
    align-items: stretch;
    width: max-content;
    min-width: 100%;
    height: 36px;
  }
  .fe-file-tabs-empty {
    display: flex;
    align-items: center;
    padding: 0 12px;
    color: var(--muted-foreground, #9ca3af);
    font-size: calc(0.78rem * var(--chrome-font-scale));
  }
  .fe-file-tab {
    position: relative;
    display: grid;
    grid-template-columns: 18px minmax(46px, 1fr) auto 30px;
    align-items: stretch;
    min-width: 108px;
    max-width: 210px;
    height: 36px;
    color: var(--foreground, #e5e7eb);
    background: var(--explorer-card-bg, #111827);
    border: 1px solid var(--explorer-card-border, #30363d);
    border-top: 0;
    border-radius: 0;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .fe-file-tab + .fe-file-tab { border-left: 0; }
  .fe-file-tab:hover { background: rgba(255, 255, 255, 0.06); }
  .fe-file-tab.active {
    box-shadow: inset 0 -2px 0 var(--explorer-active-file-accent, #60a5fa);
    background: rgba(59, 130, 246, 0.12);
  }
  .fe-file-tab.is-reordering {
    opacity: 0.78;
    z-index: 2;
    cursor: grabbing;
  }
  .fe-file-tab--missing {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .fe-file-tab-icon {
    align-self: center;
    justify-self: center;
    width: 16px;
    height: 16px;
    line-height: 16px;
    overflow: hidden;
  }
  .fe-file-tab-icon svg {
    display: block;
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  .fe-file-tab-label {
    align-self: center;
    min-width: 0;
    overflow: hidden;
    padding: 0 5px;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: calc(0.78rem * var(--chrome-font-scale));
  }
  .fe-file-tab-diagnostic {
    align-self: center;
    font-size: 0.52rem;
    line-height: 1;
    pointer-events: none;
  }
  .fe-file-tab-close {
    align-self: stretch;
    width: 30px;
    height: 100%;
    padding: 0;
    border: 0;
    border-left: 1px solid rgba(255,255,255,0.08);
    border-radius: 0;
    color: inherit;
    background: transparent;
    cursor: pointer;
  }
  .fe-file-tab-close:hover { background: rgba(239, 68, 68, 0.22); color: #fecaca; }
  .fe-file-tab.fe-draft .fe-file-tab-label::before {
    content: "*";
    margin-right: 3px;
    color: #ef4444;
    font-weight: 700;
    pointer-events: none;
  }
  .fe-file-tab.fe-git-modified { border-left: 3px solid #f97316; background: rgba(155, 90, 22, 0.75); }
  .fe-file-tab.fe-git-staged,
  .fe-file-tab.fe-git-added { border-left: 3px solid #34d399; background: rgba(32, 111, 82, 0.7); }
  .fe-file-tab.fe-git-staged_modified { border-left: 3px solid #22d3ee; background: rgba(249, 115, 22, 0.15); }
  .fe-file-tab.fe-git-deleted { border-left: 3px solid #f87171; }
  .fe-file-tab.fe-git-renamed { border-left: 3px solid #facc15; }
  .fe-file-tab.fe-git-untracked { border-left: 3px solid #00aaff; background: rgb(19, 61, 128); }
  .fe-file-tab.fe-git-ignored { border-left: 3px solid #6b7280; }
  .fe-file-tab.fe-git-conflict { border-left: 3px solid #ef4444; }
  .fe-file-tab-context-menu {
    position: fixed;
    z-index: 420;
    min-width: 210px;
    padding: 4px;
    border: 1px solid var(--explorer-card-border, #30363d);
    border-radius: 4px;
    background: var(--explorer-card-bg, #161b22);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .fe-file-tab-context-menu button {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 2px;
    color: inherit;
    background: transparent;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .fe-file-tab-context-menu button:hover,
  .fe-file-tab-context-menu button:focus-visible {
    background: var(--accent, #1f6feb);
    outline: 0;
  }
`;

export function installFileTabStyles(doc: Document = document): void {
  if (doc.getElementById('te2-file-tab-styles')) return;
  const style = doc.createElement('style');
  style.id = 'te2-file-tab-styles';
  style.textContent = FILE_TAB_STYLES;
  doc.head.append(style);
}
