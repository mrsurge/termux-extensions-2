const LONG_TIMEOUT_LANG_IDS = new Set([
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
]);

export function getBreadcrumbSymbolsTimeoutMs(langId: string): number {
  return LONG_TIMEOUT_LANG_IDS.has(langId) ? 15000 : 8000;
}
