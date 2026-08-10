type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseRegex(
  languageId: string,
  path: string,
  value: unknown,
): RegExp | undefined {
  if (typeof value === "string") {
    try {
      return new RegExp(value, "");
    } catch (error) {
      console.warn(
        `[VSIX][Languages] invalid regex for ${languageId} ${path}`,
        error,
      );
      return undefined;
    }
  }
  if (!isRecord(value)) return undefined;
  const pattern = value.pattern;
  const flags = value.flags;
  if (typeof pattern !== "string") return undefined;
  if (flags !== undefined && typeof flags !== "string") return undefined;
  try {
    return new RegExp(pattern, typeof flags === "string" ? flags : "");
  } catch (error) {
    console.warn(
      `[VSIX][Languages] invalid regex for ${languageId} ${path}`,
      error,
    );
    return undefined;
  }
}

function mapIndentAction(value: unknown): number | undefined {
  if (typeof value === "number" && value >= 0 && value <= 3) return value;
  switch (value) {
    case "none":
      return 0;
    case "indent":
      return 1;
    case "indentOutdent":
      return 2;
    case "outdent":
      return 3;
    default:
      return undefined;
  }
}

function reviveIndentationRules(
  languageId: string,
  value: unknown,
): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const increaseIndentPattern = parseRegex(
    languageId,
    "indentationRules.increaseIndentPattern",
    value.increaseIndentPattern,
  );
  const decreaseIndentPattern = parseRegex(
    languageId,
    "indentationRules.decreaseIndentPattern",
    value.decreaseIndentPattern,
  );
  if (!increaseIndentPattern || !decreaseIndentPattern) return undefined;
  const result: JsonRecord = { increaseIndentPattern, decreaseIndentPattern };
  const indentNextLinePattern = parseRegex(
    languageId,
    "indentationRules.indentNextLinePattern",
    value.indentNextLinePattern,
  );
  const unIndentedLinePattern = parseRegex(
    languageId,
    "indentationRules.unIndentedLinePattern",
    value.unIndentedLinePattern,
  );
  if (indentNextLinePattern)
    result.indentNextLinePattern = indentNextLinePattern;
  if (unIndentedLinePattern)
    result.unIndentedLinePattern = unIndentedLinePattern;
  return result;
}

function reviveOnEnterRules(
  languageId: string,
  value: unknown,
): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: JsonRecord[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.action)) return;
    const indentAction = mapIndentAction(
      entry.action.indentAction ?? entry.action.indent,
    );
    const beforeText = parseRegex(
      languageId,
      `onEnterRules[${index}].beforeText`,
      entry.beforeText,
    );
    if (indentAction === undefined || !beforeText) return;
    const action: JsonRecord = { indentAction };
    if (typeof entry.action.appendText === "string")
      action.appendText = entry.action.appendText;
    if (typeof entry.action.removeText === "number")
      action.removeText = entry.action.removeText;
    const rule: JsonRecord = { beforeText, action };
    const afterText = parseRegex(
      languageId,
      `onEnterRules[${index}].afterText`,
      entry.afterText,
    );
    const previousLineText = parseRegex(
      languageId,
      `onEnterRules[${index}].previousLineText`,
      entry.previousLineText,
    );
    if (afterText) rule.afterText = afterText;
    if (previousLineText) rule.previousLineText = previousLineText;
    result.push(rule);
  });
  return result.length ? result : undefined;
}

function reviveFoldingRules(
  languageId: string,
  value: unknown,
): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const result: JsonRecord = {};
  if (typeof value.offSide === "boolean") result.offSide = value.offSide;
  if (isRecord(value.markers)) {
    const start = parseRegex(
      languageId,
      "folding.markers.start",
      value.markers.start,
    );
    const end = parseRegex(
      languageId,
      "folding.markers.end",
      value.markers.end,
    );
    if (start && end) result.markers = { start, end };
  }
  return Object.keys(result).length ? result : undefined;
}

function reviveAutoClosingPairs(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: JsonRecord[] = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    ) {
      result.push({ open: entry[0], close: entry[1] });
      continue;
    }
    if (
      isRecord(entry) &&
      typeof entry.open === "string" &&
      typeof entry.close === "string"
    ) {
      const pair: JsonRecord = { open: entry.open, close: entry.close };
      if (
        Array.isArray(entry.notIn) &&
        entry.notIn.every((item) => typeof item === "string")
      ) {
        pair.notIn = entry.notIn;
      }
      result.push(pair);
    }
  }
  return result.length ? result : undefined;
}

function reviveVscodeLanguageConfiguration(
  languageId: string,
  rawConfig: JsonRecord,
): JsonRecord {
  const config: JsonRecord = {};
  for (const key of [
    "comments",
    "brackets",
    "colorizedBracketPairs",
    "autoCloseBefore",
    "__electricCharacterSupport",
  ]) {
    if (rawConfig[key] !== undefined) config[key] = rawConfig[key];
  }
  const wordPattern = parseRegex(
    languageId,
    "wordPattern",
    rawConfig.wordPattern,
  );
  const indentationRules = reviveIndentationRules(
    languageId,
    rawConfig.indentationRules,
  );
  const onEnterRules = reviveOnEnterRules(languageId, rawConfig.onEnterRules);
  const folding = reviveFoldingRules(languageId, rawConfig.folding);
  const autoClosingPairs = reviveAutoClosingPairs(rawConfig.autoClosingPairs);
  const surroundingPairs = reviveAutoClosingPairs(rawConfig.surroundingPairs);
  if (wordPattern) config.wordPattern = wordPattern;
  if (indentationRules) config.indentationRules = indentationRules;
  if (onEnterRules) config.onEnterRules = onEnterRules;
  if (folding) config.folding = folding;
  if (autoClosingPairs) config.autoClosingPairs = autoClosingPairs;
  if (surroundingPairs) config.surroundingPairs = surroundingPairs;
  return config;
}

export function applyVscodeLanguageConfiguration(
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  langId: string,
  configurationRaw: unknown,
  parseJsoncFn: (text: string) => unknown,
): void {
  try {
    if (
      !configurationRaw ||
      !monacoRef ||
      !monacoRef.languages ||
      !monacoRef.languages.setLanguageConfiguration
    )
      return;
    const config = parseJsoncFn(String(configurationRaw));
    if (isRecord(config)) {
      const revivedConfig = reviveVscodeLanguageConfiguration(langId, config);
      try {
        monacoRef.languages.setLanguageConfiguration(langId, revivedConfig);
      } catch (_) {}
    }
  } catch (error) {
    console.warn("[VSIX][Languages] config parse failed", langId, error);
  }
}
