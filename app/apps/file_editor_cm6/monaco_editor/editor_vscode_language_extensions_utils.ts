export function mapVscodeLanguageExtensions(
  extensionMap: Map<string, string>,
  extensions: unknown,
  langId: string,
): void {
  try {
    if (!Array.isArray(extensions)) return;
    for (let index = 0; index < extensions.length; index += 1) {
      const ext = String(extensions[index] || '').trim();
      if (!ext) continue;
      extensionMap.set(ext, langId);
    }
  } catch (_) {}
}
