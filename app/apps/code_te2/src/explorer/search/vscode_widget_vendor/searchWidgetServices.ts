import { ContextView } from '../../../../../../static/vendor/monaco-editor-core/esm/vs/base/browser/ui/contextview/contextview.js';
import { Emitter } from '../../../../../../static/vendor/monaco-editor-core/esm/vs/base/common/event.js';
import {
  Disposable,
  type IDisposable,
} from '../../../../../../static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';
import { ContextKeyService } from '../../../../../../static/vendor/monaco-editor-core/esm/vs/platform/contextkey/browser/contextKeyService.js';

export interface ExplorerSearchWidgetSearchConfiguration {
  globalFindClipboard: boolean;
  searchOnType: boolean;
  searchOnTypeDebouncePeriod: number;
  searchEditor: {
    defaultNumberOfContextLines: number;
  };
}

export interface ExplorerSearchWidgetContextViewProvider {
  showContextView(
    delegate: Parameters<ContextView['show']>[0],
  ): { close: () => void };
  hideContextView(data?: unknown): void;
  layout(): void;
  getContextViewElement(): HTMLElement;
}

export interface ExplorerSearchWidgetContextKeyService {
  createScoped(target: HTMLElement): { dispose(): void };
}

interface SearchWidgetConfigurationChangeEvent {
  affectsConfiguration(section: string): boolean;
}

class SearchWidgetConfigurationService {
  private readonly onDidChangeEmitter = new Emitter();

  readonly onDidChangeConfiguration =
    this.onDidChangeEmitter.event as (
      listener: (event: SearchWidgetConfigurationChangeEvent) => unknown,
    ) => { dispose(): void };

  constructor(
    private searchConfiguration: ExplorerSearchWidgetSearchConfiguration,
  ) {}

  getSearchConfiguration(): ExplorerSearchWidgetSearchConfiguration {
    return this.searchConfiguration;
  }

  getValue<T>(section?: string): T {
    if (!section || section === 'search') {
      return this.searchConfiguration as T;
    }
    return undefined as T;
  }

  updateSearchConfiguration(
    next: Partial<ExplorerSearchWidgetSearchConfiguration>,
  ): void {
    this.searchConfiguration = {
      ...this.searchConfiguration,
      ...next,
      searchEditor: {
        ...this.searchConfiguration.searchEditor,
        ...(next.searchEditor ?? {}),
      },
    };
    this.onDidChangeEmitter.fire({
      affectsConfiguration: (section: string) =>
        section === 'search' || section.startsWith('search.'),
    });
  }
}

interface ExplorerResolvedKeybinding {
  getElectronAccelerator(): string;
}

export interface ExplorerSearchWidgetKeybindingService {
  appendKeybinding(label: string, commandId: string): string;
  lookupKeybinding(commandId: string): ExplorerResolvedKeybinding | undefined;
}

class SearchWidgetKeybindingService
  implements ExplorerSearchWidgetKeybindingService
{
  appendKeybinding(label: string, _commandId: string): string {
    return label;
  }

  lookupKeybinding(
    commandId: string,
  ): ExplorerResolvedKeybinding | undefined {
    if (commandId === 'history.showPrevious') {
      return {
        getElectronAccelerator: () => 'Up',
      };
    }
    if (commandId === 'history.showNext') {
      return {
        getElectronAccelerator: () => 'Down',
      };
    }
    return undefined;
  }
}

class SearchWidgetClipboardService {
  private findText = '';

  async readFindText(): Promise<string> {
    return this.findText;
  }

  async writeFindText(text: string): Promise<void> {
    this.findText = text;
  }
}

class SearchWidgetAccessibilityService extends Disposable {
  private readonly onDidChangeEmitter = this._register(new Emitter());
  private screenReaderOptimized = false;

  readonly onDidChangeScreenReaderOptimized = this.onDidChangeEmitter.event;

  isScreenReaderOptimized(): boolean {
    return this.screenReaderOptimized;
  }

  setScreenReaderOptimized(next: boolean): void {
    if (this.screenReaderOptimized === next) {
      return;
    }
    this.screenReaderOptimized = next;
    this.onDidChangeEmitter.fire();
  }
}

class SearchWidgetContextViewProvider
  extends Disposable
  implements ExplorerSearchWidgetContextViewProvider
{
  private readonly contextView: ContextView;

  constructor(container: HTMLElement) {
    super();
    this.contextView = this._register(new ContextView(container, 1));
  }

  showContextView(
    delegate: Parameters<ContextView['show']>[0],
  ): { close: () => void } {
    this.contextView.show(delegate);
    return {
      close: () => this.contextView.hide(),
    };
  }

  hideContextView(data?: unknown): void {
    this.contextView.hide(data);
  }

  layout(): void {
    this.contextView.layout();
  }

  getContextViewElement(): HTMLElement {
    return this.contextView.getViewElement();
  }
}

export interface ExplorerSearchWidgetServices {
  configurationService: SearchWidgetConfigurationService;
  keybindingService: ExplorerSearchWidgetKeybindingService;
  clipboardService: SearchWidgetClipboardService;
  accessibilityService: SearchWidgetAccessibilityService;
  contextKeyService: ContextKeyService;
  contextViewProvider: SearchWidgetContextViewProvider;
}

export interface ExplorerSearchWidgetServiceOptions {
  searchConfiguration?: Partial<ExplorerSearchWidgetSearchConfiguration>;
}

const DEFAULT_SEARCH_CONFIGURATION: ExplorerSearchWidgetSearchConfiguration = {
  globalFindClipboard: false,
  searchOnType: true,
  searchOnTypeDebouncePeriod: 300,
  searchEditor: {
    defaultNumberOfContextLines: 1,
  },
};

export class ExplorerSearchWidgetServiceBundle
  extends Disposable
  implements ExplorerSearchWidgetServices
{
  readonly configurationService: SearchWidgetConfigurationService;
  readonly keybindingService: ExplorerSearchWidgetKeybindingService;
  readonly clipboardService: SearchWidgetClipboardService;
  readonly accessibilityService: SearchWidgetAccessibilityService;
  readonly contextKeyService: ContextKeyService;
  readonly contextViewProvider: SearchWidgetContextViewProvider;

  constructor(
    container: HTMLElement,
    options?: ExplorerSearchWidgetServiceOptions,
  ) {
    super();
    this.configurationService = new SearchWidgetConfigurationService({
      ...DEFAULT_SEARCH_CONFIGURATION,
      ...(options?.searchConfiguration ?? {}),
      searchEditor: {
        ...DEFAULT_SEARCH_CONFIGURATION.searchEditor,
        ...(options?.searchConfiguration?.searchEditor ?? {}),
      },
    });
    this.keybindingService = new SearchWidgetKeybindingService();
    this.clipboardService = new SearchWidgetClipboardService();
    this.accessibilityService = this._register(
      new SearchWidgetAccessibilityService(),
    );
    this.contextViewProvider = this._register(
      new SearchWidgetContextViewProvider(container),
    );
    this.contextKeyService = this._register(
      new ContextKeyService(this.configurationService as never),
    );
  }

  updateSearchConfiguration(
    next: Partial<ExplorerSearchWidgetSearchConfiguration>,
  ): void {
    this.configurationService.updateSearchConfiguration(next);
  }
}

export function createExplorerSearchWidgetServices(
  container: HTMLElement,
  options?: ExplorerSearchWidgetServiceOptions,
): ExplorerSearchWidgetServiceBundle {
  return new ExplorerSearchWidgetServiceBundle(container, options);
}

export type ExplorerSearchWidgetDisposable = IDisposable;
