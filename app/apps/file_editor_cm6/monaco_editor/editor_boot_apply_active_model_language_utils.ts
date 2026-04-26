interface WindowMonacoLike {
  monaco?: unknown;
}

export function applyActiveModelLanguage<TModel>(
  windowRef: WindowMonacoLike,
  model: TModel | null | undefined,
  currentPath: string | null | undefined,
  applyLanguageToModelFn: (model: TModel, languageId: string, filePath: string) => void,
  languageFromPathFn: (filePath: string) => string,
): void {
  if (windowRef.monaco && model && currentPath) {
    applyLanguageToModelFn(model, languageFromPathFn(currentPath), currentPath);
  }
}
