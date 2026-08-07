import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_RESULTS = 20_000;
const HARD_MAX_RESULTS = 100_000;

export interface WorkspaceFileSearchRuntime {
  workspaceRoot: () => string | null;
  fsPathFromUri: (uri: unknown) => string | null;
  uriForPath: (filePath: string) => Record<string, unknown>;
  log?: (...args: unknown[]) => void;
}

interface FileSearchOptions extends Record<string, unknown> {
  includePattern?: unknown;
  excludePattern?: unknown;
  filePattern?: unknown;
  maxResults?: unknown;
  exists?: unknown;
  ignoreGlobCase?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePattern(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function patternStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const patterns: string[] = [];
  for (const item of values) {
    if (typeof item === "string" && item.trim()) {
      patterns.push(normalizePattern(item.trim()));
      continue;
    }
    if (!isRecord(item)) continue;
    const pattern = item.pattern;
    if (typeof pattern === "string" && pattern.trim()) {
      patterns.push(normalizePattern(pattern.trim()));
      continue;
    }
    if (Array.isArray(pattern)) patterns.push(...patternStrings(pattern));
  }
  return patterns;
}

function findClosingBrace(pattern: string, start: number): number {
  let depth = 0;
  for (let index = start; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitBraceAlternatives(value: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      alternatives.push(value.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(value.slice(start));
  return alternatives;
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  const close = findClosingBrace(pattern, open);
  if (close < 0) return [pattern];
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return splitBraceAlternatives(pattern.slice(open + 1, close)).flatMap(
    (alternative) => expandBraces(`${prefix}${alternative}${suffix}`),
  );
}

function escapeRegExpChar(char: string): string {
  return /[\\^$+?.()|{}]/.test(char) ? `\\${char}` : char;
}

function globSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close > index + 1) {
        const body = pattern.slice(index + 1, close).replace(/^!/, "^");
        source += `[${body}]`;
        index = close;
        continue;
      }
    }
    source += escapeRegExpChar(char);
  }
  return source;
}

function compilePatterns(patterns: readonly string[], ignoreCase: boolean): RegExp[] {
  return patterns.flatMap((pattern) =>
    expandBraces(pattern).map(
      (expanded) => new RegExp(`^${globSource(expanded)}$`, ignoreCase ? "i" : ""),
    ),
  );
}

function matchesAny(matchers: readonly RegExp[], relativePath: string): boolean {
  return matchers.some((matcher) => matcher.test(relativePath));
}

function shouldPruneDirectory(matchers: readonly RegExp[], relativePath: string): boolean {
  if (!matchers.length) return false;
  return (
    matchesAny(matchers, relativePath) ||
    matchesAny(matchers, `${relativePath}/`) ||
    matchesAny(matchers, `${relativePath}/__te2_search_probe__`)
  );
}

function resultLimit(options: FileSearchOptions): number {
  if (options.exists === true) return 1;
  const requested = Number(options.maxResults);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.floor(requested), HARD_MAX_RESULTS);
}

function includePatterns(options: FileSearchOptions): string[] {
  const explicit = patternStrings(options.includePattern);
  if (explicit.length) return explicit;
  const filePattern = typeof options.filePattern === "string"
    ? normalizePattern(options.filePattern.trim())
    : "";
  if (!filePattern) return ["**/*"];
  return filePattern.includes("/") ? [filePattern] : [filePattern, `**/${filePattern}`];
}

export async function searchWorkspaceFiles(
  runtime: WorkspaceFileSearchRuntime,
  includeFolder: unknown,
  rawOptions: unknown,
): Promise<Record<string, unknown>[]> {
  const options: FileSearchOptions = isRecord(rawOptions) ? rawOptions : {};
  const root = runtime.fsPathFromUri(includeFolder) ?? runtime.workspaceRoot();
  if (!root) throw new Error("workspace file search has no root folder");

  const absoluteRoot = path.resolve(root);
  const rootStat = await fs.stat(absoluteRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`workspace file search root is not a directory: ${absoluteRoot}`);
  }

  const ignoreCase = options.ignoreGlobCase === true;
  const includes = includePatterns(options);
  const excludes = patternStrings(options.excludePattern);
  const includeMatchers = compilePatterns(includes, ignoreCase);
  const excludeMatchers = compilePatterns(excludes, ignoreCase);
  const limit = resultLimit(options);
  const results: Record<string, unknown>[] = [];
  let visited = 0;

  async function walk(directory: string, relativeParent: string): Promise<void> {
    if (results.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      runtime.log?.(
        `[fileSearch] skipped unreadable directory=${directory}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (results.length >= limit) return;
      visited += 1;
      const relativePath = relativeParent
        ? `${relativeParent}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || shouldPruneDirectory(excludeMatchers, relativePath)) continue;
        await walk(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!matchesAny(includeMatchers, relativePath)) continue;
      if (matchesAny(excludeMatchers, relativePath)) continue;
      results.push(runtime.uriForPath(path.join(absoluteRoot, relativePath)));
    }
  }

  await walk(absoluteRoot, "");
  runtime.log?.(
    `[fileSearch] root=${absoluteRoot} include=${JSON.stringify(includes)} exclude=${JSON.stringify(excludes)} visited=${visited} results=${results.length} limit=${limit}`,
  );
  return results;
}
