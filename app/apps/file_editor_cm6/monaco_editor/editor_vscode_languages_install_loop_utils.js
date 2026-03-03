export function installVscodeLanguagesLoop(langs, normalizeLanguageFn, onLanguageFn) {
  for (var i = 0; i < langs.length; i++) {
    var l = langs[i];
    if (!l || !l.id) continue;
    var langId = normalizeLanguageFn(l.id);
    if (!langId) continue;
    onLanguageFn(l, langId);
  }
}
