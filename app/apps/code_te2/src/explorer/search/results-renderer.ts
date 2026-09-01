import {
  type ExplorerContentSearchFileResult,
  type ExplorerContentSearchMatch,
} from "./types.ts";
import { normalizeContentSearchResults } from "./result-model.ts";
import { renderHighlightedSearchSnippet } from "./render-styling.ts";
import { getErrorMessage } from "../utils/errors.ts";
import type { ExplorerJumpOptions } from "../host/file-open-bridge.ts";

interface ExplorerSearchResultsRendererDeps {
  toast(message: string): void;
  openFileAndMaybeJump(
    rel: string,
    lineNumber?: number | null,
    jumpOptions?: ExplorerJumpOptions,
  ): Promise<void>;
  loadMoreResults?(): Promise<void> | void;
  loadMoreInFile?(file: ExplorerContentSearchFileResult): Promise<void> | void;
  isGlobalMoreLoading?(): boolean;
  isFileMoreLoading?(rel: string): boolean;
}

function splitPathForDisplay(path: string): { parent: string; name: string } {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return { parent: "", name: normalized };
  }
  return {
    parent: normalized.slice(0, index + 1),
    name: normalized.slice(index + 1) || normalized,
  };
}

function renderPathLabel(target: HTMLElement, path: string): void {
  target.classList.add("fe-search-path-label");
  target.title = path;
  target.replaceChildren();
  const { parent, name } = splitPathForDisplay(path);
  if (parent) {
    const parentSpan = document.createElement("span");
    parentSpan.className = "fe-search-path-parent";
    parentSpan.textContent = parent;
    target.appendChild(parentSpan);
  }
  const nameSpan = document.createElement("span");
  nameSpan.className = "fe-search-path-name";
  nameSpan.textContent = name || path;
  target.appendChild(nameSpan);
}

export function renderContentResults(
  container: HTMLElement,
  data: unknown,
  deps: ExplorerSearchResultsRendererDeps,
): void {
  const payload = normalizeContentSearchResults(data);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const list = document.createElement("div");
  list.className = "fe-search-list";

  results.forEach((fileResult: ExplorerContentSearchFileResult) => {
    const rel =
      fileResult.rel || fileResult.relativePath || fileResult.path || "";
    const fileGroup = document.createElement("div");
    fileGroup.className = "fe-search-file-group";

    const matches = Array.isArray(fileResult.matches) ? fileResult.matches : [];
    const fileHeader = document.createElement("div");
    fileHeader.className = "fe-search-file-header";
    const fileTitle = document.createElement("span");
    fileTitle.className = "fe-search-file-title";
    renderPathLabel(fileTitle, rel);
    fileHeader.appendChild(fileTitle);

    const fileMeta = document.createElement("span");
    fileMeta.className = "fe-search-file-meta";
    const fileTotal =
      typeof fileResult.fileMatchCount === "number"
        ? fileResult.fileMatchCount
        : matches.length;
    fileMeta.textContent =
      fileTotal > matches.length
        ? `${matches.length} of ${fileTotal}`
        : `${matches.length}`;
    fileHeader.appendChild(fileMeta);
    fileGroup.appendChild(fileHeader);

    matches.forEach((match: ExplorerContentSearchMatch) => {
      const matchRow = document.createElement("div");
      matchRow.className = "fe-search-match";
      matchRow.onclick = async () => {
        if (!rel) {
          deps.toast("File opener not available");
          return;
        }
        try {
          await deps.openFileAndMaybeJump(
            rel,
            typeof match.line === "number" ? match.line : 1,
            {
              focus: false,
              scrollY: "center",
            },
          );
        } catch (error) {
          deps.toast(
            `Failed to open file: ${getErrorMessage(error, "unknown error")}`,
          );
        }
      };

      const lineNum = document.createElement("span");
      lineNum.className = "fe-search-line-num";
      lineNum.textContent = String(
        typeof match.line === "number" ? match.line : 1,
      );
      matchRow.appendChild(lineNum);

      const snippet = document.createElement("span");
      snippet.className = "fe-search-snippet";
      const snippetText = match.snippet || match.text || "";
      const snippetRanges =
        Array.isArray(match.snippetRanges) && match.snippetRanges.length > 0
          ? match.snippetRanges
          : snippetText === match.text &&
              Array.isArray(match.lineRanges) &&
              match.lineRanges.length > 0
            ? match.lineRanges
            : undefined;
      renderHighlightedSearchSnippet(snippet, snippetText, rel, {
        ranges: snippetRanges,
        matchText: match.matchText,
        column: snippetText === match.text ? match.column : null,
      });
      matchRow.appendChild(snippet);

      fileGroup.appendChild(matchRow);
    });

    if (fileResult.fileTruncated && fileResult.nextMatchCursor) {
      const moreRow = document.createElement("div");
      moreRow.className = "fe-search-more-row";
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "fe-search-more-btn";
      const loading = deps.isFileMoreLoading?.(rel) === true;
      moreButton.disabled = loading;
      moreButton.textContent = loading
        ? "Loading matches..."
        : "Show more in file";
      moreButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deps.loadMoreInFile?.(fileResult);
      });
      moreRow.appendChild(moreButton);
      fileGroup.appendChild(moreRow);
    }

    list.appendChild(fileGroup);
  });

  container.appendChild(list);

  const visibleFileCount =
    typeof payload.file_count === "number"
      ? payload.file_count
      : results.length;
  const visibleMatchCount =
    typeof payload.match_count === "number"
      ? payload.match_count
      : results.reduce((count, result) => {
          const matches = Array.isArray(result.matches) ? result.matches : [];
          return count + matches.length;
        }, 0);
  const totalFileCount = payload.totalFileCount ?? visibleFileCount;
  const totalMatchCount = payload.totalMatchCount ?? visibleMatchCount;

  const summary = document.createElement("div");
  summary.className = "fe-search-summary";
  summary.textContent =
    totalFileCount > visibleFileCount || totalMatchCount > visibleMatchCount
      ? `Showing ${visibleMatchCount} of ${totalMatchCount} matches across ${visibleFileCount} of ${totalFileCount} files`
      : `Showing ${visibleMatchCount} matches across ${visibleFileCount} files`;
  container.appendChild(summary);

  if (payload.searchLimitReached) {
    const notice = document.createElement("div");
    notice.className = "fe-search-notice";
    const limit = payload.searchMatchLimit ?? totalMatchCount;
    notice.textContent = `Stopped after ${limit} matches. Add filters to narrow the search.`;
    container.appendChild(notice);
  }

  if (payload.nextGlobalCursor) {
    const more = document.createElement("div");
    more.className = "fe-search-more-global";
    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "fe-search-more-btn fe-search-more-btn-global";
    const loading = deps.isGlobalMoreLoading?.() === true;
    moreButton.disabled = loading;
    moreButton.textContent = loading
      ? "Loading results..."
      : "Show more results";
    moreButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void deps.loadMoreResults?.();
    });
    more.appendChild(moreButton);
    container.appendChild(more);
  } else if (payload.truncated) {
    const notice = document.createElement("div");
    notice.className = "fe-search-notice";
    notice.textContent =
      "Results are truncated, but no materialization cursor was provided.";
    container.appendChild(notice);
  }
}
