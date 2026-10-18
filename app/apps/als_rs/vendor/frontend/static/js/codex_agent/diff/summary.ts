export function countPatchChanges(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  for (const line of text.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
    } else if (line.startsWith('+') && newRemaining > 0) {
      additions += 1;
      newRemaining -= 1;
    } else if (line.startsWith('-') && oldRemaining > 0) {
      deletions += 1;
      oldRemaining -= 1;
    } else if (line.startsWith(' ')) {
      oldRemaining = Math.max(0, oldRemaining - 1);
      newRemaining = Math.max(0, newRemaining - 1);
    } else if (!line.startsWith('\\')) {
      oldRemaining = 0;
      newRemaining = 0;
    }
  }
  return { additions, deletions };
}

export function diffFileIcon(language: string | null | undefined): string {
  switch (language?.toLowerCase()) {
    case 'rust': case 'typescript': case 'python': case 'javascript': return `language-${language.toLowerCase()}`;
    case 'json': case 'jsonc': return 'json';
    case 'markdown': case 'md': return 'markdown';
    case 'css': case 'scss': case 'less': return 'symbol-color';
    case 'sql': return 'database';
    case 'text': case 'plaintext': case 'txt': return 'file-text';
    case '': case undefined: return 'file';
    default: return 'file-code';
  }
}
