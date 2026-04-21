import { installMarkerNavBindings, jumpToMarker } from './editor_marker_nav_utils.js';
import { applyLineNumberSizingForEditors } from './editor_line_number_utils.js';
import { ensureTouchSelection as ensureTouchSelectionUtil } from './editor_touch_menu_utils.js';
import { syncReadOnlyInputMode } from './editor_readonly_input_mode_utils.js';
import { onEditorConfigChanged } from './editor_config_change_utils.js';

interface EditorUiEditorRuntimeDeps {
  getWindow(): Window;
  getDocument(): Document;
  getMonaco(): unknown;
  getEditor(): unknown;
  getDiffEditor(): unknown;
  getModel(): unknown;
  getGitHeadModel(): unknown;
  getGitDiskModel(): unknown;
  getCurrentPath(): string | null;
  getUiIpcSocket(): unknown;
  updateDebug(extra?: string): void;
}

type DirectionLike = unknown;

export function createEditorUiEditorRuntime(deps: EditorUiEditorRuntimeDeps) {
  let layoutObserver: ResizeObserver | null = null;
  let lastKnownReadOnly: boolean | null = null;

  function getEditorContainer(): HTMLElement | null {
    try {
      return deps.getDocument().getElementById('fh-monaco');
    } catch (_) {
      return null;
    }
  }

  function layoutEditors(): void {
    const diffEditor = deps.getDiffEditor() as { layout?(): void } | null;
    const editor = deps.getEditor() as { layout?(): void } | null;
    try { if (diffEditor && diffEditor.layout) diffEditor.layout(); } catch (_) {}
    try { if (editor && editor.layout) editor.layout(); } catch (_) {}
  }

  function ensureLayoutObserver(): void {
    try {
      if (layoutObserver) return;
      const win = deps.getWindow() as Window & { ResizeObserver?: typeof ResizeObserver };
      if (!win.ResizeObserver) return;
      const container = getEditorContainer();
      if (!container) return;
      layoutObserver = new win.ResizeObserver(() => {
        layoutEditors();
      });
      layoutObserver.observe(container);
      try {
        deps.getWindow().addEventListener('resize', layoutEditors);
      } catch (_) {}
    } catch (_) {}
  }

  function getThemeService(): unknown {
    try {
      const editor = deps.getEditor() as Record<string, unknown> | null;
      if (!editor) return null;
      let service = editor._themeService;
      if (!service && editor._instantiationService && typeof (editor._instantiationService as { invokeFunction?: (callback: (accessor: unknown) => unknown) => unknown }).invokeFunction === 'function') {
        try {
          service = (editor._instantiationService as { invokeFunction: (callback: (accessor: { get?: (id: { toString(): string }) => unknown }) => unknown) => unknown }).invokeFunction(
            (accessor) => accessor.get && accessor.get({ toString() { return 'standaloneThemeService'; } }),
          );
        } catch (_) {}
      }
      if (!service) {
        const keys = Object.keys(editor);
        for (let index = 0; index < keys.length; index += 1) {
          try {
            const value = editor[keys[index]];
            if (value && typeof value === 'object' && typeof (value as { getColorTheme?: () => unknown }).getColorTheme === 'function') {
              service = value;
              break;
            }
          } catch (_) {}
        }
      }
      return service || null;
    } catch (_) {
      return null;
    }
  }

  function forceSemanticHighlighting(): void {
    try {
      const service = getThemeService() as { getColorTheme?(): { semanticHighlighting?: boolean } | null } | null;
      if (!service || typeof service.getColorTheme !== 'function') {
        console.log('[semanticTokens] could not find themeService on editor');
        return;
      }
      const theme = service.getColorTheme();
      if (theme && !theme.semanticHighlighting) {
        Object.defineProperty(theme, 'semanticHighlighting', { value: true, writable: true, configurable: true });
        console.log('[semanticTokens] forced semanticHighlighting=true on theme');
      }
    } catch (error) {
      console.warn('[semanticTokens] forceSemanticHighlighting error', error);
    }
  }

  function installMarkerNavBindingsRuntime(targetEditor: unknown): void {
    try {
      installMarkerNavBindings(deps.getMonaco(), targetEditor, (dir: DirectionLike) => {
        jumpToMarker(deps.getMonaco(), targetEditor, deps.getModel(), dir);
      });
    } catch (_) {}
  }

  function ensureTouchSelection(reason: string): void {
    ensureTouchSelectionUtil(reason, {
      getEditor: deps.getEditor,
      getDiffEditor: deps.getDiffEditor,
      getCurrentPath: deps.getCurrentPath,
      getUiIpcSocket: deps.getUiIpcSocket,
      updateDebug: deps.updateDebug,
    });
  }

  function syncReadOnlyInputModeRuntime(editor: unknown): void {
    syncReadOnlyInputMode(editor, deps.getMonaco(), deps.getDocument());
  }

  function onEditorConfigChangedRuntime(editor: unknown): void {
    onEditorConfigChanged(editor, {
      syncReadOnlyInputModeFn: syncReadOnlyInputModeRuntime,
      lastKnownReadOnly,
      setLastKnownReadOnlyFn(readOnly: boolean | null) { lastKnownReadOnly = readOnly; },
      monacoRef: deps.getMonaco(),
      fetchFn(url: string, init?: RequestInit) {
        return deps.getWindow().fetch(url, init);
      },
    });
  }

  function applyEditorTypography(node: HTMLElement): void {
    try {
      const editor = deps.getEditor() as { getOption?(option: unknown): string | number | null } | null;
      const monacoRef = deps.getMonaco() as { editor?: { EditorOption?: Record<string, unknown> } } | null;
      if (!node || !editor || !monacoRef || !monacoRef.editor || !monacoRef.editor.EditorOption) return;
      let fontFamily: string | number | null = null;
      let fontSize: string | number | null = null;
      let lineHeight: string | number | null = null;
      try { fontFamily = editor.getOption ? editor.getOption(monacoRef.editor.EditorOption.fontFamily) : null; } catch (_) { fontFamily = null; }
      try { fontSize = editor.getOption ? editor.getOption(monacoRef.editor.EditorOption.fontSize) : null; } catch (_) { fontSize = null; }
      try { lineHeight = editor.getOption ? editor.getOption(monacoRef.editor.EditorOption.lineHeight) : null; } catch (_) { lineHeight = null; }
      if (fontFamily) node.style.fontFamily = String(fontFamily);
      if (fontSize) node.style.fontSize = String(fontSize) + 'px';
      if (lineHeight) node.style.lineHeight = String(lineHeight) + 'px';
    } catch (_) {}
  }

  function applyLineNumberSizing(): void {
    applyLineNumberSizingForEditors(
      deps.getEditor(),
      deps.getDiffEditor(),
      deps.getModel(),
      deps.getGitHeadModel(),
      deps.getGitDiskModel(),
    );
  }

  return {
    getEditorContainer,
    layoutEditors,
    ensureLayoutObserver,
    forceSemanticHighlighting,
    installMarkerNavBindings: installMarkerNavBindingsRuntime,
    ensureTouchSelection,
    syncReadOnlyInputMode: syncReadOnlyInputModeRuntime,
    onEditorConfigChanged: onEditorConfigChangedRuntime,
    applyEditorTypography,
    applyLineNumberSizing,
  };
}
