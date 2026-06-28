import type {
  ExplorerContentSearchFileResult,
  ExplorerContentSearchMatch,
  ExplorerContentSearchResults,
  SearchContentDtoFile,
  SearchContentDtoMatch,
  SearchContentDtoResult,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringValue(value);
}

function normalizeDtoMatch(
  match: SearchContentDtoMatch,
): ExplorerContentSearchMatch {
  const lineNumber = numberValue(match.lineNumber);
  const columnNumber = numberValue(match.columnNumber);
  const lineText = stringValue(match.lineText);
  const snippet = stringValue(match.snippet) || lineText || "";
  return {
    line: lineNumber,
    column:
      typeof columnNumber === "number"
        ? Math.max(0, columnNumber - 1)
        : undefined,
    text: lineText,
    snippet,
    matchText: stringValue(match.matchText),
    lineRanges: Array.isArray(match.lineRanges) ? match.lineRanges : undefined,
    snippetRanges: Array.isArray(match.snippetRanges)
      ? match.snippetRanges
      : undefined,
  };
}

function normalizeDtoFile(
  file: SearchContentDtoFile,
): ExplorerContentSearchFileResult {
  const matches = Array.isArray(file.matches)
    ? file.matches.map(normalizeDtoMatch)
    : [];
  return {
    path: stringValue(file.path),
    rel: stringValue(file.relativePath),
    relativePath: stringValue(file.relativePath),
    matches,
    fileMatchCount: numberValue(file.fileMatchCount),
    matchesReturned: numberValue(file.matchesReturned) ?? matches.length,
    fileTruncated: file.fileTruncated === true,
    nextMatchCursor: nullableStringValue(file.nextMatchCursor),
  };
}

function normalizeProjectedFile(
  value: unknown,
): ExplorerContentSearchFileResult | null {
  if (!isRecord(value)) return null;
  const matches = Array.isArray(value.matches)
    ? value.matches.filter(isRecord).map((match) => ({
        line: numberValue(match.line),
        column: numberValue(match.column),
        text: stringValue(match.text),
        snippet: stringValue(match.snippet) || stringValue(match.text) || "",
        matchText: stringValue(match.matchText),
        lineRanges: Array.isArray(match.lineRanges)
          ? match.lineRanges
          : undefined,
        snippetRanges: Array.isArray(match.snippetRanges)
          ? match.snippetRanges
          : undefined,
      }))
    : [];
  return {
    path: stringValue(value.path),
    rel: stringValue(value.rel) || stringValue(value.relativePath),
    relativePath: stringValue(value.relativePath) || stringValue(value.rel),
    matches,
    fileMatchCount: numberValue(value.fileMatchCount),
    matchesReturned: numberValue(value.matchesReturned) ?? matches.length,
    fileTruncated: value.fileTruncated === true,
    nextMatchCursor: nullableStringValue(value.nextMatchCursor),
  };
}

export function normalizeContentSearchResults(
  value: unknown,
): ExplorerContentSearchResults {
  if (!isRecord(value)) {
    return { mode: "content", results: [], truncated: false };
  }

  if (Array.isArray(value.files)) {
    const dto = value as SearchContentDtoResult;
    const results = value.files.map((file) =>
      normalizeDtoFile(file as SearchContentDtoFile),
    );
    return {
      mode: "content",
      query: stringValue(dto.query),
      results,
      truncated: dto.truncated === true,
      file_count: numberValue(dto.fileCount) ?? results.length,
      match_count:
        numberValue(dto.matchCount) ??
        results.reduce((count, file) => count + (file.matches?.length || 0), 0),
      searchId: stringValue(dto.searchId),
      jobId: stringValue(dto.jobId),
      opId: stringValue(dto.opId),
      complete: dto.complete === true,
      totalFileCount: numberValue(dto.totalFileCount),
      totalMatchCount: numberValue(dto.totalMatchCount),
      nextGlobalCursor: nullableStringValue(dto.nextGlobalCursor),
      truncatedReason: stringValue(dto.truncatedReason),
    };
  }

  const rawResults = Array.isArray(value.results) ? value.results : [];
  const results = rawResults
    .map(normalizeProjectedFile)
    .filter((item): item is ExplorerContentSearchFileResult => Boolean(item));
  return {
    mode: "content",
    query: stringValue(value.query),
    results,
    truncated: value.truncated === true,
    file_count: numberValue(value.file_count) ?? results.length,
    match_count:
      numberValue(value.match_count) ??
      results.reduce((count, file) => count + (file.matches?.length || 0), 0),
    searchId: stringValue(value.searchId),
    jobId: stringValue(value.jobId),
    opId: stringValue(value.opId),
    complete: value.complete === true,
    totalFileCount: numberValue(value.totalFileCount),
    totalMatchCount: numberValue(value.totalMatchCount),
    nextGlobalCursor: nullableStringValue(value.nextGlobalCursor),
    truncatedReason: stringValue(value.truncatedReason),
  };
}

function fileKey(file: ExplorerContentSearchFileResult): string {
  return file.rel || file.relativePath || file.path || "";
}

function visibleMatchCount(results: ExplorerContentSearchFileResult[]): number {
  return results.reduce(
    (count, file) => count + (file.matches?.length || 0),
    0,
  );
}

export function mergeContentSearchResults(
  currentValue: unknown,
  nextValue: unknown,
): ExplorerContentSearchResults {
  const current = normalizeContentSearchResults(currentValue);
  const next = normalizeContentSearchResults(nextValue);
  const mergedFiles = new Map<string, ExplorerContentSearchFileResult>();

  for (const file of current.results || []) {
    const key = fileKey(file);
    if (key) {
      mergedFiles.set(key, { ...file, matches: [...(file.matches || [])] });
    }
  }

  for (const file of next.results || []) {
    const key = fileKey(file);
    if (!key) continue;
    const existing = mergedFiles.get(key);
    if (!existing) {
      mergedFiles.set(key, { ...file, matches: [...(file.matches || [])] });
      continue;
    }
    existing.path = file.path || existing.path;
    existing.rel = file.rel || existing.rel;
    existing.relativePath = file.relativePath || existing.relativePath;
    existing.matches = [...(existing.matches || []), ...(file.matches || [])];
    existing.fileMatchCount = file.fileMatchCount ?? existing.fileMatchCount;
    existing.matchesReturned =
      file.matchesReturned ??
      existing.matchesReturned ??
      existing.matches.length;
    existing.fileTruncated = file.fileTruncated === true;
    existing.nextMatchCursor = file.nextMatchCursor;
  }

  const results = Array.from(mergedFiles.values());
  return {
    ...current,
    ...next,
    results,
    file_count: results.length,
    match_count: visibleMatchCount(results),
    totalFileCount: next.totalFileCount ?? current.totalFileCount,
    totalMatchCount: next.totalMatchCount ?? current.totalMatchCount,
    truncated:
      next.truncated === true ||
      results.some((file) => file.fileTruncated === true) ||
      Boolean(next.nextGlobalCursor),
  };
}

export function mergeContentSearchFile(
  currentValue: unknown,
  nextFile: SearchContentDtoFile,
): ExplorerContentSearchResults {
  const current = normalizeContentSearchResults(currentValue);
  const normalizedFile = normalizeDtoFile(nextFile);
  const results = [...(current.results || [])];
  const key = fileKey(normalizedFile);
  const index = key ? results.findIndex((file) => fileKey(file) === key) : -1;

  if (index >= 0) {
    const existing = results[index];
    results[index] = {
      ...existing,
      path: normalizedFile.path || existing.path,
      rel: normalizedFile.rel || existing.rel,
      relativePath: normalizedFile.relativePath || existing.relativePath,
      matches: [
        ...(existing.matches || []),
        ...(normalizedFile.matches || []),
      ] as ExplorerContentSearchMatch[],
      fileMatchCount: normalizedFile.fileMatchCount ?? existing.fileMatchCount,
      matchesReturned:
        normalizedFile.matchesReturned ??
        existing.matchesReturned ??
        (existing.matches?.length || 0) + (normalizedFile.matches?.length || 0),
      fileTruncated: normalizedFile.fileTruncated === true,
      nextMatchCursor: normalizedFile.nextMatchCursor,
    };
  } else if (key) {
    results.push(normalizedFile);
  }

  return {
    ...current,
    results,
    file_count: results.length,
    match_count: visibleMatchCount(results),
    truncated:
      Boolean(current.nextGlobalCursor) ||
      results.some((file) => file.fileTruncated === true),
  };
}
