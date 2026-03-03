export function getBreadcrumbSymbolsTimeoutMs(langId) {
  return (langId === 'javascript' || langId === 'typescript' || langId === 'javascriptreact' || langId === 'typescriptreact') ? 15000 : 8000;
}
