import { RawContextKey } from '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js';

export const SEARCH_WIDGET_COMMAND_IDS = {
  toggleCaseSensitive: 'explorer.search.toggleCaseSensitive',
  toggleWholeWord: 'explorer.search.toggleWholeWord',
  toggleRegex: 'explorer.search.toggleRegex',
  togglePreserveCase: 'explorer.search.togglePreserveCase',
  toggleContextLines: 'explorer.search.toggleContextLines',
  replaceAll: 'explorer.search.replaceAll',
} as const;

export const SEARCH_WIDGET_CONTEXT = {
  replaceActiveKey: new RawContextKey(
    'explorerSearchReplaceActive',
    false,
  ),
  searchInputBoxFocusedKey: new RawContextKey(
    'explorerSearchInputBoxFocused',
    false,
  ),
  replaceInputBoxFocusedKey: new RawContextKey(
    'explorerSearchReplaceInputBoxFocused',
    false,
  ),
} as const;
