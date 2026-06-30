import {
  defaultInputBoxStyles,
  defaultToggleStyles,
} from '../../../../../static/vendor/monaco-editor-core/esm/vs/platform/theme/browser/defaultStyles.js';
import { SearchFindInput } from './vscode_widget_vendor/searchFindInput.ts';
import {
  ExcludePatternInputWidget,
  PatternInputWidget,
} from './vscode_widget_vendor/patternInputWidget.ts';
import { createExplorerSearchWidgetServices } from './vscode_widget_vendor/searchWidgetServices.ts';
import type { ExplorerContentSearchOptions } from './types.ts';

interface ExplorerContentQueryWidgetDeps {
  onOptionsChanged(options: ExplorerContentQueryWidgetState): void;
  onEscape(): void;
}

export interface ExplorerContentQueryWidgetState extends ExplorerContentSearchOptions {
  query: string;
}

const DEFAULT_CONTENT_QUERY_STATE: ExplorerContentQueryWidgetState = {
  query: '',
  isRegex: false,
  isCaseSensitive: false,
  isWholeWords: false,
  includePattern: '',
  excludePattern: '',
  useIgnoreFiles: true,
};

const MIN_PATTERN_INPUT_WIDTH = 180;

interface KeyEventLike {
  key?: string;
}

function isKeyEventLike(value: unknown): value is KeyEventLike {
  return value !== null && typeof value === 'object';
}

export function createExplorerContentQueryWidget(
  host: HTMLElement,
  deps: ExplorerContentQueryWidgetDeps,
) {
  const root = document.createElement('div');
  root.className = 'fe-search-content-widget search-view';

  const widgetsContainer = document.createElement('div');
  widgetsContainer.className = 'search-widgets-container';
  root.appendChild(widgetsContainer);

  const searchWidget = document.createElement('div');
  searchWidget.className = 'search-widget';
  widgetsContainer.appendChild(searchWidget);

  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container input-box';
  searchWidget.appendChild(searchContainer);

  const queryDetails = document.createElement('div');
  queryDetails.className = 'query-details more';
  searchWidget.appendChild(queryDetails);

  const includeHeading = document.createElement('h4');
  includeHeading.textContent = 'files to include';
  queryDetails.appendChild(includeHeading);

  const includeRow = document.createElement('div');
  includeRow.className = 'file-types fe-search-pattern-row';
  queryDetails.appendChild(includeRow);

  const excludeHeading = document.createElement('h4');
  excludeHeading.textContent = 'files to exclude';
  queryDetails.appendChild(excludeHeading);

  const excludeRow = document.createElement('div');
  excludeRow.className = 'file-types fe-search-pattern-row';
  queryDetails.appendChild(excludeRow);

  host.appendChild(root);

  const services = createExplorerSearchWidgetServices(root);
  const searchInput = new SearchFindInput(
    searchContainer,
    services.contextViewProvider,
    {
      label: 'Search',
      placeholder: 'Search in files',
      appendCaseSensitiveLabel: '',
      appendWholeWordsLabel: '',
      appendRegexLabel: '',
      history: new Set<string>(),
      showHistoryHint: () => true,
      flexibleHeight: true,
      flexibleMaxHeight: 134,
      showCommonFindToggles: true,
      inputBoxStyles: defaultInputBoxStyles,
      toggleStyles: defaultToggleStyles,
    },
    services.contextKeyService,
  );

  const includeInput = new PatternInputWidget(
    includeRow,
    services.contextViewProvider,
    {
      ariaLabel: 'Files to include',
      placeholder: 'e.g. src/**/*.ts,*.py',
      inputBoxStyles: defaultInputBoxStyles,
      width: 320,
    },
    services.contextKeyService,
    services.keybindingService,
  );

  const excludeInput = new ExcludePatternInputWidget(
    excludeRow,
    services.contextViewProvider,
    {
      ariaLabel: 'Files to exclude',
      placeholder: 'e.g. node_modules,dist',
      inputBoxStyles: defaultInputBoxStyles,
      width: 320,
    },
    services.contextKeyService,
    services.keybindingService,
  );

  let isSyncing = false;
  let state: ExplorerContentQueryWidgetState = {
    ...DEFAULT_CONTENT_QUERY_STATE,
  };

  const resizePatternInputs = (): void => {
    const width = Math.floor(
      Math.max(
        includeRow.clientWidth,
        excludeRow.clientWidth,
        queryDetails.clientWidth,
        root.clientWidth,
      ),
    );
    if (width < MIN_PATTERN_INPUT_WIDTH) {
      return;
    }
    includeInput.setWidth(width);
    excludeInput.setWidth(width);
  };

  const schedulePatternInputResize = (): void => {
    window.requestAnimationFrame(() => {
      if (!root.isConnected) {
        return;
      }
      resizePatternInputs();
    });
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          resizePatternInputs();
        });
  resizeObserver?.observe(root);
  resizeObserver?.observe(queryDetails);

  const emitOptionsChanged = (): void => {
    if (isSyncing) {
      return;
    }
    state = {
      query: searchInput.getValue(),
      isRegex: searchInput.getRegex(),
      isCaseSensitive: searchInput.getCaseSensitive(),
      isWholeWords: searchInput.getWholeWords(),
      includePattern: includeInput.getValue(),
      excludePattern: excludeInput.getValue(),
      useIgnoreFiles: excludeInput.useExcludesAndIgnoreFiles(),
    };
    deps.onOptionsChanged({ ...state });
  };

  const maybeHandleEscape = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      deps.onEscape();
    }
  };

  searchInput.inputBox.inputElement.addEventListener(
    'keydown',
    maybeHandleEscape,
  );
  includeInput.getInputElement().addEventListener('keydown', maybeHandleEscape);
  excludeInput.getInputElement().addEventListener('keydown', maybeHandleEscape);

  searchInput.onDidChange(() => emitOptionsChanged());
  searchInput.onDidOptionChange(() => emitOptionsChanged());
  searchInput.onKeyDown((event: unknown) => {
    if (isKeyEventLike(event) && event.key === 'Escape') {
      deps.onEscape();
    }
  });
  includeInput.onSubmit(() => emitOptionsChanged());
  excludeInput.onSubmit(() => emitOptionsChanged());
  excludeInput.onChangeIgnoreBox(() => emitOptionsChanged());

  return {
    dispose(): void {
      resizeObserver?.disconnect();
      searchInput.dispose();
      includeInput.dispose();
      excludeInput.dispose();
      services.dispose();
      root.remove();
    },
    focus(): void {
      searchInput.focus();
      searchInput.select();
    },
    setVisible(visible: boolean): void {
      root.style.display = visible ? 'block' : 'none';
      if (visible) {
        schedulePatternInputResize();
      }
    },
    setState(next: ExplorerContentQueryWidgetState): void {
      isSyncing = true;
      try {
        state = { ...next };
        if (searchInput.getValue() !== next.query) {
          searchInput.setValue(next.query);
        }
        if (searchInput.getRegex() !== next.isRegex) {
          searchInput.setRegex(next.isRegex);
        }
        if (searchInput.getCaseSensitive() !== next.isCaseSensitive) {
          searchInput.setCaseSensitive(next.isCaseSensitive);
        }
        if (searchInput.getWholeWords() !== next.isWholeWords) {
          searchInput.setWholeWords(next.isWholeWords);
        }
        if (includeInput.getValue() !== next.includePattern) {
          includeInput.setValue(next.includePattern);
        }
        if (excludeInput.getValue() !== next.excludePattern) {
          excludeInput.setValue(next.excludePattern);
        }
        if (excludeInput.useExcludesAndIgnoreFiles() !== next.useIgnoreFiles) {
          excludeInput.setUseExcludesAndIgnoreFiles(next.useIgnoreFiles);
        }
      } finally {
        isSyncing = false;
      }
      schedulePatternInputResize();
    },
    getState(): ExplorerContentQueryWidgetState {
      return { ...state };
    },
  };
}
