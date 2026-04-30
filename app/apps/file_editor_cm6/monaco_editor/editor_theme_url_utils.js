import { buildUiUrl } from './editor_common_utils.ts';

export function getVscodeThemeJsonUrl(themeId, themeRegistry, apiBase) {
  var id = String(themeId || '');
  if (themeRegistry && themeRegistry[id] && themeRegistry[id].serveUrl) {
    return buildUiUrl(apiBase, themeRegistry[id].serveUrl);
  }
  var vendoredMap = {
    'github-dark-default': 'dark-default.json',
    'github-light-default': 'light-default.json',
    'github-dark': 'dark.json',
    'github-light': 'light.json',
    'github-dark-dimmed': 'dark-dimmed.json',
    'github-dark-high-contrast': 'dark-high-contrast.json',
    'github-light-high-contrast': 'light-high-contrast.json',
    'github-dark-colorblind-beta': 'dark-colorblind.json',
    'github-light-colorblind-beta': 'light-colorblind.json',
  };
  if (vendoredMap[id]) {
    return buildUiUrl(apiBase, 'monaco_editor/themes/vendored/github/' + vendoredMap[id]);
  }
  return null;
}
