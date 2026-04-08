declare module 'hterm/public.js' {
  export interface HtermModuleLike {
    Terminal: new (config?: unknown) => HtermTerminalLike;
  }

  export interface HtermSize {
    width: number;
    height: number;
  }

  export interface HtermScrollPortLike {
    characterSize: HtermSize;
    pasteTarget_?: HTMLTextAreaElement | null;
    getDocument(): Document;
    getScreenNode(): HTMLElement;
    getScreenSize(): HtermSize;
    scheduleRedraw(): void;
  }

  export interface HtermScreenLike {
    expandSelection(selection: Selection | null): void;
  }

  export interface HtermIoLike {
    onVTKeystroke: (data: string) => void;
    sendString: (data: string) => void;
    onTerminalResize: (width: number, height: number) => void;
  }

  export interface HtermTerminalLike {
    io: HtermIoLike;
    scrollPort_: HtermScrollPortLike;
    screen_?: HtermScreenLike;
    screenSize: HtermSize;
    decorate(container: HTMLElement): void;
    focus(): void;
    interpret(data: string): void;
    installKeyboard(): void;
    uninstallKeyboard(): void;
    setSelectionEnabled(state: boolean): void;
    setFontSize(px: number): void;
    getFontSize(): number;
    setFontFamily(family: string): void;
    setCursorBlink(state: boolean): void;
    setCursorColor(color: string): void;
    setBackgroundColor(color: string): void;
    setWidth(cols: number | null): void;
    setHeight(rows: number | null): void;
  }

  const hterm: HtermModuleLike;

  export default hterm;
}
