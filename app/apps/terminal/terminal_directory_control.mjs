// Opt-in shell-control proof. Ordinary Terminal sessions never construct this.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export class DirectoryControl {
  constructor(root, emit) {
    if (!root) throw new Error('directory control requires an explicit private root');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = fs.mkdtempSync(path.join(root, 'shell-control-'));
    this.nonce = randomBytes(24).toString('hex');
    this.emit = emit;
    this.state = 'starting';
    this.dirty = false;
    this.pending = null;
    this.held = [];
    this.heldBytes = 0;
    this.closed = false;
    this.serial = 0;
    this.inputSerial = 0;
    this.submittedSerial = 0;
    this.timer = null;
    this.writeRequest('', 'cancel', '');
  }

  shell() {
    return ['bash', '--init-file', fileURLToPath(new URL('./shellspec/directory_control.bash', import.meta.url)), '-i'];
  }

  environment() {
    return { TERMINAL_DIRECTORY_ROOT: this.root, TERMINAL_DIRECTORY_NONCE: this.nonce };
  }

  bind(pty, terminal) {
    this.pty = pty;
    this.registration = terminal.parser.registerOscHandler(777, data => {
      const prefix = `te2-control;${this.nonce};`;
      if (!data.startsWith(prefix)) return false;
      const serial = data.slice(prefix.length);
      if (!/^[0-9]+-[0-9]+$/.test(serial)) return true;
      const file = path.join(this.root, `event-${serial}`);
      const bytes = fs.readFileSync(file);
      fs.unlinkSync(file);
      if (bytes.length > 8192) throw new Error('oversized shell-control event');
      const fields = bytes.toString('utf8').split('\0');
      const [kind, token, value, cwd] = fields;
      if (kind === 'state') {
        this.state = value;
        // A delayed prompt event must not erase a newer partial-input fact.
        if (value === 'idle' && this.inputSerial === this.submittedSerial) this.dirty = false;
        void this.emit({ type: 'shell.state', state: value, cwd });
        if (value === 'idle' && this.pending?.refreshing) {
          const request = this.pending;
          clearTimeout(this.timer);
          this.timer = null;
          this.pending = null;
          void this.emit({ type: 'directory.result', request_id: request.id, state: request.resultState, cwd });
          this.flushInput();
        }
      } else if (kind === 'result' && this.pending?.token === token) {
        const request = this.pending;
        if (value === 'deferred') {
          clearTimeout(this.timer);
          this.timer = null;
          request.wake = false;
          this.state = 'busy';
          this.writeRequest(token, 'prompt', request.path);
          this.flushInput();
          return true;
        }
        if (!request.refreshing) {
          // The shell has rechecked clean-idle ownership and applied the trap.
          // Readline caches the old expanded prompt. An empty accepted line
          // regenerates it through normal PROMPT_COMMAND/PS1 (including Starship),
          // not manual ANSI rendering. Held user input cannot overtake this.
          request.refreshing = true;
          request.resultState = value;
          if (request.wake) {
            this.state = 'refreshing';
            this.pty.write('\r');
          }
          return true;
        }
        clearTimeout(this.timer);
        this.timer = null;
        this.pending = null;
        void this.emit({ type: 'directory.result', request_id: request.id, state: value, cwd });
        this.flushInput();
      }
      return true;
    });
  }

  writeRequest(token, mode, cwd) {
    const stage = path.join(this.root, 'request-new');
    fs.writeFileSync(stage, `${token}\n${mode}\n${cwd}\0`, { mode: 0o600 });
    fs.renameSync(stage, path.join(this.root, 'request'));
  }

  async request(message) {
    if (this.closed || this.state === 'unsupported') throw new Error('shell directory control unavailable');
    if (typeof message.request_id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(message.request_id)
      || typeof message.path !== 'string' || !path.isAbsolute(message.path)
      || message.path.includes('\0') || Buffer.byteLength(message.path) > 4096) {
      throw new Error('invalid directory request');
    }
    if (this.pending) {
      await this.emit({ type: 'directory.result', request_id: this.pending.id, state: 'superseded' });
    }
    clearTimeout(this.timer);
    const wake = this.state === 'idle' && !this.dirty;
    const token = `${++this.serial}-${this.nonce}`;
    this.pending = { id: message.request_id, token, wake, path: message.path };
    this.writeRequest(token, wake ? 'wake' : 'prompt', message.path);
    await this.emit({ type: 'directory.result', request_id: message.request_id, state: 'pending' });
    if (wake) {
      // No terminal-input bytes: Bash's WINCH trap rechecks its own execution
      // state. Hold later input until the result so it cannot overtake this cd.
      process.kill(this.pty.pid, 'SIGWINCH');
      this.timer = setTimeout(() => {
        if (!this.pending || this.pending.token !== token) return;
        this.writeRequest('', 'cancel', '');
        this.pending = null;
        void this.emit({ type: 'directory.result', request_id: message.request_id, state: 'timeout' });
        this.flushInput();
      }, 2000);
    }
  }

  input(data) {
    if (this.pending?.wake) {
      const bytes = Buffer.byteLength(data);
      if (this.heldBytes + bytes > 65536) throw new Error('shell-control input queue full');
      this.held.push(data);
      this.heldBytes += bytes;
      return;
    }
    // Conservative: any input makes the prompt dirty until a fresh shell-owned
    // idle event. Escape/editing sequences aren't guessed into a line model.
    this.dirty = true;
    this.inputSerial += 1;
    if (data.endsWith('\n') || data.endsWith('\r')) this.submittedSerial = this.inputSerial;
    this.pty.write(data);
  }

  snapshot() {
    return this.pending ? { state: 'pending', path: this.pending.path }
      : { state: this.state === 'unsupported' ? 'unavailable' : this.state === 'starting' ? 'starting' : 'ready', path: '' };
  }

  async cancel() {
    const pending = this.pending;
    this.pending = null;
    clearTimeout(this.timer);
    this.timer = null;
    this.writeRequest('', 'cancel', '');
    if (pending) await this.emit({ type: 'directory.result', request_id: pending.id, state: 'cancelled' });
    this.flushInput();
  }

  flushInput() {
    const held = this.held;
    this.held = [];
    this.heldBytes = 0;
    for (const data of held) this.input(data);
  }

  dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    this.registration?.dispose();
    this.held = [];
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
