import { existsSync } from "node:fs";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_WORKSPACE_CONTAINS_MAX_ENTRIES = 25000;
const DEFAULT_WORKSPACE_CONTAINS_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "node_modules",
  "target",
  "build",
  "dist",
]);

export interface WorkspaceContainsOptions {
  log?: (...args: unknown[]) => void;
  maxEntries?: number;
  skipDirs?: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field ? field : null;
}

function workspaceFolderPath(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const uri = isRecord(value.uri) ? value.uri : value;
  return stringField(uri, "fsPath") || stringField(uri, "path");
}

function workspaceContainsPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/"));
}

function hasGlobMagic(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function escapeRegExpChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? "";
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExpChar(char);
  }
  source += "$";
  return new RegExp(source);
}

function maxDepthForGlob(pattern: string): number {
  if (pattern.includes("**")) return 12;
  return Math.max(1, pattern.split("/").length);
}

async function workspaceGlobExists(
  root: string,
  pattern: string,
  maxEntries: number,
  skipDirs: ReadonlySet<string>,
): Promise<boolean> {
  const regex = globPatternToRegExp(pattern);
  const maxDepth = maxDepthForGlob(pattern);
  let visited = 0;

  async function walk(dir: string, relParent: string, depth: number): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > maxEntries) return false;
      const rel = relParent ? `${relParent}/${entry.name}` : entry.name;
      if (regex.test(rel)) return true;
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;
      if (pattern.includes("**") || depth + 1 < maxDepth) {
        if (await walk(path.join(dir, entry.name), rel, depth + 1)) return true;
      }
    }
    return false;
  }

  return walk(root, "", 0);
}

async function workspacePatternExists(
  root: string,
  pattern: string,
  options: Required<Pick<WorkspaceContainsOptions, "maxEntries" | "skipDirs">>,
): Promise<boolean> {
  if (!pattern) return false;
  if (!hasGlobMagic(pattern)) return existsSync(path.join(root, pattern));
  return workspaceGlobExists(root, pattern, options.maxEntries, options.skipDirs);
}

export async function checkWorkspaceContains(
  folders: unknown,
  includes: unknown,
  options: WorkspaceContainsOptions = {},
): Promise<boolean> {
  const roots = Array.isArray(folders)
    ? folders.map((folder) => workspaceFolderPath(folder)).filter((folder): folder is string => !!folder)
    : [];
  const patterns = workspaceContainsPatterns(includes);
  const log = options.log ?? (() => {});
  const matcherOptions = {
    maxEntries: options.maxEntries ?? DEFAULT_WORKSPACE_CONTAINS_MAX_ENTRIES,
    skipDirs: options.skipDirs ?? DEFAULT_WORKSPACE_CONTAINS_SKIP_DIRS,
  };

  if (!roots.length || !patterns.length) {
    log(`[workspaceContains] $checkExists skip roots=${roots.length} patterns=${patterns.length}`);
    return false;
  }

  for (const root of roots) {
    for (const pattern of patterns) {
      if (await workspacePatternExists(root, pattern, matcherOptions)) {
        log(`[workspaceContains] $checkExists match root=${root} pattern=${pattern}`);
        return true;
      }
    }
  }

  log(`[workspaceContains] $checkExists miss roots=${JSON.stringify(roots)} patterns=${JSON.stringify(patterns)}`);
  return false;
}
