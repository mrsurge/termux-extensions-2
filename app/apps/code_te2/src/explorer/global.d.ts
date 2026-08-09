import type { ExplorerStickyScopesApi } from './chrome/sticky-scopes.ts';

export {};

interface ExplorerHostBridge {
  toast?: (message: string, ms?: number) => void;
}

interface ExplorerTeFilePickerPathChoice {
  path: string;
}

interface ExplorerTeFilePickerSaveChoice extends ExplorerTeFilePickerPathChoice {
  directory: string;
  name: string;
  existed?: boolean;
}

interface ExplorerTeFilePickerOpenDirectoryOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePickerOpenFileOptions {
  title: string;
  startPath?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePickerOpenOptions {
  title: string;
  startPath?: string;
  mode?: 'any' | 'file' | 'dir';
  selectLabel?: string;
}

interface ExplorerTeFilePickerSaveFileOptions {
  title: string;
  startPath?: string;
  filename?: string;
  selectLabel?: string;
}

interface ExplorerTeFilePicker {
  openDirectory(
    options: ExplorerTeFilePickerOpenDirectoryOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  open?(
    options: ExplorerTeFilePickerOpenOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  openFile?(
    options: ExplorerTeFilePickerOpenFileOptions,
  ): Promise<ExplorerTeFilePickerPathChoice | null>;
  saveFile(
    options: ExplorerTeFilePickerSaveFileOptions,
  ): Promise<ExplorerTeFilePickerSaveChoice | null>;
}

declare global {
  interface Window {
    host?: ExplorerHostBridge;
    __codeTe2EditorState?: unknown;
    __codeTe2ApplyAutosaveContent?: (payload: unknown) => void;
    __codeTe2ApplyRemoteDraft?: (payload: unknown) => void;
    __codeTe2EnsureDraftDiffs?: (force?: boolean) => Promise<void> | void;
    __codeTe2EnsureInlineDiffs?: (force?: boolean) => Promise<void> | void;
    __codeTe2HandlePrefsChanged?: (payload: unknown) => void;
    __codeTe2HandleProjectOpened?: (path: string, payload?: Record<string, unknown>) => void;
    __codeTe2HandleWatcherError?: (payload: Record<string, unknown>) => void;
    __codeTe2HandleWatcherRaiseResult?: (payload: Record<string, unknown>) => void;
    __codeTe2PendingPrefsChanged?: unknown;
    __codeTe2PendingWatcherError?: Record<string, unknown>;
    __codeTe2PendingWatcherRaiseResult?: Record<string, unknown>;
    __codeTe2ReloadCurrentFile?: () => void;
    __codeTe2RequestGitBaselines?: () => void;
    __explorerStickyScopes?: ExplorerStickyScopesApi | null;
    teFilePicker?: ExplorerTeFilePicker;
  }
}

declare module '/static/vendor/seti-icons/seti-icons.js' {
  interface SetiIconPayload {
    svg?: string;
    color?: string;
  }

  export function getIcon(fileName: string): Promise<SetiIconPayload | null>;
}

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

  export function trackFocus(element: HTMLElement): IFocusTracker;
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

  export class ContextView {
    constructor(container: HTMLElement, domPosition?: number);
    show(delegate: unknown): void;
    hide(data?: unknown): void;
    layout(): void;
    getViewElement(): HTMLElement;
    dispose(): void;
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

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js' {
  export interface IDisposable {
    dispose(): void;
  }

  export class Disposable implements IDisposable {
    protected readonly _store: { dispose(): void };
    protected _register<T extends IDisposable>(value: T): T;
    dispose(): void;
  }

  export class DisposableStore implements IDisposable {
    add<T extends IDisposable>(value: T): T;
    clear(): void;
    dispose(): void;
  }

  export class MutableDisposable<T extends IDisposable = IDisposable>
    implements IDisposable
  {
    value: T | undefined;
    clear(): void;
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

  export class RawContextKey<T = unknown> {
    constructor(key: string, defaultValue: T, meta?: unknown);
    bindTo(service: IContextKeyService): IContextKey<T>;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/widget.js' {
  import { Disposable } from '/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';

  export class Widget extends Disposable {
    onkeyup(
      domNode: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
      listener: (event: unknown) => void,
    ): void;
    onkeydown(
      domNode: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
      listener: (event: unknown) => void,
    ): void;
    oninput(
      domNode: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
      listener: (event: unknown) => void,
    ): void;
    onmousedown(
      domNode: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
      listener: (event: unknown) => void,
    ): void;
    ignoreGesture(target: HTMLElement): { dispose(): void };
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js' {
  export interface IInputBoxStyles {
    [key: string]: unknown;
  }

  export interface IMessage {
    content: string;
  }

  export class InputBox {
    readonly element: HTMLElement;
    readonly inputElement: HTMLInputElement | HTMLTextAreaElement;
    value: string;
    paddingRight: number;
    constructor(
      container: HTMLElement,
      contextViewProvider?: unknown,
      options?: Record<string, unknown>,
    );
    onDidChange(listener: (value: string) => void): { dispose(): void };
    onDidHeightChange(listener: () => void): { dispose(): void };
    focus(): void;
    blur(): void;
    hasFocus(): boolean;
    select(range?: { start: number; end: number } | null): void;
    layout(): void;
    enable(): void;
    disable(): void;
    insertAtCursor(text: string): void;
    dispose(): void;
  }

  export class HistoryInputBox extends InputBox {
    constructor(
      container: HTMLElement,
      contextViewProvider?: unknown,
      options?: Record<string, unknown>,
    );
    showNextValue(): void;
    showPreviousValue(): void;
    addToHistory(always?: boolean): void;
    getHistory(): string[];
    clearHistory(): void;
    prependHistory(history: string[]): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/toggle/toggle.js' {
  export interface IToggleStyles {
    [key: string]: unknown;
  }

  export class Toggle {
    readonly domNode: HTMLElement;
    checked: boolean;
    constructor(options: Record<string, unknown>);
    onChange(listener: (viaKeyboard: boolean) => void): { dispose(): void };
    width(): number;
    enable(): void;
    disable(): void;
    focus(): void;
    dispose(): void;
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/codicons.js' {
  export const Codicon: Record<string, unknown>;
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/common/history.js' {
  export class HistoryNavigator<T = string> {
    constructor(items?: Iterable<T>, limit?: number);
    add(value: T): void;
    getHistory(): T[];
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/nls.js' {
  export function localize(
    key: string,
    message: string,
    ...args: unknown[]
  ): string;
}

declare module '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/contextScopedHistoryWidget.js' {
  import { FindInput } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/findinput/findInput.js';
  import type { HistoryInputBox } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js';
  import type { IContextKeyService } from '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js';

  export function registerAndCreateHistoryNavigationContext(
    scopedContextKeyService: { dispose(): void },
    widget: HistoryInputBox,
  ): { dispose(): void };

  export class ContextScopedFindInput extends FindInput {
    readonly inputBox: HistoryInputBox;
    readonly regex?: { enable(): void; disable(): void };
    constructor(
      container: HTMLElement | null,
      contextViewProvider: unknown,
      options: Record<string, unknown>,
      contextKeyService: IContextKeyService,
    );
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/historyWidgetKeybindingHint.js' {
  export function showHistoryKeybindingHint(
    keybindingService: unknown,
  ): boolean;
}

declare module '/static/vendor/monaco-editor-core/esm/vs/platform/theme/browser/defaultStyles.js' {
  export const defaultToggleStyles: Record<string, unknown>;
  export const defaultInputBoxStyles: Record<string, unknown>;
}

declare module '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/browser/contextKeyService.js' {
  import { Disposable } from '/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';
  import type { IContextKeyService } from '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js';

  export class ContextKeyService
    extends Disposable
    implements IContextKeyService
  {
    constructor(configurationService?: unknown);
    createScoped(target: HTMLElement): { dispose(): void };
  }
}

declare module '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/findinput/findInput.js' {
  import { Widget } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/widget.js';
  import type { HistoryInputBox } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js';

  export interface IFindInputOptions {
    [key: string]: unknown;
  }

  export class FindInput extends Widget {
    readonly domNode: HTMLElement;
    readonly inputBox: HistoryInputBox;
    readonly regex?: {
      checked: boolean;
      enable(): void;
      disable(): void;
      focus(): void;
      width(): number;
    };
    readonly wholeWords?: { checked: boolean };
    readonly caseSensitive?: { checked: boolean; focus(): void };
    constructor(
      parent: HTMLElement | null,
      contextViewProvider: unknown,
      options: Record<string, unknown>,
    );
    onDidChange(listener: (value: string) => void): { dispose(): void };
    onDidOptionChange(
      listener: (viaKeyboard: boolean) => void,
    ): { dispose(): void };
    onKeyDown(listener: (event: unknown) => void): { dispose(): void };
    onCaseSensitiveKeyDown(
      listener: (event: unknown) => void,
    ): { dispose(): void };
    onRegexKeyDown(listener: (event: unknown) => void): { dispose(): void };
    setEnabled(enabled: boolean): void;
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    select(): void;
    setRegex(value: boolean): void;
    getRegex(): boolean;
    setCaseSensitive(value: boolean): void;
    getCaseSensitive(): boolean;
    setWholeWords(value: boolean): void;
    getWholeWords(): boolean;
    focusOnRegex(): void;
    focusOnCaseSensitive(): void;
    clearMessage(): void;
    validate(): void;
    setFocusInputOnOptionClick(value: boolean): void;
  }
}
