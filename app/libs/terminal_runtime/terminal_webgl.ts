export interface TerminalWebglAddon {
  dispose(): void;
  onContextLoss(listener: () => void): { dispose(): void };
}
type Constructor = new () => TerminalWebglAddon;
declare global {
  interface Window { WebglAddon?: { WebglAddon: Constructor } }
}
let loading: Promise<Constructor> | undefined;

/** One script per frontend document, but one GPU renderer per xterm. */
export function loadTerminalWebgl(): Promise<Constructor> {
  if (window.WebglAddon?.WebglAddon) return Promise.resolve(window.WebglAddon.WebglAddon);
  return loading ??= new Promise<Constructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/xterm/xterm-addon-webgl.js';
    script.onload = () => {
      const ctor = window.WebglAddon?.WebglAddon;
      if (ctor) resolve(ctor); else reject(new Error('Missing xterm WebGL renderer'));
    };
    script.onerror = () => { script.remove(); reject(new Error('Could not load xterm WebGL renderer')); };
    document.head.append(script);
  }).catch((error: unknown) => { loading = undefined; throw error; });
}

/** Call after open(). Dispose this binding before disposing the terminal. */
export function attachTerminalWebgl(term: {loadAddon(addon: TerminalWebglAddon): void},
  Webgl: Constructor, onLoss: () => void): {dispose(): void} {
  const addon = new Webgl();
  term.loadAddon(addon);
  const listener = addon.onContextLoss(onLoss);
  return {dispose() { listener.dispose(); addon.dispose(); }};
}
