/**
 * Terminal Panel Module for Code-OSS IDE
 * Manages terminal sessions with framework shells and xterm.js
 */

import { Terminal } from '/static/vendor/xterm/xterm.js';
import { FitAddon } from '/static/vendor/xterm/xterm-addon-fit.js';
import { WebLinksAddon } from '/static/vendor/xterm/xterm-addon-web-links.js';

const TERMINAL_DEFAULTS = {
  cols: 80,
  rows: 24,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    selection: 'rgba(255, 255, 255, 0.3)',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  },
};

class TerminalSession {
  constructor(id, shellId, container, projectPath) {
    this.id = id;
    this.shellId = shellId;
    this.container = container;
    this.projectPath = projectPath;
    this.terminal = null;
    this.fitAddon = null;
    this.webLinksAddon = null;
    this.ws = null;
    this.connected = false;
    this.buffer = [];
  }

  async initialize() {
    // Create xterm.js instance
    this.terminal = new Terminal({
      ...TERMINAL_DEFAULTS,
      allowProposedApi: true,
    });

    // Add addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.webLinksAddon = new WebLinksAddon();
    this.terminal.loadAddon(this.webLinksAddon);

    // Open terminal in container
    this.terminal.open(this.container);
    this.fitAddon.fit();

    // Set up event handlers
    this.terminal.onData((data) => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Connect WebSocket
    await this.connect();
  }

  async connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/app/code_oss/ws/terminal/${this.id}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        console.log(`Terminal ${this.id} connected`);

        // Send resize info
        const { cols, rows } = this.terminal;
        this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));

        // Flush any buffered output
        while (this.buffer.length > 0) {
          const data = this.buffer.shift();
          this.terminal.write(data);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'output') {
            if (this.terminal) {
              this.terminal.write(message.data);
            } else {
              this.buffer.push(message.data);
            }
          } else if (message.type === 'exit') {
            this.handleExit(message.code);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error(`Terminal ${this.id} WebSocket error:`, error);
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log(`Terminal ${this.id} disconnected`);

        // Attempt reconnection after delay
        setTimeout(() => {
          if (!this.destroyed) {
            this.connect();
          }
        }, 2000);
      };
    } catch (error) {
      console.error(`Failed to connect terminal ${this.id}:`, error);
      this.connected = false;
    }
  }

  resize() {
    if (this.fitAddon) {
      this.fitAddon.fit();
      const { cols, rows } = this.terminal;

      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    }
  }

  focus() {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  handleExit(code) {
    if (this.terminal) {
      this.terminal.write(`\r\n\x1b[1;33mProcess exited with code ${code}\x1b[0m\r\n`);
    }
  }

  destroy() {
    this.destroyed = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    this.fitAddon = null;
    this.webLinksAddon = null;
    this.connected = false;
  }
}

class TerminalPanel {
  constructor(containerElement, projectPath) {
    this.container = containerElement;
    this.projectPath = projectPath;
    this.terminals = new Map();
    this.activeTerminalId = null;
    this.tabsContainer = null;
    this.contentContainer = null;
    this.resizeObserver = null;

    this.initialize();
  }

  initialize() {
    // Create panel structure
    this.container.innerHTML = `
      <header class="terminal-header">
        <div class="terminal-tabs-wrapper">
          <div class="terminal-tabs" id="terminal-tabs"></div>
          <button class="terminal-new-btn" id="terminal-new" title="New Terminal">
            <span>+</span>
          </button>
        </div>
        <div class="terminal-actions">
          <button class="terminal-action" id="terminal-clear" title="Clear Terminal">
            <span>⌫</span>
          </button>
          <button class="terminal-action" id="terminal-maximize" title="Maximize">
            <span>⤢</span>
          </button>
        </div>
      </header>
      <div class="terminal-content" id="terminal-content"></div>
    `;

    this.tabsContainer = this.container.querySelector('#terminal-tabs');
    this.contentContainer = this.container.querySelector('#terminal-content');

    // Set up event handlers
    this.setupEventHandlers();

    // Set up resize observer
    this.setupResizeObserver();

    // Load existing terminals
    this.loadTerminals();
  }

  setupEventHandlers() {
    // New terminal button
    const newBtn = this.container.querySelector('#terminal-new');
    newBtn.addEventListener('click', () => this.createTerminal());

    // Clear terminal button
    const clearBtn = this.container.querySelector('#terminal-clear');
    clearBtn.addEventListener('click', () => this.clearActiveTerminal());

    // Maximize button
    const maxBtn = this.container.querySelector('#terminal-maximize');
    maxBtn.addEventListener('click', () => this.toggleMaximize());

    // Tab clicks (delegated)
    this.tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.terminal-tab');
      if (tab) {
        const terminalId = tab.dataset.terminalId;

        if (e.target.classList.contains('terminal-tab-close')) {
          e.stopPropagation();
          this.closeTerminal(terminalId);
        } else {
          this.activateTerminal(terminalId);
        }
      }
    });
  }

  setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      // Resize active terminal when container size changes
      if (this.activeTerminalId) {
        const session = this.terminals.get(this.activeTerminalId);
        if (session) {
          session.resize();
        }
      }
    });

    this.resizeObserver.observe(this.contentContainer);
  }

  async loadTerminals() {
    try {
      const response = await fetch('/api/app/code_oss/terminals');
      const result = await response.json();

      if (result.ok && result.data) {
        for (const terminalInfo of result.data) {
          await this.attachTerminal(terminalInfo);
        }

        // Activate first terminal if any exist
        if (this.terminals.size > 0 && !this.activeTerminalId) {
          const firstId = this.terminals.keys().next().value;
          this.activateTerminal(firstId);
        }
      }
    } catch (error) {
      console.error('Failed to load terminals:', error);
    }
  }

  async createTerminal(title = null) {
    try {
      const response = await fetch('/api/app/code_oss/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: this.projectPath,
          title: title || `Terminal ${this.terminals.size + 1}`,
        }),
      });

      const result = await response.json();
      if (result.ok) {
        await this.attachTerminal(result.data);
        this.activateTerminal(result.data.id);
      } else {
        console.error('Failed to create terminal:', result.error);
      }
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }

  async attachTerminal(terminalInfo) {
    const { id, shell_id: shellId, title } = terminalInfo;

    // Create tab
    const tab = document.createElement('div');
    tab.className = 'terminal-tab';
    tab.dataset.terminalId = id;
    tab.innerHTML = `
      <span class="terminal-tab-title">${title}</span>
      <button class="terminal-tab-close" title="Close Terminal">×</button>
    `;
    this.tabsContainer.appendChild(tab);

    // Create content container
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-instance';
    terminalContainer.dataset.terminalId = id;
    terminalContainer.style.display = 'none';
    this.contentContainer.appendChild(terminalContainer);

    // Create terminal session
    const session = new TerminalSession(id, shellId, terminalContainer, this.projectPath);
    this.terminals.set(id, session);

    // Initialize terminal
    await session.initialize();
  }

  activateTerminal(terminalId) {
    // Deactivate current terminal
    if (this.activeTerminalId) {
      const currentTab = this.tabsContainer.querySelector(
        `.terminal-tab[data-terminal-id="${this.activeTerminalId}"]`
      );
      const currentContainer = this.contentContainer.querySelector(
        `.terminal-instance[data-terminal-id="${this.activeTerminalId}"]`
      );

      if (currentTab) currentTab.classList.remove('active');
      if (currentContainer) currentContainer.style.display = 'none';
    }

    // Activate new terminal
    const tab = this.tabsContainer.querySelector(
      `.terminal-tab[data-terminal-id="${terminalId}"]`
    );
    const container = this.contentContainer.querySelector(
      `.terminal-instance[data-terminal-id="${terminalId}"]`
    );
    const session = this.terminals.get(terminalId);

    if (tab && container && session) {
      tab.classList.add('active');
      container.style.display = 'block';
      this.activeTerminalId = terminalId;

      // Focus and resize
      setTimeout(() => {
        session.resize();
        session.focus();
      }, 0);
    }
  }

  async closeTerminal(terminalId) {
    const session = this.terminals.get(terminalId);
    if (!session) return;

    // Destroy terminal session
    session.destroy();
    this.terminals.delete(terminalId);

    // Remove UI elements
    const tab = this.tabsContainer.querySelector(
      `.terminal-tab[data-terminal-id="${terminalId}"]`
    );
    const container = this.contentContainer.querySelector(
      `.terminal-instance[data-terminal-id="${terminalId}"]`
    );

    if (tab) tab.remove();
    if (container) container.remove();

    // Destroy backend terminal
    try {
      await fetch(`/api/app/code_oss/terminals/${terminalId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error(`Failed to destroy terminal ${terminalId}:`, error);
    }

    // Activate another terminal if this was active
    if (this.activeTerminalId === terminalId) {
      this.activeTerminalId = null;

      if (this.terminals.size > 0) {
        const nextId = this.terminals.keys().next().value;
        this.activateTerminal(nextId);
      }
    }
  }

  clearActiveTerminal() {
    if (this.activeTerminalId) {
      const session = this.terminals.get(this.activeTerminalId);
      if (session && session.terminal) {
        session.terminal.clear();
      }
    }
  }

  toggleMaximize() {
    this.container.classList.toggle('terminal-maximized');

    // Resize active terminal after animation
    setTimeout(() => {
      if (this.activeTerminalId) {
        const session = this.terminals.get(this.activeTerminalId);
        if (session) {
          session.resize();
        }
      }
    }, 300);
  }

  destroy() {
    // Clean up all terminals
    for (const session of this.terminals.values()) {
      session.destroy();
    }
    this.terminals.clear();

    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear container
    this.container.innerHTML = '';
  }
}

export { TerminalPanel };
