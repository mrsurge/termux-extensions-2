interface Preferences {
  showLineNumbers: boolean; showLineShading: boolean; showSyntaxHighlight: boolean;
  wordWrap: boolean; theme: string;
}
export function createEditorPreferences(options: {
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  themes: Record<string, unknown>;
}): { load(seed?: unknown): Preferences; save(value: unknown): Preferences };
