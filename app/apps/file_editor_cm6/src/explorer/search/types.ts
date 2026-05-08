export type ExplorerSearchMode =
  | 'name'
  | 'content'
  | 'changes'
  | 'review'
  | 'diagnostics';

export interface ExplorerSearchOverlayState {
  searchMode: ExplorerSearchMode;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: unknown;
}

export interface ExplorerNameSearchItem {
  type?: string;
  rel?: string;
}

export interface ExplorerNameSearchResults {
  results?: ExplorerNameSearchItem[];
  truncated?: boolean;
  count?: number;
}

export interface ExplorerContentSearchMatch {
  line?: number;
  column?: number;
  text?: string;
  snippet?: string;
}

export interface ExplorerContentSearchFileResult {
  rel?: string;
  matches?: ExplorerContentSearchMatch[];
}

export interface ExplorerContentSearchResults {
  results?: ExplorerContentSearchFileResult[];
  truncated?: boolean;
  file_count?: number;
  match_count?: number;
}

export interface ExplorerContentSearchOptions {
  isRegex: boolean;
  isCaseSensitive: boolean;
  isWholeWords: boolean;
  includePattern: string;
  excludePattern: string;
  useIgnoreFiles: boolean;
}
