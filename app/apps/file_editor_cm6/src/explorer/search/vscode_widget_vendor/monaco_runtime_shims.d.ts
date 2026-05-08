declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/keyboardEvent.js' {
  export interface IKeyboardEvent {
    readonly keyCode: number;
    preventDefault(): void;
    stopPropagation(): void;
    equals(other: number): boolean;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/dom.js' {
  export interface IFocusTracker {
    onDidFocus(listener: () => void): { dispose(): void };
    onDidBlur(listener: () => void): { dispose(): void };
    dispose(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/contextview/contextview.js' {
  export interface IContextViewProvider {
    showContextView(
      delegate: unknown,
      container?: HTMLElement,
      shadowRoot?: ShadowRoot,
    ): { close(): void };
    hideContextView(data?: unknown): void;
    layout(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/button/button.js' {
  export interface IButtonOptions {
    [key: string]: unknown;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/findinput/findInput.js' {
  export interface IFindInputOptions {
    [key: string]: unknown;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js' {
  export interface IInputBoxStyles {
    [key: string]: unknown;
  }

  export interface IMessage {
    content: string;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/toggle/toggle.js' {
  export interface IToggleStyles {
    [key: string]: unknown;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/event.js' {
  export type Event<T = unknown> = (
    listener: (event: T) => unknown,
    thisArgs?: unknown,
    disposables?: unknown,
  ) => { dispose(): void };

  export class Emitter<T = unknown> {
    readonly event: Event<T>;
    fire(event: T): void;
    dispose(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/async.js' {
  export class Delayer<T = unknown> {
    constructor(defaultDelay: number);
    trigger(task: () => T | Promise<T>, delay?: number): Promise<T>;
    cancel(): void;
    dispose(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js' {
  export interface IDisposable {
    dispose(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js' {
  export interface IContextKey<T = unknown> {
    set(value: T): void;
    reset(): void;
    get(): T;
  }

  export interface IContextKeyService {
    createScoped(target: HTMLElement): { dispose(): void };
  }
}
