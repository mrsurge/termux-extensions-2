// Editable file extensions - can be opened in file editor
const EDITABLE_EXTENSIONS = new Set([
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".pyw",
  ".pyi",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ksh",
  ".json",
  ".jsonc",
  ".json5",
  ".xml",
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".config",
  ".env",
  ".env.local",
  ".env.production",
  ".gitignore",
  ".dockerignore",
  ".npmignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".bashrc",
  ".zshrc",
  ".vimrc",
  ".tmux.conf",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".pl",
  ".r",
  ".R",
  ".sql",
  ".lua",
  ".vim",
  ".dockerfile",
  "Dockerfile",
  ".makefile",
  "Makefile",
  ".log",
  ".csv",
  ".tsv",
]);

export function isEditableFile(filename: string): boolean {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check exact matches first (like Dockerfile, Makefile)
  if (EDITABLE_EXTENSIONS.has(name)) return true;
  // Check extensions
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return EDITABLE_EXTENSIONS.has(ext);
}

const ARCHIVE_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
]);

export const MAX_EDITOR_SIZE = 256 * 1024; // 256 KB threshold

export function joinPath(dir: string, name: string): string {
  if (!dir || dir === "/") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function isArchive(filename: string): boolean {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check for compound extensions
  if (
    name.endsWith(".tar.gz") ||
    name.endsWith(".tar.bz2") ||
    name.endsWith(".tar.xz")
  ) {
    return true;
  }
  // Check single extensions
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return ARCHIVE_EXTENSIONS.has(ext);
}

export function parentPath(path: string): string {
  if (!path || path === "/") return "/";
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  const parent = trimmed.slice(0, idx);
  return parent || "/";
}

export function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function formatDate(mtime: number | undefined): string {
  if (mtime === undefined || !Number.isFinite(mtime)) return "";
  try {
    return new Date(mtime * 1000).toLocaleString();
  } catch (_) {
    return "";
  }
}

export function modeToString(mode: string | number | undefined, type: string): string {
  if (typeof mode !== "number" || !Number.isFinite(mode)) return "----------";

  // File type character
  let str = "";
  if (type === "directory") str = "d";
  else if (type === "symlink") str = "l";
  else str = "-";

  // Permission bits
  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ];

  return str + perms.join("");
}

export function formatOwnership(owner: string | number | undefined, group: string | number | undefined): string {
  const o = owner || "?";
  const g = group || "?";
  return `${o}:${g}`;
}
