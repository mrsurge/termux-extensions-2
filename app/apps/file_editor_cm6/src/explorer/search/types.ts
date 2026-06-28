export type ExplorerSearchMode =
  | "name"
  | "content"
  | "changes"
  | "review"
  | "diagnostics";

export interface ExplorerSearchOverlayState {
  searchMode: ExplorerSearchMode;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: unknown;
  searchStatus: ExplorerSearchStatus | null;
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
  matchText?: string;
  lineRanges?: ExplorerSearchTextRange[];
  snippetRanges?: ExplorerSearchTextRange[];
}

export interface ExplorerContentSearchFileResult {
  path?: string;
  rel?: string;
  relativePath?: string;
  matches?: ExplorerContentSearchMatch[];
  fileMatchCount?: number;
  matchesReturned?: number;
  fileTruncated?: boolean;
  nextMatchCursor?: string | null;
}

export interface ExplorerContentSearchResults {
  mode?: "content";
  query?: string;
  results?: ExplorerContentSearchFileResult[];
  truncated?: boolean;
  file_count?: number;
  match_count?: number;
  searchId?: string;
  jobId?: string;
  opId?: string;
  complete?: boolean;
  totalFileCount?: number;
  totalMatchCount?: number;
  nextGlobalCursor?: string | null;
  truncatedReason?: string;
}

export interface ExplorerContentSearchOptions {
  isRegex: boolean;
  isCaseSensitive: boolean;
  isWholeWords: boolean;
  includePattern: string;
  excludePattern: string;
  useIgnoreFiles: boolean;
}

export interface ExplorerSearchTextRange {
  start: number;
  end: number;
}

export interface ExplorerSearchPresentationWindow {
  maxInitialMatchesPerFile: number;
  maxInitialMatchesTotal: number;
}

export interface ExplorerSearchMaterializationLimit {
  maxMatchesPerFile?: number;
  maxMatchesTotal?: number;
}

export interface ExplorerSearchStatus {
  status: "idle" | "running" | "loadingMore" | "canceling" | "done" | "error";
  message: string | null;
  filesScanned?: number;
  filesMatched?: number;
  matchesFound?: number;
}

export interface ExplorerSearchIdentity {
  correlationId: string | null;
  searchId: string | null;
  jobId: string | null;
  root: string | null;
  projectGeneration: number | null;
}

export interface SearchContentDtoMatch {
  lineNumber?: number;
  columnNumber?: number;
  lineText?: string;
  snippet?: string;
  matchText?: string;
  lineRanges?: ExplorerSearchTextRange[];
  snippetRanges?: ExplorerSearchTextRange[];
}

export interface SearchContentDtoFile {
  path?: string;
  relativePath?: string;
  matches?: SearchContentDtoMatch[];
  fileMatchCount?: number;
  matchesReturned?: number;
  fileTruncated?: boolean;
  nextMatchCursor?: string | null;
}

export interface SearchContentDtoResult {
  dto?: "SearchContentResult";
  version?: number;
  root?: string;
  projectGeneration?: number;
  query?: string;
  files?: SearchContentDtoFile[];
  fileCount?: number;
  matchCount?: number;
  truncated?: boolean;
  searchId?: string;
  jobId?: string;
  opId?: string;
  complete?: boolean;
  totalFileCount?: number;
  totalMatchCount?: number;
  nextGlobalCursor?: string | null;
  truncatedReason?: string;
}

export interface SearchJobStartedPayload {
  dto?: "SearchJobStarted";
  version?: number;
  jobId?: string;
  searchId?: string;
  opId?: string;
  kind?: ExplorerSearchMode | "files";
  root?: string;
  projectGeneration?: number;
  correlationId?: string;
  status?: string;
  message?: string;
}

export interface SearchJobProgressPayload {
  dto?: "SearchJobProgress";
  version?: number;
  jobId?: string;
  opId?: string;
  kind?: ExplorerSearchMode | "files";
  root?: string;
  projectGeneration?: number;
  correlationId?: string;
  status?: string;
  message?: string;
  filesScanned?: number;
  filesMatched?: number;
  matchesFound?: number;
  sequence?: number;
}

export interface SearchJobResultPayload {
  dto?: "SearchJobResult";
  version?: number;
  jobId?: string;
  searchId?: string;
  kind?: ExplorerSearchMode | "files";
  root?: string;
  projectGeneration?: number;
  correlationId?: string;
  sequence?: number;
  result?: SearchContentDtoResult;
}

export interface SearchJobDonePayload {
  dto?: "SearchJobDone";
  version?: number;
  jobId?: string;
  searchId?: string;
  kind?: ExplorerSearchMode | "files";
  root?: string;
  projectGeneration?: number;
  correlationId?: string;
  status?: string;
  fileCount?: number;
  matchCount?: number;
  cancelled?: boolean;
}

export interface SearchJobErrorPayload {
  dto?: "SearchJobError";
  version?: number;
  jobId?: string;
  searchId?: string;
  kind?: ExplorerSearchMode | "files";
  root?: string;
  projectGeneration?: number;
  correlationId?: string;
  status?: string;
  code?: string;
  message?: string;
}

export interface ExplorerSearchMoreResult {
  dto?: "ExplorerSearchMoreResult";
  version?: number;
  searchId?: string;
  windowKind?: "global";
  result?: SearchContentDtoResult;
}

export interface ExplorerSearchMoreInFileResult {
  dto?: "ExplorerSearchMoreInFileResult";
  version?: number;
  searchId?: string;
  root?: string;
  projectGeneration?: number;
  file?: SearchContentDtoFile;
}

export const CONTENT_SEARCH_PRESENTATION_WINDOW: ExplorerSearchPresentationWindow =
  {
    maxInitialMatchesPerFile: 10,
    maxInitialMatchesTotal: 50,
  };

export const CONTENT_SEARCH_MORE_LIMIT: ExplorerSearchMaterializationLimit = {
  maxMatchesPerFile: 10,
  maxMatchesTotal: 50,
};

export const CONTENT_SEARCH_MORE_IN_FILE_LIMIT = 50;
