export async function getVscodeLanguagesList(win, vscodeApiCallFn) {
  var langs = null;
  try {
    if (win && win.__te2VscodeBootstrap && Array.isArray(win.__te2VscodeBootstrap.languages)) {
      langs = win.__te2VscodeBootstrap.languages;
    }
  } catch (_) {}
  if (!Array.isArray(langs)) {
    var res = await vscodeApiCallFn('vscode.languages.list', {});
    langs = res && res.languages ? res.languages : [];
  }
  return Array.isArray(langs) ? langs : [];
}
