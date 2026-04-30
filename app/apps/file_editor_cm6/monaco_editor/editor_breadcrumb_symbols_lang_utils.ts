interface BreadcrumbLanguageModelLike {
  getLanguageId?(): string;
  [key: string]: unknown;
}

export function resolveBreadcrumbSymbolsLangId(
  model: unknown,
  absPath: string,
  languageFromPathFn: (path: string) => string,
): string {
  const languageModel =
    model && typeof model === 'object'
      ? (model as BreadcrumbLanguageModelLike)
      : null;
  let langId = languageModel?.getLanguageId?.() || '';
  if (!langId) langId = languageFromPathFn(absPath) || '';
  return langId;
}
