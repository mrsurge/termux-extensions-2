export function warnIfPlaintextOnlyLanguages(langs) {
  if (langs.length <= 1 && langs[0] === 'plaintext') {
    console.warn('[Monaco] language registry still plaintext-only');
  }
}
