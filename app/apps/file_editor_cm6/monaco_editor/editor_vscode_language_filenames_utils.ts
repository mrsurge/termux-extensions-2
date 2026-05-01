export function mapVscodeLanguageFilenames(
  filenameMap: Map<string, string>,
  filenames: unknown,
  langId: string,
): void {
  try {
    if (!Array.isArray(filenames)) return;
    for (let index = 0; index < filenames.length; index += 1) {
      const name = String(filenames[index] || '').trim();
      if (!name) continue;
      filenameMap.set(name, langId);
    }
  } catch (_) {}
}
