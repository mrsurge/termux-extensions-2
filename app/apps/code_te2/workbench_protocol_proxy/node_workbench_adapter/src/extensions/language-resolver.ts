interface LanguageAssociation {
  id: string;
  filenames: Set<string>;
  extensions: string[];
  filenamePatterns: RegExp[];
  firstLine: RegExp | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function escapeRegExpChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp | null {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "{") {
      const close = pattern.indexOf("}", index + 1);
      if (close > index) {
        const alternatives = pattern
          .slice(index + 1, close)
          .split(",")
          .map((item) =>
            [...item].map((part) => escapeRegExpChar(part)).join("")
          );
        source += `(?:${alternatives.join("|")})`;
        index = close;
        continue;
      }
    }
    source += escapeRegExpChar(char);
  }
  try {
    return new RegExp(`${source}$`, "i");
  } catch {
    return null;
  }
}

function safeRegExp(source: unknown): RegExp | null {
  if (typeof source !== "string" || !source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function languageContributions(extensions: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const extension of extensions) {
    if (!isRecord(extension) || !isRecord(extension.contributes)) continue;
    const languages = extension.contributes.languages;
    if (Array.isArray(languages)) out.push(...languages);
  }
  return out;
}

export class ExtensionLanguageResolver {
  private associations: LanguageAssociation[] = [];

  setExtensions(extensions: unknown[]): void {
    const associations: LanguageAssociation[] = [];
    for (const rawLanguage of languageContributions(extensions)) {
      if (!isRecord(rawLanguage)) continue;
      const id =
        typeof rawLanguage.id === "string" ? rawLanguage.id.trim() : "";
      if (!id) continue;
      const extensionsForLanguage = stringArray(rawLanguage.extensions)
        .map((extension) => extension.toLowerCase())
        .sort((left, right) => right.length - left.length);
      const filenamePatterns = stringArray(rawLanguage.filenamePatterns)
        .map(globToRegExp)
        .filter((pattern): pattern is RegExp => !!pattern);
      associations.push({
        id,
        filenames: new Set(stringArray(rawLanguage.filenames)),
        extensions: extensionsForLanguage,
        filenamePatterns,
        firstLine: safeRegExp(rawLanguage.firstLine),
      });
    }
    this.associations = associations;
  }

  clear(): void {
    this.associations = [];
  }

  resolve(filePath: string, text = ""): string | null {
    const normalizedPath = String(filePath || "").replace(/\\/g, "/");
    const loweredPath = normalizedPath.toLowerCase();
    const basename = normalizedPath.split("/").pop() ?? normalizedPath;

    for (let index = this.associations.length - 1; index >= 0; index -= 1) {
      const association = this.associations[index];
      if (association?.filenames.has(basename)) return association.id;
    }

    let extensionMatch: { id: string; length: number } | null = null;
    for (let index = this.associations.length - 1; index >= 0; index -= 1) {
      const association = this.associations[index];
      if (!association) continue;
      for (const extension of association.extensions) {
        if (
          extension.length > (extensionMatch?.length ?? 0) &&
          loweredPath.endsWith(extension)
        ) {
          extensionMatch = { id: association.id, length: extension.length };
        }
      }
    }
    if (extensionMatch) return extensionMatch.id;

    for (let index = this.associations.length - 1; index >= 0; index -= 1) {
      const association = this.associations[index];
      if (
        association?.filenamePatterns.some(
          (pattern) => pattern.test(normalizedPath) || pattern.test(basename),
        )
      ) {
        return association.id;
      }
    }

    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    if (firstLine) {
      for (let index = this.associations.length - 1; index >= 0; index -= 1) {
        const association = this.associations[index];
        if (association?.firstLine?.test(firstLine)) return association.id;
      }
    }
    return null;
  }
}
