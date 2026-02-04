export class Emitter {
  constructor() {
    this._listeners = new Set();
    this.event = (listener) => {
      this._listeners.add(listener);
      return { dispose: () => this._listeners.delete(listener) };
    };
  }

  fire(event) {
    for (const listener of Array.from(this._listeners)) {
      try {
        listener(event);
      } catch {
        // swallow (matches VS Code robustness)
      }
    }
  }

  dispose() {
    this._listeners.clear();
  }
}

export class BufferedEmitter {
  constructor() {
    this._emitter = new Emitter();
    this._buffered = [];
    this._hasListeners = false;
    this.event = (listener) => {
      this._hasListeners = true;
      const d = this._emitter.event(listener);
      // Flush buffered events in order
      while (this._buffered.length) this._emitter.fire(this._buffered.shift());
      return {
        dispose: () => {
          d.dispose();
          // We don't try to detect "no listeners" precisely; OK for our usage.
        },
      };
    };
  }

  fire(event) {
    if (this._hasListeners) this._emitter.fire(event);
    else this._buffered.push(event);
  }

  flushBuffer() {
    this._buffered = [];
  }

  dispose() {
    this._emitter.dispose();
    this._buffered = [];
  }
}

